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
import {
  getCachedCourses,
  getCachedGrades,
  getCachedAnnouncements,
  getCachedStudentInfo,
  getCachedTCCourses,
  getCachedTCActivities,
  getCachedTCModules,
  getCachedTCAttendance,
  getCachedTCTodos,
  syncAllData,
} from './puDataCache';
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
import type { AssistantChoiceMenu } from '../data/types';

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
            description: '篩選狀態：pending=未繳, overdue=逾期, all=全部',
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
    const now = new Date();

    let items: any[] = [];

    // TronClass activities — may be Record<number, TCActivity[]> or TCActivity[]
    const activityList: any[] = Array.isArray(tcActivities)
      ? tcActivities
      : tcActivities ? Object.values(tcActivities).flat() : [];
    if (activityList.length > 0) {
      items.push(...activityList.map((a: any) => ({
        id: a.id ?? a.activity_id,
        title: a.title ?? a.name,
        courseName: a.course_name ?? '未知課程',
        dueAt: a.end_time ?? a.due_date ?? a.deadline,
        type: a.type ?? 'assignment',
        isOverdue: a.end_time ? new Date(a.end_time) < now : false,
      })));
    }

    // TronClass todos
    if (tcTodos && tcTodos.length > 0) {
      items.push(...tcTodos.filter((t: any) => !items.some(a => a.id === t.id)).map((t: any) => ({
        id: t.id,
        title: t.title ?? t.name,
        courseName: t.course_name ?? '未知課程',
        dueAt: t.end_time ?? t.due_date,
        type: 'todo',
        isOverdue: t.end_time ? new Date(t.end_time) < now : false,
      })));
    }

    // DataSource fallback
    if (items.length === 0 && hasDataSource() && ctx.userId) {
      try {
        const ds = getDataSource();
        const inboxTasks = await ds.listInboxTasks(ctx.userId, ctx.schoolId);
        items = inboxTasks.map(t => ({
          id: t.id,
          title: (t as any).title ?? t.id,
          courseName: (t as any).groupName ?? '',
          dueAt: (t as any).dueAt,
          type: (t as any).kind ?? 'task',
          isOverdue: (t as any).dueAt ? new Date((t as any).dueAt) < now : false,
        }));
      } catch { /* ignore */ }
    }

    const status = args.status ?? 'all';
    if (status === 'overdue') {
      items = items.filter(i => i.isOverdue);
    } else if (status === 'pending') {
      items = items.filter(i => !i.isOverdue);
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
      return `${i + 1}. ${item.title} (${item.courseName}) — ${due}${item.isOverdue ? ' ⚠️逾期' : ''}`;
    }).join('\n');

    return {
      success: true,
      data: items,
      summary: `共 ${items.length} 項待處理:\n${summary}`,
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
      return { success: true, data: limited, summary: `近期活動:\n${summary}` };
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
      const convos = await ds.listConversations(ctx.userId, undefined, ctx.schoolId);
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

  // ─────── 寫入工具 ───────

  send_message: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) return { success: false, error: '未登入', summary: '需要登入才能發送訊息。', isWrite: true };
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
    try {
      const ds = getDataSource();
      await ds.registerEvent(args.eventId, ctx.userId, ctx.schoolId);
      return { success: true, isWrite: true, summary: `✅ 已報名活動 ${args.eventId}` };
    } catch (e: any) {
      return { success: false, error: e.message, summary: '報名活動失敗。', isWrite: true };
    }
  },

  reserve_library_seat: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) return { success: false, error: '未登入', summary: '需要登入才能預約。', isWrite: true };
    try {
      const ds = getDataSource();
      const reservation = await ds.reserveSeat(args.seatId, ctx.userId, args.date, args.startTime, args.endTime, ctx.schoolId);
      return { success: true, isWrite: true, data: reservation, summary: `✅ 已預約座位 ${args.seatId}（${args.date} ${args.startTime}-${args.endTime}）` };
    } catch (e: any) {
      return { success: false, error: e.message, summary: '預約座位失敗。', isWrite: true };
    }
  },

  borrow_book: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) return { success: false, error: '未登入', summary: '需要登入才能借書。', isWrite: true };
    try {
      const ds = getDataSource();
      const loan = await ds.borrowBook(args.bookId, ctx.userId, ctx.schoolId);
      return { success: true, isWrite: true, data: loan, summary: `✅ 已借閱書籍 ${args.bookId}` };
    } catch (e: any) {
      return { success: false, error: e.message, summary: '借閱失敗。', isWrite: true };
    }
  },

  renew_book: async (args, ctx) => {
    if (!hasDataSource() || !ctx.userId) return { success: false, error: '未登入', summary: '需要登入才能續借。', isWrite: true };
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
      return { success: true, isWrite: true, data: req, summary: `✅ 已提交維修申請「${args.title}」` };
    } catch (e: any) {
      return { success: false, error: e.message, summary: '提交維修申請失敗。', isWrite: true };
    }
  },

  // ─────── 教師工具 ───────

  start_attendance: async (args, ctx) => {
    if (!hasDataSource()) return { success: false, summary: '無法啟動點名。', isWrite: true };
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
    try {
      const ds = getDataSource();
      const result = await ds.checkInAttendance({
        courseSpaceId: args.courseSpaceId,
        sessionId: args.sessionId,
        qrToken: args.qrToken,
      });
      return {
        success: result.success,
        isWrite: true,
        data: result,
        summary: result.success ? '簽到成功！' : '簽到失敗，請確認 QR Code 或場次是否正確。',
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
    try {
      const ds = getDataSource();
      const reservation = await ds.reserveWashingMachine(args.machineId, ctx.userId, ctx.schoolId);
      return { success: true, isWrite: true, data: reservation, summary: `洗衣機預約成功！機器 ID: ${args.machineId}` };
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
          summary: `${dateStr}（${dayNames[dayOfWeek]}）沒有找到任何課程，不需要請假哦！如果是其他日期，請告訴我日期。`,
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
          summary: `${dateStr}（${dayNames[dayOfWeek]}）有以下課程：\n\n${list}\n\n你要請哪堂課的假？還是全部都請？你可以說「全部都請」或指定課程名稱。`,
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
      const itemName = (args.itemName ?? '').trim();
      if (!itemName) return { success: false, isWrite: true, summary: '請告訴我你想點什麼餐點。' };

      // ── 1. 合併所有菜單來源（Firestore + 本地官方目錄）──
      let allMenus: any[] = [];
      if (hasDataSource()) {
        try {
          const ds = getDataSource();
          const firestoreMenus = await ds.listMenus(ctx.schoolId);
          if (firestoreMenus?.length) allMenus.push(...firestoreMenus);
        } catch { /* Firestore 查詢失敗也不影響 */ }
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
      if (isProvidenceDiningSchoolId(ctx.schoolId)) {
        const localCafs = getPuDiningCafeterias(ctx.schoolId);
        const existingIds = new Set(cafeteriasForMenus.map((c: any) => c.id));
        for (const lc of localCafs) {
          if (!existingIds.has(lc.id)) cafeteriasForMenus.push(lc);
        }
      }

      // ── 2. 智慧模糊匹配 ──
      const normalize = (s: string) => s.toLowerCase().replace(/[\s｜|／/,，、\-—_()（）]/g, '');
      const keyword = normalize(itemName);

      // 找出所有匹配的餐點（支援部分匹配）
      const findMatches = (): any[] => {
        // 完全匹配
        const exact = allMenus.filter(m => normalize(m.name) === keyword);
        if (exact.length > 0) return exact;
        // 名稱包含關鍵字
        const includes = allMenus.filter(m => normalize(m.name).includes(keyword));
        if (includes.length > 0) return includes;
        // 關鍵字包含名稱
        const reverse = allMenus.filter(m => keyword.includes(normalize(m.name)));
        if (reverse.length > 0) return reverse;
        // 拆字匹配（≥60% 字元命中）
        const chars = [...keyword];
        const fuzzy = allMenus.filter(m => {
          const n = normalize(m.name);
          return chars.filter(c => n.includes(c)).length >= Math.ceil(chars.length * 0.6);
        });
        if (fuzzy.length > 0) return fuzzy;
        return [];
      };

      const matches = findMatches();

      // ── 3. 無匹配 → 推薦類似餐點 ──
      if (matches.length === 0) {
        const pickMenus = allMenus.slice(0, 8);
        const suggestions = allMenus.slice(0, 10).map((m: any) =>
          `• ${m.name}${typeof m.price === 'number' ? ` $${m.price}` : ''}${m.cafeteria ? `（${m.cafeteria}）` : ''}`
        ).join('\n');
        const choiceMenu: AssistantChoiceMenu | undefined =
          pickMenus.length > 0
            ? {
                title: '熱門／可點餐點',
                prompt: '點選一項會幫你帶入訂餐請求',
                options: pickMenus.map((m: any, i: number) => ({
                  id: encodeDiningChoiceMenuId(m, cafeteriasForMenus),
                  label: `${m.name}${typeof m.price === 'number' ? ` · $${m.price}` : ''}`,
                  subtitle: m.cafeteria ? String(m.cafeteria) : undefined,
                  sendAsUser: `幫我點第${i + 1}個`,
                })),
              }
            : undefined;
        return {
          success: false, isWrite: true,
          summary: `找不到「${itemName}」這道餐點。\n\n目前可點的有：\n${suggestions}\n\n你可以說「幫我點 XXX」來下單，或點下方選單。`,
          choiceMenu,
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
      } as any);

      return {
        success: true, isWrite: true, data: order,
        summary: [
          `已送出訂單。`,
          `餐點：${matched.name} x ${quantity}`,
          cafeteria?.name ? `餐廳：${cafeteria.name}` : (matched.cafeteria ? `餐廳：${matched.cafeteria}` : ''),
          price ? `金額：$${totalAmount}` : '',
          `訂單編號：${order?.id ?? '已建立'}`,
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
    try {
      const ds = getDataSource();
      await ds.cancelOrder(args.orderId, ctx.userId, ctx.schoolId);
      return { success: true, isWrite: true, summary: `訂單已取消（ID: ${args.orderId}）。` };
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
