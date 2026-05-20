/* eslint-disable */
/**
 * AI Agent Tools — Gemini Function Calling 工具定義
 *
 * 讓 AI 模型自主決定要查什麼資料、執行什麼操作。
 * 不再是預先注入所有資料到 prompt，而是 AI 按需調用工具。
 *
 * 架構：
 * 1. 定義 Tool declarations (Gemini function calling schema)
 * 2. 實作 Tool executors (實際執行的函數)
 * 3. 支援讀取 + 寫入操作 (AI 可代理使用者完成所有事)
 * 4. 角色感知 (學生/教師/管理者 各有不同可用工具)
 */

import { getDataSource, hasDataSource, type DataSource } from '../data/source';
// LMS v2: 改 import 自 supabaseLmsCache facade。
// flag OFF 時:facade 自動委派回 puDataCache (TronClass),行為與舊版完全相同。
// flag ON  時:同樣的函數會自動改打 Supabase,AI 立即拿到新 LMS 資料。
// 介面 100% 對齊,所有原本 import 語法都不用改。
import {
  getAnyCachedCourses as getCachedCourses,
  getAnyCachedGrades as getCachedGrades,
  getAnyCachedAnnouncements as getCachedAnnouncements,
  getAnyCachedStudentInfo as getCachedStudentInfo,
  getAnyCachedTCCourses as getCachedTCCourses,
  getAnyCachedTCActivities as getCachedTCActivities,
  getAnyCachedTCModules,
  getAnyCachedTCAttendance as getCachedTCAttendance,
  getAnyCachedTCTodos as getCachedTCTodos,
  getAnyCachedTCAnnouncements as getCachedTCAnnouncements,
  getAnyCachedTCExams as getCachedTCExams,
  getAnyCachedTCScoreItems as getCachedTCScoreItems,
  getAnyCachedTCHomeworkActivities as getCachedTCHomeworkActivities,
  getAnyCachedTCDiscussions as getCachedTCDiscussions,
  getAnyCachedTCMaterials as getCachedTCMaterials,
  getAnyCachedTCCourseMembers as getCachedTCCourseMembers,
  getAnyCachedTCCourseAnnouncements as getCachedTCCourseAnnouncements,
  syncAllData,
} from './supabaseLmsCache';
import type { CampusActorRole } from '../data';
import {
  getPuDiningMenuItems,
  getPuDiningCafeterias,
  isProvidenceDiningSchoolId,
} from '../data/puDiningCatalog';
import {
  distillLearnedSkillFromToolSuccess,
  type LearnedSkill,
} from '../data/puAIAgentData';
import type { AssistantChoiceMenu, InboxTask } from '../data/types';
import {
  formatLunchRecommendationReply,
  recommendLunchCandidates,
  type LunchMenuRow,
} from './recommendLunch';
import { understand, rankMenuCandidates, type SemanticFrame } from './aiSemanticReasoner';
import { recordUnknownConcept, lookupLearnedConcept, linkConceptToMeaning } from './aiActiveLearning';
import {
  createDemoDiningOrder,
  getDemoDiningCafeterias,
  getDemoDiningMenuItems,
} from './demoOrdering';

/** 與 AIChatScreen 訂餐選單一致：itemId@@vendorId */
const DINING_CHOICE_ID_SEP = '@@';

function diningVendorKeyForMenu(m: { cafeteriaId?: string; cafeteria_id?: string; cafeteria?: string }, cafeterias: any[]): string {
  const cid = m.cafeteriaId ?? m.cafeteria_id ?? '';
  const caf =
    cafeterias.find((c: any) => c.id === cid) ??
    cafeterias.find((c: any) => c.name === m.cafeteria);
  if (caf) return String(caf.merchantId ?? caf.id ?? '').trim();
  return String(cid ?? '').trim();
}

function encodeDiningChoiceMenuId(m: { id?: string }, cafeterias: any[]): string {
  const v = diningVendorKeyForMenu(m as any, cafeterias);
  if (!v || !m?.id) return String(m.id ?? '');
  return `${m.id}${DINING_CHOICE_ID_SEP}${v}`;
}

function hasInvalidDiningQuantityRequest(text: string): boolean {
  return /(?:^|[^\d])(?:[-−－]\s*\d+|0)\s*[碗份個杯盤道]/.test(text) ||
    /負\s*\d+\s*[碗份個杯盤道]/.test(text);
}

function hasInvalidDiningQuantityValue(value: unknown): boolean {
  if (value == null || String(value).trim() === '') return false;
  const n = Number(String(value).trim());
  return !Number.isFinite(n) || n < 1;
}

function menuLooksVegetarian(m: any): boolean {
  const text = [
    m?.name,
    m?.description,
    m?.category,
    Array.isArray(m?.tags) ? m.tags.join(' ') : '',
  ].join(' ');
  return m?.isVegetarian === true ||
    m?.vegetarian === true ||
    /素|蔬|沙拉|青菜|vegetarian|vegan/i.test(text);
}

// ─── 共用：從訊息中解析「第 N 個」/「最後一個」 ───
function parseOrdinalFromMessage(msg: string): number | null {
  if (!msg) return null;
  const cn: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const m = msg.match(/第\s*([一二兩三四五六七八九十\d]+)\s*[個份項道杯碗本]/);
  if (m) {
    const n = cn[m[1]] ?? parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  if (/最後[一那]?個/.test(msg)) return -1;
  if (/^第一個$/.test(msg.trim())) return 1;
  return null;
}

// ─── 語意層輔助：時段中文、選單建構、共用下單流程 ───
function mealTimeLabel(t: 'breakfast' | 'lunch' | 'dinner' | 'snack'): string {
  return t === 'breakfast' ? '早餐' : t === 'lunch' ? '午餐' : t === 'dinner' ? '晚餐' : '下午茶';
}

function buildDiningChoiceMenu(
  menus: any[],
  cafeterias: any[],
  frame?: SemanticFrame,
): AssistantChoiceMenu {
  const titleSuffix = frame?.slots.meal_time
    ? `（${mealTimeLabel(frame.slots.meal_time)}推薦）`
    : '';
  return {
    title: `請選擇餐點${titleSuffix}`,
    prompt: '點選下方任一項，就可以幫你下單；或回「第 N 個」、「不是這個是 XXX」我就學會了',
    producedByTool: 'create_order',
    options: menus.slice(0, 8).map((m: any, i: number) => ({
      id: encodeDiningChoiceMenuId(m, cafeterias),
      label: `${m.name}${typeof m.price === 'number' ? ` · $${m.price}` : ''}`,
      subtitle: m.cafeteria ? String(m.cafeteria) : undefined,
      sendAsUser: `幫我點第${i + 1}個`,
    })),
  };
}

/** 共用下單流程；matches.length === 1 與 ordinal-resolved 都會走這裡 */
async function placeOrderWith(
  matched: any,
  quantity: number,
  cafeteriasForMenus: any[],
  ctx: ExecutorContext,
  args: Record<string, string>,
): Promise<ToolCallResult> {
  const cafeteriaId = matched.cafeteriaId ?? matched.cafeteria_id ?? '';
  const cafeteria =
    cafeteriasForMenus.find((c: any) => c.id === cafeteriaId) ??
    cafeteriasForMenus.find((c: any) => c.name === matched.cafeteria) ??
    cafeteriasForMenus[0];
  const vendorId = diningVendorKeyForMenu(matched, cafeteriasForMenus);
  const itemId = String(matched.id ?? '').trim();
  if (!itemId) {
    return { success: false, isWrite: true, summary: '無法辨識餐點 ID（itemId），請改點選下方選單或換個說法。' };
  }
  if (!vendorId) {
    return { success: false, isWrite: true, summary: '無法辨識店家 ID（vendorId），請確認菜單已同步或改選其他餐廳。' };
  }
  if (!Number.isFinite(quantity) || quantity < 1) {
    return { success: false, isWrite: true, summary: '請提供有效的數量（quantity），至少為 1。' };
  }
  // 異常數量保護：一個人不太可能一次訂 > 20 份；交回 clarification 而不是直接送單
  // 避免：使用者打錯字 / AI 誤判 ordinal 為 quantity（雖然 detectQuantity 已修，但雙保險）
  if (quantity > 20) {
    return {
      success: false,
      isWrite: false,
      summary: `你想點「${matched.name}」${quantity} 份嗎？一次超過 20 份是大量訂購，我先不直接下單。\n\n如果是為團體訂餐，請改到餐廳頁面確認；如果只是想點一份，請改說「點一份${matched.name}」。`,
    };
  }
  const qty = Math.floor(quantity);
  // price 可能是 number、未定義、或非數字字串 — 取 number；其他情況視為「店家未公告」(0)
  const rawPrice: unknown = matched.price;
  const price: number =
    typeof rawPrice === 'number' && Number.isFinite(rawPrice) ? rawPrice : 0;
  // totalAmount = 0 時，下游 OrderSuccessCard 會顯示「金額待店家報價」而不是 $0
  const totalAmount = price * qty;

  if (ctx.userId?.startsWith('demo_')) {
    const demo = await createDemoDiningOrder({
      userId: ctx.userId,
      schoolId: ctx.schoolId,
      role: ctx.role,
      merchantId: vendorId,
      merchantName: cafeteria?.name ?? matched.cafeteria,
      cafeteriaId: cafeteria?.id ?? cafeteriaId,
      itemId,
      itemName: matched.name,
      quantity: qty,
      price,
      note: args.note,
      source: 'ai_agent',
    });
    const suffix = demo.substituted ? '（原指定品項不可用，已改用 demo 可下單品項）' : '';
    return {
      success: true,
      isWrite: true,
      data: demo.order,
      summary: [
        '✅ 已送出 demo 訂單。',
        `身份：${demo.actor.name}（${demo.actor.role}）`,
        `餐點：${demo.item.name} x ${demo.quantity}${suffix}`,
        `餐廳：${demo.merchant.name}`,
        price ? `金額：$${demo.total}` : '',
        `訂單編號：${demo.order.id}`,
        '狀態：待店家確認',
      ].filter(Boolean).join('\n'),
    };
  }

  if (!hasDataSource()) {
    return {
      success: true,
      isWrite: true,
      summary: [
        '已幫你選好餐點！',
        `餐點：${matched.name} x ${qty}`,
        cafeteria?.name ? `餐廳：${cafeteria.name}` : matched.cafeteria ? `餐廳：${matched.cafeteria}` : '',
        price ? `金額：$${totalAmount}` : '',
        '請到點餐頁面完成最終確認下單。',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  const ds = getDataSource();
  const order = await ds.createOrder({
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    cafeteriaId: cafeteria?.id ?? cafeteriaId,
    merchantId: cafeteria?.merchantId ?? cafeteria?.id ?? cafeteriaId,
    cafeteria: cafeteria?.name ?? matched.cafeteria ?? '校園餐廳',
    merchantName: cafeteria?.name ?? matched.cafeteria ?? '校園餐廳',
    items: [
      {
        menuItemId: matched.id,
        name: matched.name,
        price,
        quantity: qty,
        note: args.note,
      },
    ],
    totalAmount,
    note: args.note,
    source: 'ai_agent',
  } as any);

  if (!order?.id) {
    return {
      success: false,
      isWrite: true,
      summary: '訂餐失敗：目前系統忙碌，請改到餐廳點餐頁面完成。',
    };
  }

  return {
    success: true,
    isWrite: true,
    data: order,
    summary: [
      '✅ 已送出訂單。',
      `餐點：${matched.name} x ${qty}`,
      cafeteria?.name ? `餐廳：${cafeteria.name}` : matched.cafeteria ? `餐廳：${matched.cafeteria}` : '',
      price ? `金額：$${totalAmount}` : '',
      `訂單編號：${order.id}`,
      '狀態：待店家確認',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

/** Cloud Function createOrder 錯誤 → 使用者可讀說明（勿只顯示 not-found） */
function formatCreateOrderToolError(e: unknown): string {
  const anyErr = e as { code?: string; message?: string };
  const code = String(anyErr?.code ?? '').toLowerCase();
  const msg = String(anyErr?.message ?? e ?? '');
  const lower = msg.toLowerCase();

  if (
    code.includes('not-found') ||
    lower.includes('not-found') ||
    lower.includes('cafeteria not found')
  ) {
    return [
      '無法建立訂單：雲端後台找不到這間餐廳的正式資料。',
      '常見原因：菜單來自 App 內建的校園目錄示範，但該餐廳尚未在後台建檔或未同步。',
      '請到「校園 → 餐廳」或點餐頁，選擇已上架且可線上接單的店家；或請管理員同步餐廳資料。',
    ].join('\n');
  }
  if (
    code.includes('failed-precondition') ||
    lower.includes('failed-precondition') ||
    lower.includes('店家尚未開通')
  ) {
    return [
      '後端拒絕下單：餐廳可能尚未開通線上接單，或目前沒有可接單的店員端。',
      '請改選其他已開通店家，或到現場／點餐頁確認。',
    ].join('\n');
  }
  if (code.includes('unauthenticated') || lower.includes('must be logged in')) {
    return '請先登入再訂餐。';
  }
  if (code.includes('invalid-argument')) {
    return '訂餐資料不完整或格式不符，請從點餐頁重新選擇品項後再試。';
  }
  return msg ? `訂餐失敗：${msg}` : '訂餐失敗：未知錯誤';
}

// ════════════════════════════════════════════════════════════
// 1. Gemini Function Declarations
// ════════════════════════════════════════════════════════════

export type GeminiToolDeclaration = {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
};

/**
 * 所有可用工具的宣告 — 給 Gemini 的 function calling schema
 */
export function getToolDeclarations(role?: CampusActorRole): GeminiToolDeclaration[] {
  const readTools: GeminiToolDeclaration[] = [
    // ── 學業資料查詢 ──
    {
      name: 'query_courses',
      description: '查詢使用者的課程列表（今日課表、本學期所有課程）。回傳課程名稱、教師、時間、地點。',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            description: '篩選條件：today=今天的課, all=所有課程, next=下一堂課',
            enum: ['today', 'all', 'next'],
          },
        },
        required: ['filter'],
      },
    },
    {
      name: 'query_grades',
      description: '查詢使用者的成績。回傳各科成績、GPA、學分數。可查詢特定學期或所有學期。',
      parameters: {
        type: 'object',
        properties: {
          semester: { type: 'string', description: '學期，如 "112-2"。留空則查全部。' },
        },
      },
    },
    {
      name: 'query_assignments',
      description: '查詢待繳作業和考試。回傳作業標題、截止日期、所屬課程、是否逾期。',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: '篩選：pending=尚未繳交（含已逾期但未繳）, overdue=已逾期且尚未繳交, all=全部相關作業/考試狀態',
            enum: ['pending', 'overdue', 'all'],
          },
        },
      },
    },
    {
      name: 'query_attendance',
      description: '查詢出席記錄。回傳各課出席率、缺席次數、風險等級。',
      parameters: {
        type: 'object',
        properties: {
          courseId: { type: 'string', description: '指定課程 ID，留空查全部課程' },
        },
      },
    },
    {
      name: 'query_student_info',
      description: '查詢學生個人資訊（學號、系所、年級、入學年、學籍狀態）。',
      parameters: { type: 'object', properties: {} },
    },

    // ── 學分與畢業分析 ──
    {
      name: 'analyze_credits',
      description: '分析學分進度：已修學分、畢業需求 128 學分、各類別（通識/必修/選修）進度、預計畢業時間。',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'predict_gpa',
      description: '預測 GPA 趨勢：基於歷史成績用線性回歸分析未來走向，判斷畢業風險。',
      parameters: { type: 'object', properties: {} },
    },

    // ── 校園資訊 ──
    {
      name: 'query_announcements',
      description: '查詢校園公告。回傳最新公告標題、來源、發布時間。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'string', description: '數量限制，預設 5' },
        },
      },
    },
    {
      name: 'query_events',
      description: '查詢校園活動。回傳活動名稱、時間、地點、是否可報名。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'string', description: '數量限制，預設 5' },
        },
      },
    },
    {
      name: 'query_menus',
      description: '查詢餐廳菜單。回傳今日各餐廳的餐點名稱、價格。也可搜尋特定食物。',
      parameters: {
        type: 'object',
        properties: {
          cafeteria: { type: 'string', description: '指定餐廳名稱，留空查全部' },
          keyword: { type: 'string', description: '搜尋關鍵字，例如「滷肉飯」「蛋餅」' },
        },
      },
    },
    {
      name: 'recommend_lunch',
      description:
        '依已載入菜單推薦午餐／正餐（排除飲料甜點為主），先給候選再請使用者確認是否下單。不要用它取代 create_order。',
      parameters: {
        type: 'object',
        properties: {
          budget: { type: 'string', description: '預算上限（元），可留空' },
          timeSlot: {
            type: 'string',
            description: 'lunch / dinner / breakfast，預設 lunch',
            enum: ['lunch', 'dinner', 'breakfast'],
          },
        },
      },
    },
    {
      name: 'query_library',
      description: '搜尋圖書館書籍，查詢借閱記錄、座位可用數。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'search=搜尋書籍, loans=我的借閱, seats=座位狀態',
            enum: ['search', 'loans', 'seats'],
          },
          keyword: { type: 'string', description: '搜尋關鍵字（action=search 時使用）' },
        },
        required: ['action'],
      },
    },
    {
      name: 'query_bus',
      description: '查詢公車路線和即時到站資訊。',
      parameters: {
        type: 'object',
        properties: {
          stopId: { type: 'string', description: '站牌 ID，留空查所有路線' },
        },
      },
    },
    {
      name: 'query_notifications',
      description: '查詢使用者的通知列表。回傳未讀和已讀通知。',
      parameters: {
        type: 'object',
        properties: {
          unreadOnly: { type: 'string', description: 'true=只查未讀, false=全部', enum: ['true', 'false'] },
        },
      },
    },
    {
      name: 'query_calendar',
      description: '查詢行事曆事件。可指定日期範圍。',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: '起始日期 YYYY-MM-DD，預設今天' },
          endDate: { type: 'string', description: '結束日期 YYYY-MM-DD，預設七天後' },
        },
      },
    },
    {
      name: 'query_conversations',
      description: '查詢私訊對話列表。回傳最近對話、未讀訊息數。',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'query_orders',
      description: '查詢訂單記錄。回傳餐廳訂單狀態、金額。',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: '篩選狀態：pending, completed, all', enum: ['pending', 'completed', 'all'] },
        },
      },
    },

    // ── 綜合分析 ──
    {
      name: 'comprehensive_analysis',
      description: '進行全面學業分析：綜合成績、出席、作業、學分，產生深度報告和風險評估。使用者問到「分析我的狀況」「我的學業怎麼樣」時使用。',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'daily_briefing',
      description: '產生今日簡報：今天的課程、待繳作業、重要通知、行事曆事件的整合摘要。使用者問到「今天有什麼」「今日摘要」時使用。',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'assistant_help',
      description: '說明 AI 校園助理可以做哪些事，以及哪些操作需要更多資訊或確認。',
      parameters: { type: 'object', properties: {} },
    },
  ];

  // ── 寫入/代理操作 ──
  const writeTools: GeminiToolDeclaration[] = [
    {
      name: 'send_message',
      description: '代替使用者發送私訊給其他同學。',
      parameters: {
        type: 'object',
        properties: {
          peerId: { type: 'string', description: '對方的使用者 ID' },
          content: { type: 'string', description: '訊息內容' },
        },
        required: ['peerId', 'content'],
      },
    },
    {
      name: 'create_calendar_event',
      description: '代替使用者在行事曆上建立新事件（讀書計畫、提醒等）。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '事件標題' },
          startAt: { type: 'string', description: '開始時間 ISO 8601' },
          endAt: { type: 'string', description: '結束時間 ISO 8601' },
          location: { type: 'string', description: '地點（選填）' },
          description: { type: 'string', description: '說明（選填）' },
        },
        required: ['title', 'startAt'],
      },
    },
    {
      name: 'register_event',
      description: '代替使用者報名校園活動。',
      parameters: {
        type: 'object',
        properties: {
          eventId: { type: 'string', description: '活動 ID' },
        },
        required: ['eventId'],
      },
    },
    {
      name: 'reserve_library_seat',
      description: '代替使用者預約圖書館座位。',
      parameters: {
        type: 'object',
        properties: {
          seatId: { type: 'string', description: '座位 ID' },
          date: { type: 'string', description: '日期 YYYY-MM-DD' },
          startTime: { type: 'string', description: '開始時間 HH:mm' },
          endTime: { type: 'string', description: '結束時間 HH:mm' },
        },
        required: ['seatId', 'date', 'startTime', 'endTime'],
      },
    },
    {
      name: 'borrow_book',
      description: '代替使用者借閱圖書館的書。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '書籍 ID' },
        },
        required: ['bookId'],
      },
    },
    {
      name: 'renew_book',
      description: '代替使用者續借圖書館的書。',
      parameters: {
        type: 'object',
        properties: {
          loanId: { type: 'string', description: '借閱記錄 ID' },
        },
        required: ['loanId'],
      },
    },
    {
      name: 'mark_notifications_read',
      description: '代替使用者將通知標為已讀。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'all=全部已讀, single=單筆已讀', enum: ['all', 'single'] },
          notificationId: { type: 'string', description: '通知 ID（action=single 時使用）' },
        },
        required: ['action'],
      },
    },
    {
      name: 'create_repair_request',
      description: '代替使用者提交宿舍維修申請。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: '維修類型：electrical, plumbing, furniture, appliance, other' },
          title: { type: 'string', description: '問題描述標題' },
          description: { type: 'string', description: '詳細描述' },
          room: { type: 'string', description: '房間號' },
        },
        required: ['type', 'title', 'description'],
      },
    },
    // ── 新增：完整學生代理操作 ──
    {
      name: 'submit_assignment',
      description: '代替使用者繳交作業。',
      parameters: {
        type: 'object',
        properties: {
          assignmentId: { type: 'string', description: '作業 ID' },
          groupId: { type: 'string', description: '群組/課程 ID' },
          content: { type: 'string', description: '繳交的文字內容' },
        },
        required: ['assignmentId', 'groupId', 'content'],
      },
    },
    {
      name: 'enroll_course',
      description: '代替使用者選課。',
      parameters: {
        type: 'object',
        properties: {
          courseId: { type: 'string', description: '課程 ID' },
          semester: { type: 'string', description: '學期，如 113-2' },
        },
        required: ['courseId', 'semester'],
      },
    },
    {
      name: 'drop_course',
      description: '代替使用者退選課程。',
      parameters: {
        type: 'object',
        properties: {
          enrollmentId: { type: 'string', description: '選課紀錄 ID' },
        },
        required: ['enrollmentId'],
      },
    },
    {
      name: 'cancel_seat_reservation',
      description: '代替使用者取消圖書館座位預約。',
      parameters: {
        type: 'object',
        properties: {
          reservationId: { type: 'string', description: '預約 ID' },
        },
        required: ['reservationId'],
      },
    },
    {
      name: 'return_book',
      description: '代替使用者歸還圖書館的書。',
      parameters: {
        type: 'object',
        properties: {
          loanId: { type: 'string', description: '借閱記錄 ID' },
        },
        required: ['loanId'],
      },
    },
    {
      name: 'unregister_event',
      description: '代替使用者取消活動報名。',
      parameters: {
        type: 'object',
        properties: {
          eventId: { type: 'string', description: '活動 ID' },
        },
        required: ['eventId'],
      },
    },
    {
      name: 'check_in_attendance',
      description: '代替學生簽到（出席打卡）。',
      parameters: {
        type: 'object',
        properties: {
          courseSpaceId: { type: 'string', description: '課程空間 ID' },
          sessionId: { type: 'string', description: '點名場次 ID' },
          qrToken: { type: 'string', description: 'QR code token（選填）' },
        },
        required: ['courseSpaceId', 'sessionId'],
      },
    },
    {
      name: 'create_health_appointment',
      description: '代替使用者預約健康中心看診。',
      parameters: {
        type: 'object',
        properties: {
          department: { type: 'string', description: '科別：general, dental, counseling, physical_therapy' },
          date: { type: 'string', description: '日期 YYYY-MM-DD' },
          timeSlot: { type: 'string', description: '時段 HH:mm' },
          reason: { type: 'string', description: '看診原因' },
        },
        required: ['department', 'date', 'timeSlot'],
      },
    },
    {
      name: 'reserve_washing_machine',
      description: '代替使用者預約洗衣機。',
      parameters: {
        type: 'object',
        properties: {
          machineId: { type: 'string', description: '洗衣機 ID' },
        },
        required: ['machineId'],
      },
    },
    {
      name: 'create_lost_found',
      description: '代替使用者發布失物招領或拾獲物品。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'lost=遺失, found=拾獲', enum: ['lost', 'found'] },
          title: { type: 'string', description: '物品名稱' },
          description: { type: 'string', description: '詳細描述' },
          location: { type: 'string', description: '遺失/拾獲地點' },
          contactInfo: { type: 'string', description: '聯絡方式' },
        },
        required: ['type', 'title', 'description'],
      },
    },
    {
      name: 'join_group',
      description: '代替使用者加入群組（學習小組等）。',
      parameters: {
        type: 'object',
        properties: {
          groupId: { type: 'string', description: '群組 ID' },
          joinCode: { type: 'string', description: '加入碼（選填）' },
        },
        required: ['groupId'],
      },
    },
    {
      name: 'create_group_post',
      description: '代替使用者在群組內發布貼文。',
      parameters: {
        type: 'object',
        properties: {
          groupId: { type: 'string', description: '群組 ID' },
          content: { type: 'string', description: '貼文內容' },
          type: { type: 'string', description: '類型', enum: ['discussion', 'question', 'resource', 'announcement'] },
        },
        required: ['groupId', 'content'],
      },
    },
    {
      name: 'confirm_package_pickup',
      description: '代替使用者確認領取宿舍包裹。',
      parameters: {
        type: 'object',
        properties: {
          packageId: { type: 'string', description: '包裹 ID' },
        },
        required: ['packageId'],
      },
    },
    {
      name: 'request_leave',
      description: '代替使用者請假。自動查找今天/指定日期的課程，並提交請假申請。',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: '請假原因（如：生病、家庭因素、個人事務）' },
          date: { type: 'string', description: '請假日期 YYYY-MM-DD（選填，預設今天）' },
          courseName: { type: 'string', description: '課程名稱（選填，自動查找當天課程）' },
          leaveType: { type: 'string', description: '假別：sick=病假, personal=事假, official=公假', enum: ['sick', 'personal', 'official'] },
        },
        required: ['reason'],
      },
    },
    {
      name: 'create_order',
      description:
        '代替使用者從「已載入菜單」訂餐（與 App 點餐流程一致：比對品項→送 createOrder API）。須已登入。菜單來自 Firestore 與（靜宜）內建目錄合併；若使用者的餐點名稱 0 筆匹配會回傳建議品項；多筆匹配回傳清單請使用者選；僅 1 筆則嘗試建立訂單。後端會驗證餐廳是否開通接單、店員是否上線，失敗時不可宣稱已下單。無 DataSource 時只能提示使用者到點餐頁手動確認。',
      parameters: {
        type: 'object',
        properties: {
          itemName: { type: 'string', description: '餐點名稱（如：牛肉麵、雞排飯；盡量與菜單用語一致）' },
          cafeteria: { type: 'string', description: '指定餐廳名稱（選填，用於多品項時縮小範圍）' },
          quantity: { type: 'string', description: '數量（預設 1）' },
          note: { type: 'string', description: '備註（如：不要香菜）' },
        },
        required: ['itemName'],
      },
    },
    {
      name: 'cancel_order',
      description: '代替使用者取消訂單。',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: '訂單 ID' },
        },
        required: ['orderId'],
      },
    },
    {
      name: 'create_print_job',
      description: '代替使用者提交列印工作。',
      parameters: {
        type: 'object',
        properties: {
          printerId: { type: 'string', description: '印表機 ID' },
          fileName: { type: 'string', description: '檔案名稱' },
          copies: { type: 'string', description: '份數' },
          colorMode: { type: 'string', description: '色彩模式', enum: ['bw', 'color'] },
          paperSize: { type: 'string', description: '紙張大小', enum: ['A4', 'A3', 'B5', 'Letter'] },
        },
        required: ['printerId', 'fileName'],
      },
    },
    {
      name: 'rate_menu_item',
      description: '代替使用者為餐廳菜色評分。',
      parameters: {
        type: 'object',
        properties: {
          menuItemId: { type: 'string', description: '菜色 ID' },
          rating: { type: 'string', description: '評分 1-5' },
        },
        required: ['menuItemId', 'rating'],
      },
    },
    {
      name: 'update_calendar_event',
      description: '代替使用者修改行事曆事件。',
      parameters: {
        type: 'object',
        properties: {
          eventId: { type: 'string', description: '事件 ID' },
          title: { type: 'string', description: '新標題（選填）' },
          startAt: { type: 'string', description: '新開始時間 ISO 8601（選填）' },
          endAt: { type: 'string', description: '新結束時間 ISO 8601（選填）' },
          location: { type: 'string', description: '新地點（選填）' },
        },
        required: ['eventId'],
      },
    },
    {
      name: 'delete_calendar_event',
      description: '代替使用者刪除行事曆事件。',
      parameters: {
        type: 'object',
        properties: {
          eventId: { type: 'string', description: '事件 ID' },
        },
        required: ['eventId'],
      },
    },
    {
      name: 'query_dorm_info',
      description: '查詢使用者的宿舍資訊（房號、包裹、洗衣機等）。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'query_health_records',
      description: '查詢使用者的健康記錄與看診紀錄。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'query_loans',
      description: '查詢使用者目前的圖書借閱紀錄。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'query_enrollments',
      description: '查詢使用者的選課紀錄。',
      parameters: {
        type: 'object',
        properties: {
          semester: { type: 'string', description: '學期（選填）' },
        },
      },
    },
    {
      name: 'query_exams',
      description: '查詢課程的考試列表，包含考試時間、總分、提交次數等詳細資訊。',
      parameters: {
        type: 'object',
        properties: {
          courseId: { type: 'number', description: '課程 ID（選填，不填則查全部）' },
        },
      },
    },
    {
      name: 'query_score_items',
      description: '查詢課程的評分項目（評量方式及佔比），包含作業、考試、出席等各項配分。',
      parameters: {
        type: 'object',
        properties: {
          courseId: { type: 'number', description: '課程 ID（選填）' },
        },
      },
    },
    {
      name: 'query_discussions',
      description: '查詢課程的討論區列表，包含貼文數、最新回覆時間等。',
      parameters: {
        type: 'object',
        properties: {
          courseId: { type: 'number', description: '課程 ID（選填）' },
        },
      },
    },
    {
      name: 'query_materials',
      description: '查詢課程教材與資源，包含檔案名稱、大小、類型等。',
      parameters: {
        type: 'object',
        properties: {
          courseId: { type: 'number', description: '課程 ID（選填）' },
        },
      },
    },
    {
      name: 'query_course_members',
      description: '查詢課程的成員名單（同學、教師、助教）。',
      parameters: {
        type: 'object',
        properties: {
          courseId: { type: 'number', description: '課程 ID' },
        },
        required: ['courseId'],
      },
    },
    {
      name: 'query_homework_detail',
      description: '查詢各課程的作業活動詳情，包含繳交狀態、截止時間、提交紀錄等。',
      parameters: {
        type: 'object',
        properties: {
          courseId: { type: 'number', description: '課程 ID（選填）' },
        },
      },
    },
    {
      name: 'query_course_announcements',
      description: '查詢特定課程的公告列表。',
      parameters: {
        type: 'object',
        properties: {
          courseId: { type: 'number', description: '課程 ID（選填）' },
        },
      },
    },
  ];

  // ── 教師專用工具 ──
  const teacherTools: GeminiToolDeclaration[] = [
    {
      name: 'start_attendance',
      description: '教師專用：開始一堂課的點名（產生 QR Code）。',
      parameters: {
        type: 'object',
        properties: {
          courseSpaceId: { type: 'string', description: '課程空間 ID' },
        },
        required: ['courseSpaceId'],
      },
    },
    {
      name: 'create_assignment',
      description: '教師專用：建立新作業。',
      parameters: {
        type: 'object',
        properties: {
          groupId: { type: 'string', description: '群組 ID' },
          title: { type: 'string', description: '作業標題' },
          description: { type: 'string', description: '作業說明' },
          dueAt: { type: 'string', description: '截止日期 ISO 8601' },
        },
        required: ['groupId', 'title'],
      },
    },
    {
      name: 'grade_submission',
      description: '教師專用：批改學生繳交的作業。',
      parameters: {
        type: 'object',
        properties: {
          submissionId: { type: 'string', description: '繳交記錄 ID' },
          grade: { type: 'string', description: '分數 (0-100)' },
          feedback: { type: 'string', description: '批改回饋' },
        },
        required: ['submissionId', 'grade'],
      },
    },
    {
      name: 'create_announcement',
      description: '教師/管理者專用：發布校園公告。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '公告標題' },
          body: { type: 'string', description: '公告內容' },
          category: { type: 'string', description: '類別', enum: ['general', 'academic', 'event', 'emergency'] },
        },
        required: ['title', 'body'],
      },
    },
  ];

  const tools = [...readTools, ...writeTools];

  // 加入教師/管理者專用工具
  if (role === 'teacher' || role === 'admin' || role === 'staff') {
    tools.push(...teacherTools);
  }

  return tools;
}

// ════════════════════════════════════════════════════════════
// 2. Tool Executors — 實際執行的函數
// ════════════════════════════════════════════════════════════

export type ToolCallResult = {
  success: boolean;
  data?: unknown;
  error?: string;
  /** 是否為寫入操作（需要確認） */
  isWrite?: boolean;
  /** 使用者友善的結果摘要 */
  summary: string;
  /** 寫入成功時可附帶蒸餾技能，供持久化到本地訓練庫 */
  learnedSkill?: LearnedSkill;
  /** 需要使用者從多個選項中點選時（例如訂餐多筆匹配） */
  choiceMenu?: AssistantChoiceMenu;
};

export type ExecutorContext = {
  userId?: string;
  schoolId: string;
  role?: CampusActorRole;
  /** 當前使用者自然語言請求（用於成功後蒸餾技能；勿傳內部工具選擇 prompt） */
  lastUserMessage?: string;
  /** 上一輪 choiceMenu；registry 用於解析「第 N 個」這類回覆 */
  lastChoiceMenu?: AssistantChoiceMenu;
};

async function executeRegistryTool(
  toolName: string,
  args: Record<string, string>,
  ctx: ExecutorContext,
): Promise<ToolCallResult> {
  // Lazy require 避免 aiToolRegistry <-> aiAgentTools 的 legacy fallback 循環相依。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { executeToolStandard } = require('./aiToolRegistry') as typeof import('./aiToolRegistry');
  const result = await executeToolStandard(toolName, args, {
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    role: ctx.role,
    lastUserMessage: ctx.lastUserMessage,
    lastChoiceMenu: ctx.lastChoiceMenu,
  });

  return {
    success: result.success,
    data: result.data,
    error: result.error,
    isWrite: result.isWrite,
    summary: result.summary,
    learnedSkill: result.learnedSkill,
    choiceMenu: result.choiceMenu,
    ...({
      errorCode: result.errorCode,
      isDraft: result.isDraft,
      missingInfo: result.missingInfo,
      recordId: result.recordId,
    } as any),
  };
}

/**
 * 執行單一工具呼叫
 */
export async function executeTool(
  toolName: string,
  args: Record<string, string>,
  ctx: ExecutorContext,
): Promise<ToolCallResult> {
  try {
    switch (toolName) {
      case 'order_food':
        return await executeRegistryTool('order_food', args, ctx);
    }

    const executor = TOOL_EXECUTORS[toolName];
    if (!executor) {
      return { success: false, error: `未知的工具: ${toolName}`, summary: '無法執行' };
    }
    const result = await executor(args, ctx);
    if (result.success && result.isWrite && ctx.lastUserMessage?.trim()) {
      const learned = distillLearnedSkillFromToolSuccess(
        ctx.lastUserMessage.trim(),
        toolName,
        args,
        result.summary,
      );
      if (learned) return { ...result, learnedSkill: learned };
    }
    return result;
  } catch (e: any) {
    console.warn(`[AIAgent] Tool ${toolName} failed:`, e);
    return { success: false, error: e?.message ?? String(e), summary: '執行失敗' };
  }
}

/** TronClass activity.type：是否為作業／測驗類（排除討論區、教材等） */
function tcActivityTypeIsAssignmentLike(type: unknown): boolean {
  const t = String(type ?? '').toLowerCase();
  if (!t) return false;
  return (
    t === 'homework' ||
    t === 'quiz' ||
    t === 'exam' ||
    t === 'assignment' ||
    t === 'online_quiz' ||
    t.includes('homework') ||
    t.includes('quiz') ||
    t.includes('exam') ||
    t.includes('作業') ||
    t.includes('測驗')
  );
}

/** 與 PUAdapter.listInboxTasks 篩選一致：已繳／已評分不視為待繳 */
function tcActivityNeedsSubmit(activity: { status?: unknown }): boolean {
  const s = String(activity.status ?? '').toLowerCase();
  return s !== 'graded' && s !== 'submitted';
}

// ── 工具執行器映射 ──

const TOOL_EXECUTORS: Record<
  string,
  (args: Record<string, string>, ctx: ExecutorContext) => Promise<ToolCallResult>
> = {
  // ─────── 讀取工具 ───────

  query_courses: async (args, ctx) => {
    const filter = args.filter ?? 'all';
    // 優先用 puDataCache（本地快取）
    const tcCourses = await getCachedTCCourses();
    const puCourses = await getCachedCourses();

    let courses: any[] = [];
    if (tcCourses && tcCourses.length > 0) {
      courses = tcCourses.map((c: any) => ({
        id: c.id ?? c.course_id,
        name: c.name ?? c.course_name,
        teacher: c.teacher_name ?? c.instructor,
        dayOfWeek: c.day_of_week,
        startTime: c.start_time,
        endTime: c.end_time,
        location: c.location ?? c.classroom,
        credits: c.credits,
      }));
    } else if (puCourses && (Array.isArray(puCourses) ? puCourses : puCourses?.courses ?? []).length > 0) {
      const puCourseList = Array.isArray(puCourses) ? puCourses : puCourses?.courses ?? [];
      courses = puCourseList.map((c: any) => ({
        id: c.id,
        name: c.name ?? c.courseName,
        teacher: c.teacher ?? c.instructor,
        dayOfWeek: c.dayOfWeek,
        startTime: c.startTime,
        endTime: c.endTime,
        location: c.location ?? c.classroom,
        credits: c.credits,
      }));
    }

    // 也嘗試從 DataSource
    if (courses.length === 0 && hasDataSource()) {
      try {
        const ds = getDataSource();
        const dsCourses = await ds.listCourses(ctx.schoolId);
        courses = dsCourses.map(c => ({
          id: c.id,
          name: c.name,
          teacher: (c as any).teacher ?? (c as any).instructor,
          dayOfWeek: (c as any).dayOfWeek,
          startTime: (c as any).startTime,
          endTime: (c as any).endTime,
          location: (c as any).location,
          credits: (c as any).credits,
        }));
      } catch { /* ignore */ }
    }

    if (filter === 'today') {
      const todayDow = new Date().getDay();
      courses = courses.filter(c => c.dayOfWeek === todayDow || c.dayOfWeek === (todayDow === 0 ? 7 : todayDow));
    } else if (filter === 'next') {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const todayDow = now.getDay();
      const todayCourses = courses
        .filter(c => c.dayOfWeek === todayDow || c.dayOfWeek === (todayDow === 0 ? 7 : todayDow))
        .filter(c => {
          if (!c.startTime) return false;
          const [h, m] = c.startTime.split(':').map(Number);
          return h * 60 + m > nowMin;
        })
        .sort((a, b) => {
          const [ah, am] = (a.startTime ?? '99:99').split(':').map(Number);
          const [bh, bm] = (b.startTime ?? '99:99').split(':').map(Number);
          return (ah * 60 + am) - (bh * 60 + bm);
        });
      courses = todayCourses.slice(0, 1);
    }

    if (courses.length === 0) {
      return {
        success: true,
        data: [],
        summary: filter === 'today' ? '今天沒有課程' : '目前沒有課程資料。可能尚未登入 TronClass。',
      };
    }

    const summary = courses.map((c, i) =>
      `${i + 1}. ${c.name}${c.teacher ? ` (${c.teacher})` : ''}${c.startTime ? ` ${c.startTime}` : ''}${c.endTime ? `-${c.endTime}` : ''}${c.location ? ` @${c.location}` : ''}${c.credits ? ` ${c.credits}學分` : ''}`
    ).join('\n');

    return { success: true, data: courses, summary: `共 ${courses.length} 門課程:\n${summary}` };
  },

  query_grades: async (args, ctx) => {
    const rawGrades = await getCachedGrades();
    // PUGradeResult is { grades: PUGrade[], ... } — unwrap
    const gradeList: any[] = Array.isArray(rawGrades) ? rawGrades : (rawGrades as any)?.grades ?? [];
    if (gradeList.length === 0) {
      // 嘗試 DataSource
      if (hasDataSource() && ctx.userId) {
        try {
          const ds = getDataSource();
          const dsGrades = await ds.listGrades(ctx.userId, args.semester, ctx.schoolId);
          if (dsGrades.length > 0) {
            const summary = dsGrades.map((g, i) =>
              `${i + 1}. ${(g as any).courseName ?? g.id}：${(g as any).score ?? (g as any).grade ?? '未公布'}${(g as any).credits ? ` (${(g as any).credits}學分)` : ''}`
            ).join('\n');
            const gpaResult = await ds.getGPA(ctx.userId, ctx.schoolId).catch(() => null);
            return {
              success: true,
              data: { grades: dsGrades, gpa: gpaResult },
              summary: `成績:\n${summary}${gpaResult ? `\nGPA: ${gpaResult.gpa.toFixed(2)} (累計 ${gpaResult.totalCredits} 學分)` : ''}`,
            };
          }
        } catch { /* ignore */ }
      }
      return { success: true, data: [], summary: '目前沒有成績資料。' };
    }

    const summary = gradeList.map((g: any, i: number) =>
      `${i + 1}. ${g.courseName ?? g.name ?? g.id}：${g.score ?? g.grade ?? '未公布'}${g.credits ? ` (${g.credits}學分)` : ''}`
    ).join('\n');

    // 計算 GPA
    let gpa: number | null = null;
    const validGrades = gradeList.filter((g: any) => g.score != null && g.credits);
    if (validGrades.length > 0) {
      const totalPoints = validGrades.reduce((sum: number, g: any) => {
        const gp = g.score >= 90 ? 4.0 : g.score >= 80 ? 3.0 : g.score >= 70 ? 2.0 : g.score >= 60 ? 1.0 : 0;
        return sum + gp * (g.credits ?? 0);
      }, 0);
      const totalCredits = validGrades.reduce((sum: number, g: any) => sum + (g.credits ?? 0), 0);
      gpa = totalCredits > 0 ? totalPoints / totalCredits : null;
    }

    return {
      success: true,
      data: { grades: gradeList, gpa },
      summary: `成績:\n${summary}${gpa != null ? `\nGPA: ${gpa.toFixed(2)}` : ''}`,
    };
  },

  query_assignments: async (args, ctx) => {
    const tcActivities = await getCachedTCActivities();
    const tcTodos = await getCachedTCTodos();
    const tcCourses = await getCachedTCCourses();
    const courseNameById = new Map<number, string>();
    if (tcCourses) {
      for (const c of tcCourses) {
        courseNameById.set(c.id, c.name);
      }
    }
    const now = new Date();

    const activityList: any[] = Array.isArray(tcActivities)
      ? tcActivities
      : tcActivities
        ? Object.values(tcActivities).flat()
        : [];

    const items: any[] = [];
    const seenKeys = new Set<string>();

    const rowKeyFromTc = (a: any): string =>
      a?.id != null ? `tc-activity-${a.id}` : `tc-fallback-${String(a?.title ?? '')}-${String(a?.course_id ?? '')}`;

    const pushInboxTaskRow = (t: InboxTask) => {
      if (t.kind !== 'assignment' && t.kind !== 'quiz') return;
      const needsSubmit = t.preferredIntent === 'submit';
      const akey = t.assignmentId ?? undefined;
      const dedupeKey = akey ?? `inbox-${t.id}`;
      if (seenKeys.has(dedupeKey)) return;
      seenKeys.add(dedupeKey);
      const dueRaw =
        t.dueAt instanceof Date ? t.dueAt.toISOString() : t.dueAt != null ? String(t.dueAt) : undefined;
      items.push({
        id: t.id,
        assignmentKey: akey,
        title: t.title,
        courseName: t.groupName ?? '',
        dueAt: dueRaw,
        type: t.kind,
        isOverdue: t.dueAt ? new Date(t.dueAt as Date) < now : false,
        needsSubmit,
      });
    };

    const pushTcRow = (a: any) => {
      if (!tcActivityTypeIsAssignmentLike(a.type)) return;
      const rk = rowKeyFromTc(a);
      if (seenKeys.has(rk)) return;
      seenKeys.add(rk);
      const dueRaw = a.end_time ?? a.due_date ?? a.deadline;
      const cid = typeof a.course_id === 'number' ? a.course_id : parseInt(String(a.course_id ?? ''), 10);
      const cn =
        (a.course_name && String(a.course_name)) ||
        (!Number.isNaN(cid) ? courseNameById.get(cid) : undefined) ||
        (!Number.isNaN(cid) ? `課程#${cid}` : '未知課程');
      items.push({
        id: a.id ?? a.activity_id,
        assignmentKey: a.id != null ? `tc-activity-${a.id}` : undefined,
        title: a.title ?? a.name ?? '未命名',
        courseName: cn,
        dueAt: dueRaw,
        type: a.type ?? 'assignment',
        isOverdue: dueRaw ? new Date(dueRaw) < now : false,
        needsSubmit: tcActivityNeedsSubmit(a),
      });
    };

    if (hasDataSource() && ctx.userId) {
      try {
        const ds = getDataSource();
        const inboxTasks = await ds.listInboxTasks(ctx.userId, ctx.schoolId);
        for (const t of inboxTasks) {
          pushInboxTaskRow(t);
        }
      } catch {
        /* ignore */
      }
    }

    for (const a of activityList) {
      pushTcRow(a);
    }

    if (tcTodos && tcTodos.length > 0) {
      for (const t of tcTodos) {
        pushTcRow(t);
      }
    }

    const status = args.status ?? 'all';
    if (status === 'overdue') {
      items.splice(0, items.length, ...items.filter((i) => i.isOverdue && i.needsSubmit));
    } else if (status === 'pending') {
      items.splice(0, items.length, ...items.filter((i) => i.needsSubmit));
    }

    // 按截止日排序
    items.sort((a, b) => {
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });

    if (items.length === 0) {
      return { success: true, data: [], summary: '目前沒有待處理的作業或任務。' };
    }

    const summary = items.slice(0, 10).map((item, i) => {
      const due = item.dueAt ? new Date(item.dueAt).toLocaleDateString('zh-TW') : '無截止日';
      const sub = item.needsSubmit === false ? ' ✓已處理' : '';
      return `${i + 1}. ${item.title} (${item.courseName}) — ${due}${item.isOverdue ? ' ⚠️逾期' : ''}${sub}`;
    }).join('\n');

    return {
      success: true,
      data: items,
      summary: `共 ${items.length} 項（作業/測驗）：\n${summary}`,
    };
  },

  query_attendance: async (args, ctx) => {
    const tcAttendance = await getCachedTCAttendance();
    if (!tcAttendance || tcAttendance.length === 0) {
      return { success: true, data: [], summary: '目前沒有出席記錄資料。' };
    }

    let records = tcAttendance as any[];
    if (args.courseId) {
      records = records.filter((r: any) => r.course_id === args.courseId || r.courseId === args.courseId);
    }

    // 計算出席統計
    const courseStats: Record<string, { total: number; present: number; absent: number; late: number; name: string }> = {};
    for (const r of records) {
      const cid = r.course_id ?? r.courseId ?? 'unknown';
      const cname = r.course_name ?? r.courseName ?? cid;
      if (!courseStats[cid]) courseStats[cid] = { total: 0, present: 0, absent: 0, late: 0, name: cname };
      courseStats[cid].total++;
      const status = (r.status ?? r.attendanceStatus ?? '').toLowerCase();
      if (status.includes('present') || status.includes('出席') || status === 'attended') {
        courseStats[cid].present++;
      } else if (status.includes('late') || status.includes('遲到')) {
        courseStats[cid].late++;
      } else {
        courseStats[cid].absent++;
      }
    }

    const statsEntries = Object.entries(courseStats);
    const summary = statsEntries.map(([_, stats]) => {
      const rate = stats.total > 0 ? Math.round((stats.present + stats.late) / stats.total * 100) : 0;
      const risk = rate < 60 ? '🔴高風險' : rate < 75 ? '🟡注意' : '🟢正常';
      return `${stats.name}: ${rate}% 出席率 (${stats.present}出席/${stats.late}遲到/${stats.absent}缺席) ${risk}`;
    }).join('\n');

    return {
      success: true,
      data: courseStats,
      summary: `出席統計:\n${summary}`,
    };
  },

  query_student_info: async (args, ctx) => {
    const info = await getCachedStudentInfo();
    if (!info) {
      return { success: true, data: null, summary: '尚未登入或無法取得學生資訊。' };
    }
    const i = info as any;
    const summary = [
      i.name ? `姓名: ${i.name}` : null,
      i.studentId ? `學號: ${i.studentId}` : null,
      i.department ? `系所: ${i.department}` : null,
      i.grade ? `年級: ${i.grade}` : null,
      i.entryYear ? `入學年: ${i.entryYear}` : null,
      i.status ? `學籍: ${i.status}` : null,
    ].filter(Boolean).join('\n');

    return { success: true, data: info, summary: summary || '學生基本資訊已取得。' };
  },

  analyze_credits: async (args, ctx) => {
    const rawGrades = await getCachedGrades();
    const gradeArr: any[] = Array.isArray(rawGrades) ? rawGrades : (rawGrades as any)?.grades ?? [];
    if (gradeArr.length === 0) {
      return { success: true, data: null, summary: '無成績資料，無法分析學分進度。' };
    }

    const g = gradeArr;
    let totalCredits = 0;
    let totalPassed = 0;
    const categories: Record<string, number> = {};

    for (const grade of g) {
      const credits = grade.credits ?? 0;
      const score = grade.score ?? grade.grade;
      totalCredits += credits;
      if (score != null && score >= 60) {
        totalPassed += credits;
      }
      const cat = grade.category ?? grade.type ?? '其他';
      categories[cat] = (categories[cat] ?? 0) + credits;
    }

    const needed = 128;
    const remaining = Math.max(0, needed - totalPassed);
    const progress = Math.round((totalPassed / needed) * 100);

    const summary = [
      `已修學分: ${totalPassed} / ${needed} (${progress}%)`,
      `尚需: ${remaining} 學分`,
      ...Object.entries(categories).map(([cat, credits]) => `  ${cat}: ${credits} 學分`),
      remaining <= 0 ? '✅ 學分已滿足畢業要求' : `預計還需 ${Math.ceil(remaining / 20)} 個學期`,
    ].join('\n');

    return {
      success: true,
      data: { totalPassed, needed, remaining, progress, categories },
      summary,
    };
  },

  predict_gpa: async (args, ctx) => {
    const rawGrades = await getCachedGrades();
    const gradeArr: any[] = Array.isArray(rawGrades) ? rawGrades : (rawGrades as any)?.grades ?? [];
    if (gradeArr.length === 0) {
      return { success: true, data: null, summary: '無成績資料，無法預測 GPA。' };
    }

    const g = gradeArr;
    const validGrades = g.filter(gr => gr.score != null && gr.credits);

    if (validGrades.length < 2) {
      return { success: true, data: null, summary: '資料不足（需至少 2 門課成績），無法進行趨勢預測。' };
    }

    // 按學期分組計算各學期 GPA
    const semesterMap: Record<string, { totalPoints: number; totalCredits: number }> = {};
    for (const gr of validGrades) {
      const sem = gr.semester ?? 'unknown';
      if (!semesterMap[sem]) semesterMap[sem] = { totalPoints: 0, totalCredits: 0 };
      const gp = gr.score >= 90 ? 4.0 : gr.score >= 80 ? 3.0 : gr.score >= 70 ? 2.0 : gr.score >= 60 ? 1.0 : 0;
      semesterMap[sem].totalPoints += gp * (gr.credits ?? 0);
      semesterMap[sem].totalCredits += gr.credits ?? 0;
    }

    const semesterGPAs = Object.entries(semesterMap)
      .map(([sem, data]) => ({
        semester: sem,
        gpa: data.totalCredits > 0 ? data.totalPoints / data.totalCredits : 0,
      }))
      .sort((a, b) => a.semester.localeCompare(b.semester));

    // 線性回歸
    const n = semesterGPAs.length;
    const xs = semesterGPAs.map((_, i) => i);
    const ys = semesterGPAs.map(s => s.gpa);
    const xMean = xs.reduce((a, b) => a + b, 0) / n;
    const yMean = ys.reduce((a, b) => a + b, 0) / n;
    const slope = xs.reduce((sum, x, i) => sum + (x - xMean) * (ys[i] - yMean), 0) /
      (xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0) || 1);
    const predictedNext = yMean + slope * n;

    const trend = slope > 0.1 ? '📈 上升趨勢' : slope < -0.1 ? '📉 下降趨勢' : '➡️ 持平';
    const currentGPA = semesterGPAs[semesterGPAs.length - 1]?.gpa ?? 0;

    const summary = [
      `目前 GPA: ${currentGPA.toFixed(2)}`,
      `趨勢: ${trend} (斜率 ${slope > 0 ? '+' : ''}${slope.toFixed(3)})`,
      `預測下學期 GPA: ${Math.max(0, Math.min(4.0, predictedNext)).toFixed(2)}`,
      '',
      '各學期 GPA:',
      ...semesterGPAs.map(s => `  ${s.semester}: ${s.gpa.toFixed(2)}`),
      '',
      currentGPA < 1.5 ? '⚠️ GPA 偏低，有二一風險！建議加強弱科。' :
        currentGPA < 2.5 ? '💡 GPA 中等，還有提升空間。' :
        '✅ GPA 表現良好，繼續保持！',
    ].join('\n');

    return {
      success: true,
      data: { semesterGPAs, currentGPA, slope, predictedNext, trend },
      summary,
    };
  },

  query_announcements: async (args, ctx) => {
    const limit = parseInt(args.limit ?? '5');
    const cached = await getCachedAnnouncements();

    let announcements: any[] = [];
    if (cached && cached.length > 0) {
      announcements = cached;
    } else if (hasDataSource()) {
      try {
        const ds = getDataSource();
        announcements = await ds.listAnnouncements(ctx.schoolId);
      } catch { /* ignore */ }
    }

    announcements = announcements.slice(0, limit);
    if (announcements.length === 0) {
      return { success: true, data: [], summary: '目前沒有公告。' };
    }

    const summary = announcements.map((a: any, i: number) =>
      `${i + 1}. ${a.title}${a.source ? ` (${a.source})` : ''}${a.publishedAt ? ` — ${new Date(a.publishedAt).toLocaleDateString('zh-TW')}` : ''}`
    ).join('\n');

    return { success: true, data: announcements, summary: `最新公告:\n${summary}` };
  },

  query_events: async (args, ctx) => {
    if (!hasDataSource()) return { success: true, data: [], summary: '無法查詢活動。' };
    try {
      const ds = getDataSource();
      const events = await ds.listEvents(ctx.schoolId);
      const limited = events.slice(0, parseInt(args.limit ?? '5'));
      if (limited.length === 0) return { success: true, data: [], summary: '目前沒有活動。' };

      const summary = limited.map((e, i) =>
        `${i + 1}. ${e.title}${e.location ? ` @${e.location}` : ''}${e.startsAt ? ` — ${new Date(e.startsAt).toLocaleDateString('zh-TW')}` : ''}`
      ).join('\n');
      return {
        success: true,
        data: limited,
        summary: `近期活動:\n${summary}\n\n點選下方或回「第 N 個」即可報名（若已額滿會由後端回覆）。`,
        choiceMenu: {
          title: '近期活動',
          producedByTool: 'register_event',
          prompt: '選一場活動報名',
          options: limited.slice(0, 8).map((e: any, i: number) => ({
            id: String(e.id ?? ''),
            label: String(e.title ?? `活動 ${i + 1}`),
            subtitle: e.location ? String(e.location) : undefined,
            sendAsUser: `報名第${i + 1}個活動`,
          })),
        },
      };
    } catch {
      return { success: true, data: [], summary: '查詢活動失敗。' };
    }
  },

  query_menus: async (args, ctx) => {
    try {
      // ── 合併所有菜單來源（Firestore + 本地官方目錄）──
      let menus: any[] = [];
      if (hasDataSource()) {
        try {
          const ds = getDataSource();
          const firestoreMenus = await ds.listMenus(ctx.schoolId);
          if (firestoreMenus?.length) menus.push(...firestoreMenus);
        } catch { /* Firestore 查詢失敗不影響 */ }
      }
      // 加入靜宜大學本地菜單目錄（永遠可用，不依賴 Firestore）
      if (isProvidenceDiningSchoolId(ctx.schoolId)) {
        const localMenus = getPuDiningMenuItems(ctx.schoolId);
        if (localMenus?.length) {
          const existingNames = new Set(menus.map((m: any) => m.name?.toLowerCase()));
          for (const lm of localMenus) {
            if (!existingNames.has(lm.name?.toLowerCase())) {
              menus.push(lm);
            }
          }
        }
      }

      if (args.cafeteria) {
        menus = menus.filter((m: any) => m.cafeteria?.includes(args.cafeteria));
      }

      // 如果有搜尋關鍵字，進行模糊篩選
      if (args.keyword) {
        const kw = args.keyword.toLowerCase();
        const filtered = menus.filter((m: any) =>
          m.name?.toLowerCase().includes(kw) || kw.includes(m.name?.toLowerCase() ?? '')
        );
        if (filtered.length > 0) menus = filtered;
      }

      if (menus.length === 0) return { success: true, data: [], summary: '目前沒有菜單資料。' };

      const summary = menus.slice(0, 15).map((m: any, i: number) =>
        `${i + 1}. ${m.name}${m.price != null ? ` $${m.price}` : ''}${m.cafeteria ? ` (${m.cafeteria})` : ''}`
      ).join('\n');
      return { success: true, data: menus, summary: `今日菜單:\n${summary}` };
    } catch {
      return { success: true, data: [], summary: '查詢菜單失敗。' };
    }
  },

  recommend_lunch: async (args, ctx) => {
    try {
      let menus: any[] = [];
      if (hasDataSource()) {
        try {
          const ds = getDataSource();
          const firestoreMenus = await ds.listMenus(ctx.schoolId);
          if (firestoreMenus?.length) menus.push(...firestoreMenus);
        } catch { /* ignore */ }
      }
      if (isProvidenceDiningSchoolId(ctx.schoolId)) {
        const localMenus = getPuDiningMenuItems(ctx.schoolId);
        if (localMenus?.length) {
          const existingNames = new Set(menus.map((m: any) => m.name?.toLowerCase()));
          for (const lm of localMenus) {
            if (!existingNames.has(lm.name?.toLowerCase())) menus.push(lm);
          }
        }
      }
      const rows: LunchMenuRow[] = menus
        .map((m: any) => ({
          id: String(m.id ?? ''),
          name: String(m.name ?? ''),
          price: typeof m.price === 'number' ? m.price : undefined,
          cafeteria: m.cafeteria,
          category: m.category,
          isPopular: Boolean(m.isPopular),
        }))
        .filter((r) => r.id && r.name);
      if (rows.length === 0) {
        return {
          success: true,
          data: { items: [] },
          summary:
            '目前沒有菜單資料，無法推薦午餐。請先到「校園 → 點餐」同步菜單後再問我。',
        };
      }
      const budgetRaw = args.budget?.trim();
      const budgetCap = budgetRaw ? parseInt(budgetRaw, 10) : undefined;
      const slot =
        args.timeSlot === 'dinner' || args.timeSlot === 'breakfast' ? args.timeSlot : 'lunch';
      const mealLabel = slot === 'dinner' ? '晚餐' : slot === 'breakfast' ? '早餐' : '午餐';
      const { items } = recommendLunchCandidates(rows, {
        budgetCap: Number.isFinite(budgetCap) && (budgetCap as number) > 0 ? budgetCap : undefined,
        maxItems: 3,
      });
      const answer = formatLunchRecommendationReply(items, { mealLabel });
      return { success: true, data: { items }, summary: answer, isWrite: false };
    } catch {
      return { success: false, summary: '午餐推薦失敗，請稍後再試。' };
    }
  },

  query_library: async (args, ctx) => {
    if (!hasDataSource()) return { success: true, data: [], summary: '無法查詢圖書館。' };
    const ds = getDataSource();
    try {
      if (args.action === 'search' && args.keyword) {
        const books = await ds.searchBooks(args.keyword, ctx.schoolId);
        if (books.length === 0) return { success: true, data: [], summary: `找不到「${args.keyword}」相關書籍。` };
        const summary = books.slice(0, 5).map((b, i) =>
          `${i + 1}. ${b.title}${(b as any).author ? ` — ${(b as any).author}` : ''}${(b as any).available ? ' ✅可借' : ' ❌已借出'}`
        ).join('\n');
        return { success: true, data: books, summary: `搜尋結果:\n${summary}` };
      } else if (args.action === 'loans' && ctx.userId) {
        const loans = await ds.listLoans(ctx.userId, ctx.schoolId);
        if (loans.length === 0) return { success: true, data: [], summary: '目前沒有借閱中的書籍。' };
        const summary = loans.map((l, i) =>
          `${i + 1}. ${(l as any).bookTitle ?? l.id}${(l as any).dueDate ? ` — 到期 ${new Date((l as any).dueDate).toLocaleDateString('zh-TW')}` : ''}`
        ).join('\n');
        return { success: true, data: loans, summary: `借閱中:\n${summary}` };
      } else if (args.action === 'seats') {
        const seats = await ds.listSeats(ctx.schoolId);
        const available = seats.filter(s => (s as any).status === 'available' || !(s as any).occupied);
        return {
          success: true,
          data: { total: seats.length, available: available.length },
          summary: `圖書館座位: ${available.length}/${seats.length} 個可用`,
        };
      }
      return { success: true, data: null, summary: '請指定動作：search/loans/seats。' };
    } catch {
      return { success: true, data: [], summary: '查詢圖書館失敗。' };
    }
  },

  query_bus: async (args, ctx) => {
    if (!hasDataSource()) return { success: true, data: [], summary: '無法查詢公車資訊。' };
    try {
      const ds = getDataSource();
      if (args.stopId) {
        const arrivals = await ds.getBusArrivals(args.stopId);
        if (arrivals.length === 0) return { success: true, data: [], summary: '目前沒有即時到站資訊。' };
        const summary = arrivals.slice(0, 5).map((a, i) =>
          `${i + 1}. ${(a as any).routeName ?? a.id} — ${(a as any).estimatedMinutes ?? '?'} 分鐘到站`
        ).join('\n');
        return { success: true, data: arrivals, summary: `即時到站:\n${summary}` };
      } else {
        const routes = await ds.listBusRoutes(ctx.schoolId);
        if (routes.length === 0) return { success: true, data: [], summary: '無公車路線資料。' };
        const summary = routes.slice(0, 5).map((r, i) =>
          `${i + 1}. ${r.name ?? r.id}${(r as any).description ? ` — ${(r as any).description}` : ''}`
        ).join('\n');
        return { success: true, data: routes, summary: `公車路線:\n${summary}` };
      }
    } catch {
      return { success: true, data: [], summary: '查詢公車資訊失敗。' };
    }
  },

  query_notifications: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) return { success: true, data: [], summary: '無法查詢通知。' };
    try {
      const ds = getDataSource();
      let notifs = await ds.listNotifications(ctx.userId);
      if (args.unreadOnly === 'true') {
        notifs = notifs.filter(n => !(n as any).read);
      }
      if (notifs.length === 0) return { success: true, data: [], summary: '沒有通知。' };
      const summary = notifs.slice(0, 5).map((n, i) =>
        `${i + 1}. ${(n as any).title ?? n.id}${(n as any).read ? '' : ' 🔴未讀'}`
      ).join('\n');
      return { success: true, data: notifs, summary: `通知:\n${summary}` };
    } catch {
      return { success: true, data: [], summary: '查詢通知失敗。' };
    }
  },

  query_calendar: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) return { success: true, data: [], summary: '無法查詢行事曆。' };
    try {
      const ds = getDataSource();
      const startDate = args.startDate ?? new Date().toISOString().split('T')[0];
      const endDate = args.endDate ?? new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
      const events = await ds.listCalendarEvents(ctx.userId, startDate, endDate, ctx.schoolId);
      if (events.length === 0) return { success: true, data: [], summary: `${startDate} ~ ${endDate} 沒有行事曆事件。` };
      const summary = events.slice(0, 8).map((e, i) =>
        `${i + 1}. ${e.title}${(e as any).startAt ? ` — ${new Date((e as any).startAt).toLocaleDateString('zh-TW')}` : ''}`
      ).join('\n');
      return { success: true, data: events, summary: `行事曆:\n${summary}` };
    } catch {
      return { success: true, data: [], summary: '查詢行事曆失敗。' };
    }
  },

  query_conversations: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) return { success: true, data: [], summary: '無法查詢對話。' };
    try {
      const ds = getDataSource();
      const convos = (await ds.listConversations(ctx.userId, undefined, ctx.schoolId)).map((c: any) => {
        const members = Array.isArray(c.memberIds) ? c.memberIds : [];
        const peerId = c.peerId ?? members.find((id: string) => id !== ctx.userId);
        return { ...c, peerId };
      });
      if (convos.length === 0) return { success: true, data: [], summary: '目前沒有對話。' };
      const summary = convos.slice(0, 5).map((c, i) =>
        `${i + 1}. 對話 ${c.id.slice(0, 8)}… (${(c as any).memberIds?.length ?? '?'} 人)${(c as any).lastMessageText ? ` — ${(c as any).lastMessageText.slice(0, 30)}` : ''}`
      ).join('\n');
      return { success: true, data: convos, summary: `對話列表:\n${summary}` };
    } catch {
      return { success: true, data: [], summary: '查詢對話失敗。' };
    }
  },

  query_orders: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) return { success: true, data: [], summary: '無法查詢訂單。' };
    try {
      const ds = getDataSource();
      let orders = await ds.listOrders(ctx.userId, undefined, ctx.schoolId);
      if (args.status && args.status !== 'all') {
        orders = orders.filter(o => o.status === args.status);
      }
      if (orders.length === 0) return { success: true, data: [], summary: '目前沒有訂單。' };
      const summary = orders.slice(0, 5).map((o, i) =>
        `${i + 1}. ${(o as any).merchantName ?? '訂單'} — $${(o as any).total ?? '?'} (${o.status})`
      ).join('\n');
      return { success: true, data: orders, summary: `訂單:\n${summary}` };
    } catch {
      return { success: true, data: [], summary: '查詢訂單失敗。' };
    }
  },

  comprehensive_analysis: async (args, ctx) => {
    // 並行執行多個查詢
    const [gradesResult, attendResult, assignResult, creditsResult, gpaResult] = await Promise.all([
      TOOL_EXECUTORS.query_grades({}, ctx),
      TOOL_EXECUTORS.query_attendance({}, ctx),
      TOOL_EXECUTORS.query_assignments({ status: 'all' }, ctx),
      TOOL_EXECUTORS.analyze_credits({}, ctx),
      TOOL_EXECUTORS.predict_gpa({}, ctx),
    ]);

    const parts = [
      '═══ 全面學業分析報告 ═══\n',
      '📊 成績:', gradesResult.summary, '',
      '📋 出席:', attendResult.summary, '',
      '📝 作業:', assignResult.summary, '',
      '🎓 學分:', creditsResult.summary, '',
      '📈 GPA 預測:', gpaResult.summary, '',
    ];

    return {
      success: true,
      data: { grades: gradesResult.data, attendance: attendResult.data, assignments: assignResult.data, credits: creditsResult.data, gpa: gpaResult.data },
      summary: parts.join('\n'),
    };
  },

  daily_briefing: async (args, ctx) => {
    const [coursesResult, assignResult, notifResult, calendarResult] = await Promise.all([
      TOOL_EXECUTORS.query_courses({ filter: 'today' }, ctx),
      TOOL_EXECUTORS.query_assignments({ status: 'pending' }, ctx),
      TOOL_EXECUTORS.query_notifications({ unreadOnly: 'true' }, ctx),
      TOOL_EXECUTORS.query_calendar({}, ctx),
    ]);

    const now = new Date();
    const greeting = now.getHours() < 12 ? '早安' : now.getHours() < 18 ? '午安' : '晚安';

    const parts = [
      `═══ ${greeting}！今日簡報 ═══\n`,
      `📅 ${now.toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' })}\n`,
      '📚 今日課程:', coursesResult.summary, '',
      '📝 待處理:', assignResult.summary, '',
      '🔔 未讀通知:', notifResult.summary, '',
      '📆 近期行程:', calendarResult.summary, '',
    ];

    return {
      success: true,
      data: { courses: coursesResult.data, assignments: assignResult.data, notifications: notifResult.data, calendar: calendarResult.data },
      summary: parts.join('\n'),
    };
  },

  assistant_help: async () => {
    return {
      success: true,
      isWrite: false,
      summary: [
        '我可以協助校園 App 內的任務：',
        '1. 查課表、作業、成績、學分進度與每日簡報',
        '2. 查公告、活動、餐廳、圖書館、宿舍、包裹與交通資訊',
        '3. 在資訊足夠時代辦訂餐、請假、圖書館座位、借書、洗衣機、報修、通知已讀與訊息發送',
        '會寫入資料的操作，我會先確認必要資訊；缺房號、課程或目標時會先追問。',
      ].join('\n'),
    };
  },

  // ─────── 寫入工具 ───────

  send_message: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) return { success: false, error: '未登入', summary: '需要登入才能發送訊息。', isWrite: true };
    if (!args.peerId || !args.content) {
      return { success: false, isWrite: false, summary: '請告訴我要傳給誰，以及要傳什麼內容。' };
    }
    try {
      const ds = getDataSource();
      const convoId = `dm_${ctx.schoolId}_${[ctx.userId, args.peerId].sort().join('_')}`;
      await ds.createConversation([ctx.userId, args.peerId], ctx.schoolId, convoId);
      await ds.sendMessage({ conversationId: convoId, senderId: ctx.userId, content: args.content, type: 'text' });
      return { success: true, isWrite: true, summary: `已發送訊息給 ${args.peerId.slice(0, 8)}…：「${args.content.slice(0, 30)}…」` };
    } catch (e: any) {
      return { success: false, error: e.message, summary: '發送訊息失敗。', isWrite: true };
    }
  },

  create_calendar_event: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) return { success: false, error: '未登入', summary: '需要登入才能建立事件。', isWrite: true };
    try {
      const ds = getDataSource();
      const event = await ds.createCalendarEvent({
        title: args.title,
        startAt: args.startAt,
        endAt: args.endAt ?? args.startAt,
        userId: ctx.userId,
        schoolId: ctx.schoolId,
        location: args.location,
        description: args.description,
        type: 'personal',
      } as any);
      return { success: true, isWrite: true, data: event, summary: `✅ 已建立行事曆事件「${args.title}」` };
    } catch (e: any) {
      return { success: false, error: e.message, summary: '建立行事曆事件失敗。', isWrite: true };
    }
  },

  register_event: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) return { success: false, error: '未登入', summary: '需要登入才能報名。', isWrite: true };
    const ds = getDataSource();
    // 1. 處理「第 N 個」/ lastChoiceMenu 選擇
    let eventId = (args.eventId ?? '').trim();
    if (!eventId && ctx.lastChoiceMenu && ctx.lastUserMessage) {
      const ord = parseOrdinalFromMessage(ctx.lastUserMessage);
      if (ord != null) {
        const opt = ctx.lastChoiceMenu.options[ord - 1];
        if (opt) eventId = String(opt.id ?? '').split('@@')[0];
      }
    }
    // 2. 仍沒有 eventId → 列出可報名活動 + choiceMenu，反問使用者
    if (!eventId) {
      try {
        const list = await ds.listEvents(ctx.schoolId).catch(() => [] as any[]);
        const active = (Array.isArray(list) ? list : []).slice(0, 8);
        if (active.length === 0) {
          return { success: false, isWrite: false, summary: '目前沒有可報名的活動。' };
        }
        return {
          success: false, isWrite: false,
          summary: `請選擇要報名的活動：\n\n${active.map((e: any, i: number) => `${i + 1}. ${e.title ?? e.name}${e.location ? `（${e.location}）` : ''}`).join('\n')}\n\n點選下方任一項，或回「第 N 個」。`,
          choiceMenu: {
            title: '請選擇活動',
            producedByTool: 'register_event',
            options: active.map((e: any, i: number) => ({
              id: String(e.id ?? e.eventId ?? ''),
              label: String(e.title ?? e.name ?? `活動 ${i + 1}`),
              subtitle: e.location ? String(e.location) : undefined,
              sendAsUser: `幫我報名第${i + 1}個`,
            })),
          },
        };
      } catch (e: any) {
        return { success: false, error: e.message, summary: '無法取得活動清單。', isWrite: false };
      }
    }
    // 3. 有 eventId → 正常執行
    try {
      await ds.registerEvent(eventId, ctx.userId, ctx.schoolId);
      return { success: true, isWrite: true, summary: `✅ 已報名活動 ${eventId}` };
    } catch (e: any) {
      return { success: false, error: e.message, summary: `報名活動失敗：${e.message ?? '未知錯誤'}`, isWrite: true };
    }
  },

  reserve_library_seat: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) return { success: false, error: '未登入', summary: '需要登入才能預約。', isWrite: true };
    const ds = getDataSource();
    const date = args.date || new Date().toISOString().split('T')[0];
    const startTime = args.startTime || '09:00';
    const endTime = args.endTime || '12:00';
    let seatId = (args.seatId ?? '').trim();
    if (!seatId && ctx.lastChoiceMenu && ctx.lastUserMessage) {
      const ord = parseOrdinalFromMessage(ctx.lastUserMessage);
      if (ord != null) {
        const opt = ctx.lastChoiceMenu.options[ord - 1];
        if (opt) seatId = String(opt.id ?? '').split('@@')[0];
      }
    }
    if (!seatId) {
      try {
        const seats = await (ds as any).listSeats?.(ctx.schoolId).catch(() => []) ?? [];
        const available = (Array.isArray(seats) ? seats : []).filter((s: any) => s.available !== false && s.status !== 'occupied').slice(0, 8);
        if (available.length === 0) {
          return { success: false, isWrite: false, summary: '目前圖書館沒有可預約的空座位。' };
        }
        return {
          success: false, isWrite: false,
          summary: `這些座位可選：\n\n${available.map((s: any, i: number) => `${i + 1}. ${s.zone ?? s.name ?? s.seatId ?? `座位 ${i + 1}`}${s.floor ? `（${s.floor}）` : ''}`).join('\n')}\n\n點下方或說「第 N 個」就幫你預約 ${date} ${startTime}-${endTime}。`,
          choiceMenu: {
            title: '請選擇座位',
            producedByTool: 'reserve_library_seat',
            options: available.map((s: any, i: number) => ({
              id: String(s.id ?? s.seatId ?? ''),
              label: String(s.zone ?? s.name ?? `座位 ${i + 1}`),
              subtitle: s.floor ? String(s.floor) : undefined,
              sendAsUser: `預約第${i + 1}個座位 ${date} ${startTime}-${endTime}`,
            })),
          },
        };
      } catch (e: any) {
        return { success: false, error: e.message, summary: '無法取得座位資料。', isWrite: false };
      }
    }
    try {
      const reservation = await ds.reserveSeat(seatId, ctx.userId, date, startTime, endTime, ctx.schoolId);
      return { success: true, isWrite: true, data: reservation, summary: `✅ 已預約座位 ${seatId}（${date} ${startTime}-${endTime}）` };
    } catch (e: any) {
      return { success: false, error: e.message, summary: `預約座位失敗：${e.message ?? '未知錯誤'}`, isWrite: true };
    }
  },

  borrow_book: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) return { success: false, error: '未登入', summary: '需要登入才能借書。', isWrite: true };
    const ds = getDataSource();
    let bookId = (args.bookId ?? '').trim();

    // 1. 從 lastChoiceMenu 解 ordinal
    if (!bookId && ctx.lastChoiceMenu && ctx.lastUserMessage) {
      const ord = parseOrdinalFromMessage(ctx.lastUserMessage);
      if (ord != null) {
        const opt = ctx.lastChoiceMenu.options[ord - 1];
        if (opt) bookId = String(opt.id ?? '').split('@@')[0];
      } else if (/隨便|都可以|任一|相關|挑一?本|選一?本/.test(ctx.lastUserMessage)) {
        const opt = ctx.lastChoiceMenu.options[0];
        if (opt) bookId = String(opt.id ?? '').split('@@')[0];
      }
    }

    // 2. 從 lastUserMessage 抽書名關鍵字（中／日／英書名）
    const userMsg = ctx.lastUserMessage ?? '';
    const bookKw =
      userMsg.match(/(?:借|借閱)\s*[《「『"]([^》」』"]{2,30})[》」』"]/)?.[1] ??
      userMsg.match(/(?:借|借閱)\s*([^\s，,。的這那一]{2,15})\s*這?本/)?.[1] ??
      '';

    // 3. 如果有關鍵字 → 用搜尋找書
    if (!bookId && bookKw) {
      try {
        const results: any = await (ds as any).searchBooks?.(bookKw, ctx.schoolId).catch(() => null);
        const books: any[] = Array.isArray(results) ? results : (results?.items ?? []);
        const exact = books.find((b) => String(b.title ?? '').includes(bookKw));
        if (exact) bookId = String(exact.id ?? exact.bookId ?? '');
        else if (books.length > 0) {
          return {
            success: false, isWrite: false,
            summary: `搜尋「${bookKw}」找到 ${books.length} 本相關書籍：\n\n${books.slice(0, 6).map((b: any, i: number) => `${i + 1}. ${b.title ?? b.name}${b.author ? `（${b.author}）` : ''}`).join('\n')}\n\n回我「第 N 本」就幫你借。`,
            choiceMenu: {
              title: '請選擇書籍',
              producedByTool: 'borrow_book',
              options: books.slice(0, 6).map((b: any, i: number) => ({
                id: String(b.id ?? b.bookId ?? ''),
                label: String(b.title ?? b.name ?? `書籍 ${i + 1}`),
                subtitle: b.author ? String(b.author) : undefined,
                sendAsUser: `借第${i + 1}本`,
              })),
            },
          };
        }
      } catch { /* 搜尋失敗，繼續往下 */ }
    }

    // 4. 還是沒有 bookId → 看使用者是否說「隨便」「都可以」→ AI 直接代決定
    const wantsAutoPick = /隨便|都可以|都好|隨機|任意|你選|你決定|你幫我選/.test(userMsg);
    if (!bookId) {
      try {
        // mockSource / dataSource 沒有 listAllBooks，用 searchBooks('') 取得全部
        const allBooks: any = await (ds as any).searchBooks?.('', ctx.schoolId).catch(() => null);
        const books: any[] = Array.isArray(allBooks) ? allBooks : (allBooks?.items ?? []);
        const top = books.slice(0, 8);
        if (wantsAutoPick && top.length > 0) {
          // AI 直接決定（hash 挑前 3 名其中之一，避免每次同一本）
          const seed = (new Date().getDate() + (ctx.userId?.length ?? 0)) % Math.min(3, top.length);
          bookId = String(top[seed].id ?? top[seed].bookId ?? '');
          if (!bookId) {
            return { success: false, isWrite: false, summary: '找不到可借的書，請晚點再試。' };
          }
        } else if (top.length > 0) {
          return {
            success: false, isWrite: false,
            summary: `${bookKw ? `找不到「${bookKw}」，` : ''}這幾本書可以借：\n\n${top.map((b: any, i: number) => `${i + 1}. ${b.title ?? b.name}${b.author ? `（${b.author}）` : ''}`).join('\n')}\n\n回我「第 N 本」就幫你借。`,
            choiceMenu: {
              title: '請選擇書籍',
              producedByTool: 'borrow_book',
              options: top.map((b: any, i: number) => ({
                id: String(b.id ?? b.bookId ?? ''),
                label: String(b.title ?? b.name ?? `書籍 ${i + 1}`),
                subtitle: b.author ? String(b.author) : undefined,
                sendAsUser: `借第${i + 1}本`,
              })),
            },
          };
        }
      } catch { /* ignore */ }
      if (!bookId) {
        return {
          success: false, isWrite: false,
          summary: '請告訴我要借哪本書？可以說書名（例如「幫我借《人工智慧導論》」），我幫你搜尋並借閱。',
        };
      }
    }

    try {
      const loan = await ds.borrowBook(bookId, ctx.userId, ctx.schoolId);
      return { success: true, isWrite: true, data: loan, summary: `✅ 已借閱書籍 ${bookId}` };
    } catch (e: any) {
      return { success: false, error: e.message, summary: `借閱失敗：${e.message ?? '未知錯誤'}`, isWrite: true };
    }
  },

  renew_book: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) return { success: false, error: '未登入', summary: '需要登入才能續借。', isWrite: true };
    if (!args.loanId) {
      return { success: false, isWrite: false, summary: '請指定要續借哪一本書，或先查借閱紀錄後選一本。' };
    }
    try {
      const ds = getDataSource();
      const loan = await ds.renewBook(args.loanId, ctx.userId, ctx.schoolId);
      return { success: true, isWrite: true, data: loan, summary: `✅ 已續借 ${args.loanId}` };
    } catch (e: any) {
      return { success: false, error: e.message, summary: '續借失敗。', isWrite: true };
    }
  },

  mark_notifications_read: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) return { success: false, error: '未登入', summary: '需要登入。', isWrite: true };
    try {
      const ds = getDataSource();
      if (args.action === 'all') {
        await ds.markAllNotificationsRead(ctx.userId);
        return { success: true, isWrite: true, summary: '✅ 已將所有通知標為已讀' };
      } else if (args.notificationId) {
        await ds.markNotificationRead(args.notificationId);
        return { success: true, isWrite: true, summary: `✅ 已將通知 ${args.notificationId} 標為已讀` };
      }
      return { success: false, summary: '請指定通知 ID 或使用 all。', isWrite: true };
    } catch (e: any) {
      return { success: false, error: e.message, summary: '操作失敗。', isWrite: true };
    }
  },

  create_repair_request: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) return { success: false, error: '未登入', summary: '需要登入。', isWrite: true };
    try {
      const ds = getDataSource();
      const req = await ds.createRepairRequest({
        userId: ctx.userId,
        type: args.type as any,
        title: args.title,
        description: args.description,
        room: args.room,
        schoolId: ctx.schoolId,
      } as any);
      if (!req?.id) {
        return {
          success: false,
          isWrite: true,
          summary: '報修失敗：目前系統忙碌，請改用宿舍頁面處理。',
        };
      }
      return {
        success: true,
        isWrite: true,
        data: req,
        summary: `✅ 已提交維修申請（編號：${req.id}）「${args.title}」${args.room ? `\n地點：${args.room}` : ''}`,
      };
    } catch (e: any) {
      return { success: false, error: e.message, summary: '提交維修申請失敗。', isWrite: true };
    }
  },

  // ─────── 教師工具 ───────

  start_attendance: async (args, ctx) => {
    if (!hasDataSource()) return { success: false, summary: '無法啟動點名。', isWrite: true };
    if (!args.courseSpaceId) {
      return { success: false, isWrite: false, summary: '請指定要啟動點名的課程。' };
    }
    try {
      const ds = getDataSource();
      const result = await ds.startAttendanceSession({ courseSpaceId: args.courseSpaceId });
      return {
        success: true,
        isWrite: true,
        data: result,
        summary: `✅ 已啟動點名 (Session ${result.sessionId})${result.qrToken ? `\nQR Token: ${result.qrToken}` : ''}`,
      };
    } catch (e: any) {
      return { success: false, error: e.message, summary: '啟動點名失敗。', isWrite: true };
    }
  },

  create_assignment: async (args, ctx) => {
    if (!hasDataSource()) return { success: false, summary: '無法建立作業。', isWrite: true };
    if (!args.groupId || !args.title) {
      return { success: false, isWrite: false, summary: '請指定要在哪門課建立作業，以及作業標題。' };
    }
    try {
      const ds = getDataSource();
      const assignment = await ds.createAssignment({
        groupId: args.groupId,
        title: args.title,
        description: args.description ?? '',
        dueAt: args.dueAt ? new Date(args.dueAt) : undefined,
        type: 'assignment',
        createdBy: ctx.userId ?? '',
      } as any);
      return { success: true, isWrite: true, data: assignment, summary: `✅ 已建立作業「${args.title}」` };
    } catch (e: any) {
      return { success: false, error: e.message, summary: '建立作業失敗。', isWrite: true };
    }
  },

  grade_submission: async (args, ctx) => {
    if (!hasDataSource()) return { success: false, summary: '無法批改。', isWrite: true };
    if (!args.submissionId || !args.grade) {
      return { success: false, isWrite: false, summary: '請指定要批改的繳交紀錄與分數。' };
    }
    try {
      const ds = getDataSource();
      const result = await ds.gradeSubmission(args.submissionId, parseInt(args.grade), args.feedback);
      return { success: true, isWrite: true, data: result, summary: `✅ 已給分 ${args.grade} 分${args.feedback ? '，附回饋' : ''}` };
    } catch (e: any) {
      return { success: false, error: e.message, summary: '批改失敗。', isWrite: true };
    }
  },

  create_announcement: async (args, ctx) => {
    // 公告需要透過 DataSource（通常需要管理者權限）
    return {
      success: false,
      isWrite: true,
      summary: '公告發布需要通過管理後台操作，目前 AI 無法直接發布。請前往管理台發布公告。',
    };
  },

  // ─────── 新增完整代理操作 ───────

  submit_assignment: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) {
      return { success: false, isWrite: true, summary: '無法提交作業：資料來源或使用者未登入。' };
    }
    if (!args.assignmentId || !args.groupId || !args.content) {
      return { success: false, isWrite: false, summary: '請指定要繳交哪份作業，並提供繳交內容。' };
    }
    try {
      const ds = getDataSource();
      const result = await ds.submitAssignment({
        assignmentId: args.assignmentId,
        userId: ctx.userId,
        groupId: args.groupId,
        content: args.content,
      });
      return { success: true, isWrite: true, data: result, summary: `作業已繳交成功！繳交 ID: ${result.id}` };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `繳交作業失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  enroll_course: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) {
      return { success: false, isWrite: true, summary: '無法選課：資料來源或使用者未登入。' };
    }
    if (!args.courseId || !args.semester) {
      return { success: false, isWrite: false, summary: '請指定要加選的課程與學期。' };
    }
    try {
      const ds = getDataSource();
      const enrollment = await ds.enrollCourse(ctx.userId, args.courseId, args.semester, ctx.schoolId);
      return { success: true, isWrite: true, data: enrollment, summary: `選課成功！課程 ID: ${args.courseId}，學期: ${args.semester}` };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `選課失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  drop_course: async (args, ctx) => {
    if (!hasDataSource()) {
      return { success: false, isWrite: true, summary: '無法退選：資料來源未連接。' };
    }
    if (!args.enrollmentId) {
      return { success: false, isWrite: false, summary: '請指定要退選哪一門課，或先查目前選課紀錄後選一筆。' };
    }
    try {
      const ds = getDataSource();
      await ds.dropCourse(args.enrollmentId, ctx.userId, ctx.schoolId);
      return { success: true, isWrite: true, summary: `已成功退選（選課紀錄 ID: ${args.enrollmentId}）。` };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `退選失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  cancel_seat_reservation: async (args, ctx) => {
    if (!hasDataSource()) {
      return { success: false, isWrite: true, summary: '無法取消預約：資料來源未連接。' };
    }
    if (!args.reservationId) {
      return { success: false, isWrite: false, summary: '請指定要取消哪一筆座位預約。' };
    }
    try {
      const ds = getDataSource();
      await ds.cancelSeatReservation(args.reservationId, ctx.userId, ctx.schoolId);
      return { success: true, isWrite: true, summary: `座位預約已取消（ID: ${args.reservationId}）。` };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `取消預約失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  return_book: async (args, ctx) => {
    if (!hasDataSource()) {
      return { success: false, isWrite: true, summary: '無法還書：資料來源未連接。' };
    }
    if (!args.loanId) {
      return { success: false, isWrite: false, summary: '請指定要歸還哪一本書，或先查借閱紀錄後選一本。' };
    }
    try {
      const ds = getDataSource();
      await ds.returnBook(args.loanId, ctx.userId, ctx.schoolId);
      return { success: true, isWrite: true, summary: `已成功歸還書籍（借閱 ID: ${args.loanId}）。` };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `還書失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  unregister_event: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) {
      return { success: false, isWrite: true, summary: '無法取消報名：資料來源或使用者未登入。' };
    }
    if (!args.eventId) {
      return { success: false, isWrite: false, summary: '請指定要取消報名的活動。' };
    }
    try {
      const ds = getDataSource();
      await ds.unregisterEvent(args.eventId, ctx.userId, ctx.schoolId);
      return { success: true, isWrite: true, summary: `已取消活動報名（活動 ID: ${args.eventId}）。` };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `取消報名失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  check_in_attendance: async (args, ctx) => {
    if (!hasDataSource()) {
      return { success: false, isWrite: true, summary: '無法簽到：資料來源未連接。' };
    }
    const courseSpaceId = (args.courseSpaceId ?? '').trim();
    if (!courseSpaceId) {
      return {
        success: false,
        isWrite: false,
        summary: '簽到需要當前課程的 QR Code 或場次代碼。請打開 App 「課程 → 簽到」掃碼，或告訴我哪堂課的代碼。',
      };
    }
    try {
      const ds = getDataSource();
      const result = await ds.checkInAttendance({
        courseSpaceId,
        sessionId: args.sessionId,
        qrToken: args.qrToken,
      });
      return {
        success: result.success,
        isWrite: true,
        data: result,
        summary: result.success ? '✅ 簽到成功！' : '簽到失敗，請確認 QR Code 或場次是否正確。',
      };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `簽到失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  create_health_appointment: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) {
      return { success: false, isWrite: true, summary: '無法預約看診：資料來源或使用者未登入。' };
    }
    try {
      const ds = getDataSource();
      const appt = await ds.createHealthAppointment({
        userId: ctx.userId,
        department: args.department as any,
        date: args.date,
        timeSlot: args.timeSlot,
        reason: args.reason ?? '',
        schoolId: ctx.schoolId,
      });
      return { success: true, isWrite: true, data: appt, summary: `健康中心預約成功！${args.department} 科，${args.date} ${args.timeSlot}` };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `預約看診失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  reserve_washing_machine: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) {
      return { success: false, isWrite: true, summary: '無法預約洗衣機：資料來源或使用者未登入。' };
    }
    const ds = getDataSource();
    let machineId = (args.machineId ?? '').trim();
    if (!machineId && ctx.lastChoiceMenu && ctx.lastUserMessage) {
      const ord = parseOrdinalFromMessage(ctx.lastUserMessage);
      if (ord != null) {
        const opt = ctx.lastChoiceMenu.options[ord - 1];
        if (opt) machineId = String(opt.id ?? '').split('@@')[0];
      }
    }
    if (!machineId) {
      try {
        const dorm: any = await (ds as any).getDormInfo?.(ctx.userId, ctx.schoolId).catch(() => null);
        const machines: any[] = dorm?.washingMachines ?? dorm?.machines ?? [];
        const available = machines.filter((m: any) => m.available !== false && m.status !== 'in_use').slice(0, 8);
        if (available.length === 0) {
          return { success: false, isWrite: false, summary: '目前沒有空的洗衣機，請晚點再試。' };
        }
        return {
          success: false, isWrite: false,
          summary: `可用洗衣機：\n\n${available.map((m: any, i: number) => `${i + 1}. ${m.label ?? m.name ?? m.id}${m.floor ? `（${m.floor}）` : ''}`).join('\n')}\n\n回「第 N 個」就幫你預約。`,
          choiceMenu: {
            title: '請選擇洗衣機',
            producedByTool: 'reserve_washing_machine',
            options: available.map((m: any, i: number) => ({
              id: String(m.id ?? m.machineId ?? ''),
              label: String(m.label ?? m.name ?? `洗衣機 ${i + 1}`),
              subtitle: m.floor ? String(m.floor) : undefined,
              sendAsUser: `預約第${i + 1}個洗衣機`,
            })),
          },
        };
      } catch (e: any) {
        return { success: false, error: e.message, summary: '無法取得洗衣機清單。', isWrite: false };
      }
    }
    try {
      const reservation = await ds.reserveWashingMachine(machineId, ctx.userId, ctx.schoolId);
      return { success: true, isWrite: true, data: reservation, summary: `✅ 洗衣機預約成功！機器：${machineId}` };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `預約洗衣機失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  create_lost_found: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) {
      return { success: false, isWrite: true, summary: '無法發布失物招領：資料來源或使用者未登入。' };
    }
    try {
      const ds = getDataSource();
      const item = await ds.createLostFoundItem({
        reporterId: ctx.userId,
        type: args.type as 'lost' | 'found',
        title: args.title,
        description: args.description,
        category: 'other' as any,
        location: args.location ?? '',
        date: new Date().toISOString().slice(0, 10),
        contactInfo: args.contactInfo,
        schoolId: ctx.schoolId,
      });
      return { success: true, isWrite: true, data: item, summary: `失物招領已發布：${args.title}（${args.type === 'lost' ? '遺失' : '拾獲'}）` };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `發布失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  join_group: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) {
      return { success: false, isWrite: true, summary: '無法加入群組：資料來源或使用者未登入。' };
    }
    if (!args.groupId) {
      return { success: false, isWrite: false, summary: '請提供群組代碼或群組 ID。' };
    }
    try {
      const ds = getDataSource();
      const member = await ds.joinGroup(args.groupId, ctx.userId, args.joinCode);
      return { success: true, isWrite: true, data: member, summary: `已成功加入群組！` };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `加入群組失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  create_group_post: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) {
      return { success: false, isWrite: true, summary: '無法發布貼文：資料來源或使用者未登入。' };
    }
    if (!args.groupId || !args.content) {
      return { success: false, isWrite: false, summary: '請指定要發到哪個群組，以及貼文內容。' };
    }
    try {
      const ds = getDataSource();
      const post = await ds.createGroupPost({
        groupId: args.groupId,
        authorId: ctx.userId,
        content: args.content,
        isAnnouncement: args.type === 'announcement',
      });
      return { success: true, isWrite: true, data: post, summary: `貼文已發布！` };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `發布貼文失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  confirm_package_pickup: async (args, ctx) => {
    if (!hasDataSource()) {
      return { success: false, isWrite: true, summary: '無法確認領取：資料來源未連接。' };
    }
    if (!args.packageId) {
      return { success: false, isWrite: false, summary: '請指定要確認領取哪一件包裹。' };
    }
    try {
      const ds = getDataSource();
      await ds.confirmPackagePickup(args.packageId, ctx.schoolId);
      return { success: true, isWrite: true, summary: `包裹已確認領取（ID: ${args.packageId}）。` };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `確認領取失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  request_leave: async (args, ctx) => {
    if (!ctx.userId) {
      return { success: false, isWrite: true, summary: '請先登入才能請假。' };
    }
    try {
      // 1. 解析日期
      const now = new Date();
      let targetDate = now;
      if (args.date) {
        const parsed = new Date(args.date);
        if (!isNaN(parsed.getTime())) targetDate = parsed;
      }
      const dayOfWeek = targetDate.getDay(); // 0=Sun, 1=Mon...
      const dateStr = `${targetDate.getFullYear()}/${targetDate.getMonth() + 1}/${targetDate.getDate()}`;
      const dayNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

      // 2. 查找當天課程
      let courses: any[] = [];
      try {
        const cached = await getCachedCourses();
        if (cached && Array.isArray((cached as any).courses)) courses = (cached as any).courses;
        else if (Array.isArray(cached)) courses = cached;
      } catch { /* ignore cache errors */ }
      if (courses.length === 0 && hasDataSource()) {
        try { courses = await getDataSource().listCourses(ctx.schoolId); } catch { /* ignore */ }
      }

      // 找出當天的課
      const todayCourses = courses.filter((c: any) => {
        if (c.dayOfWeek === dayOfWeek) return true;
        if (Array.isArray(c.schedule)) {
          return c.schedule.some((s: any) => s.dayOfWeek === dayOfWeek);
        }
        return false;
      });

      // 如果指定了課程名稱，精確匹配
      let targetCourses = todayCourses;
      if (args.courseName) {
        const keyword = args.courseName.toLowerCase();
        const filtered = todayCourses.filter((c: any) =>
          c.name?.toLowerCase().includes(keyword) || keyword.includes(c.name?.toLowerCase() ?? '')
        );
        if (filtered.length > 0) targetCourses = filtered;
      }

      const reason = args.reason || '個人因素';
      const leaveType = args.leaveType || 'personal';
      const leaveTypeLabel = leaveType === 'sick' ? '病假' : leaveType === 'official' ? '公假' : '事假';

      if (targetCourses.length === 0 && todayCourses.length === 0) {
        return {
          success: true, isWrite: false,
          summary: [
            `假別：${leaveTypeLabel}`,
            `${dateStr}（${dayNames[dayOfWeek]}）沒有找到任何課程，不需要請假哦！如果是其他日期，請告訴我日期。`,
          ].join('\n'),
        };
      }

      // 3. 多堂課 → 列出選項
      if (targetCourses.length > 1 && !args.courseName) {
        const list = targetCourses.map((c: any, i: number) => {
          const time = c.startTime ? `${c.startTime}-${c.endTime || ''}` : (c.startPeriod ? `第${c.startPeriod}節` : '');
          return `${i + 1}. ${c.name}${time ? ` (${time})` : ''}`;
        }).join('\n');
        return {
          success: true, isWrite: false,
          summary: [
            `假別：${leaveTypeLabel}`,
            '',
            `${dateStr}（${dayNames[dayOfWeek]}）有以下課程：`,
            '',
            list,
            '',
            '你要請哪堂課的假？還是全部都請？你可以說「全部都請」或指定課程名稱。',
          ].join('\n'),
          data: targetCourses.map((c: any) => ({ id: c.id, name: c.name })),
        };
      }

      // 4. 執行請假
      const courseNames = targetCourses.map((c: any) => c.name).join('、');

      if (hasDataSource()) {
        const ds = getDataSource();
        // 嘗試寫入請假記錄
        for (const course of targetCourses) {
          try {
            await (ds as any).createLeaveRequest?.({
              userId: ctx.userId,
              schoolId: ctx.schoolId,
              courseId: course.id,
              courseName: course.name,
              date: targetDate.toISOString().split('T')[0],
              reason,
              leaveType,
              status: 'pending',
            } as any);
          } catch {
            // 如果 createLeaveRequest 不存在，用 createCalendarEvent 記錄
            try {
              await ds.createCalendarEvent?.({
                userId: ctx.userId,
                schoolId: ctx.schoolId,
                title: `[${leaveTypeLabel}] ${course.name}`,
                startAt: targetDate,
                description: `請假原因：${reason}`,
              } as any);
            } catch { /* 最後手段也失敗了 */ }
          }
        }
      }

      return {
        success: true, isWrite: true,
        summary: [
          `已幫你提交請假申請！`,
          `日期：${dateStr}（${dayNames[dayOfWeek]}）`,
          `課程：${courseNames || '全天課程'}`,
          `假別：${leaveTypeLabel}`,
          `原因：${reason}`,
          `狀態：已送出，等待老師審核`,
        ].join('\n'),
      };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `請假失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  create_order: async (args, ctx) => {
    if (!ctx.userId) {
      return { success: false, isWrite: true, summary: '請先登入才能訂餐哦！' };
    }
    try {
      const rawItemName = (args.itemName ?? '').trim();

      // ── 0. 語意推理：理解使用者真正想表達什麼 ──
      const userMsg = ctx.lastUserMessage ?? rawItemName;
      const frame = understand(userMsg, {
        lastChoiceMenu: ctx.lastChoiceMenu,
      });

      if (hasInvalidDiningQuantityRequest(userMsg) || hasInvalidDiningQuantityValue(args.quantity)) {
        return {
          success: false,
          isWrite: false,
          summary: '數量看起來不合理。請改成至少 1 份，例如「雞排飯 1 份」或「第 2 個 2 份」。',
        };
      }

      // ── 1. 合併所有菜單來源（Firestore + 本地官方目錄）──
      let allMenus: any[] = [];
      if (hasDataSource()) {
        try {
          const ds = getDataSource();
          const firestoreMenus = await ds.listMenus(ctx.schoolId);
          if (firestoreMenus?.length) allMenus.push(...firestoreMenus);
        } catch { /* Firestore 查詢失敗也不影響 */ }
      }
      if (ctx.userId.startsWith('demo_')) {
        const demoMenus = getDemoDiningMenuItems(ctx.schoolId);
        const existingIds = new Set(allMenus.map((m: any) => String(m.id ?? '')));
        for (const dm of demoMenus) {
          if (!existingIds.has(String(dm.id))) allMenus.push(dm);
        }
      }
      // 加入靜宜大學本地菜單目錄（永遠可用）
      if (isProvidenceDiningSchoolId(ctx.schoolId)) {
        const localMenus = getPuDiningMenuItems(ctx.schoolId);
        if (localMenus?.length) {
          // 去重：如果 Firestore 已有同名的就跳過
          const existingNames = new Set(allMenus.map((m: any) => m.name?.toLowerCase()));
          for (const lm of localMenus) {
            if (!existingNames.has(lm.name?.toLowerCase())) {
              allMenus.push(lm);
            }
          }
        }
      }
      if (allMenus.length === 0) {
        return { success: false, isWrite: true, summary: '目前沒有菜單資料，無法訂餐。請先開啟餐廳/點餐頁面同步資料。' };
      }

      let cafeteriasForMenus: any[] = [];
      if (hasDataSource()) {
        try {
          cafeteriasForMenus = await getDataSource().listCafeterias(ctx.schoolId);
        } catch {
          /* ignore */
        }
      }
      if (ctx.userId.startsWith('demo_')) {
        const demoCafs = getDemoDiningCafeterias(ctx.schoolId);
        const existingIds = new Set(cafeteriasForMenus.map((c: any) => c.id));
        for (const dc of demoCafs) {
          if (!existingIds.has(dc.id)) cafeteriasForMenus.push(dc);
        }
      }
      if (isProvidenceDiningSchoolId(ctx.schoolId)) {
        const localCafs = getPuDiningCafeterias(ctx.schoolId);
        const existingIds = new Set(cafeteriasForMenus.map((c: any) => c.id));
        for (const lc of localCafs) {
          if (!existingIds.has(lc.id)) cafeteriasForMenus.push(lc);
        }
      }

      const vegetarianConflictResult = (matched: any): ToolCallResult | null => {
        if (!frame.constraints.vegetarian || menuLooksVegetarian(matched)) return null;
        const vegPool = allMenus.filter(menuLooksVegetarian);
        const ranked = rankMenuCandidates(vegPool, {
          ...frame,
          slots: { ...frame.slots, item: null },
          constraints: { ...frame.constraints, vegetarian: true },
        }).slice(0, 8);
        const suggestions = ranked
          .map((m: any, i: number) => `${i + 1}. ${m.name}${typeof m.price === 'number' ? ` $${m.price}` : ''}${m.cafeteria ? `（${m.cafeteria}）` : ''}`)
          .join('\n');
        return {
          success: true,
          isWrite: false,
          summary: [
            `你說你吃素，但「${matched.name}」看起來不是素食餐點，我先不替你送單。`,
            suggestions ? `可改選這些素食選項：\n\n${suggestions}` : '目前沒有找到明確的素食餐點，請改到餐廳頁面篩選素食或告訴我其他條件。',
            suggestions ? '回我「第 N 個」再幫你下單。' : '',
          ].filter(Boolean).join('\n\n'),
          choiceMenu: ranked.length > 0 ? buildDiningChoiceMenu(ranked, cafeteriasForMenus, frame) : undefined,
        };
      };

      // ── 2A. 位置引用：「第 N 個」或「對/就那個」直接從 lastChoiceMenu 解析 ──
      const refUsesLastMenu =
        (frame.reference?.type === 'ordinal' || frame.reference?.type === 'confirmation' || frame.reference?.type === 'demonstrative') &&
        ctx.lastChoiceMenu?.options?.length;
      if (refUsesLastMenu) {
        const idx = frame.reference?.type === 'ordinal'
          ? (frame.reference.index === -1 ? ctx.lastChoiceMenu!.options.length : (frame.reference.index ?? 1))
          : 1; // confirmation / demonstrative → 預設挑第一個
        const opt = ctx.lastChoiceMenu!.options[idx - 1];
        if (opt) {
          // 從 option.id 解析 itemId — 通常是 "itemId@@vendorId" 或菜單 slug
          const idParts = String(opt.id ?? '').split('@@');
          const resolvedItemId = idParts[0] ?? '';
          const matchedByIdOrName = allMenus.find(
            (m) => String(m.id ?? '') === resolvedItemId || String(m.name ?? '') === opt.label,
          ) || allMenus.find((m) => String(opt.label ?? '').includes(String(m.name ?? '')));
          if (matchedByIdOrName) {
            // 學會：「第 N 個」在這個對話裡 = matchedByIdOrName.name
            linkConceptToMeaning(opt.label, {
              meaning: '位置引用（lastChoiceMenu 對應項）',
              itemName: matchedByIdOrName.name,
              source: 'inferred',
              confidence: 0.95,
            });
            const conflict = vegetarianConflictResult(matchedByIdOrName);
            if (conflict) return conflict;
            return await placeOrderWith(matchedByIdOrName, frame.slots.quantity ?? 1, cafeteriasForMenus, ctx, args);
          }
          // 找不到也不要報「找不到 第 N 個」，而是反問
          return {
            success: false,
            isWrite: false,
            summary: `「${opt.label}」目前不在可下單清單中。你想找其他類似的餐點嗎？`,
          };
        }
      }

      // ── 2A-bis. 「隨便/你決定」+ 上一輪有餐單 → AI 直接代決定（top-1 by ranking）──
      if (frame.constraints.autoPick) {
        // 優先從 lastChoiceMenu 的選項中挑
        const pool: any[] = (() => {
          if (ctx.lastChoiceMenu?.options?.length) {
            return ctx.lastChoiceMenu.options
              .map((opt) => {
                const idParts = String(opt.id ?? '').split('@@');
                const resolvedItemId = idParts[0] ?? '';
                return (
                  allMenus.find((m) => String(m.id ?? '') === resolvedItemId) ??
                  allMenus.find((m) => String(m.name ?? '') === opt.label) ??
                  allMenus.find((m) => String(opt.label ?? '').includes(String(m.name ?? '')))
                );
              })
              .filter(Boolean);
          }
          return rankMenuCandidates(allMenus, frame);
        })();
        if (pool.length === 0) {
          return {
            success: false,
            isWrite: false,
            summary: '目前沒有可下單的選項。',
          };
        }
        // 「隨便」→ 不要每次選同一個，從前 3 名裡用日期 hash 挑一個
        const top = pool.slice(0, Math.min(3, pool.length));
        const seed = (new Date().getDate() + (ctx.userId?.length ?? 0)) % top.length;
        const picked = top[seed];
        const conflict = vegetarianConflictResult(picked);
        if (conflict) return conflict;
        return await placeOrderWith(picked, frame.slots.quantity ?? 1, cafeteriasForMenus, ctx, args);
      }

      // ── 2B. 純時段詞「幫我訂午餐／晚餐」→ 推薦該時段熱門 ──
      const isMealTimeOnly =
        frame.intent === 'order_food' &&
        frame.slots.meal_time &&
        !frame.slots.item &&
        !frame.reference;
      if (isMealTimeOnly) {
        const ranked = rankMenuCandidates(allMenus, frame).slice(0, 8);
        if (ranked.length === 0) {
          return {
            success: false,
            isWrite: false,
            summary: `目前看起來沒有適合${mealTimeLabel(frame.slots.meal_time!)}的選項，要不要看完整菜單？`,
          };
        }
        return {
          success: true,
          isWrite: false,
          summary: `${mealTimeLabel(frame.slots.meal_time!)}推薦${frame.constraints.spicy === true ? '（辣味）' : frame.constraints.vegetarian ? '（素食）' : ''}：\n\n${ranked
            .map(
              (m, i) =>
                `${i + 1}. ${m.name}${typeof m.price === 'number' ? ` $${m.price}` : ''}${m.cafeteria ? `（${m.cafeteria}）` : ''}`,
            )
            .join('\n')}\n\n點選下方任一項，或說「第 N 個」就幫你下單。`,
          choiceMenu: buildDiningChoiceMenu(ranked, cafeteriasForMenus, frame),
        };
      }

      // ── 2B-bis. 只有 constraints/category（清淡/辣/素/便宜...）→ 用條件過濾現有 menu/lastChoiceMenu ──
      const hasUsefulConstraint =
        frame.constraints.vegetarian ||
        frame.constraints.spicy === true ||
        frame.constraints.spicy === 'avoid' ||
        frame.constraints.warm ||
        frame.constraints.cold ||
        frame.constraints.quick ||
        frame.constraints.maxPrice != null ||
        (frame.constraints.avoidAllergens && frame.constraints.avoidAllergens.length > 0) ||
        Boolean(frame.slots.category);
      if (hasUsefulConstraint && !frame.slots.item && !frame.reference && !frame.slots.meal_time) {
        // 優先在 lastChoiceMenu 提到的品項中過濾
        let pool = allMenus;
        if (ctx.lastChoiceMenu?.options?.length) {
          const fromMenu = ctx.lastChoiceMenu.options
            .map((opt) => {
              const idParts = String(opt.id ?? '').split('@@');
              const id = idParts[0];
              return (
                allMenus.find((m) => String(m.id ?? '') === id) ??
                allMenus.find((m) => String(opt.label ?? '').includes(String(m.name ?? '')))
              );
            })
            .filter(Boolean);
          if (fromMenu.length > 0) pool = fromMenu as any[];
        }
        const ranked = rankMenuCandidates(pool, frame).slice(0, 8);
        if (ranked.length === 0) {
          return {
            success: false,
            isWrite: false,
            summary: `找不到符合條件的選項。要不要換個說法？例如「素食午餐」「便宜的早餐」。`,
          };
        }
        // 偏好條件描述
        const desc = [
          frame.constraints.vegetarian && '素食',
          frame.constraints.spicy === true && '辣味',
          frame.constraints.spicy === 'avoid' && '不辣',
          frame.constraints.warm && '熱食',
          frame.constraints.cold && '冷飲',
          frame.constraints.maxPrice != null && `預算 $${frame.constraints.maxPrice} 以下`,
          frame.slots.category === 'beverage' && '飲料',
          frame.slots.category === 'dessert' && '甜點',
        ].filter(Boolean).join('、');
        return {
          success: true,
          isWrite: false,
          summary: `${desc ? desc + '推薦：' : '符合條件的選項：'}\n\n${ranked
            .map((m: any, i: number) => `${i + 1}. ${m.name}${typeof m.price === 'number' ? ` $${m.price}` : ''}${m.cafeteria ? `（${m.cafeteria}）` : ''}`)
            .join('\n')}\n\n回我「第 N 個」就幫你下單。`,
          choiceMenu: buildDiningChoiceMenu(ranked, cafeteriasForMenus, frame),
        };
      }

      // ── 2C. 沒有 itemName 也沒有 reference 也沒有 meal_time → 反問而非報錯 ──
      if (!rawItemName && !frame.slots.item && !frame.reference) {
        // 如果上一輪有餐單，就把它端出來再讓使用者挑（而不是又問一遍）
        if (ctx.lastChoiceMenu?.options?.length) {
          return {
            success: false,
            isWrite: false,
            summary: '上面那份清單還能用喔，回我「第 N 個」就幫你下單；或告訴我你的條件（素食、不辣、便宜一點⋯）。',
            choiceMenu: ctx.lastChoiceMenu,
          };
        }
        return {
          success: false,
          isWrite: false,
          summary: '你想吃什麼？可以告訴我具體餐點名（例如「滷肉飯」）、時段（午餐／晚餐）、或描述（清淡的、辣的）。也可以說「隨便」我幫你決定。',
        };
      }

      // ── 2D. 一般匹配（含學習過的別名）──
      const itemName = frame.slots.item ?? rawItemName;
      const normalize = (s: string) => s.toLowerCase().replace(/[\s｜|／/,，、\-—_()（）]/g, '');
      const itemNameCandidates = Array.from(new Set([
        itemName,
        rawItemName,
        itemName.replace(/^(?:幫我|我要|我想|點|訂|買|來|一份|1份|一個|1個|一碗|1碗|一杯|1杯)+/g, ''),
        itemName.replace(/(?:一份|1份|一個|1個|一碗|1碗|一杯|1杯)/g, ''),
      ].map((s) => s.trim()).filter(Boolean)));

      const findMatches = (): any[] => {
        for (const candidate of itemNameCandidates) {
          const keyword = normalize(candidate);
          // 0. 學習過的概念別名
          const learned = lookupLearnedConcept(candidate);
          if (learned?.itemName) {
            const byLearned = allMenus.filter((m) => normalize(m.name) === normalize(learned.itemName!));
            if (byLearned.length > 0) return byLearned;
          }
          // 1. 完全匹配
          const exact = allMenus.filter(m => normalize(m.name) === keyword);
          if (exact.length > 0) return exact;
          // 2. 名稱包含關鍵字
          const includes = allMenus.filter(m => normalize(m.name).includes(keyword));
          if (includes.length > 0) return includes;
          // 3. 關鍵字包含名稱
          const reverse = allMenus.filter(m => keyword.includes(normalize(m.name)));
          if (reverse.length > 0) return reverse;
          // 4. 拆字匹配（≥60% 字元命中）
          const chars = [...keyword];
          const fuzzy = allMenus.filter(m => {
            const n = normalize(m.name);
            return chars.filter(c => n.includes(c)).length >= Math.ceil(chars.length * 0.6);
          });
          if (fuzzy.length > 0) return fuzzy;
        }
        return [];
      };

      const matches = findMatches();

      // ── 3. 無匹配 → 主動標記為 unknownConcept，並反問（不是報「找不到」）──
      if (matches.length === 0) {
        // ➤ 主動學習：記住這個我不會的詞
        recordUnknownConcept(itemName, {
          message: userMsg,
          hypothesis: (() => {
            // 字元交集最高的 known item 作為推測
            const termChars = new Set([...itemName]);
            let best: { name: string; overlap: number } | null = null;
            for (const m of allMenus) {
              const itemChars = new Set([...String(m.name ?? '')]);
              let overlap = 0;
              termChars.forEach((c) => { if (itemChars.has(c)) overlap++; });
              if (!best || overlap > best.overlap) best = { name: m.name, overlap };
            }
            return best && best.overlap > 0
              ? { guess: best.name, reason: `${best.overlap}/${itemName.length} 字重疊`, confidence: Math.min(0.7, best.overlap / itemName.length) }
              : undefined;
          })(),
        });

        const ranked = rankMenuCandidates(allMenus, frame).slice(0, 8);
        // 重組：如果語意層有 mealTime/constraints，按那個推薦
        const pickMenus = ranked.length > 0 ? ranked : allMenus.slice(0, 8);
        const suggestions = pickMenus.map((m: any) =>
          `• ${m.name}${typeof m.price === 'number' ? ` $${m.price}` : ''}${m.cafeteria ? `（${m.cafeteria}）` : ''}`
        ).join('\n');
        const friendlyAsk = frame.slots.meal_time
          ? `沒有完全叫「${itemName}」的餐點，這是${mealTimeLabel(frame.slots.meal_time)}的推薦：`
          : `我這裡找不到叫「${itemName}」的餐點，是不是想點下面其中一項？`;
        return {
          success: false, isWrite: false,
          summary: `${friendlyAsk}\n\n${suggestions}\n\n你可以說「第 N 個」幫你下單，或回我比較像哪一項，我下次就學會了。`,
          choiceMenu: buildDiningChoiceMenu(pickMenus, cafeteriasForMenus, frame),
        };
      }

      // ── 4. 多個匹配 → 列出選項讓使用者挑 ──
      if (matches.length > 1) {
        const slice = matches.slice(0, 8);
        const options = slice.map((m: any, i: number) =>
          `${i + 1}. ${m.name}${typeof m.price === 'number' ? ` $${m.price}` : ''}${m.cafeteria ? `（${m.cafeteria}）` : ''}`
        ).join('\n');
        const choiceMenu: AssistantChoiceMenu = {
          title: '請選擇餐點',
          prompt: '點選後會以你的名義送出訂餐請求（仍受後端接單條件限制）',
          options: slice.map((m: any, i: number) => ({
            id: encodeDiningChoiceMenuId(m, cafeteriasForMenus),
            label: `${m.name}${typeof m.price === 'number' ? ` · $${m.price}` : ''}`,
            subtitle: m.cafeteria ? String(m.cafeteria) : undefined,
            sendAsUser: `幫我點第${i + 1}個`,
          })),
        };
        return {
          success: true, isWrite: false,
          summary: `找到 ${matches.length} 個「${itemName}」相關餐點：\n\n${options}\n\n請點下方選單，或說「幫我點第1個」／完整名稱。`,
          data: slice.map((m: any) => ({ id: m.id, name: m.name, price: m.price, cafeteria: m.cafeteria })),
          choiceMenu,
        };
      }

      // ── 5. 唯一匹配 → 直接下單 ──
      const matched = matches[0];
      const conflict = vegetarianConflictResult(matched);
      if (conflict) return conflict;
      const cafeteriaId = matched.cafeteriaId ?? matched.cafeteria_id ?? '';
      const remoteCafeterias: any[] = hasDataSource()
        ? await getDataSource().listCafeterias(ctx.schoolId).catch(() => [])
        : [];
      const cafeterias = [...cafeteriasForMenus];
      const cafeteria = cafeterias.find((c: any) => c.id === cafeteriaId)
        ?? cafeterias.find((c: any) => c.name === matched.cafeteria)
        ?? cafeterias[0];

      const vendorId = diningVendorKeyForMenu(matched, cafeterias);
      const itemId = String(matched.id ?? '').trim();
      if (!itemId) {
        return { success: false, isWrite: true, summary: '無法辨識餐點 ID（itemId），請改點選下方選單或換個說法。' };
      }
      if (!vendorId) {
        return { success: false, isWrite: true, summary: '無法辨識店家 ID（vendorId），請確認菜單已同步或改選其他餐廳。' };
      }

      const quantity = parseInt(String(args.quantity ?? '1'), 10);
      if (!Number.isFinite(quantity) || quantity < 1) {
        return { success: false, isWrite: true, summary: '請提供有效的數量（quantity），至少為 1。' };
      }
      const price = matched.price ?? 0;
      if (typeof price !== 'number') {
        return { success: false, isWrite: true, summary: '此品項缺少可下單價格，無法建立訂單。' };
      }
      const totalAmount = price * quantity;

      // 建立訂單
      if (ctx.userId?.startsWith('demo_')) {
        const demo = await createDemoDiningOrder({
          userId: ctx.userId,
          schoolId: ctx.schoolId,
          role: ctx.role,
          merchantId: vendorId,
          merchantName: cafeteria?.name ?? matched.cafeteria,
          cafeteriaId: cafeteria?.id ?? cafeteriaId,
          itemId,
          itemName: matched.name,
          quantity,
          price,
          note: args.note,
          source: 'ai_agent',
        });
        const suffix = demo.substituted ? '（原指定品項不可用，已改用 demo 可下單品項）' : '';
        return {
          success: true, isWrite: true, data: demo.order,
          summary: [
            `✅ 已送出 demo 訂單。`,
            `身份：${demo.actor.name}（${demo.actor.role}）`,
            `餐點：${demo.item.name} x ${demo.quantity}${suffix}`,
            `餐廳：${demo.merchant.name}`,
            price ? `金額：$${demo.total}` : '',
            `訂單編號：${demo.order.id}`,
            `狀態：待店家確認`,
          ].filter(Boolean).join('\n'),
        };
      }

      if (!hasDataSource()) {
        // 沒有 DataSource 但有菜單 → 回報結果但無法寫入
        return {
          success: true, isWrite: true,
          summary: [
            `已幫你選好餐點！`,
            `餐點：${matched.name} x ${quantity}`,
            cafeteria?.name ? `餐廳：${cafeteria.name}` : (matched.cafeteria ? `餐廳：${matched.cafeteria}` : ''),
            price ? `金額：$${totalAmount}` : '',
            `請到點餐頁面完成最終確認下單。`,
          ].filter(Boolean).join('\n'),
        };
      }

      const finalCafeteriaId = cafeteria?.id ?? cafeteriaId;
      if (cafeteria && matched.cafeteriaId && matched.cafeteriaId !== cafeteria.id) {
        return {
          success: false,
          isWrite: true,
          summary: '餐點與店家資料不一致，請重新選擇品項。',
        };
      }
      const remoteIds = new Set(remoteCafeterias.map((c: any) => c.id));
      if (remoteIds.size > 0 && finalCafeteriaId && !remoteIds.has(finalCafeteriaId)) {
        const displayName =
          cafeteria?.name ?? matched.cafeteria ?? '這間餐廳';
        return {
          success: false,
          isWrite: true,
          summary: [
            `「${displayName}」的菜單可在 App 內瀏覽，但雲端後台尚未有這間店的接單設定，AI 無法代為送單。`,
            '請到「校園 → 餐廳」或點餐頁，選擇已上架且顯示可線上接單的店家；若為示範資料，須等餐廳正式接入後才能下單。',
          ].join('\n'),
        };
      }

      const ds = getDataSource();
      const order = await ds.createOrder({
        userId: ctx.userId,
        schoolId: ctx.schoolId,
        cafeteriaId: finalCafeteriaId,
        merchantId: cafeteria?.merchantId ?? cafeteria?.id ?? cafeteriaId,
        cafeteria: cafeteria?.name ?? matched.cafeteria ?? '校園餐廳',
        merchantName: cafeteria?.name ?? matched.cafeteria ?? '校園餐廳',
        items: [{
          menuItemId: matched.id,
          name: matched.name,
          price,
          quantity,
          note: args.note,
        }],
        totalAmount,
        note: args.note,
        source: 'ai_agent',
      } as any);

      if (!order?.id) {
        return {
          success: false,
          isWrite: true,
          summary: '訂餐失敗：目前系統忙碌，請改到餐廳點餐頁面完成。',
        };
      }

      return {
        success: true, isWrite: true, data: order,
        summary: [
          `✅ 已送出訂單。`,
          `餐點：${matched.name} x ${quantity}`,
          cafeteria?.name ? `餐廳：${cafeteria.name}` : (matched.cafeteria ? `餐廳：${matched.cafeteria}` : ''),
          price ? `金額：$${totalAmount}` : '',
          `訂單編號：${order.id}`,
          `狀態：待店家確認`,
        ].filter(Boolean).join('\n'),
      };
    } catch (e: unknown) {
      return { success: false, isWrite: true, summary: formatCreateOrderToolError(e) };
    }
  },

  cancel_order: async (args, ctx) => {
    if (!hasDataSource()) {
      return { success: false, isWrite: true, summary: '無法取消訂單：資料來源未連接。' };
    }
    const ds = getDataSource();
    let orderId = (args.orderId ?? '').trim();
    if (!orderId && ctx.lastChoiceMenu && ctx.lastUserMessage) {
      const ord = parseOrdinalFromMessage(ctx.lastUserMessage);
      if (ord != null) {
        const opt = ctx.lastChoiceMenu.options[ord - 1];
        if (opt) orderId = String(opt.id ?? '').split('@@')[0];
      }
    }
    if (!orderId) {
      try {
        const orders = await (ds as any).listOrders?.(ctx.userId, ctx.schoolId).catch(() => []) ?? [];
        const pending = (Array.isArray(orders) ? orders : []).filter((o: any) =>
          !/completed|cancelled|refunded/i.test(String(o.status ?? '')),
        ).slice(0, 8);
        if (pending.length === 0) {
          return { success: false, isWrite: false, summary: '目前沒有可取消的訂單。' };
        }
        return {
          success: false, isWrite: false,
          summary: `這些訂單可以取消：\n\n${pending.map((o: any, i: number) => `${i + 1}. ${o.items?.[0]?.name ?? o.cafeteria ?? '訂單'} · $${o.totalAmount ?? '?'}`).join('\n')}\n\n回「取消第 N 個」就幫你處理。`,
          choiceMenu: {
            title: '請選擇要取消的訂單',
            producedByTool: 'cancel_order',
            options: pending.map((o: any, i: number) => ({
              id: String(o.id ?? o.orderId ?? ''),
              label: String(o.items?.[0]?.name ?? o.cafeteria ?? `訂單 ${i + 1}`),
              subtitle: o.totalAmount != null ? `$${o.totalAmount}` : undefined,
              sendAsUser: `取消第${i + 1}個訂單`,
            })),
          },
        };
      } catch (e: any) {
        return { success: false, error: e.message, summary: '無法取得訂單清單。', isWrite: false };
      }
    }
    try {
      await ds.cancelOrder(orderId, ctx.userId, ctx.schoolId);
      return { success: true, isWrite: true, summary: `✅ 訂單已取消（ID: ${orderId}）。` };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `取消訂單失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  create_print_job: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) {
      return { success: false, isWrite: true, summary: '無法列印：資料來源或使用者未登入。' };
    }
    try {
      const ds = getDataSource();
      const job = await ds.createPrintJob({
        printerId: args.printerId,
        userId: ctx.userId,
        fileName: args.fileName,
        copies: parseInt(args.copies ?? '1', 10) || 1,
        color: args.colorMode === 'color',
        duplex: false,
        pages: 1,
        schoolId: ctx.schoolId,
      });
      return { success: true, isWrite: true, data: job, summary: `列印工作已提交！檔案: ${args.fileName}，份數: ${args.copies ?? '1'}` };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `提交列印工作失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  rate_menu_item: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) {
      return { success: false, isWrite: true, summary: '無法評分：資料來源或使用者未登入。' };
    }
    if (!args.menuItemId || !args.rating) {
      return { success: false, isWrite: false, summary: '請指定要評分的餐點與分數。' };
    }
    try {
      const ds = getDataSource();
      const rating = parseInt(args.rating, 10);
      if (rating < 1 || rating > 5) return { success: false, isWrite: true, summary: '評分須為 1-5 之間。' };
      await ds.rateMenuItem(args.menuItemId, ctx.userId, rating);
      return { success: true, isWrite: true, summary: `菜色已評分 ${rating} 顆星！` };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `評分失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  update_calendar_event: async (args, ctx) => {
    if (!hasDataSource()) {
      return { success: false, isWrite: true, summary: '無法修改事件：資料來源未連接。' };
    }
    if (!args.eventId) {
      return { success: false, isWrite: false, summary: '請指定要修改哪一個行事曆事件。' };
    }
    try {
      const ds = getDataSource();
      const updates: any = {};
      if (args.title) updates.title = args.title;
      if (args.startAt) updates.startAt = args.startAt;
      if (args.endAt) updates.endAt = args.endAt;
      if (args.location) updates.location = args.location;
      const event = await ds.updateCalendarEvent(args.eventId, updates, ctx.userId, ctx.schoolId);
      return { success: true, isWrite: true, data: event, summary: `行事曆事件已更新！` };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `修改事件失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  delete_calendar_event: async (args, ctx) => {
    if (!hasDataSource()) {
      return { success: false, isWrite: true, summary: '無法刪除事件：資料來源未連接。' };
    }
    if (!args.eventId) {
      return { success: false, isWrite: false, summary: '請指定要刪除哪一個行事曆事件。' };
    }
    try {
      const ds = getDataSource();
      await ds.deleteCalendarEvent(args.eventId, ctx.userId, ctx.schoolId);
      return { success: true, isWrite: true, summary: `行事曆事件已刪除（ID: ${args.eventId}）。` };
    } catch (e: any) {
      return { success: false, isWrite: true, summary: `刪除事件失敗：${e?.message ?? '未知錯誤'}` };
    }
  },

  query_dorm_info: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) {
      return { success: true, data: null, summary: '無法查詢宿舍資訊：未登入。' };
    }
    try {
      const ds = getDataSource();
      const info = await ds.getDormitoryInfo(ctx.userId);
      const packages = await ds.listDormPackages(ctx.userId, undefined, ctx.schoolId).catch(() => []);
      const machines = await ds.listWashingMachines(ctx.schoolId).catch(() => []);
      const parts: string[] = [];
      if (info) {
        parts.push(`宿舍: ${(info as any).building ?? '未知'} ${(info as any).room ?? ''}`);
      }
      if (packages.length > 0) {
        parts.push(`待領包裹: ${packages.length} 件`);
        packages.slice(0, 3).forEach(p => parts.push(`  - ${(p as any).description ?? (p as any).id}`));
      }
      if (machines.length > 0) {
        const available = machines.filter((m: any) => m.status === 'available').length;
        parts.push(`洗衣機: ${available}/${machines.length} 台可用`);
      }
      return { success: true, data: { info, packages, machines }, summary: parts.join('\n') || '目前沒有宿舍相關資料。' };
    } catch (e: any) {
      return { success: true, data: null, summary: '宿舍資訊查詢失敗。' };
    }
  },

  query_health_records: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) {
      return { success: true, data: null, summary: '無法查詢健康紀錄：未登入。' };
    }
    try {
      const ds = getDataSource();
      const records = await ds.listHealthRecords(ctx.userId, undefined, ctx.schoolId);
      const appointments = await ds.listHealthAppointments(ctx.userId, undefined, ctx.schoolId).catch(() => []);
      const parts: string[] = [];
      if (appointments.length > 0) {
        parts.push(`預約看診: ${appointments.length} 筆`);
        appointments.slice(0, 3).forEach(a => parts.push(`  - ${(a as any).department ?? ''}  ${(a as any).date ?? ''} ${(a as any).timeSlot ?? ''} (${(a as any).status ?? ''})`));
      }
      if (records.length > 0) {
        parts.push(`健康紀錄: ${records.length} 筆`);
      }
      return { success: true, data: { records, appointments }, summary: parts.join('\n') || '目前沒有健康相關紀錄。' };
    } catch (e: any) {
      return { success: true, data: null, summary: '健康紀錄查詢失敗。' };
    }
  },

  query_loans: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) {
      return { success: true, data: null, summary: '無法查詢借閱紀錄：未登入。' };
    }
    try {
      const ds = getDataSource();
      const loans = await ds.listLoans(ctx.userId, ctx.schoolId);
      if (loans.length === 0) return { success: true, data: [], summary: '目前沒有借閱紀錄。' };
      const summary = loans.map((l: any, i: number) =>
        `${i + 1}. ${l.bookTitle ?? l.bookId}${l.dueDate ? ` (到期: ${l.dueDate})` : ''}${l.status ? ` [${l.status}]` : ''}`
      ).join('\n');
      return { success: true, data: loans, summary: `借閱紀錄:\n${summary}` };
    } catch (e: any) {
      return { success: true, data: null, summary: '借閱紀錄查詢失敗。' };
    }
  },

  query_enrollments: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) {
      return { success: true, data: null, summary: '無法查詢選課紀錄：未登入。' };
    }
    try {
      const ds = getDataSource();
      const enrollments = await ds.listEnrollments(ctx.userId, args.semester, ctx.schoolId);
      if (enrollments.length === 0) return { success: true, data: [], summary: '目前沒有選課紀錄。' };
      const summary = enrollments.map((e: any, i: number) =>
        `${i + 1}. ${e.courseName ?? e.courseId}${e.semester ? ` (${e.semester})` : ''}${e.status ? ` [${e.status}]` : ''}`
      ).join('\n');
      return { success: true, data: enrollments, summary: `選課紀錄:\n${summary}` };
    } catch (e: any) {
      return { success: true, data: null, summary: '選課紀錄查詢失敗。' };
    }
  },

  // ── 新增詳細查詢工具 ──

  query_exams: async (args: any) => {
    const cached = await getCachedTCExams();
    if (!cached) return { success: true, data: null, summary: '暫無考試資料。' };
    const entries = args.courseId ? { [args.courseId]: cached[args.courseId] ?? [] } : cached;
    const allExams = Object.entries(entries).flatMap(([cid, exams]) =>
      (exams as any[]).map((e: any) => ({ ...e, courseId: Number(cid) }))
    );
    if (allExams.length === 0) return { success: true, data: [], summary: '目前沒有考試。' };
    const summary = allExams.map((e: any, i: number) =>
      `${i + 1}. ${e.title}（${e.start_time ?? '未定'} ~ ${e.end_time ?? '未定'}）${e.is_closed ? '[已結束]' : ''}`
    ).join('\n');
    return { success: true, data: allExams, summary: `考試列表:\n${summary}` };
  },

  query_score_items: async (args: any) => {
    const cached = await getCachedTCScoreItems();
    if (!cached) return { success: true, data: null, summary: '暫無評分項目資料。' };
    const entries = args.courseId ? { [args.courseId]: cached[args.courseId] ?? [] } : cached;
    const items = Object.entries(entries).flatMap(([cid, arr]) =>
      (arr as any[]).map((s: any) => ({ ...s, courseId: Number(cid) }))
    );
    if (items.length === 0) return { success: true, data: [], summary: '目前沒有評分項目。' };
    const summary = items.map((s: any) => `• ${s.name}（${s.percentage ?? 0}%）`).join('\n');
    return { success: true, data: items, summary: `評分項目:\n${summary}` };
  },

  query_discussions: async (args: any) => {
    const cached = await getCachedTCDiscussions();
    if (!cached) return { success: true, data: null, summary: '暫無討論區資料。' };
    const entries = args.courseId ? { [args.courseId]: cached[args.courseId] ?? [] } : cached;
    const discussions = Object.entries(entries).flatMap(([cid, arr]) =>
      (arr as any[]).map((d: any) => ({ ...d, courseId: Number(cid) }))
    );
    if (discussions.length === 0) return { success: true, data: [], summary: '目前沒有討論區。' };
    const summary = discussions.map((d: any) =>
      `• ${d.title}（${d.post_count ?? 0} 篇貼文）${d.is_locked ? '[已鎖定]' : ''}`
    ).join('\n');
    return { success: true, data: discussions, summary: `討論區:\n${summary}` };
  },

  query_materials: async (args: any) => {
    const cached = await getCachedTCMaterials();
    if (!cached) return { success: true, data: null, summary: '暫無教材資料。' };
    const entries = args.courseId ? { [args.courseId]: cached[args.courseId] ?? [] } : cached;
    const materials = Object.entries(entries).flatMap(([cid, arr]) =>
      (arr as any[]).map((m: any) => ({ ...m, courseId: Number(cid) }))
    );
    if (materials.length === 0) return { success: true, data: [], summary: '目前沒有教材。' };
    const summary = materials.map((m: any) =>
      `• ${m.title ?? m.file_name ?? '未命名'}（${m.type ?? 'file'}）`
    ).join('\n');
    return { success: true, data: materials, summary: `教材列表:\n${summary}` };
  },

  query_course_members: async (args: any) => {
    if (!args.courseId) return { success: true, data: null, summary: '請指定課程 ID。' };
    const cached = await getCachedTCCourseMembers();
    const members = cached?.[args.courseId] ?? [];
    if (members.length === 0) return { success: true, data: [], summary: '暫無成員資料。' };
    const teachers = members.filter((m: any) => m.role === 'teacher' || m.role === 'ta');
    const students = members.filter((m: any) => m.role === 'student');
    const summary = `教師/助教: ${teachers.map((t: any) => t.name).join('、') || '無'}\n學生: 共 ${students.length} 人`;
    return { success: true, data: members, summary };
  },

  query_homework_detail: async (args: any) => {
    const cached = await getCachedTCHomeworkActivities();
    if (!cached) return { success: true, data: null, summary: '暫無作業活動資料。' };
    const entries = args.courseId ? { [args.courseId]: cached[args.courseId] ?? [] } : cached;
    const homeworks = Object.entries(entries).flatMap(([cid, arr]) =>
      (arr as any[]).map((h: any) => ({ ...h, courseId: Number(cid) }))
    );
    if (homeworks.length === 0) return { success: true, data: [], summary: '目前沒有作業。' };
    const summary = homeworks.map((h: any) => {
      const submitted = Array.isArray(h.homework_submissions) && h.homework_submissions.length > 0;
      const status = submitted ? '✓已繳' : h.is_closed ? '✗已截止' : '○待繳';
      return `${status} ${h.title}${h.end_time ? `（截止: ${h.end_time.slice(0, 16).replace('T', ' ')}）` : ''}`;
    }).join('\n');
    return { success: true, data: homeworks, summary: `作業詳情:\n${summary}` };
  },

  query_course_announcements: async (args: any) => {
    const cached = await getCachedTCCourseAnnouncements();
    if (!cached) return { success: true, data: null, summary: '暫無課程公告。' };
    const entries = args.courseId ? { [args.courseId]: cached[args.courseId] ?? [] } : cached;
    const announcements = Object.entries(entries).flatMap(([cid, arr]) =>
      (arr as any[]).map((a: any) => ({ ...a, courseId: Number(cid) }))
    );
    if (announcements.length === 0) return { success: true, data: [], summary: '目前沒有課程公告。' };
    const summary = announcements.slice(0, 10).map((a: any) =>
      `• ${a.title}${a.created_at ? `（${a.created_at.slice(0, 10)}）` : ''}`
    ).join('\n');
    return { success: true, data: announcements, summary: `課程公告:\n${summary}` };
  },
};

// ════════════════════════════════════════════════════════════
// 3. Gemini API 整合 — Function Calling 格式
// ════════════════════════════════════════════════════════════

/**
 * 將工具宣告轉為 Gemini API 的 tools 格式。
 *
 * 合併來源：
 *   1. 既有 readTools / writeTools（保留向後相容）
 *   2. aiToolRegistry 的 canonical 工具（如 order_food / reserve_seat / create_reminder）
 *   後者會覆寫同名項，讓 Gemini 看到 schema 更嚴謹的版本。
 */
export function toGeminiToolsPayload(role?: CampusActorRole) {
  const legacy = getToolDeclarations(role);
  // Lazy require 避免循環相依
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getRegistryGeminiDeclarations } = require('./aiToolRegistry') as typeof import('./aiToolRegistry');
  const canonical = getRegistryGeminiDeclarations(role);
  const map = new Map<string, GeminiToolDeclaration>();
  for (const d of legacy) map.set(d.name, d);
  for (const d of canonical) map.set(d.name, d as unknown as GeminiToolDeclaration);
  const merged = Array.from(map.values());
  return [{
    function_declarations: merged.map(d => ({
      name: d.name,
      description: d.description,
      parameters: d.parameters,
    })),
  }];
}

/**
 * 處理 Gemini 回傳的 function call
 * 回傳格式：{ functionCalls: [...], textResponse?: string }
 */
export function parseGeminiFunctionCalls(candidate: any): {
  functionCalls: Array<{ name: string; args: Record<string, string> }>;
  textResponse?: string;
} {
  const parts = candidate?.content?.parts ?? [];
  const functionCalls: Array<{ name: string; args: Record<string, string> }> = [];
  let textResponse: string | undefined;

  for (const part of parts) {
    if (part.functionCall) {
      functionCalls.push({
        name: part.functionCall.name,
        args: part.functionCall.args ?? {},
      });
    }
    if (part.text) {
      textResponse = (textResponse ?? '') + part.text;
    }
  }

  return { functionCalls, textResponse };
}

/**
 * 將工具執行結果格式化為 Gemini 的 functionResponse
 */
export function formatToolResponseForGemini(
  toolName: string,
  result: ToolCallResult,
): { role: string; parts: Array<{ functionResponse: { name: string; response: { content: string } } }> } {
  return {
    role: 'function',
    parts: [{
      functionResponse: {
        name: toolName,
        response: {
          content: JSON.stringify({
            success: result.success,
            summary: result.summary,
            error: result.error,
          }),
        },
      },
    }],
  };
}
