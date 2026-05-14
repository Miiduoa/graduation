/* eslint-disable */
/**
 * AI Local Agent — 本地模型自主代理 v2
 * ═══════════════════════════════════════════════════════════
 * v2 核心改進：
 * - 智慧參數萃取：從自然語言中用 NLP 提取工具所需參數
 * - 鏈式執行：先讀取查找目標 ID，再執行寫入操作
 * - 系統層直接執行：不依賴 3B 模型輸出 [EXECUTE:...] 格式
 * - 自動確認生成：系統生成操作確認訊息，不靠模型
 *
 * 流程：
 * 使用者訊息 → 意圖分析 + 參數萃取 → 讀取查詢 → 鏈式寫入
 * → 全部結果注入 prompt → 本地模型總結回覆
 */

import {
  executeTool,
  getToolDeclarations,
  type ToolCallResult,
  type GeminiToolDeclaration,
} from './aiAgentTools';
import {
  executeToolStandard,
  getToolSpec,
  type StandardToolResult,
} from './aiToolRegistry';
import type { AssistantChoiceMenu, CampusActorRole } from '../data';
import { understand as semanticUnderstand } from './aiSemanticReasoner';
import { linkConceptToMeaning } from './aiActiveLearning';

// ════════════════════════════════════════════════════════════
// 0. 對話上下文指代解析 (Anaphora Resolution)
// ════════════════════════════════════════════════════════════

export type ConversationTurn = { role: 'user' | 'assistant'; content: string };

/**
 * 從 AI 回覆中提取列表項目。支援三種列表格式：
 *   1) `1. 項目` / `1) 項目` / `1、項目`（有序）
 *   2) `• 項目` / `- 項目` / `* 項目`（無序 — index 依出現順序）
 *   3) `項目 | 說明 (位置)` / `項目｜說明（位置）`（pipe 分隔）
 * 同一段中若混用，會合併編號（讓「第 N 個」對應使用者看到的第 N 行）。
 */
function extractListItems(text: string): Array<{ index: number; text: string; name: string; detail: string; location: string }> {
  const items: Array<{ index: number; text: string; name: string; detail: string; location: string }> = [];
  const lines = text.split('\n');
  let idx = 0;
  for (const line of lines) {
    // 有序：1. xxx
    let m = line.match(/^\s*(\d+)[.、)）]\s*(.+)/);
    let fullText: string | null = null;
    if (m) fullText = m[2].trim();
    // 無序：• xxx / - xxx / * xxx
    if (!fullText) {
      const m2 = line.match(/^\s*[•·●○*\-+]\s+(.+)/);
      if (m2) fullText = m2[1].trim();
    }
    if (!fullText) continue;

    idx++;
    const parts = fullText.match(/^([^|｜]+?)(?:\s*[|｜]\s*(.+?))?(?:\s*[（(](.+?)[)）])?$/);
    items.push({
      index: idx,
      text: fullText,
      name: parts?.[1]?.trim() ?? fullText,
      detail: parts?.[2]?.trim() ?? '',
      location: parts?.[3]?.trim() ?? '',
    });
  }
  return items;
}

/**
 * 指代解析：「幫我選第一個」「就那個」「就剛剛那個啊」→ 具體項目
 */
export function resolveConversationReference(
  message: string,
  history: ConversationTurn[],
): { resolvedItemName: string; resolvedDetail: string; resolvedLocation: string; originalContext: string; referenceType: 'ordinal' | 'demonstrative' | 'confirmation' } | null {
  const msg = message.trim();
  const ordinalMatch = msg.match(/第\s*([一二三四五六七八九十\d]+)\s*[個本]/);
  // 勿讓「那堂課」「那間教室」單獨的「那」觸發指代誤判
  const demonstrativeMatch =
    /就?(?:剛剛?|上面|前面)?(?:那個|那(?:一|兩|三)?個|這個|這(?:一|兩|三)?個)啊?|就[是]?(?:那|這|它)(?:個)?啊?|對[，,]?\s*(?:就是)?(?:那|這|它)(?:個)?/.test(
      msg,
    );
  const confirmMatch = /^(?:對|好[的啊]?|可以|沒問題|ok|OK|嗯|恩|是[的啊]?)\s*$/.test(msg);
  if (!ordinalMatch && !demonstrativeMatch && !confirmMatch) return null;

  let lastAssistantContent = '';
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant' && history[i].content.length > 10) { lastAssistantContent = history[i].content; break; }
  }
  if (!lastAssistantContent) return null;

  const items = extractListItems(lastAssistantContent);
  if (items.length === 0) {
    // 也嘗試從「您選擇的是「X」」中提取
    const selectedMatch = lastAssistantContent.match(/(?:您選擇的是|你選的是|已選擇|已幫您選|選擇了)\s*[「『"]([^」』"]+)[」』"]/);
    if (selectedMatch) {
      return { resolvedItemName: selectedMatch[1], resolvedDetail: '', resolvedLocation: '', originalContext: lastAssistantContent, referenceType: demonstrativeMatch ? 'demonstrative' : 'confirmation' };
    }
    return null;
  }

  if (ordinalMatch) {
    const numMap: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    const num = numMap[ordinalMatch[1]] ?? parseInt(ordinalMatch[1], 10);
    const target = (num >= 1 && num <= items.length) ? items[num - 1] : items[0];
    return { resolvedItemName: target.name, resolvedDetail: target.detail, resolvedLocation: target.location, originalContext: lastAssistantContent, referenceType: 'ordinal' };
  }

  if (demonstrativeMatch || confirmMatch) {
    // 往回找上一輪 user 是否選了某項
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'user') {
        const prevMsg = history[i].content;
        const prevOrd = prevMsg.match(/第\s*([一二三四五六七八九十\d]+)\s*個/);
        if (prevOrd) {
          const nm: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
          const n = nm[prevOrd[1]] ?? parseInt(prevOrd[1], 10);
          for (let j = i - 1; j >= 0; j--) {
            if (history[j].role === 'assistant') {
              const prevItems = extractListItems(history[j].content);
              if (n >= 1 && n <= prevItems.length) {
                const t = prevItems[n - 1];
                return { resolvedItemName: t.name, resolvedDetail: t.detail, resolvedLocation: t.location, originalContext: lastAssistantContent, referenceType: 'demonstrative' };
              }
              break;
            }
          }
        }
        for (const item of items) {
          if (prevMsg.includes(item.name)) {
            return { resolvedItemName: item.name, resolvedDetail: item.detail, resolvedLocation: item.location, originalContext: lastAssistantContent, referenceType: 'demonstrative' };
          }
        }
        break;
      }
    }
    // 從 assistant 回覆中找「您選擇的是」
    const selMatch = lastAssistantContent.match(/(?:您選擇的是|你選的是|已選擇|已幫您選|選擇了)\s*[「『"]([^」』"]+)[」』"]/);
    if (selMatch) {
      const matched = items.find(i => i.name.includes(selMatch[1]) || selMatch[1].includes(i.name));
      return { resolvedItemName: matched?.name ?? selMatch[1], resolvedDetail: matched?.detail ?? '', resolvedLocation: matched?.location ?? '', originalContext: lastAssistantContent, referenceType: 'demonstrative' };
    }
    // fallback: 取第一個
    if (items.length > 0) {
      return { resolvedItemName: items[0].name, resolvedDetail: items[0].detail, resolvedLocation: items[0].location, originalContext: lastAssistantContent, referenceType: 'confirmation' };
    }
  }
  return null;
}

// ════════════════════════════════════════════════════════════
// 1. 意圖分析器 + 智慧參數萃取
// ════════════════════════════════════════════════════════════

export type DetectedIntent = {
  tool: string;
  args: Record<string, string>;
  priority: number;
  reason: string;
  /** 是否為寫入操作 */
  isWrite?: boolean;
  /** 寫入操作的前置讀取工具（用來查找目標 ID） */
  prereqRead?: { tool: string; args: Record<string, string> };
  /** 寫入操作需要從前置讀取結果中提取的 key */
  resolveFromRead?: (readResult: ToolCallResult, msg: string) => Record<string, string>;
  /**
   * 寫入工具實際需要哪些 args；空陣列 = handler 自己決定（語意層處理）。
   * 不設定時 → 沿用舊行為（任何 empty arg 都算 missing）。
   */
  requiredArgs?: string[];
  /** 這些欄位必須由前置讀取解析取得，不能只用使用者文字猜測。 */
  resolvedRequiredArgs?: string[];
};

const GENERATED_WRITE_REQUIRED_ARGS: Record<string, string[]> = {
  send_message: ['peerId', 'content'],
  create_calendar_event: ['title', 'startAt'],
  register_event: [],
  reserve_library_seat: [],
  borrow_book: [],
  renew_book: ['loanId'],
  mark_notifications_read: ['action'],
  create_repair_request: ['room', 'description'],
  submit_assignment: ['assignmentId', 'groupId', 'content'],
  enroll_course: ['courseId', 'semester'],
  drop_course: ['enrollmentId'],
  cancel_seat_reservation: ['reservationId'],
  return_book: ['loanId'],
  unregister_event: ['eventId'],
  check_in_attendance: [],
  create_health_appointment: ['department', 'date', 'timeSlot'],
  reserve_washing_machine: [],
  create_lost_found: ['type', 'title', 'description'],
  join_group: ['groupId'],
  create_group_post: ['groupId', 'content'],
  confirm_package_pickup: ['packageId'],
  request_leave: ['reason'],
  create_order: [],
  cancel_order: [],
  create_print_job: ['printerId', 'fileName'],
  rate_menu_item: ['menuItemId', 'rating'],
  update_calendar_event: ['eventId'],
  delete_calendar_event: ['eventId'],
  start_attendance: ['courseSpaceId'],
  create_assignment: ['groupId', 'title'],
  grade_submission: ['submissionId', 'grade'],
  create_announcement: ['title', 'body'],
};

function isWriteToolName(toolName: string): boolean {
  return toolName.startsWith('create_') || toolName.startsWith('send_')
    || toolName.startsWith('submit_') || toolName.startsWith('register_')
    || toolName.startsWith('reserve_') || toolName.startsWith('borrow_')
    || toolName.startsWith('cancel_') || toolName.startsWith('drop_')
    || toolName.startsWith('delete_') || toolName.startsWith('update_')
    || toolName.startsWith('mark_') || toolName.startsWith('rate_')
    || toolName === 'request_leave' || toolName.startsWith('check_in')
    || toolName.startsWith('start_') || toolName.startsWith('return_')
    || toolName.startsWith('renew_') || toolName.startsWith('confirm_')
    || toolName.startsWith('join_') || toolName.startsWith('unregister_');
}

function requiredArgsForGeneratedWrite(toolName: string, declarationRequired: string[] = []): string[] {
  if (Object.prototype.hasOwnProperty.call(GENERATED_WRITE_REQUIRED_ARGS, toolName)) {
    return GENERATED_WRITE_REQUIRED_ARGS[toolName];
  }
  return declarationRequired;
}

/**
 * 從自然語言中萃取時間參數
 */
function extractTime(msg: string): { date?: string; startTime?: string; endTime?: string; startAt?: string; endAt?: string } {
  const result: Record<string, string> = {};
  const now = new Date();

  // 日期
  if (/今天|今日/.test(msg)) {
    result.date = now.toISOString().split('T')[0];
  } else if (/明天|明日/.test(msg)) {
    const d = new Date(now); d.setDate(d.getDate() + 1);
    result.date = d.toISOString().split('T')[0];
  } else if (/後天/.test(msg)) {
    const d = new Date(now); d.setDate(d.getDate() + 2);
    result.date = d.toISOString().split('T')[0];
  } else if (/下週|下禮拜|下個禮拜|下個星期/.test(msg)) {
    // 解析「下週/下禮拜 + 星期幾」
    const dayMap: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
    const dayMatch = msg.match(/(?:下週|下禮拜|下個禮拜|下個星期)\s*([一二三四五六日天])/);
    if (dayMatch && dayMap[dayMatch[1]] !== undefined) {
      const targetDay = dayMap[dayMatch[1]];
      const d = new Date(now);
      const currentDay = d.getDay(); // 0=週日
      // 計算到下週目標日的天數
      let daysToAdd = (targetDay - currentDay + 7);
      if (daysToAdd <= 0) daysToAdd += 7; // 確保是「下」週
      if (daysToAdd <= 7) daysToAdd += 7; // 強制下週（非本週）
      // 但如果已經超過本週目標日，加7就到下週了
      daysToAdd = ((targetDay - currentDay + 7) % 7) || 7;
      daysToAdd += 7; // 強制「下」週
      // 簡化邏輯：下週X = 本週X + 7天
      const thisWeekTarget = (targetDay - currentDay + 7) % 7 || 7;
      d.setDate(d.getDate() + thisWeekTarget + 7);
      // 但如果本週目標日還沒過，thisWeekTarget 不需要 +7，只需加到下週
      // 最終：從今天起找到下一個目標日，再 +7
      const d2 = new Date(now);
      const nextOccurrence = (targetDay - currentDay + 7) % 7 || 7;
      d2.setDate(d2.getDate() + nextOccurrence + 7);
      result.date = d2.toISOString().split('T')[0];
    } else {
      // 沒指定星期幾，預設 +7 天
      const d = new Date(now); d.setDate(d.getDate() + 7);
      result.date = d.toISOString().split('T')[0];
    }
  } else if (/這週|這禮拜|這個禮拜|這個星期/.test(msg)) {
    const dayMap: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
    const dayMatch = msg.match(/(?:這週|這禮拜|這個禮拜|這個星期)\s*([一二三四五六日天])/);
    if (dayMatch && dayMap[dayMatch[1]] !== undefined) {
      const targetDay = dayMap[dayMatch[1]];
      const d = new Date(now);
      const currentDay = d.getDay();
      const diff = (targetDay - currentDay + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      result.date = d.toISOString().split('T')[0];
    }
  } else if (/星期|禮拜|週/.test(msg)) {
    // 「禮拜五」「星期三」不帶「下/這」→ 找最近的那一天
    const dayMap: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
    const dayMatch = msg.match(/(?:星期|禮拜|週)\s*([一二三四五六日天])/);
    if (dayMatch && dayMap[dayMatch[1]] !== undefined) {
      const targetDay = dayMap[dayMatch[1]];
      const d = new Date(now);
      const currentDay = d.getDay();
      const diff = (targetDay - currentDay + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      result.date = d.toISOString().split('T')[0];
    }
  }

  // 具體日期 M/D 或 M月D日
  const dateMatch = msg.match(/(\d{1,2})[\/月](\d{1,2})[日號]?/);
  if (dateMatch) {
    const m = dateMatch[1].padStart(2, '0');
    const d = dateMatch[2].padStart(2, '0');
    result.date = `${now.getFullYear()}-${m}-${d}`;
  }

  // 時間 HH:MM
  const timeMatch = msg.match(/(\d{1,2})[:\s時](\d{0,2})[分]?/);
  if (timeMatch) {
    const h = timeMatch[1].padStart(2, '0');
    const m = (timeMatch[2] || '00').padStart(2, '0');
    result.startTime = `${h}:${m}`;
    // 預設 1 小時
    const endH = String(Math.min(parseInt(h) + 1, 23)).padStart(2, '0');
    result.endTime = `${endH}:${m}`;
  }

  // 時段
  if (/早[上晨]/.test(msg)) { result.startTime = result.startTime ?? '09:00'; result.endTime = result.endTime ?? '10:00'; }
  if (/中午/.test(msg)) { result.startTime = result.startTime ?? '12:00'; result.endTime = result.endTime ?? '13:00'; }
  if (/下午/.test(msg)) { result.startTime = result.startTime ?? '14:00'; result.endTime = result.endTime ?? '15:00'; }
  if (/晚[上間]/.test(msg)) { result.startTime = result.startTime ?? '19:00'; result.endTime = result.endTime ?? '20:00'; }

  // ISO 格式
  if (result.date && result.startTime) {
    result.startAt = `${result.date}T${result.startTime}:00`;
    if (result.endTime) result.endAt = `${result.date}T${result.endTime}:00`;
  }

  return result;
}

/**
 * 從自然語言中萃取文字內容（引號或「」或 content 關鍵字後）
 */
function extractContent(msg: string): string {
  // 「...」
  const cn = msg.match(/[「『](.+?)[」』]/);
  if (cn) return cn[1];
  // "..."
  const en = msg.match(/"(.+?)"/);
  if (en) return en[1];
  // 說/寫/傳 後面的內容
  const after = msg.match(/(?:說|寫|傳|講|內容[是為]?)\s*[:：]?\s*(.{2,})/);
  if (after) return after[1].trim();
  return '';
}

function extractRoom(msg: string): string {
  const buildingRoom = msg.match(/([A-Za-z])\s*(?:棟|館)?\s*(\d{3,4})(?:房|室)?/i);
  if (buildingRoom) return `${buildingRoom[1].toUpperCase()}${buildingRoom[2]}`;
  const room = msg.match(/(?:在|房間|寢室|宿舍|地點[:：]?)?\s*([A-Za-z]?\s?\d{3,4})(?:房|室)?/i);
  return room?.[1]?.replace(/\s+/g, '').toUpperCase() ?? '';
}

/** 報修第二輪：只有文字地點（女廁旁走廊）仍應併回前一則報修 */
function extractRepairLocationText(msg: string): string {
  const s = msg.trim().replace(/^在\s*/, '').trim();
  if (!s || s.length > 48) return '';
  if (/^[A-Za-z]?\d{3,4}/.test(s)) return '';
  if (/旁|走廊|樓層|樓|廁|梯間|門口|轉角|大廳|室外|室內|外側|裡面|旁邊|附近/.test(s)) return s;
  return '';
}

function isRoomOnlyMessage(msg: string): boolean {
  const s = msg.trim();
  if (/^(?:在\s*)?(?:[A-Za-z]\s*(?:棟|館)?\s*)?\d{3,4}(?:房|室)?$/i.test(s)) return true;
  if (/^(?:在\s*)?[A-Za-z]?\d{3,4}\b/.test(s) && s.length <= 28) return true;
  if (/^(?:在\s*)?.{2,40}$/.test(s) && extractRepairLocationText(s)) return true;
  return false;
}

/**
 * 從讀取結果中模糊匹配目標名稱，返回 ID
 */
function fuzzyMatchFromData(data: any, keyword: string, idField: string, nameFields: string[]): string | null {
  if (!data || !keyword) return null;
  const items = Array.isArray(data) ? data : (data?.items ?? data?.list ?? data?.data ?? []);
  if (!Array.isArray(items)) return null;
  const kw = keyword.toLowerCase();
  for (const item of items) {
    for (const nf of nameFields) {
      const val = item[nf];
      if (typeof val === 'string' && val.toLowerCase().includes(kw)) {
        return String(item[idField] ?? item.id ?? '');
      }
    }
  }
  // 如果只有一個結果，直接返回
  if (items.length === 1) return String(items[0][idField] ?? items[0].id ?? '');
  return null;
}

function extractRatedMenuItemName(message: string): string {
  const cleaned = message
    .replace(/[「『」』"]/g, '')
    .replace(/^(?:幫我|請|麻煩|幫忙)\s*/, '')
    .replace(/(?:這個|這份|這道|那個|那份|那道)\s*/g, '')
    .trim();
  const match =
    cleaned.match(/(.{1,30}?)(?:給|打)\s*[一二兩三四五\d]\s*[星分]/) ??
    cleaned.match(/(.{1,30}?)(?:評分|打分|幾星|好不好吃)/) ??
    cleaned.match(/(?:評|評分|打分)\s*(.{1,30})/);
  return (match?.[1] ?? '')
    .replace(/^(?:餐點|菜色|菜|食物)\s*/, '')
    .replace(/[，。！？!?、\s]+$/g, '')
    .trim();
}

/**
 * 分析使用者訊息，判斷需要呼叫哪些工具
 * v2: 同時萃取參數 + 設定鏈式執行前置讀取
 */
export function analyzeIntents(message: string): DetectedIntent[] {
  const raw = message.replace(/[\u200B-\u200D\uFEFF]/g, '').normalize('NFKC');
  const msg = raw.toLowerCase().trim();
  const origMsg = raw.trim();
  const intents: DetectedIntent[] = [];
  const timeArgs = extractTime(msg);
  const content = extractContent(origMsg);

  const trimmedLead = origMsg.trim();
  if (
    /^(?:你.*會.*(?:什麼|啥|幹嘛)|你能做什麼|你能幹嘛|你可以做什麼|可以幹嘛|能做什麼|有啥用|有啥功能|會啥|功能|功能說明|使用說明|怎麼用|help|幫助)\??$/i.test(
      trimmedLead,
    ) ||
    /這個助理.{0,22}(?:能做|會做|能做啥|做哪些|幹啥)|助理.{0,12}(?:做哪些|干啥|能做啥)/.test(msg)
  ) {
    intents.push({ tool: 'assistant_help', args: {}, priority: 20, reason: '能力說明' });
  }

  // ══════════════════════════════════
  // 讀取意圖（priority >= 7）
  // ══════════════════════════════════

  // ── 課程/課表 ──
  if (
    /課[表程]|今天[有的].*課|上什麼課|有什麼課|什麼課|哪堂課|幾堂課|幾節課|今天要上幾|第一堂|第一節|首堂|頭堂|今天的課|明天.*課|下一堂|下一節|接下來.*課|幾點.*課|星期.*課|有課嗎|有沒有課|待會.*課|等等.*課|等一下.*課|等一下.*上|等等要上|待會要上|上啥|要上啥|接下來上|在哪上課|哪邊上課|固定在哪.*上課|教室.*幾樓|幾樓.*教室|教室在哪|哪間教室|哪個教室|何處上課|上課地點|教學大樓|what'?s\s+my\s+(?:class|schedule)|\bclass(?:es)?\b.*\btoday\b|\btoday\b.*\bclass(?:es)?\b/.test(
      msg,
    )
  ) {
    const filter = /今天|今日/.test(msg) ? 'today' : /下一堂|下一節|接下來/.test(msg) ? 'next' : 'all';
    intents.push({ tool: 'query_courses', args: { filter }, priority: 10, reason: '查詢課程' });
  }

  if (/成績|分數|幾分|考幾分|gpa|績點|排名|學期成績/.test(msg)) {
    intents.push({ tool: 'query_grades', args: {}, priority: 10, reason: '查詢成績' });
  }

  if (/作業|功課|課業|報告|繳交|deadline|截止|考試|測驗|quiz|exam|待辦|todo|期末|draft|要交|交沒|該交/.test(msg)) {
    const status = /逾期|過期|遲交/.test(msg) ? 'overdue' : /全部/.test(msg) ? 'all' : 'pending';
    intents.push({ tool: 'query_assignments', args: { status }, priority: 10, reason: '查詢作業' });
  }

  if (/考試|期中考|期末考|測驗|小考|quiz|exam|考程/.test(msg) && !/成績|分數|被當/.test(msg)) {
    intents.push({ tool: 'query_exams', args: {}, priority: 10, reason: '查詢考試' });
  }

  if (/評分項目|配分|佔比|占比|比重|成績比例|計分方式|怎麼算分/.test(msg)) {
    intents.push({ tool: 'query_score_items', args: {}, priority: 10, reason: '查詢評分項目' });
  }

  if (/討論區|讨论区|討論串|论坛|貼吧|課程討論|forum|discussion|貼文.*課/.test(msg)) {
    intents.push({ tool: 'query_discussions', args: {}, priority: 9, reason: '查詢課程討論區' });
  }

  if (/教材|講義|讲义|课件|投影片|幻灯片|ppt|PPT|上課檔案|課程檔案|materials?|module/.test(msg)) {
    intents.push({ tool: 'query_materials', args: {}, priority: 9, reason: '查詢課程教材' });
  }

  if (/課程成員|修課名單|同學名單|誰修|助教名單|老師名單|課上有哪些人/.test(msg)) {
    intents.push({ tool: 'query_course_members', args: {}, priority: 8, reason: '查詢課程成員' });
  }

  if (/作業詳情|作业详情|作業細節|繳交狀態|繳交情況|繳交情形|提交紀錄|提交记录|作業回饋|作業活動/.test(msg)) {
    intents.push({ tool: 'query_homework_detail', args: {}, priority: 10, reason: '查詢作業詳情' });
  }

  if (/課程公告|課堂公告|课堂公告|老師公告|课内公告|課內公告|tronclass.*公告/i.test(msg)) {
    intents.push({ tool: 'query_course_announcements', args: {}, priority: 9, reason: '查詢課程公告' });
  }

  // ── 請假（寫入）vs 查出席／假單（讀取）──
  // 「請假單」為名詞，勿誤觸申請請假；須有動作語境（要請／申請／幫我請…）
  const wantsApplyLeave =
    (/幫我.*請假|我要請假|請病假|請事假|(?:想|要)請(?:一)?(?:整天|全天)?(?:的)?假/.test(msg) ||
      (/請假/.test(msg) &&
        /要請|想請|申請|辦|跟老師請|跟課堂請|下午|明天|今天|下禮拜|下週|這禮拜/.test(msg)) ||
      (/請假/.test(msg) && /頭痛|生病|不舒服|發燒|感冒|拉肚子|身體|掛病號/.test(msg))) &&
    !/請假單|假單/.test(msg);
  if (wantsApplyLeave) {
    const reasonMatch = origMsg.match(/(?:因為|原因|因)\s*(.{2,20})/);
    const courseMatch = origMsg.match(/(?:的|課|堂)\s*(.{2,15}?)(?:的|請假|$)/);
    const isSickLeave = /病假|生病|不舒服|發燒|感冒|頭痛|拉肚子|身體/.test(msg);
    const reason = reasonMatch?.[1]?.trim() || (isSickLeave ? '身體不適' : /事|家|私/.test(msg) ? '個人事務' : '個人因素');
    const leaveType = isSickLeave ? 'sick' : /公假|公務/.test(msg) ? 'official' : 'personal';
    // 使用 extractTime 的日期解析（支援下禮拜X、星期X、明天等）
    const dateArg = timeArgs.date ?? '';
    intents.push({
      tool: 'request_leave', isWrite: true, priority: 15,
      args: {
        reason,
        leaveType,
        ...(courseMatch?.[1] ? { courseName: courseMatch[1].trim() } : {}),
        ...(dateArg ? { date: dateArg } : {}),
      },
      reason: `請假（${reason}${dateArg ? ` ${dateArg}` : ''}）`,
      prereqRead: { tool: 'query_courses', args: {} },
    });
  } else if (/請假單|假單/.test(msg) && /查|看|過|審|還沒|進度|狀態/.test(msg)) {
    intents.push({ tool: 'query_attendance', args: {}, priority: 10, reason: '查詢請假狀態' });
  } else if (/出席|缺席|出勤|曠課|到課|點名/.test(msg)) {
    intents.push({ tool: 'query_attendance', args: {}, priority: 10, reason: '查詢出席' });
  } else if (/請假/.test(msg) && /紀錄|查|幾次|狀態/.test(msg)) {
    intents.push({ tool: 'query_attendance', args: {}, priority: 10, reason: '查詢請假紀錄' });
  }

  if (/學分|畢業|能不能畢|修了幾|還差.*學分|畢業門檻|必修|選修/.test(msg)) {
    intents.push({ tool: 'analyze_credits', args: {}, priority: 10, reason: '學分分析' });
  }

  if (/預測|趨勢|未來|走勢|會不會被當|二一|退學|能畢業/.test(msg)) {
    intents.push({ tool: 'predict_gpa', args: {}, priority: 9, reason: 'GPA 預測' });
  }

  if (/我是誰|個人資料|學號|系所|科系|哪個系|幾年級/.test(msg)) {
    intents.push({ tool: 'query_student_info', args: {}, priority: 10, reason: '個人資料' });
  }

  const postingAnnouncement =
    (/發布\s*公告|建立\s*公告|發\s*校園公告|發\s*課程公告|全校\s*公告(?:一下|通知)?|麻煩\s*全校\s*公告|張貼\s*公告|貼上\s*公告|貼出\s*公告|刊登\s*公告|貼(?:個|一(?:則)?)?(?:正式|緊急|官方)?(?:的)?公告|發(?:個|一則)\s*公告|發(?:緊急|官方|正式)[^。\s，]{0,16}?公告|^發公告\b/.test(msg)) &&
    !/發什麼|發過哪些|發了些|有沒有發|有没有发/.test(msg) &&
    !/(?:掃|查|核對|檢查|瀏覽).{0,16}(?:全校|校級)?公告|(?:全校|校級)公告.{0,18}(?:遺漏|漏|上新|清單|過一遍)/.test(msg);
  if (/公告|最新消息|校務|學校.*通知|停課|補假|颱風|天氣假/.test(msg) && !postingAnnouncement) {
    intents.push({ tool: 'query_announcements', args: {}, priority: 8, reason: '查詢公告' });
  }

  if (/活動|社團|比賽|演講|工作坊|校慶/.test(msg) && !/報名|參加|取消/.test(msg)) {
    intents.push({ tool: 'query_events', args: {}, priority: 8, reason: '查詢活動' });
  }

  const homeCookingAdvice =
    /自己煮|在家煮|下廚|料理|食譜|菜譜|冰箱|食材|煮飯|做菜|炒菜|煎蛋|煮麵|煮菜/.test(msg) &&
    !/學餐|餐廳|菜單|外帶|外送|幫我[點訂]|我要[點訂]|點一[個份碗]|訂一[個份碗]/.test(msg);

  if (
    (/推薦.*(午餐|午飯|正餐)|午餐.*(推薦|吃什麼|要吃)|今天中午吃什麼|中午吃什麼|吃午飯|午飯吃什麼|幫我.*午餐|今天.*午餐|正餐.*吃什麼/.test(
      msg,
    ) ||
      (/中午|午餐|晚餐|早餐|菜色|便當/.test(msg) &&
        /推(?:薦)?(?:哪|什麼|啥)?(?:幾)?道|推.{0,6}菜|冷熱|葷素/.test(msg))) &&
    !homeCookingAdvice &&
    !/幫我[點訂]|我要[點訂]|點一[個份碗]|訂一[個份碗]/.test(msg)
  ) {
    const timeSlot = /晚餐|晚飯|今晚/.test(msg) ? 'dinner' : /早餐|早飯/.test(msg) ? 'breakfast' : 'lunch';
    const budgetMatch = origMsg.match(/預算\s*(\d{2,4})|(\d{2,4})\s*元(?:以內|以下)?/);
    const budget = budgetMatch?.[1] ?? budgetMatch?.[2];
    intents.push({
      tool: 'recommend_lunch',
      args: { timeSlot, ...(budget ? { budget } : {}) },
      priority: 14,
      reason: '午餐／正餐推薦',
    });
  } else if (
    /吃|喝|餐[廳點]|菜單|午餐|晚餐|早餐|便當|宵夜|消夜|手搖|奶茶|珍奶|價[格錢]|好吃|美食|飯|清淡|素食|不要太油|少油/.test(msg) &&
    !homeCookingAdvice &&
    !/評分|打分|幾星|幫我[點訂]|我要[點訂]|點一[個份碗]|訂一[個份碗]|不是.*(?:吃|飯)|想看成績/.test(msg)
  ) {
    // 萃取食物關鍵字，例如「我想吃滷肉飯」→ keyword=「滷肉飯」
    const foodKw = origMsg.match(/(?:想吃|想喝|有沒有|有什麼|吃)\s*(.{1,10}?)(?:嗎|呢|的|吧|啊|？|$)/)?.[1]?.trim() ?? '';
    const menuArgs: Record<string, string> = {};
    if (foodKw && foodKw.length >= 2 && !/什麼|好吃|推薦|餐廳/.test(foodKw)) {
      menuArgs.keyword = foodKw;
    }
    intents.push({ tool: 'query_menus', args: menuArgs, priority: 8, reason: foodKw ? `查詢「${foodKw}」` : '查詢餐廳' });
  }

  // ── 列印地點／怎麼印（非「幫我印檔案」）──
  if (
    (/列印店|影印店|影印|去哪.*列印|哪裡.*列印|哪邊.*列印|列印在哪|哪.*印東西|影印.*免費|免費.*影印|印.*免費|幾張.*免費|列印.*規定/.test(msg)) &&
    !/幫我印|想印|要列印|印一下|\.pdf|\.doc|份數|黑白|彩色/.test(msg)
  ) {
    intents.push({ tool: 'comprehensive_analysis', args: {}, priority: 9, reason: '列印相關指引' });
  }

  if (
    (/圖書[館室]|借書|還書|座位|自習|k書|讀書|\blibrary\b/i.test(msg) ||
      /幫我.*(?:圖書|library|還書|借書|借閱|啥時要還|何時還)/.test(msg)) &&
    !/讀書會|讀書計畫|讀書計劃/.test(msg)
  ) {
    const action = /借.*書|借閱|我借/.test(msg) ? 'loans' : /座位|自習|位子/.test(msg) ? 'seats' : 'search';
    const keyword = msg.match(/搜[尋索].*?[「『"](.*?)[」』"]/) ?. [1] ?? '';
    intents.push({ tool: 'query_library', args: { action, keyword }, priority: 8, reason: '查詢圖書館' });
  }

  if (/公車|巴士|校車|交通|怎麼[去到]|搭車|火車|高鐵|ubike|怎麼搭|\bbus\b|shuttle/.test(msg)) {
    intents.push({ tool: 'query_bus', args: {}, priority: 7, reason: '查詢交通' });
  }

  if (
    (/未讀|notifications?\b.*\bunread\b|\bunread\b.*notif|消息|有沒有通知|看一下通知|查通知/.test(msg) ||
      (/通知/.test(msg) && /看|查|有沒有|嗎|啦|一下|未讀/.test(msg))) &&
    !/幫我.*(發|傳|送|私訊).*(?:訊|消息)|標.*已讀|全部.*已讀/.test(msg)
  ) {
    intents.push({ tool: 'query_notifications', args: { unreadOnly: 'true' }, priority: 7, reason: '查詢通知' });
  }

  if (
    (/行事曆|日程|行程|排程|calendar|\bmy\s+schedule\b|\bschedule\b|幾號.*有|這週/.test(msg) ||
      /\bsync\b.*(?:行程|行事曆|calendar)|(?:行程|行事曆).*\bsync\b/i.test(msg)) &&
    !/新增|建立|修改|刪除|加/.test(msg)
  ) {
    intents.push({ tool: 'query_calendar', args: {}, priority: 8, reason: '查詢行事曆' });
  }

  if (
    /私訊|訊息|對話|聊天|dm|message|有人找|誰找過我|誰傳給我|密我|一直密|狂密|敲我|已讀不回|不回我|誰密我/.test(
      msg,
    ) &&
    !/幫我.*[發送傳]/.test(msg) &&
    !(
      /朋友|同事|主管|家人|室友|對方|男友|女友|伴侶|曖昧|曖昧對象/.test(msg) &&
      /怎麼(?:講|說|回|聊|開口)|如何(?:講|說|回|聊)|不尷尬|話術|回覆|建議|溝通|安慰/.test(msg)
    )
  ) {
    intents.push({ tool: 'query_conversations', args: {}, priority: 7, reason: '查詢訊息' });
  }

  if (
    (/訂單|外送|外賣|外帶|待出餐|沒出餐|暴單|付款|消費|交易|口袋|餘額|花多少|零用錢|生活費|還剩多少|省下多少|我的錢|沒錢了|上次.{0,8}訂|訂過.{0,8}(?:餐|單)|下的單|訂\s*的.{0,14}(?:還在|想看|查看|看一下)/.test(
      msg,
    ) ||
      /多少\s*筆.*(?:外帶|外賣|訂單|出餐)/.test(msg) ||
      (/訂/.test(msg) && /(?:還在(?:嗎)?|想看看|看一下)/.test(msg))) &&
    !/取消/.test(msg)
  ) {
    intents.push({ tool: 'query_orders', args: { status: 'all' }, priority: 7, reason: '查詢訂單' });
  }

  if (/宿舍|宿[室]|包裹|寢室/.test(msg) && !/幫我.*預約/.test(msg)) {
    intents.push({ tool: 'query_dorm_info', args: {}, priority: 8, reason: '查詢宿舍' });
  }
  if (
    /洗衣機/.test(msg) &&
    !/幫我.*預約/.test(msg) &&
    !/預約(\s*洗衣|\s*機|洗衣機)|洗衣機.*預約/.test(msg)
  ) {
    intents.push({ tool: 'query_dorm_info', args: {}, priority: 8, reason: '查詢宿舍' });
  }

  const narrowHealthLookup =
    /查詢|查看|查出來|查紀錄|查記錄|查一下|查查|幫我查|帮我查|查預約|查挂号|紀錄|记录|狀態|状态|有沒有/.test(msg);
  const helpedHealthBooking = /[幫帮]我\s*(?:要)?(?:預約|掛號|预约|挂号)/.test(origMsg);
  if (
    /健康|看[診病]|醫生|医生|掛號|挂号|健檢|身體/.test(msg) &&
    (narrowHealthLookup || !helpedHealthBooking)
  ) {
    intents.push({ tool: 'query_health_records', args: {}, priority: 7, reason: '查詢健康' });
  }

  if (
    /借閱|借了.*書|我的書|圖書.*紀錄|借的書|書.*過期|過期.*書|借書.*過期|要還|啥時還|何時還|幾時還|\bdue\b/i.test(
      msg,
    )
  ) {
    intents.push({ tool: 'query_loans', args: {}, priority: 8, reason: '查詢借閱' });
  }

  if (/選課.*紀錄|我選了|已選|退選.*紀錄/.test(msg)) {
    intents.push({ tool: 'query_enrollments', args: {}, priority: 8, reason: '查詢選課' });
  }

  if (/退選|退掉.*課/.test(msg) && /不確定|要不要|該不該|能不能|可不可以|考慮|想問|怎麼/.test(msg)) {
    intents.push({ tool: 'query_enrollments', args: {}, priority: 10, reason: '退選前查詢已選課程' });
    intents.push({ tool: 'analyze_credits', args: {}, priority: 9, reason: '退選前檢查學分影響' });
  }

  if (/選課|加選|選修/.test(msg) && /怎麼|如何|流程|規定|不確定|要不要|該不該|能不能|可不可以|想問|想多修/.test(msg)) {
    intents.push({ tool: 'query_courses', args: { filter: 'all' }, priority: 10, reason: '加退選前查詢課程' });
    intents.push({ tool: 'query_enrollments', args: {}, priority: 9, reason: '加退選前查詢已選課程' });
  }

  // ── 綜合分析 ──
  if (/分析|報告|總結|全面|整體|狀態|狀況|怎麼樣|概況|overview|總覽|一鍵|懶得逐個查|\bcomprehensive\b/i.test(msg)) {
    intents.push({ tool: 'comprehensive_analysis', args: {}, priority: 10, reason: '綜合分析' });
  }

  // ── 今日／明日簡報 ──
  if (
    (/今天.*[忙嗎有什麼活動]|今日.*[嗎有什]|摘要|簡報|briefing|早安.*什|忙不忙|忙嗎|明天.*[忙嗎有]|明日.*[忙嗎有]|這禮拜.*[忙嗎有]|下禮拜.*[忙嗎有]/.test(
      msg,
    )) &&
    !/有什麼課|什麼課|課表|上課|課堂|微積分|課程/.test(msg)
  ) {
    if (intents.length === 0) {
      const isTomorrow = /明天|明日/.test(msg);
      intents.push({
        tool: 'daily_briefing',
        args: isTomorrow ? { day: 'tomorrow' } : {},
        priority: 10,
        reason: isTomorrow ? '明日簡報' : '今日簡報',
      });
    }
  }

  if (/懶人包|今日重點/.test(msg) && !/吃飯|訂餐|點餐|想[吃喝]|便當|蛋餅|奶茶|飲料|宵夜|手搖/.test(msg)) {
    intents.push({ tool: 'daily_briefing', args: {}, priority: 16, reason: '今日懶人包' });
  }

  // ── 餓 → 推薦午餐／晚餐（不拘泥句首，允許口語前綴如「欸」「幹我」）──
  if (
    /好餓|超餓|很餓|有點餓|肚子餓|肚子.{0,2}餓|肚餓|又餓|餓到|餓爆|餓了|餓扁|餓死|快餓死|好想吃東西|想[吃喝]點什麼|嘴饞/.test(msg)
  ) {
    const hour = new Date().getHours();
    const timeSlot = hour < 10 ? 'breakfast' : hour < 14 ? 'lunch' : hour < 17 ? 'snack' : 'dinner';
    intents.push({
      tool: 'recommend_lunch',
      args: { timeSlot },
      priority: 13,
      reason: '依時段推薦餐點',
    });
  }

  // ══════════════════════════════════
  // 寫入意圖（isWrite: true）
  // 現在帶真實參數 + 前置讀取鏈
  // ══════════════════════════════════

  // ── 發送訊息（「私訊誰找過我」為查詢，排除私訊後接「誰」）──
  if (
    /(?:幫我)?[發送傳].*訊息|(?:幫我)?私訊(?!誰)|^通知\s*[\u4e00-\u9fa5A-Za-z]{1,8}|(?:幫我)?(?:傳給|(?<!分)發給)|(?:幫我|請你|請)跟\s*[\u4e00-\u9fa5A-Za-z]{1,12}(?:講|說|：|︰)/.test(
      origMsg,
    ) &&
    !/標.*已讀|全部.*已讀|所有.*已讀|通知.*清|清.*通知|幫我把.{0,12}通知.{0,14}已讀/.test(msg) &&
    !(/\bsub-[a-zA-Z0-9_-]+\b/i.test(origMsg) && /(?:給|打)\s*(?:個)?\s*\d{1,3}/.test(origMsg))
  ) {
    const notifyMatch = origMsg.match(/^通知\s*([^\s,，。！的]{1,4}?)(?=(?:今天|明天|後天|下週|下禮拜|這週|早上|下午|晚上|中午|的|把|改|要|$))\s*(.*)$/);
    // 名字應該短（2~4 字中文），且在「明天/今天/這個/那個/說/要/把」等代名詞前截斷
    const nameMatch =
      notifyMatch ??
      origMsg.match(/(?:跟|傳給|(?<!分)發給|私訊|通知|(?<![分發])給)\s*([^\s,，。！的明今這那個說要把要請我]{1,4})/) ??
      origMsg.match(/^通知\s*([^\s,，。！的明今這那個說要把]{1,4})/);
    const peerName = (nameMatch?.[1] ?? '').replace(/(?:跟[他她它]?|和[他她它]?|叫[他她它]?)$/, '');
    const messageContent = notifyMatch?.[2]?.replace(/^的/, '').trim() || content || '你好';
    intents.push({
      tool: 'send_message', isWrite: true, priority: 12,
      args: { peerId: peerName, content: messageContent },
      requiredArgs: ['peerId', 'content'],
      resolvedRequiredArgs: ['peerId'],
      reason: `發送訊息給 ${peerName || '(待確認)'}`,
      prereqRead: { tool: 'query_conversations', args: {} },
      resolveFromRead: (res, m) => {
        // 從對話列表中找到匹配的 peerId
        const data = res.data as any;
        if (!data) return {};
        const items = Array.isArray(data) ? data : (data?.conversations ?? []);
        const name = peerName.toLowerCase();
        for (const c of items) {
          const members = c.memberIds ?? c.members ?? [];
          const pName = c.peerName ?? c.displayName ?? '';
          if (pName.toLowerCase().includes(name)) {
            const peerId = c.peerId ?? members.find((id: string) => id !== '__self__') ?? '';
            if (peerId) return { peerId };
          }
        }
        return {};
      },
    });
  }

  // ── 報名活動 ──
  if (/報名|參加/.test(msg) && /活動|社團|比賽|演講|工作坊/.test(msg)) {
    const eventName = origMsg.match(/(?:報名|參加)\s*[「『"]?([^」』"\s]{2,20})/)?.[1] ?? '';
    intents.push({
      tool: 'register_event', isWrite: true, priority: 12,
      args: { eventId: '' },
      requiredArgs: [],
      reason: `報名活動「${eventName || '(自動選擇)'}」`,
      prereqRead: { tool: 'query_events', args: {} },
      resolveFromRead: (res) => {
        const id = fuzzyMatchFromData(res.data, eventName, 'id', ['title', 'name']);
        return id ? { eventId: id } : {};
      },
    });
  }

  // ── 取消報名 ──
  if (/取消.*報名|不想.*參加/.test(msg)) {
    const eventName = origMsg.match(/取消.*?報名\s*[「『"]?([^」』"\s]{2,20})/)?.[1] ?? '';
    intents.push({
      tool: 'unregister_event', isWrite: true, priority: 12,
      args: { eventId: '' },
      requiredArgs: ['eventId'],
      reason: `取消報名「${eventName || '(自動選擇)'}」`,
      prereqRead: { tool: 'query_events', args: {} },
      resolveFromRead: (res) => {
        const id = fuzzyMatchFromData(res.data, eventName, 'id', ['title', 'name']);
        return id ? { eventId: id } : {};
      },
    });
  }

  // ── 預約圖書館座位 ──
  if (/預約.*座位|訂.*座|\bbook\b.*(?:圖書館|座位|位子|席)|(?:圖書館|座位|位子).*\bbook\b/i.test(msg)) {
    intents.push({
      tool: 'reserve_library_seat', isWrite: true, priority: 12,
      args: {
        seatId: '', // 自動從查詢結果取第一個可用
        date: timeArgs.date ?? new Date().toISOString().split('T')[0],
        startTime: timeArgs.startTime ?? '09:00',
        endTime: timeArgs.endTime ?? '12:00',
      },
      requiredArgs: [],
      reason: '預約圖書館座位',
      prereqRead: { tool: 'query_library', args: { action: 'seats', keyword: '' } },
      resolveFromRead: (res) => {
        const data = res.data as any;
        const seats = Array.isArray(data) ? data : (data?.seats ?? data?.available ?? []);
        if (Array.isArray(seats) && seats.length > 0) {
          const available = seats.find((s: any) => s.available !== false && s.status !== 'occupied');
          if (available) return { seatId: String(available.id ?? available.seatId ?? '') };
        }
        return {};
      },
    });
  }

  // ── 借書 ──
  if (
    /幫我.*借.*[書本]|借.*這本|借閱.*[書本]|借.*一本|隨便.*借|借.*隨便|順便.*借|借本|借.*參考書/.test(msg) &&
    !/續借/.test(msg)
  ) {
    const bookName =
      origMsg.match(/借本\s*([^，。！？\s]{1,24})/)?.[1]?.trim() ??
      origMsg.match(/借\s*[「『"]?([^」』"\s]{2,20})/)?.[1] ??
      '';
    intents.push({
      tool: 'borrow_book', isWrite: true, priority: 12,
      args: { bookId: '' },
      requiredArgs: [],
      reason: `借閱「${bookName || '(待查找)'}」`,
      prereqRead: { tool: 'query_library', args: { action: 'search', keyword: bookName } },
      resolveFromRead: (res) => {
        const id = fuzzyMatchFromData(res.data, bookName, 'id', ['title', 'name', 'bookTitle']);
        return id ? { bookId: id } : {};
      },
    });
  }

  // ── 續借 ──
  if (/續借/.test(msg)) {
    const bookName = origMsg.match(/續借\s*[「『"]?([^」』"\s]{2,20})/)?.[1] ?? '';
    intents.push({
      tool: 'renew_book', isWrite: true, priority: 12,
      args: { loanId: '' },
      requiredArgs: ['loanId'],
      reason: `續借「${bookName || '(自動選擇)'}」`,
      prereqRead: { tool: 'query_loans', args: {} },
      resolveFromRead: (res) => {
        const id = fuzzyMatchFromData(res.data, bookName, 'id', ['title', 'name', 'bookTitle', 'loanId']);
        return id ? { loanId: id } : {};
      },
    });
  }

  // ── 還書 ──
  if (
    /還書|歸還.*書|(?:幫我|我要|請).*還.*書/.test(msg) &&
    !/啥時|何時|什麼時候|幾時|到期|要還/.test(msg)
  ) {
    const bookName = origMsg.match(/還\s*[「『"]?([^」』"\s]{2,20})/)?.[1] ?? '';
    intents.push({
      tool: 'return_book', isWrite: true, priority: 12,
      args: { loanId: '' },
      requiredArgs: ['loanId'],
      reason: `歸還「${bookName || '(自動選擇)'}」`,
      prereqRead: { tool: 'query_loans', args: {} },
      resolveFromRead: (res) => {
        const id = fuzzyMatchFromData(res.data, bookName, 'id', ['title', 'name', 'bookTitle', 'loanId']);
        return id ? { loanId: id } : {};
      },
    });
  }

  // ── 建立行事曆事件 ──
  if (/新增.*行事曆|加.*行程|加到\s*行事曆|加進\s*行事曆|把.+加到.+行事曆|建立.*提醒|排.*讀書計畫|幫我.*排.*時間|幫我.*加.*行程/.test(msg)) {
    const titleMatch =
      origMsg.match(/(?:把|將)\s*[「『"]?(.{2,24}?)[」』"]?\s*加到\s*行事曆/) ??
      origMsg.match(/(?:新增|建立|加)\s*[「『"]?(.{2,30}?)[」』"]?\s*(?:到|進|的?行事曆|的?行程|$)/);
    const title = titleMatch?.[1]?.trim() ?? (content || '新行程');
    intents.push({
      tool: 'create_calendar_event', isWrite: true, priority: 12,
      args: {
        title,
        startAt: timeArgs.startAt ?? new Date(Date.now() + 3600000).toISOString(),
        endAt: timeArgs.endAt ?? '',
      },
      reason: `建立行程「${title}」`,
    });
  }

  // ── 刪除行事曆 ──
  if (/刪除.*行程|刪.*行程|刪.*行事曆|取消.*事件/.test(msg)) {
    const eventName =
      origMsg.match(/(?:刪除|刪掉|取消)\s*[「『"]?([^」』"\s]{2,20})/)?.[1] ?? '';
    intents.push({
      tool: 'delete_calendar_event', isWrite: true, priority: 12,
      args: { eventId: '' },
      requiredArgs: ['eventId'],
      reason: `刪除行程「${eventName || '(自動選擇)'}」`,
      prereqRead: { tool: 'query_calendar', args: {} },
      resolveFromRead: (res) => {
        const id = fuzzyMatchFromData(res.data, eventName, 'id', ['title', 'name', 'eventId']);
        return id ? { eventId: id } : {};
      },
    });
  }

  // ── 修改行事曆 ──
  if (/修改.*行程|改(?:一下)?.*行程|改.*行事曆|更新.*事件/.test(msg)) {
    const eventName =
      origMsg.match(/(?:修改|更新|改(?:一下)?)\s*[「『"]?([^」』"\s]{2,20})/)?.[1] ?? '';
    intents.push({
      tool: 'update_calendar_event', isWrite: true, priority: 12,
      args: {
        eventId: '',
        ...(timeArgs.startAt ? { startAt: timeArgs.startAt } : {}),
        ...(timeArgs.endAt ? { endAt: timeArgs.endAt } : {}),
      },
      requiredArgs: ['eventId'],
      reason: `修改行程「${eventName || '(自動選擇)'}」`,
      prereqRead: { tool: 'query_calendar', args: {} },
      resolveFromRead: (res) => {
        const id = fuzzyMatchFromData(res.data, eventName, 'id', ['title', 'name', 'eventId']);
        return id ? { eventId: id } : {};
      },
    });
  }

  // ── 報修 ──
  if (/報修|維修|壞了|故障|水管|電|燈|爛掉|爛到|斷線|上不了網|無法連線|\bwifi\b|網路|網絡|宿網|宿舍網/.test(msg)) {
    const typeMap: Record<string, string> = { '水': 'plumbing', '電': 'electrical', '燈': 'electrical', '家具': 'furniture', '冷氣': 'appliance' };
    let repairType = 'other';
    for (const [k, v] of Object.entries(typeMap)) { if (msg.includes(k)) { repairType = v; break; } }
    const room = extractRoom(origMsg);
    const desc = content || origMsg.replace(/幫我|請|報修/g, '').trim();
    intents.push({
      tool: 'create_repair_request', isWrite: true, priority: 12,
      args: { type: repairType, title: desc.slice(0, 30), description: desc, room },
      requiredArgs: ['room', 'description'],
      reason: `報修：${desc.slice(0, 20)}`,
    });
  }

  // ── 繳交作業 ──
  if (/繳交|交作業|提交.*作業/.test(msg) && !/還沒|沒.*(?:動筆|寫|做|完成)|未完成|沒交/.test(msg)) {
    const assignName = origMsg.match(/(?:繳交|提交)\s*[「『"]?([^」』"\s]{2,20})/)?.[1] ?? '';
    intents.push({
      tool: 'submit_assignment', isWrite: true, priority: 12,
      args: { assignmentId: '', groupId: '', content: content || '已完成' },
      requiredArgs: ['assignmentId', 'groupId', 'content'],
      reason: `繳交作業「${assignName || '(自動選擇)'}」`,
      prereqRead: { tool: 'query_assignments', args: { status: 'pending' } },
      resolveFromRead: (res) => {
        const data = res.data as any;
        const items = Array.isArray(data) ? data : (data?.assignments ?? data?.list ?? []);
        if (!Array.isArray(items)) return {};
        const kw = assignName.toLowerCase();
        for (const a of items) {
          const name = (a.title ?? a.name ?? '').toLowerCase();
          if (!kw || name.includes(kw)) {
            return {
              assignmentId: String(a.id ?? a.assignmentId ?? ''),
              groupId: String(a.groupId ?? a.courseId ?? ''),
            };
          }
        }
        if (items.length === 1) return {
          assignmentId: String(items[0].id ?? items[0].assignmentId ?? ''),
          groupId: String(items[0].groupId ?? items[0].courseId ?? ''),
        };
        return {};
      },
    });
  }

  // ── 澄清「其實要加選」：訊息同時含 退選+加選 時，勿誤送 drop
  const clarifiesEnrollNotDrop =
    /不是退選|並非退選|(?:別|勿)退選|打錯.{0,20}(?:加選|選課)|我是要加選|改(?:成|為)加選/.test(msg);

  // ── 選課 ──
  if (
    /選課|加選|選修.*課|我要.*選/.test(msg) &&
    (!/退選|紀錄|我選了|已選|怎麼|如何|流程|規定|不確定|要不要|該不該|能不能|可不可以|想問/.test(msg) ||
      clarifiesEnrollNotDrop)
  ) {
    let courseName = origMsg.match(/(?:選|加選)\s*[「『"]?([^」』"\s]{2,20})/)?.[1] ?? '';
    if (courseName && /(?:不是|並非).{0,2}退選/.test(courseName)) {
      courseName = courseName.split(/(?:不是|並非).{0,2}退選/)[0].trim();
    }
    intents.push({
      tool: 'enroll_course', isWrite: true, priority: 12,
      args: { courseId: '', semester: '' },
      requiredArgs: ['courseId', 'semester'],
      reason: `選課「${courseName || '(待確認)'}」`,
      prereqRead: { tool: 'query_courses', args: { filter: 'all' } },
      resolveFromRead: (res) => {
        const id = fuzzyMatchFromData(res.data, courseName, 'id', ['name', 'title', 'courseName']);
        const data = res.data as any;
        const items = Array.isArray(data) ? data : (data?.courses ?? []);
        const semester = Array.isArray(items) && items[0]?.semester ? items[0].semester : '';
        return id ? { courseId: id, semester } : {};
      },
    });
  }

  // ── 退選 ──
  if (
    /退選|退掉.*課/.test(msg) &&
    !/紀錄|查|看|狀態|歷史|已退|過去|不確定|要不要|該不該|能不能|可不可以|考慮|想問|怎麼/.test(msg) &&
    !clarifiesEnrollNotDrop
  ) {
    const courseName = origMsg.match(/退選?\s*[「『"]?([^」』"\s]{2,20})/)?.[1] ?? '';
    intents.push({
      tool: 'drop_course', isWrite: true, priority: 12,
      args: { enrollmentId: '' },
      requiredArgs: ['enrollmentId'],
      reason: `退選「${courseName || '(待確認)'}」`,
      prereqRead: { tool: 'query_enrollments', args: {} },
      resolveFromRead: (res) => {
        const id = fuzzyMatchFromData(res.data, courseName, 'id', ['name', 'title', 'courseName', 'enrollmentId']);
        return id ? { enrollmentId: id } : {};
      },
    });
  }

  // ── 取消座位 ──
  if (/取消.*預約|取消.*座位/.test(msg)) {
    intents.push({
      tool: 'cancel_seat_reservation', isWrite: true, priority: 12,
      args: { reservationId: '' },
      requiredArgs: ['reservationId'],
      reason: '取消座位預約',
      prereqRead: { tool: 'query_library', args: { action: 'seats', keyword: '' } },
      resolveFromRead: (res) => {
        const data = res.data as any;
        const items = Array.isArray(data) ? data : (data?.reservations ?? data?.myReservations ?? []);
        if (Array.isArray(items) && items.length > 0) {
          return { reservationId: String(items[0].id ?? items[0].reservationId ?? '') };
        }
        return {};
      },
    });
  }

  // ── 簽到（含口誤「簽倒」、簡體「签倒」）──
  if (/已經.*簽到|已簽到|簽到.*了|已經.*簽倒|簽倒.*了/.test(msg) || /已签倒|签倒/.test(msg)) {
    intents.push({
      tool: 'query_attendance',
      args: {},
      priority: 10,
      reason: '查詢簽到狀態',
    });
  } else if (/簽到|簽倒|签倒|打卡|出席.*簽/.test(msg)) {
    intents.push({
      tool: 'check_in_attendance', isWrite: true, priority: 12,
      args: { courseSpaceId: '', sessionId: '' },
      requiredArgs: [],
      reason: '簽到',
      prereqRead: { tool: 'query_courses', args: { filter: 'today' } },
      resolveFromRead: (res) => {
        const data = res.data as any;
        const courses = Array.isArray(data) ? data : (data?.courses ?? []);
        if (Array.isArray(courses) && courses.length > 0) {
          const c = courses[0];
          return {
            courseSpaceId: String(c.id ?? c.courseSpaceId ?? c.groupId ?? ''),
            sessionId: String(c.sessionId ?? c.activeSession ?? 'current'),
          };
        }
        return {};
      },
    });
  }

  // ── 預約看診 ──
  if (
    /預約.*看[診病]|掛號|挂号|掛個號|挂个号|看.*醫生|看.*医生|健康中心.*預約|預約.*健康檢查|健康檢查.*預約/.test(msg) &&
    !/(?:查詢|查看|查出來|查紀錄|查記錄|查一下|查查|幫我查|帮我查|查預約|查挂号|紀錄|记录|狀態|状态|有沒有)/.test(msg)
  ) {
    const deptMap: Record<string, string> = { '牙': 'dental', '心理': 'counseling', '物理治療': 'physical_therapy', '復健': 'physical_therapy' };
    let dept = 'general';
    for (const [k, v] of Object.entries(deptMap)) { if (msg.includes(k)) { dept = v; break; } }
    const reason = content || origMsg.replace(/幫我|請|預約|掛號/g, '').trim().slice(0, 50);
    intents.push({
      tool: 'create_health_appointment', isWrite: true, priority: 12,
      args: {
        department: dept,
        date: timeArgs.date ?? new Date(Date.now() + 86400000).toISOString().split('T')[0],
        timeSlot: timeArgs.startTime ?? '10:00',
        reason,
      },
      reason: `預約${dept === 'general' ? '一般門診' : dept === 'dental' ? '牙科' : dept === 'counseling' ? '心理諮商' : '物理治療'}`,
    });
  }

  // ── 預約洗衣機 ──
  if (/預約.*洗衣|洗衣機.*預約|洗衣/.test(msg) && /幫我|預約/.test(msg)) {
    intents.push({
      tool: 'reserve_washing_machine', isWrite: true, priority: 12,
      args: { machineId: '' },
      requiredArgs: [],
      reason: '預約洗衣機',
      prereqRead: { tool: 'query_dorm_info', args: {} },
      resolveFromRead: (res) => {
        const data = res.data as any;
        const machines = data?.washingMachines ?? data?.machines ?? [];
        if (Array.isArray(machines)) {
          const avail = machines.find((m: any) => m.available !== false && m.status !== 'in_use');
          if (avail) return { machineId: String(avail.id ?? avail.machineId ?? '') };
        }
        return {};
      },
    });
  }

  // ── 失物招領 ──
  // 失物招領 — 排除「壞掉了/報修/弄壞/故障」這類非失物語境
  if (
    /失物|遺失|撿到|拾獲|不見了|搞丟|遺落|找不到.*(?:東西|錢包|手機|鑰匙|學生證)|\bi\s+lost\s+my\b|\blost\s+my\s+(?:wallet|phone|keys|card|airpods)\b/.test(
      msg,
    ) ||
    (/丟了|掉了/.test(msg) && !/壞.*[了掉]|報修|維修|故障|破[了]|裂[開了]|燒壞|弄壞/.test(msg))
  ) {
    const isFound = /撿到|拾獲/.test(msg);
    const desc = content || origMsg.replace(/幫我|請|失物招領/g, '').trim();
    const locMatch = origMsg.match(/(?:在|於)\s*([^\s,，。]{2,15})/);
    intents.push({
      tool: 'create_lost_found', isWrite: true, priority: 12,
      args: {
        type: isFound ? 'found' : 'lost',
        title: desc.slice(0, 30),
        description: desc,
        location: locMatch?.[1] ?? '',
      },
      reason: isFound ? '發布拾獲物品' : '發布遺失物品',
    });
  }

  // ── 群組／學習小組 ──
  if (/加入.*(?:群組|小組|讀書會|社群)|(?:群組|小組|讀書會|社群).*加入/.test(msg)) {
    const groupId = origMsg.match(/(?:群組|小組|讀書會|社群|代碼|code)\s*([A-Za-z0-9_-]{3,20})/)?.[1] ?? '';
    intents.push({
      tool: 'join_group',
      isWrite: true,
      priority: 11,
      args: { groupId },
      requiredArgs: ['groupId'],
      reason: `加入群組${groupId ? ` ${groupId}` : ''}`,
    });
  }

  if (/(?:群組|小組|讀書會|社群).*?(?:發文|貼文|發問|公告)|(?:發文|貼文|發問).*?(?:群組|小組|讀書會|社群)/.test(msg)) {
    const groupId = origMsg.match(/(?:群組|小組|讀書會|社群|代碼|code)\s*([A-Za-z0-9_-]{3,20})/)?.[1] ?? '';
    const contentMatch = origMsg.match(/(?:說|內容|寫|問)\s*[「『"]?(.{2,80})[」』"]?$/);
    intents.push({
      tool: 'create_group_post',
      isWrite: true,
      priority: 11,
      args: {
        groupId,
        content: contentMatch?.[1]?.trim() ?? '',
        type: /公告/.test(msg) ? 'announcement' : /問|問題/.test(msg) ? 'question' : 'discussion',
      },
      requiredArgs: ['groupId', 'content'],
      reason: '發布群組貼文',
    });
  }

  // ── 訂餐 / 點餐（語意層驅動，不再字串匹配）──
  // 「隨便/你就…幫我處理」屬綜合求助，勿走 order_food，否則 semanticUnderstand 易誤判為訂餐
  const isVagueHelpRequest =
    /(?:隨便|随便|你就).{0,14}處理|幫我處理一下|幫我搞定/.test(msg);
  const skipOrderForBriefingPack =
    /懶人包|今日重點/.test(msg) && !/吃飯|訂餐|點餐|想[吃喝]|便當|蛋餅|奶茶|飲料|宵夜|手搖/.test(msg);
  const homeCookingOrderAdvice =
    /自己煮|在家煮|下廚|料理|食譜|菜譜|冰箱|食材|煮飯|做菜|炒菜|煎蛋|煮麵|煮菜/.test(msg) &&
    !/學餐|餐廳|菜單|外帶|外送|幫我[點訂]|我要[點訂]|點一[個份碗]|訂一[個份碗]/.test(msg);
  const explicitOrderCue =
    /點餐|訂餐|外帶|外送|學餐|餐廳|菜單|幫我[點訂]|我要[點訂]|點一[個份碗杯]|訂一[個份碗杯]|來一[個份碗杯]?|買一[個份碗杯]?/.test(msg);
  const foodDomainCue =
    /吃|喝|餓|餐點|食物|美食|飯|麵|便當|午餐|晚餐|早餐|宵夜|消夜|飲料|手搖|奶茶|珍奶|咖啡|滷肉|雞腿|蛋餅|素食|辣|炸|油|清淡|便宜/.test(msg);
  const orderFoodContext = (explicitOrderCue || foodDomainCue) && !homeCookingOrderAdvice;
  const hasInvalidOrderQuantity =
    /(?:^|[^\d])(?:[-−－]\s*\d+|0)\s*[碗份個杯盤道]/.test(msg) ||
    /負\s*\d+\s*[碗份個杯盤道]/.test(msg);
  const gradeQueryCue = /成績|分數|幾分|考幾分|gpa|績點|排名|學期成績/i.test(msg);
  const isMenuBrowseQuestion =
    /不知道|哪家|哪間|哪裡|開著|開嗎|有沒有/.test(msg) &&
    !/幫我[點訂]|我要[點訂]|點一[個份碗杯]|訂一[個份碗杯]|來一[個份碗杯]?|買一[個份碗杯]?/.test(msg);
  // 排除已被其他意圖處理的訊息（請假、報修、預約、取消、查詢等）
  if (
    !isVagueHelpRequest &&
    !skipOrderForBriefingPack &&
    !isMenuBrowseQuestion &&
    !gradeQueryCue &&
    orderFoodContext &&
    !/請.*假|報修|維修|預約.*座|預約.*看|掛號|借.*(?:書|本)|借閱|還書|選課|退選|報名.*活動|發.*訊|作業|功課|deadline|待辦|未交|還沒交|繳交|簽到|簽倒|签倒|打卡|點名|取消.*訂|不要.*訂|先不要|先別(?:要|點|訂)?|等等再說|暫時不用|先不用|不點了|查看|查詢|看一下|看看|查.*訂單|我的訂單|未讀|通知|notification/.test(msg)
  ) {
    // 先用語意推理：訊息「幫我訂午餐」要解析成 intent=order_food + meal_time=lunch（item=null）
    // 而不是 itemName='午餐' 去字串匹配
    if (hasInvalidOrderQuantity) {
      intents.push({
        tool: 'create_order',
        isWrite: true,
        priority: 15,
        args: { quantity: '' },
        requiredArgs: ['quantity'],
        reason: '訂餐數量無效',
      });
    } else {
    let frame: ReturnType<typeof semanticUnderstand> | null = null;
    try {
      frame = semanticUnderstand(origMsg);
    } catch (_e) {
      frame = null;
    }

    if (frame && frame.intent === 'order_food') {
      // 數量從語意層拿
      const quantity = String(frame.slots.quantity ?? 1);
      const itemName = frame.slots.item && !/^(?:的|點的|一點的)$/.test(frame.slots.item)
        ? frame.slots.item
        : '';
      // 構造 args：只放非空欄位（gate 會用 requiredArgs 判斷，handler 自己用語意層）
      const orderArgs: Record<string, string> = { quantity };
      if (itemName) orderArgs.itemName = itemName;
      intents.push({
        tool: 'create_order',
        isWrite: true,
        priority: 15,
        args: orderArgs,
        // create_order 沒有「死掉的必填」：handler 用 lastUserMessage+lastChoiceMenu+frame 自己解析
        requiredArgs: [],
        reason: frame.slots.meal_time
          ? `訂餐：${frame.slots.meal_time === 'lunch' ? '午餐' : frame.slots.meal_time === 'dinner' ? '晚餐' : '早餐'}推薦`
          : frame.reference?.type === 'ordinal'
            ? `訂餐：選第 ${frame.reference.index} 個`
            : itemName
              ? `訂餐「${itemName}」x${quantity}`
              : '訂餐',
      });
    } else if (
      frame &&
      frame.intent === 'unknown' &&
      orderFoodContext &&
      (frame.constraints.vegetarian ||
        frame.constraints.spicy != null ||
        frame.constraints.warm ||
        frame.constraints.cold ||
        frame.constraints.quick ||
        frame.constraints.maxPrice != null ||
        frame.constraints.autoPick)
    ) {
      intents.push({
        tool: 'create_order',
        isWrite: true,
        priority: 15,
        args: { quantity: '1' },
        requiredArgs: [],
        reason: '餐點偏好推薦',
      });
    } else if (frame && frame.intent === 'unknown') {
      // 語意層放棄；用舊的 regex fallback（向後相容）
      const orderMatch = origMsg.match(/(?:幫我[點訂]|我要[點訂吃]|給我|來[一個份碗]?|買[一個份]?|訂[一個份碗]?|點[一個份碗]?)\s*(.{1,20}?)(?:吧|啊|呀|喔|哦|！|!|$)/);
      const orderMatch2 = origMsg.match(/^(?:點|訂)\s*(.{2,15})$/);
      const orderMatch3 = origMsg.match(/(?:我想[吃喝]|想[吃喝]|好想[吃喝])\s*(.{1,15}?)(?:吧|啊|呀|喔|哦|！|!|$)/);
      const foodName = orderMatch?.[1]?.trim() ?? orderMatch2?.[1]?.trim() ?? orderMatch3?.[1]?.trim() ?? '';
      const isNotFood = /假|修|預約|借|還|選|退|報名|發|繳|簽|打卡|點名|課|訊息/.test(foodName);
      if (foodName && !isNotFood && /點|訂|幫我|我要|我想吃|想吃|來[一個份碗]|買/.test(msg)) {
        const qtyMatch = origMsg.match(/(\d+)\s*[碗份個杯盤]/);
        const quantity = qtyMatch?.[1] ?? '1';
        intents.push({
          tool: 'create_order', isWrite: true, priority: 15,
          args: { itemName: foodName, quantity },
          reason: `訂餐「${foodName}」x${quantity}`,
        });
      }
    }
    }
  }

  // ── 取消訂單 ──
  if (/取消.*訂單|不要.*訂/.test(msg)) {
    intents.push({
      tool: 'cancel_order', isWrite: true, priority: 12,
      args: { orderId: '' },
      requiredArgs: [],
      reason: '取消訂單',
      prereqRead: { tool: 'query_orders', args: { status: 'pending' } },
      resolveFromRead: (res) => {
        const data = res.data as any;
        const items = Array.isArray(data) ? data : (data?.orders ?? []);
        if (Array.isArray(items) && items.length > 0) {
          return { orderId: String(items[0].id ?? items[0].orderId ?? '') };
        }
        return {};
      },
    });
  }

  // ── 通知全部已讀（勿與「已讀不回」等社交用語混淆）──
  if (
    (/全部.*已讀|所有.*已讀|通通.*已讀|通知.*清|清.*通知|未讀.{0,6}(?:清|清掉)|幫我把.{0,12}通知.{0,16}(?:標|改|設|弄).{0,4}已讀/.test(
      msg,
    ) ||
      (/標.{0,6}已讀/.test(msg) && /通知|訊息/.test(msg))) &&
    !/已讀不回/.test(msg)
  ) {
    intents.push({
      tool: 'mark_notifications_read', isWrite: true, priority: 12,
      args: { action: 'all' },
      reason: '通知全部標為已讀',
    });
  }

  // ── 領包裹 ──
  if (
    /(?:我要|我去|幫我|確認|我已|已經).*(?:領|取).*包裹|包裹.*(?:確認領取|已領|取件)/.test(msg) &&
    !/有人|誰|被.*領|領.*嗎|取.*嗎|有沒有|查|狀態/.test(msg)
  ) {
    intents.push({
      tool: 'confirm_package_pickup', isWrite: true, priority: 12,
      args: { packageId: '' },
      requiredArgs: ['packageId'],
      reason: '確認領取包裹',
      prereqRead: { tool: 'query_dorm_info', args: {} },
      resolveFromRead: (res) => {
        const data = res.data as any;
        const pkgs = data?.packages ?? [];
        if (Array.isArray(pkgs) && pkgs.length > 0) {
          const pending = pkgs.find((p: any) => p.status === 'pending' || !p.pickedUp);
          if (pending) return { packageId: String(pending.id ?? pending.packageId ?? '') };
        }
        return {};
      },
    });
  }

  // ── 教師：開始點名 ──
  if (/開始.*點名|(?:手動)?開(?:個)?(?:堂)?(?:課)?點名|啟動.*簽到/.test(msg)) {
    intents.push({
      tool: 'start_attendance', isWrite: true, priority: 12,
      args: { courseSpaceId: '' },
      requiredArgs: ['courseSpaceId'],
      reason: '開始點名',
      prereqRead: { tool: 'query_courses', args: { filter: 'today' } },
      resolveFromRead: (res) => {
        const data = res.data as any;
        const courses = Array.isArray(data) ? data : (data?.courses ?? []);
        if (Array.isArray(courses) && courses.length > 0) {
          return { courseSpaceId: String(courses[0].id ?? courses[0].courseSpaceId ?? '') };
        }
        return {};
      },
    });
  }

  // ── 教師：出作業 ──
  if (/出.*作業|建立.*作業|派.*作業|上傳.*作業|新增.*作業|發.*作業/.test(msg)) {
    const titleMatch = origMsg.match(/(?:出|建立|派)\s*.*?作業\s*[「『"]?([^」』"\s]{2,30})?/);
    intents.push({
      tool: 'create_assignment', isWrite: true, priority: 12,
      args: {
        groupId: '',
        title: titleMatch?.[1] ?? (content || '新作業'),
        description: content || '',
        ...(timeArgs.startAt ? { dueAt: timeArgs.startAt } : {}),
      },
      requiredArgs: ['groupId', 'title'],
      reason: '建立作業',
      prereqRead: { tool: 'query_courses', args: { filter: 'today' } },
      resolveFromRead: (res) => {
        const data = res.data as any;
        const courses = Array.isArray(data) ? data : (data?.courses ?? []);
        if (Array.isArray(courses) && courses.length > 0) {
          return { groupId: String(courses[0].groupId ?? courses[0].id ?? '') };
        }
        return {};
      },
    });
  }

  // ── 教師：批改作業 ──
  if (
    (/批改|給分|打分數|幫.*評分|評.*分數|給(?:個)?\s*\d+|打\s*\d+(?:\s*分)?/.test(msg)) &&
    /作業|繳交|submission|學生|這份|那份|sub[-_]/i.test(msg)
  ) {
    const submissionIdGuess =
      origMsg.match(/\b(sub-[a-zA-Z0-9_-]+)\b/i)?.[1]?.trim() ??
      origMsg.match(/繳交(?:單)?(?:號)?\s*[:：]?\s*([^\s,，]{4,48})/i)?.[1]?.trim() ??
      '';
    const grade =
      msg.match(/(\d{1,3})\s*分/)?.[1] ?? msg.match(/(?:給|打)\s*(?:個)?\s*(\d{1,3})(?:\s*分)?/)?.[1] ?? '';
    intents.push({
      tool: 'grade_submission', isWrite: true, priority: 12,
      args: {
        submissionId: submissionIdGuess,
        grade,
        feedback: content || '',
      },
      requiredArgs: ['submissionId', 'grade'],
      reason: '批改學生作業',
    });
  }

  // ── 教師／管理者：發布公告 ──
  if (
    (/發布\s*公告|建立\s*公告|發\s*校園公告|發\s*課程公告|全校\s*公告(?:一下|通知)?|麻煩\s*全校\s*公告|張貼\s*公告|貼上\s*公告|刊登\s*公告|發(?:個|一則)\s*公告|發(?:緊急|官方|正式)[^。\s，]{0,16}?公告|^發公告\b/.test(msg) ||
      /貼(?:個|一(?:則)?)?(?:正式|緊急|官方)?(?:的)?公告/.test(msg)) &&
    !/發什麼|發過哪些|發了些|有沒有發|有没有发/.test(msg)
  ) {
    const title = origMsg.match(/公告\s*[「『"]?([^」』"\s，。]{2,30})/)?.[1] ?? '';
    intents.push({
      tool: 'create_announcement', isWrite: true, priority: 12,
      args: {
        title,
        body: content || origMsg,
        category: /活動/.test(msg) ? 'event' : /緊急|停課|颱風/.test(msg) ? 'emergency' : 'general',
      },
      reason: '發布公告',
    });
  }

  // ── 餐點評分 ──
  if (/評分|打分|幾星|好不好吃|給\s*[一二兩三四五\d]\s*[星分]/.test(msg) && /餐|菜|食|吃|飯|麵|飲料|便當|腿|排|蛋餅|奶茶/.test(msg)) {
    const ratingMatch = msg.match(/(\d|一|二|兩|三|四|五)\s*[星分]/);
    const ratingMap: Record<string, string> = { 一: '1', 二: '2', 兩: '2', 三: '3', 四: '4', 五: '5' };
    const itemName = extractRatedMenuItemName(origMsg);
    intents.push({
      tool: 'rate_menu_item', isWrite: true, priority: 12,
      args: { menuItemId: '', rating: ratingMatch ? (ratingMap[ratingMatch[1]] ?? ratingMatch[1]) : '4' },
      requiredArgs: ['menuItemId', 'rating'],
      reason: `餐點評分${itemName ? `「${itemName}」` : ''}`,
      prereqRead: { tool: 'query_menus', args: {} },
      resolveFromRead: (res) => {
        const data = res.data as any;
        const items = Array.isArray(data) ? data : (data?.menus ?? data?.items ?? []);
        const id = fuzzyMatchFromData(items, itemName, 'id', ['name', 'title', 'itemName']);
        if (id) return { menuItemId: id };
        if (!itemName && Array.isArray(items) && items.length === 1) {
          return { menuItemId: String(items[0].id ?? items[0].menuItemId ?? '') };
        }
        return {};
      },
    });
  }

  // ── 列印 ──
  if (
    /幫我印|想印|要列印|列印一下|印一下|印個|印.*文件|印(?:論文|報告|期中)|一式.*份|論文.*印|print/i.test(msg) &&
    !/列印店|影印店|去哪|哪裡|哪邊|在哪|規定|免費|幾張|多少張/.test(msg)
  ) {
    const rawFileName = origMsg.match(/(?:列印|印)\s*[「『"]?([^」』"\s]{2,30})/)?.[1] ?? 'document.pdf';
    const fileName = rawFileName.replace(/^(?:一下|個|一份|份|文件|檔案)/, '').trim() || 'document.pdf';
    const copyMatch = msg.match(/(\d+|一|二|兩|三|四|五|六|七|八|九|十)\s*份/);
    const copyMap: Record<string, string> = {
      一: '1',
      二: '2',
      兩: '2',
      三: '3',
      四: '4',
      五: '5',
      六: '6',
      七: '7',
      八: '8',
      九: '9',
      十: '10',
    };
    const copies = copyMatch ? copyMap[copyMatch[1]] ?? copyMatch[1] : '1';
    const isColor = /彩色|color/.test(msg);
    intents.push({
      tool: 'create_print_job', isWrite: true, priority: 12,
      args: { printerId: 'default', fileName, copies, colorMode: isColor ? 'color' : 'bw' },
      reason: `列印「${fileName}」${copies}份`,
    });
  }

  // ── 超口語／意圖不明：給預設動作，避免完全沒工具 ──
  if (/忘記今天要幹嘛|忘記.*今天.*要|今天到底要幹嘛|今天要幹嘛/.test(msg) && intents.length === 0) {
    intents.push({ tool: 'daily_briefing', args: {}, priority: 11, reason: '今日行程提示' });
  }
  if (/(?:隨便|随便|你就).{0,14}處理|幫我處理一下|幫我搞定/.test(msg) && intents.length === 0) {
    intents.push({ tool: 'comprehensive_analysis', args: {}, priority: 10, reason: '綜合建議' });
  }

  // 排序：高優先級先執行
  intents.sort((a, b) => b.priority - a.priority);
  return intents.slice(0, 12);
}

// ════════════════════════════════════════════════════════════
// 2. 自主查詢 + 鏈式代理執行器
// ════════════════════════════════════════════════════════════

function pickChoiceMenuFromAgent(
  executed: Array<{ tool: string; result: ToolCallResult }>,
  reads: Array<{ tool: string; result: ToolCallResult }>,
): AssistantChoiceMenu | undefined {
  // 只有「已完成實際下單（寫入）」才收起選單。
  // 訂時段／多筆相符時會 success:true + isWrite:false 並附上 choiceMenu，若誤判成已下單會把選單剝掉，
  // 使用者回「第一個」就接不到 create_order ordinal，整段對話形同白痴。
  const hadCompletedPurchase = executed.some(
    (e) => e.tool === 'create_order' && e.result.success && e.result.isWrite === true,
  );
  if (hadCompletedPurchase) return undefined;

  for (let i = executed.length - 1; i >= 0; i--) {
    const m = executed[i].result.choiceMenu;
    if (m?.options?.length) return m;
  }
  for (let i = reads.length - 1; i >= 0; i--) {
    const m = reads[i].result.choiceMenu;
    if (m?.options?.length) return m;
  }
  return undefined;
}

export type AgentQueryResult = {
  intents: DetectedIntent[];
  results: Array<{ tool: string; result: ToolCallResult; reason: string }>;
  totalTimeMs: number;
  /** 所有工具結果格式化為可注入 prompt 的文字 */
  contextText: string;
  /** 已執行的寫入操作結果 */
  executedActions: Array<{ tool: string; result: ToolCallResult; reason: string }>;
  /** 因缺少參數而無法執行的操作 */
  failedActions: Array<{ tool: string; reason: string; missingInfo: string }>;
  /** 工具回傳的可點選選單（例如訂餐多選一） */
  choiceMenu?: AssistantChoiceMenu;
  // 保留舊欄位相容性
  pendingWriteActions: Array<{ tool: string; reason: string }>;
};

/**
 * v2 自主代理：讀取 + 鏈式寫入 + 自動執行
 */
export async function autonomousQuery(
  message: string,
  ctx: {
    userId?: string;
    schoolId: string;
    role?: CampusActorRole;
    /** 上一輪 AI 回覆的可點選清單，讓「第 N 個」/「就那個」等指代解析能用 */
    lastChoiceMenu?: AssistantChoiceMenu;
    /** 連線狀態（離線時某些寫入會走草稿） */
    isOnline?: boolean;
  },
  /** 可選的模型推理回調 — 當所有規則都失敗時，讓模型自己選工具 */
  modelInference?: (prompt: string) => Promise<string>,
  /** 對話歷史（用於指代解析） */
  conversationHistory?: ConversationTurn[],
): Promise<AgentQueryResult> {
  const start = Date.now();
  // 上下文校正可能在 Step -1 改寫成「幫我點 X」（讓 Step 0+ 走正常 order_food 流程）
  let contextCorrectedMessage: string | null = null;

  // ── Step -1: 主動學習 — 偵測「校正型」訊息 ──
  // 模式：
  //   1. 不是 X 是 Y          → X 等於 Y
  //   2. X 應該是 Y / X 是指 Y → X 等於 Y
  //   3. 不是 X，要 Y / 不是 X，是 Y → 拒絕 X，期望偏 Y
  //   4. 我說的 X 是 Y         → X 等於 Y
  //   5. 是 Y 啦 / 我說 Y      → 若上一輪 AI 提到「找不到 X」，將 X→Y
  try {
    const correction =
      message.match(/(?:不是|不對是|錯了是)\s*[「『"]?([^「『"，,。]{1,12})[」』"]?\s*(?:是|應該是|指的是|意思是|要|想要|找|想找)\s*[「『"]?([^「『"，,。]{1,30})[」』"]?/) ??
      message.match(/(?:我說的|我講的)\s*[「『"]?([^「『"，,。]{1,12})[」』"]?\s*(?:是|是指|就是)\s*[「『"]?([^「『"，,。]{1,30})[」』"]?/) ??
      message.match(/[「『"]?([^「『"，,。]{1,12})[」』"]?\s*(?:應該是|是指|就是指)\s*[「『"]?([^「『"，,。]{1,30})[」』"]?/);
    if (correction) {
      const [, badTerm, goodTerm] = correction;
      const bt = badTerm.trim();
      const gt = goodTerm.trim();
      // 「我不是要吃飯我是想看成績」會被誤切成要吃飯我→成績，別寫進訂餐別名
      if (!(/吃|飯|餐|餓|點餐/.test(bt) && /成績|GPA|gpa|分數|平均/.test(gt))) {
        linkConceptToMeaning(bt, {
          meaning: `使用者澄清：${bt} = ${gt}`,
          itemName: gt,
          aliases: [bt],
          source: 'user_clarified',
          confidence: 1,
        });
        console.log(`[AI Agent] 主動學習：${bt} → ${gt}`);
      }
    } else if (conversationHistory && conversationHistory.length > 0) {
      // 模式 5：使用者只回「是 Y 啦 / 我說 Y / 是 Y」，需要從上一輪 assistant
      //         回覆中抓到「找不到 X / 沒有 X」這類錯誤詞 X，學會 X→Y。
      // Greedy 的 char class 會吃掉句尾語氣詞，所以 capture 用「非語氣詞 + 非標點」
      const shortCorrection =
        message.match(/^(?:是|我說|意思是)\s*[「『"]?([^「『"，,。啦喔嗯耶哦呀的！\s]{2,20})[」』"]?\s*(?:啦|喔|嗯|耶|哦|呀|的|！)?$/) ??
        message.match(/^([^「『"，,。才對啦這個]{2,15})\s*(?:才對|啦才對|這個|這個才對)$/);
      if (shortCorrection) {
        const goodTerm = shortCorrection[1].trim();
        const lastAssistant = [...conversationHistory].reverse().find((t) => t.role === 'assistant');
        if (lastAssistant) {
          const badMatch =
            lastAssistant.content.match(/找不到叫?「([^」]{2,15})」/) ??
            lastAssistant.content.match(/沒有.*?「([^」]{2,15})」/);
          if (badMatch) {
            const badTerm = badMatch[1].trim();
            linkConceptToMeaning(badTerm, {
              meaning: `使用者澄清（上下文）：${badTerm} = ${goodTerm}`,
              itemName: goodTerm,
              aliases: [badTerm],
              source: 'user_clarified',
              confidence: 0.9,
            });
            console.log(`[AI Agent] 上下文校正學習：${badTerm} → ${goodTerm}`);
            // 重寫訊息，讓後續流程把它當成「幫我點 ${goodTerm}」
            contextCorrectedMessage = `幫我點 ${goodTerm}`;
          }
        }
      }
    }
  } catch (e) {
    console.warn('[AI Agent] correction handler failed:', e);
  }

  // ── Step 0: 指代解析 ──
  let resolvedMessage = contextCorrectedMessage ?? message;
  // 如果 ctx.lastChoiceMenu 已經帶來上一輪的選單，**不要**改寫訊息：
  // 讓語意層直接解析「第 N 個 / 第一個 / 最後一個」，handler 用 lastChoiceMenu 對齊。
  // 重寫只在沒有 lastChoiceMenu 但有對話歷史時使用（往回掃 plain text）。
  const skipReferenceRewrite = (ctx.lastChoiceMenu?.options?.length ?? 0) > 0;
  const skipRefForTeachingAction =
    /開\s*點名|開始\s*點名|啟動\s*點名|先手動\s*開\s*點名|手動\s*開\s*點名|點名啦/.test(message);
  if (!skipReferenceRewrite && !skipRefForTeachingAction && conversationHistory && conversationHistory.length > 0) {
    const ref = resolveConversationReference(message, conversationHistory);
    if (ref) {
      console.log(`[AI Agent] 指代解析: "${message}" → "${ref.resolvedItemName}" (${ref.referenceType})`);
      const lastIsDining = /菜單|餐廳|menu|今日|吃|飯|飲料|點餐|午餐|晚餐|早餐/.test(ref.originalContext);
      if (lastIsDining) {
        const foodName = ref.resolvedDetail || ref.resolvedItemName;
        const wantsOrder = /幫我[點訂選]|直接[點訂幫]|我要[點訂]|下單|就[點訂]|就[那這]個|就剛|對$|好[的啊]?$|可以$|沒問題$|選.*個|幫我選/.test(message);
        resolvedMessage = wantsOrder ? `幫我點 ${foodName}` : `查詢 ${ref.resolvedItemName} 的資訊`;
        console.log(`[AI Agent] 重建意圖: "${resolvedMessage}"`);
      }
    }
  }

  if (isRoomOnlyMessage(resolvedMessage) && conversationHistory && conversationHistory.length > 0) {
    const room =
      extractRoom(resolvedMessage) || extractRepairLocationText(resolvedMessage);
    const recentAssistantAskedRoom = [...conversationHistory]
      .reverse()
      .some((t) => t.role === 'assistant' && /缺少[：:]room|房號|地點|報修|維修/.test(t.content));
    const recentRepair = [...conversationHistory]
      .reverse()
      .find((t) => t.role === 'user' && /報修|維修|壞了|故障|冷氣|水管|電|燈|宿網|宿舍網|上不了網|無法連線|\bwifi\b|網際|網路|網絡/.test(t.content));
    if (room && recentAssistantAskedRoom && recentRepair) {
      resolvedMessage = `${recentRepair.content} 在 ${room}`;
      console.log(`[AI Agent] 報修房號補齊: "${message}" → "${resolvedMessage}"`);
    }
  }

  // 新話題覆蓋上一輪選單：懶人包／任務選項後改問課表、教室時，勿讓「第一堂」等被誤判成選單序號跟進
  let effectiveLastChoiceMenu = ctx.lastChoiceMenu;
  const rm = resolvedMessage.trim();
  const negatesMealIntent =
    /不是(?:要)?(?:吃飯|點餐|訂餐)|不想吃|先不管(?:.*)?吃|不吃飯|別點餐|別吃了|不要再.*餐/.test(rm);
  const mealOrderCue =
    !negatesMealIntent &&
    /幫我點|訂餐|點餐|要吃|想喝|喝.*飲|午餐|晚餐|早餐|宵夜|手搖|奶茶|便當|菜單|餐廳|滷肉|雞腿|蛋餅/.test(rm);
  const orderHistoryCue =
    /訂單|訂餐紀錄|上次\s*訂|訂過|我的\s*訂|(?:(?:我)?上次)?訂\s*的/.test(rm) &&
    /還在|想看|查看|看一下|紀錄|列表/.test(rm);
  const scheduleOrClassroomQuery =
    !mealOrderCue &&
    /有課嗎|有沒有課|待會.*課|等等.*課|等一下.*課|等等要上|待會要上|上啥|上什麼|什麼課|哪堂|課表|教室|點名|哪堂課|第一堂|第[一二两兩三四五六七八九十百千\d]+堂|堂在[哪那兒]|在哪上課|上課在|今天的課/.test(rm);
  const broadTopicSwitchFromChoiceMenu =
    !mealOrderCue &&
    /成績|GPA|gpa|平均(?:分)?|學分(?!.*餐)|校車|公車|\bbus\b|未讀|通知|簽到|簽倒|請假|圖書館|借書|還書|借閱|預約.*座位|報修|包裹|洗衣/.test(rm);
  if (
    effectiveLastChoiceMenu &&
    (scheduleOrClassroomQuery || orderHistoryCue || broadTopicSwitchFromChoiceMenu)
  ) {
    effectiveLastChoiceMenu = undefined;
  }

  const userDeclinesPendingMenu =
    /先不要|先別(?:要|點|訂)?|等等再說|暫時不用|算了不(?:要|點|訂)|不點了|先略過|先跳過|晚點再說|先不用/.test(rm);
  if (effectiveLastChoiceMenu && userDeclinesPendingMenu) {
    effectiveLastChoiceMenu = undefined;
  }

  const toolCtx = {
    ...ctx,
    lastUserMessage: resolvedMessage,
    lastChoiceMenu: effectiveLastChoiceMenu,
  };
  const allowedToolNames = new Set(getToolDeclarations(ctx.role).map((t) => t.name));

  // ── Step 0.4: 上下文延續 — 如果上一輪的 choiceMenu 標示了 producedByTool
  //    而使用者只回了「第 N 個 / 對 / 好啊 / 第一個就好」這種 short follow-up，
  //    直接路由回那個工具，讓 handler 用 lastChoiceMenu + ordinal 自己解析。
  const followUpToolFromMenu = (() => {
    const menu = effectiveLastChoiceMenu;
    if (!menu?.producedByTool || !menu.options?.length) return null;
    const m = resolvedMessage.trim();
    if (m.length > 36) return null; // 略放寬：「欸那就第二個吧」仍屬選單跟進
    // 「第一堂」「第二節」：數字後不是量詞，不視為選單序號（避免與「第一個」混淆：後者必含 個/份…）
    const hasOrdinal =
      /第\s*[一二两兩三四五六七八九十百千\d]+(?:[個个]|(?:份|杯|碗|本|項|道))|最(?:後|后)[一那]?(?:[個个]|(?:本|份|杯|碗))/.test(m);
    // 允許「對對對」「對對對就那個」「好好好」這類重複/語氣加強
    const isConfirm =
      /^(?:對+|好[的啊]?|可以|沒問題|ok|OK|嗯+|恩+|是[的啊]?|就[這那]個|就好|就[那這]個就好|就那個|就這個|行|好啊|要這個|買這個|就它|👍|👌|✅)$/.test(m) ||
      /^(?:對|好){1,4}(?:就[那這]個|就好|啊|啦|耶|喔|哦)?$/.test(m) ||
      /^(?:對對對|好好好|沒錯|對啊).*(?:就[那這]?個|就好)?$/.test(m);
    const fitsMenuLabel = menu.options.some((o) => o.label && m.includes(o.label.slice(0, 4)));
    const isAutoPickFollowUp =
      /隨便|随便|都可以|任一|相關|挑一?本|選一?本/.test(m) &&
      /^(?:borrow_book|create_order)$/.test(menu.producedByTool);
    const isEventUnregisterFollowUp =
      menu.producedByTool === 'register_event' &&
      /不去了|不想去|不參加|取消報名|取消.*活動|還是不去|算了.*不去/.test(m);
    if (isEventUnregisterFollowUp) return 'unregister_event';
    if (hasOrdinal || isConfirm || fitsMenuLabel || isAutoPickFollowUp) {
      return menu.producedByTool;
    }
    return null;
  })();
  if (followUpToolFromMenu) {
    console.log(`[AI Agent] 短回應路由：${followUpToolFromMenu}（透過 lastChoiceMenu.producedByTool）`);
  }

  // ── Step 0.5: 技能快取查找 — 已學會的操作直接執行 ──
  const cachedSkill = findLearnedSkill(resolvedMessage);
  if (cachedSkill && cachedSkill.successCount >= 2 && allowedToolNames.has(cachedSkill.tool)) {
    console.log(`[AI Agent] 技能快取命中: "${resolvedMessage.slice(0, 20)}" → ${cachedSkill.tool} (成功${cachedSkill.successCount}次)`);
    try {
      const skillResult = await executeLearnedSkill(cachedSkill, toolCtx);
      if (skillResult.success) {
        return {
          intents: [{ tool: cachedSkill.tool, args: cachedSkill.args, priority: 20, reason: `(已學技能) ${cachedSkill.description.slice(0, 20)}`, isWrite: true }],
          results: [], totalTimeMs: Date.now() - start,
          contextText: '', executedActions: [{ tool: cachedSkill.tool, result: skillResult, reason: cachedSkill.description }],
          failedActions: [], pendingWriteActions: [],
          choiceMenu: skillResult.choiceMenu,
        };
      }
    } catch { /* 技能執行失敗，繼續正常流程 */ }
  }

  let intents = analyzeIntents(resolvedMessage);

  // 短選單跟進：語意層常把「隨便」誤判成 create_order，導致擋掉 borrow_book 的 unshift
  if (followUpToolFromMenu) {
    const m = resolvedMessage.trim();
    const menuShortFollow =
      m.length <= 36 &&
      (/第\s*[一二两兩三四五六七八九十百千\d]+(?:[個个]|(?:份|杯|碗|本|項|道))|最(?:後|后)[一那]?(?:[個个]|(?:本|份|杯|碗))/.test(m) ||
        /^(?:對+|好[的啊]?|可以|沒問題|ok|OK|嗯+|恩+|是[的啊]?|就[這那]個|就好|就[那這]個就好|就那個|就這個|行|好啊|要這個|買這個|就它|👍|👌|✅)$/.test(m) ||
        /^(?:對|好){1,4}(?:就[那這]個|就好|啊|啦|耶|喔|哦)?$/.test(m) ||
        /^(?:對對對|好好好|沒錯|對啊).*(?:就[那這]?個|就好)?$/.test(m) ||
        (/隨便|随便|都可以|任一/.test(m) && /^(?:borrow_book|create_order)$/.test(followUpToolFromMenu)) ||
        (followUpToolFromMenu === 'register_event' &&
          /不去了|不想去|不參加|取消報名|取消.*活動|還是不去|算了.*不去/.test(m)));
    if (menuShortFollow) {
      intents = intents.filter((i) => !i.isWrite || i.tool === followUpToolFromMenu);
    }
  }

  // ── 若有 followUpToolFromMenu，且使用者沒有「新的寫入意圖」→ 補上
  // 規則：若 analyzeIntents 已經找到任何 write intent（代表使用者表達了新動作），
  //      就不要再硬塞 followUp，避免「取消最後一筆訂單」既觸發 cancel_order 又觸發 create_order
  const hasExistingWriteIntent = intents.some((i) => i.isWrite);
  if (followUpToolFromMenu && !intents.some((i) => i.tool === followUpToolFromMenu) && !hasExistingWriteIntent) {
    const isWrite = isWriteToolName(followUpToolFromMenu);
    intents.unshift({
      tool: followUpToolFromMenu,
      args: {},
      requiredArgs: isWrite ? requiredArgsForGeneratedWrite(followUpToolFromMenu) : [],
      priority: 20,
      reason: '上下文延續',
      isWrite,
    });
  }

  // ── Fallback 1: regex 全部 miss → 用語意推理 ──
  if (intents.length === 0) {
    console.log('[AI Agent] regex 無匹配，啟動自適應語意推理...');
    intents = inferIntentFromToolDescriptions(message, ctx.role);
    if (intents.length > 0) {
      console.log(`[AI Agent] 語意推理命中: ${intents.map(i => i.tool).join(', ')}`);
    }
  }

  // ── Fallback 2: 語意推理也失敗 → 讓模型選擇工具 ──
  if (intents.length === 0 && modelInference) {
    console.log('[AI Agent] 語意推理無匹配，啟動模型驅動工具選擇...');
    try {
      const prompt = buildToolSelectionPrompt(message, ctx.role);
      const modelResponse = await modelInference(prompt);
      const selection = parseToolSelection(modelResponse);
      if (selection) {
        const tools = getToolDeclarations(ctx.role);
        const toolDecl = tools.find(t => t.name === selection.tool);
        if (toolDecl) {
          const isWrite = isWriteToolName(selection.tool);
          intents.push({
            tool: selection.tool,
            args: selection.args,
            priority: 13,
            reason: `(模型推理) ${toolDecl.description.slice(0, 20)}`,
            isWrite,
            requiredArgs: isWrite
              ? requiredArgsForGeneratedWrite(selection.tool, toolDecl.parameters.required ?? [])
              : undefined,
          });
          console.log(`[AI Agent] 模型選擇: ${selection.tool}`, selection.args);
        }
      }
    } catch (e) {
      console.warn('[AI Agent] 模型驅動工具選擇失敗:', e);
    }
  }

  intents = intents.filter((intent) => allowedToolNames.has(intent.tool));

  if (intents.length === 0) {
    return {
      intents: [], results: [], totalTimeMs: Date.now() - start,
      contextText: '', executedActions: [], failedActions: [], pendingWriteActions: [],
    };
  }

  const readIntents = intents.filter(i => !i.isWrite);
  const writeIntents = intents.filter(i => i.isWrite);

  // ── Step 1: 並行執行所有讀取查詢 ──
  const readResults = await Promise.all(
    readIntents.map(async (intent) => {
      try {
        const result = await executeTool(intent.tool, intent.args, toolCtx);
        return { tool: intent.tool, result, reason: intent.reason };
      } catch (e: any) {
        return {
          tool: intent.tool,
          result: { success: false, error: e.message, summary: `${intent.reason}失敗` } as ToolCallResult,
          reason: intent.reason,
        };
      }
    }),
  );

  // 建立讀取結果快取（key = tool name）+ 學習成功的讀取
  const readCache: Record<string, ToolCallResult> = {};
  for (const r of readResults) {
    if (r.result.success) {
      readCache[r.tool] = r.result;
      learnFromSuccess(message, r.tool, {}, false);
    }
  }

  // ── Step 2: 執行前置讀取 + 鏈式寫入 ──
  const executedActions: Array<{ tool: string; result: ToolCallResult; reason: string }> = [];
  const failedActions: Array<{ tool: string; reason: string; missingInfo: string }> = [];

  for (const wi of writeIntents) {
    let finalArgs = { ...wi.args };
    const resolvedKeys = new Set<string>();

    // 如果有前置讀取需求，先執行前置讀取
    if (wi.prereqRead && wi.resolveFromRead) {
      // 優先用已有的讀取快取
      let prereqResult = readCache[wi.prereqRead.tool];
      if (!prereqResult) {
        try {
          prereqResult = await executeTool(wi.prereqRead.tool, wi.prereqRead.args, toolCtx);
          readCache[wi.prereqRead.tool] = prereqResult;
          // 把前置讀取的結果也加到 readResults 裡
          readResults.push({
            tool: wi.prereqRead.tool,
            result: prereqResult,
            reason: `(前置查詢)`,
          });
        } catch {
          prereqResult = { success: false, summary: '前置查詢失敗', error: '無法查詢' };
        }
      }

      if (prereqResult.success) {
        const resolved = wi.resolveFromRead(prereqResult, message);
        for (const [key, value] of Object.entries(resolved)) {
          if (value !== '' && value !== undefined && value !== null) {
            resolvedKeys.add(key);
          }
        }
        finalArgs = { ...finalArgs, ...resolved };
      }
    }

    // 檢查必要參數是否齊全
    // - 若有 requiredArgs：只檢查列出的欄位（其餘 empty 是 OK 的，由 handler 用語意層處理）
    // - 沒設 requiredArgs：fallback 用舊邏輯（任何 empty 都算缺少）
    let missingRequired: string[];
    if (Array.isArray(wi.requiredArgs)) {
      missingRequired = wi.requiredArgs.filter((key) => {
        const v = finalArgs[key];
        return v === '' || v === undefined || v === null;
      });
    } else {
      missingRequired = Object.entries(finalArgs)
        .filter(([_, v]) => v === '' || v === undefined || v === null)
        .map(([k]) => k);
    }
    if (Array.isArray(wi.resolvedRequiredArgs)) {
      for (const key of wi.resolvedRequiredArgs) {
        if (!resolvedKeys.has(key) && !missingRequired.includes(key)) {
          missingRequired.push(key);
        }
      }
    }

    // 把空字串 args 清掉，避免 handler 看到空字串以為「有指定空值」
    for (const key of Object.keys(finalArgs)) {
      if (finalArgs[key] === '' || finalArgs[key] === undefined || finalArgs[key] === null) {
        delete finalArgs[key];
      }
    }

    if (missingRequired.length > 0) {
      failedActions.push({
        tool: wi.tool,
        reason: wi.reason,
        missingInfo: `缺少：${missingRequired.join(', ')}`,
      });
      continue;
    }

    // 參數齊全，直接執行！
    try {
      console.log(`[AI Agent] 自動執行寫入: ${wi.tool}`, finalArgs);
      const result = await executeTool(wi.tool, finalArgs, toolCtx);
      executedActions.push({ tool: wi.tool, result, reason: wi.reason });
      // 學習：記錄成功的操作模式
      if (result.success) {
        learnFromSuccess(message, wi.tool, finalArgs, true);
      }
    } catch (e: any) {
      executedActions.push({
        tool: wi.tool,
        result: { success: false, error: e.message, summary: `${wi.reason}失敗：${e.message}`, isWrite: true },
        reason: wi.reason,
      });
    }
  }

  // ── Step 3: 格式化結果 ──
  const contextParts = readResults
    .filter(r => r.result.success && r.result.summary)
    .map(r => `【${r.reason}】\n${r.result.summary}`);

  // 加入已執行操作的結果
  for (const ea of executedActions) {
    const r = ea.result;
    // 成功 → ✅；失敗但有 choiceMenu / isWrite=false → 屬於「需要使用者澄清」，不顯示失敗紅標
    const isClarification = !r.success && r.isWrite === false && Boolean(r.summary || (r as any).choiceMenu);
    if (r.success) {
      contextParts.push(`【✅ ${ea.reason}】\n${r.summary ?? ''}`);
    } else if (isClarification) {
      contextParts.push(`【💡 ${ea.reason}】\n${r.summary ?? ''}`);
    } else {
      contextParts.push(`【❌ ${ea.reason}失敗】\n${r.summary ?? r.error ?? '執行失敗'}`);
    }
  }

  // 加入無法執行的操作
  for (const fa of failedActions) {
    contextParts.push(
      `【💭 ${fa.reason}需要補充資訊】\n${fa.missingInfo}。請在回覆中：(1) 列出 2-3 個合理選項（用 1. 2. 3. 編號清單）讓使用者直接選；(2) 已知資訊不要重複問；(3) 結尾告訴使用者「回我選的編號或具體名稱，我馬上幫你執行」。`,
    );
  }

  const contextText = contextParts.length > 0
    ? `以下是我自主查詢和代理執行的結果（${new Date().toLocaleTimeString('zh-TW')}）：\n\n${contextParts.join('\n\n')}`
    : '';

  return {
    intents,
    results: readResults,
    totalTimeMs: Date.now() - start,
    contextText,
    executedActions,
    failedActions,
    choiceMenu: pickChoiceMenuFromAgent(
      executedActions.map((ea) => ({ tool: ea.tool, result: ea.result })),
      readResults.map((r) => ({ tool: r.tool, result: r.result })),
    ),
    pendingWriteActions: [], // v2 不再有 "pending"，全部自動執行或報告失敗
  };
}

// ════════════════════════════════════════════════════════════
// 3. Agent 系統提示詞 — 給本地模型的指令 (v2)
// ════════════════════════════════════════════════════════════

export function buildLocalAgentPrompt(
  queryResult: AgentQueryResult,
  ctx: { userName?: string; role?: CampusActorRole; schoolId: string },
  reflexionHint?: string,
): string {
  const now = new Date();
  const hour = now.getHours();
  const DAY = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

  const parts = [
    '# 你是「小靜」— 靜宜大學 AI 校園助理',
    '',
    '## 身份',
    '你是已經幫使用者查詢資料和執行操作的 AI 代理。以下是系統已完成的結果，請友善地總結回報給使用者。',
    '',
    '## 規則',
    '1. 繁體中文，友善簡潔，像朋友聊天',
    '2. 直接用已查到的數據回答，引用具體數字和名稱',
    '3. 如果有操作已成功執行，要明確告訴使用者「已完成」',
    '4. 如果有操作失敗或需要更多資訊，要清楚說明缺什麼，並同時給出「代理產物」：分步計畫、可複製的補資料範例、建議開啟的 App 畫面；不可只叫使用者自己去弄就結束',
    '5. 結尾可提供下一步建議',
    '6. 不要說「請自行查看」，你就是全能助理',
    '',
    ...(reflexionHint
      ? [
          '## 本輪代理反思（僅調整說法與下一步建議；不得捏造下方未出現的資料）',
          reflexionHint,
          '',
        ]
      : []),
    `## 環境：${DAY[now.getDay()]} ${now.toLocaleDateString('zh-TW')} ${hour}:${String(now.getMinutes()).padStart(2, '0')}`,
    ctx.userName ? `使用者：${ctx.userName}` : '',
    ctx.role ? `角色：${ctx.role}` : '',
    '',
  ];

  if (queryResult.contextText) {
    parts.push(queryResult.contextText);
    parts.push('');
  }

  // 特別標注已執行的操作
  if (queryResult.executedActions.length > 0) {
    parts.push('## 已代理完成的操作');
    for (const ea of queryResult.executedActions) {
      parts.push(ea.result.success
        ? `✅ ${ea.reason}：${ea.result.summary}`
        : `❌ ${ea.reason}失敗：${ea.result.summary ?? ea.result.error}`);
    }
    parts.push('');
    parts.push('請在回答中確認這些操作已完成，讓使用者安心。');
    parts.push('');
  }

  if (queryResult.failedActions.length > 0) {
    parts.push('## 無法自動執行的操作');
    for (const fa of queryResult.failedActions) {
      parts.push(`⚠️ ${fa.reason}：${fa.missingInfo}`);
    }
    parts.push('');
    parts.push(
      '請在詢問缺少資訊的同時，已替使用者整理好草稿句式與操作順序；目標是代办到「只差使用者點一下確認或補一個欄位」。',
    );
    parts.push('');
  }

  return parts.filter(Boolean).join('\n');
}

/**
 * 僅供拼入 buildOnDeviceAppPrompt 之後的「資料附錄」— 不含第二套人格設定，避免與主 system 指令打架。
 */
export function buildLocalAgentContextAppendix(
  queryResult: AgentQueryResult,
  reflexionHint?: string,
  maxChars = 4200,
): string {
  const chunks: string[] = [];
  const hint = reflexionHint?.trim();
  if (hint) chunks.push(`【代理提醒（依工具事實）】\n${hint}`);
  const ctx = queryResult.contextText?.trim();
  if (ctx) chunks.push(ctx);
  else if (queryResult.intents.length > 0) {
    chunks.push(
      `【曾嘗試的意圖】${queryResult.intents.map((i) => `${i.tool}(${i.reason})`).join('；')}`,
    );
  }
  if (
    queryResult.failedActions.length > 0 ||
    queryResult.executedActions.some((ea) => !ea.result.success)
  ) {
    chunks.push(
      '【附錄‧代理義務】若有 ⚠️ 未完成或 ❌ 失敗：最終回覆仍須含可執行計畫、表格式草稿與 App 導頁建議；誠實說明限制，禁止只要求使用者自行處理就結案。',
    );
  }
  let out = chunks.filter(Boolean).join('\n\n');
  if (out.length > maxChars) out = out.slice(0, maxChars) + '\n…（附錄已截斷）';
  return out;
}

/**
 * 建構「模型驅動工具選擇」提示詞
 * 當系統 regex + 語意推理都失敗時，讓本地模型自己選擇工具
 * 模型回覆格式: [TOOL:tool_name] [ARGS:{"key":"value"}]
 */
export function buildToolSelectionPrompt(
  message: string,
  role?: CampusActorRole,
): string {
  const tools = getToolDeclarations(role);
  const toolList = tools.map(t => {
    const params = Object.entries(t.parameters.properties || {})
      .map(([k, v]) => `${k}(${v.description})`)
      .join(', ');
    const isWrite = isWriteToolName(t.name);
    return `- ${t.name}${isWrite ? ' [寫入]' : ' [查詢]'}: ${t.description} | 參數: ${params || '無'}`;
  }).join('\n');

  return [
    '你是校園 AI 助理的「工具選擇器」。',
    '使用者說了一句話，你要判斷應該用哪個工具來完成。',
    '',
    '## 可用工具',
    toolList,
    '',
    '## 回覆格式（嚴格遵守）',
    '如果找到匹配工具：[TOOL:工具名] [ARGS:{"參數名":"值"}]',
    '如果不需要工具：[TOOL:none]',
    '',
    '## 範例',
    '使用者：「幫我請下禮拜五的假」→ [TOOL:request_leave] [ARGS:{"reason":"個人因素","leaveType":"personal","date":"2026-05-15"}]',
    '使用者：「我想吃滷肉飯」→ [TOOL:create_order] [ARGS:{"itemName":"滷肉飯","quantity":"1"}]',
    '使用者：「有什麼好吃的」→ [TOOL:query_menus] [ARGS:{}]',
    '使用者：「你好」→ [TOOL:none]',
    '',
    `使用者：「${message}」`,
    '你的回覆（只輸出一行）：',
  ].join('\n');
}

/**
 * 解析模型回覆的工具選擇結果
 */
export function parseToolSelection(modelResponse: string): { tool: string; args: Record<string, string> } | null {
  const toolMatch = modelResponse.match(/\[TOOL:(\w+)\]/);
  if (!toolMatch || toolMatch[1] === 'none') return null;
  const tool = toolMatch[1];

  let args: Record<string, string> = {};
  const argsMatch = modelResponse.match(/\[ARGS:(\{[^}]*\})\]/);
  if (argsMatch) {
    try { args = JSON.parse(argsMatch[1]); } catch { /* ignore */ }
  }

  return { tool, args };
}

// ════════════════════════════════════════════════════════════
// 4. 自適應意圖推理 — 當 regex 無法匹配時的 fallback
// ════════════════════════════════════════════════════════════

/**
 * 學習記憶：成功執行過的 (關鍵詞組合 → 工具名) 映射
 * 存在記憶體中，App 運行期間持續學習
 * 未來可擴展到 AsyncStorage 做持久化
 */
const learnedPatterns: Map<string, { tool: string; args: Record<string, string>; isWrite: boolean; count: number }> = new Map();

/** Jest：清空 inferIntent 的自適應映射與技能快取，避免測試檔執行順序互相污染 */
export function resetAdaptiveLearnedPatternsForTests(): void {
  learnedPatterns.clear();
  skillMemory.clear();
}

/** 中文分詞（簡易版：按字元 + 常見詞彙拆分） */
function tokenize(text: string): string[] {
  const t = text.toLowerCase().trim();
  // 常見校園詞彙（2-4 字詞優先匹配）
  const dictWords = [
    '課程', '課表', '成績', '作業', '出席', '請假', '學分', '畢業',
    '選課', '退選', '公告', '活動', '社團', '菜單', '餐廳', '午餐',
    '早餐', '晚餐', '圖書館', '借書', '還書', '座位', '預約', '公車',
    '通知', '行事曆', '行程', '排程', '訊息', '私訊', '訂單', '外送',
    '宿舍', '包裹', '洗衣機', '健康', '掛號', '看診', '報修', '維修',
    '繳交', '提交', '報名', '參加', '取消', '刪除', '修改', '新增',
    '簽到', '打卡', '評分', '列印', '失物', '遺失', '點名', '點餐',
    '訂餐', '便當', '蛋餅', '牛肉麵', '飲料', '咖啡', '奶茶',
    '考試', '測驗', '截止', '待辦', '分數', '績點', '排名',
    '個人資料', '學號', '科系', '幾年級', '公假', '病假', '事假',
    '續借', '借閱', '洗衣', '領取', '查詢', '分析', '預測',
    '投票', '問卷', '調查', '停車', '停車場', '獎學金', '實習',
    '教室', '換教室', '補課', '調課', '轉學', '休學', '復學',
  ];
  const found: string[] = [];
  let remaining = t;
  // 先匹配長詞
  const sorted = [...dictWords].sort((a, b) => b.length - a.length);
  for (const word of sorted) {
    if (remaining.includes(word)) {
      found.push(word);
      remaining = remaining.replace(new RegExp(word, 'g'), ' ');
    }
  }
  // 再按單字拆分剩餘的中文字
  for (const ch of remaining) {
    if (/[一-鿿]/.test(ch)) found.push(ch);
  }
  return [...new Set(found)];
}

/** 計算兩組 token 的相似度 (Jaccard + 加權) */
function tokenSimilarity(msgTokens: string[], descTokens: string[]): number {
  if (msgTokens.length === 0 || descTokens.length === 0) return 0;
  const setA = new Set(msgTokens);
  const setB = new Set(descTokens);
  let intersection = 0;
  let weightedScore = 0;
  for (const t of setA) {
    if (setB.has(t)) {
      intersection++;
      // 長詞匹配權重更高
      weightedScore += t.length >= 3 ? 3 : t.length >= 2 ? 2 : 1;
    }
  }
  const union = new Set([...setA, ...setB]).size;
  const jaccard = intersection / union;
  // 綜合分數 = Jaccard * 0.4 + 加權覆蓋率 * 0.6
  const maxPossibleWeight = [...setA].reduce((s, t) => s + (t.length >= 3 ? 3 : t.length >= 2 ? 2 : 1), 0);
  const coverageScore = maxPossibleWeight > 0 ? weightedScore / maxPossibleWeight : 0;
  return jaccard * 0.4 + coverageScore * 0.6;
}

/** 動詞到意圖類型映射 */
const WRITE_VERBS = new Set([
  '幫', '幫我', '請', '要', '想', '訂', '點', '買', '借', '還', '交',
  '報', '報名', '取消', '刪除', '修改', '新增', '建立', '加', '發',
  '傳', '送', '提交', '繳', '簽', '預約', '掛號', '領', '續',
]);
const READ_VERBS = new Set([
  '查', '看', '找', '搜', '問', '有沒有', '是什麼', '怎麼', '哪裡',
  '多少', '幾', '什麼時候', '誰', '狀態', '紀錄', '列表',
]);

/** 判斷訊息是讀取還是寫入意圖 */
function inferReadWrite(msg: string): 'read' | 'write' | 'unknown' {
  const chars = msg.split('');
  let writeScore = 0;
  let readScore = 0;
  for (const verb of WRITE_VERBS) {
    if (msg.includes(verb)) writeScore += verb.length;
  }
  for (const verb of READ_VERBS) {
    if (msg.includes(verb)) readScore += verb.length;
  }
  if (writeScore > readScore + 1) return 'write';
  if (readScore > writeScore + 1) return 'read';
  return 'unknown';
}

function hasSemanticDomainCue(toolName: string, msg: string): boolean {
  const foodCue =
    /學餐|餐廳|菜單|訂餐|點餐|外帶|外送|便當|午餐|晚餐|早餐|宵夜|消夜|手搖|奶茶|珍奶|咖啡|滷肉飯|雞腿|蛋餅|素食|餐點|菜色|吃|喝|餓|食物|美食/.test(
      msg,
    );
  const homeCookingAdvice =
    /自己煮|在家煮|下廚|料理|食譜|菜譜|冰箱|食材|煮飯|做菜|炒菜|煎蛋|煮麵|煮菜/.test(msg) &&
    !/學餐|餐廳|菜單|外帶|外送|幫我[點訂]|我要[點訂]|點一[個份碗]|訂一[個份碗]/.test(msg);
  if (['create_order', 'recommend_lunch', 'query_menus', 'rate_menu_item'].includes(toolName)) {
    return foodCue && !homeCookingAdvice;
  }

  if (toolName === 'send_message') {
    return /(?:幫我)?[發送傳].*訊息|(?:幫我)?私訊(?!誰)|^通知\s*[\u4e00-\u9fa5A-Za-z]{1,8}|(?:幫我)?(?:傳給|(?<!分)發給)|(?:幫我|請你|請)跟\s*[\u4e00-\u9fa5A-Za-z]{1,12}(?:講|說|：|︰)/.test(
      msg,
    );
  }

  return true;
}

/**
 * 自適應意圖推理：當 analyzeIntents 的 regex 全部 miss 時，
 * 用工具描述的語意匹配來推理最可能的工具。
 * 這讓 AI 能處理完全沒預見過的請求。
 */
export function inferIntentFromToolDescriptions(
  message: string,
  role?: CampusActorRole,
): DetectedIntent[] {
  const msg = message.toLowerCase().trim();
  const msgTokens = tokenize(msg);
  if (msgTokens.length === 0) return [];

  // 與 analyzeIntents 尾段一致，但優先於「學習記憶」——避免「隨便」曾被訂餐綁死後誤觸發 create_order
  if (/(?:隨便|随便|你就).{0,14}處理|幫我處理一下|幫我搞定/.test(msg)) {
    return [{
      tool: 'comprehensive_analysis',
      args: {},
      priority: 15,
      reason: '綜合建議（語意後備）',
      isWrite: false,
    }];
  }

  // 短訊息（≤6 字）且沒有動詞/疑問詞 → 不要亂猜工具
  // 例如：「在 B302」「嗨」「對」「好啊」這類補充/招呼，不該主動觸發寫入
  const isShort = message.trim().length <= 6;
  const hasIntentVerb = /幫我|我要|想要|請|查|看|顯示|列出|送|發|報|預約|借|還|取消|刪除|新增|修改|更新|簽到|打卡|繳|報名|參加|請假|登記|怎麼|為什麼|哪裡|什麼|幾點|是否/.test(message);
  if (isShort && !hasIntentVerb) {
    return [];
  }

  // 1. 先查學習記憶
  const memoryKey = msgTokens.sort().join('|');
  const learned = learnedPatterns.get(memoryKey);
  if (learned && learned.count >= 1) {
    console.log(`[AI Adaptive] 從學習記憶命中: ${memoryKey} → ${learned.tool}`);
    return [{
      tool: learned.tool,
      args: { ...learned.args },
      priority: 14,
      reason: `(學習記憶) ${learned.tool}`,
      isWrite: learned.isWrite,
    }];
  }

  // 2. 對所有工具做語意匹配
  const tools = getToolDeclarations(role);
  const rwIntent = inferReadWrite(msg);

  type ScoredTool = { tool: GeminiToolDeclaration; score: number; isWrite: boolean };
  const scored: ScoredTool[] = [];

  for (const tool of tools) {
    if (!hasSemanticDomainCue(tool.name, msg)) continue;

    const descTokens = tokenize(tool.description);
    // 也加入工具名的語意（把 snake_case 轉中文 token）
    const nameTokens = tokenize(tool.name.replace(/_/g, ' '));
    const allDescTokens = [...new Set([...descTokens, ...nameTokens])];

    let score = tokenSimilarity(msgTokens, allDescTokens);

    // 參數名也貢獻語意分數
    const paramNames = Object.keys(tool.parameters.properties || {});
    const paramDescs = Object.values(tool.parameters.properties || {}).map(p => p.description);
    const paramTokens = tokenize(paramNames.join(' ') + ' ' + paramDescs.join(' '));
    score += tokenSimilarity(msgTokens, paramTokens) * 0.3;

    // 讀寫意圖對齊加分
    const isWrite = isWriteToolName(tool.name);

    if (rwIntent === 'write' && isWrite) score *= 1.3;
    if (rwIntent === 'read' && !isWrite) score *= 1.2;
    if (rwIntent === 'write' && !isWrite) score *= 0.7;
    if (rwIntent === 'read' && isWrite) score *= 0.8;

    if (score > 0.17) {
      scored.push({ tool, score, isWrite });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];

  // 3. 取最高分工具（可以取多個如果分數接近）
  const best = scored[0];
  if (best.score < 0.26) return []; // 略高於原本 0.2，減少誤配但不致完全不命中

  const intents: DetectedIntent[] = [];
  const topN = scored.filter(s => s.score >= best.score * 0.8).slice(0, 3);

  for (const s of topN) {
    // 從訊息中嘗試萃取每個參數的值
    const args: Record<string, string> = {};
    const props = s.tool.parameters.properties || {};
    for (const [key, prop] of Object.entries(props)) {
      // 嘗試從訊息中提取值
      if (prop.enum) {
        // enum 類型：看哪個匹配
        for (const e of prop.enum) {
          if (msg.includes(e.toLowerCase())) { args[key] = e; break; }
        }
      }
      if (key === 'reason' || key === 'description' || key === 'content' || key === 'title') {
        const extracted = extractContent(message);
        if (extracted) args[key] = extracted;
        else if (key === 'reason' || key === 'description') {
          args[key] = message.replace(/幫我|請|我要/g, '').trim().slice(0, 50);
        }
      }
      if (key === 'date' || key === 'startAt' || key === 'endAt') {
        const timeArgs = extractTime(msg);
        if (timeArgs.date && key === 'date') args[key] = timeArgs.date;
        if (timeArgs.startAt && key === 'startAt') args[key] = timeArgs.startAt;
        if (timeArgs.endAt && key === 'endAt') args[key] = timeArgs.endAt;
      }
    }

    // 構建前置讀取（寫入操作通常需要先查 ID）
    let prereqRead: { tool: string; args: Record<string, string> } | undefined;
    if (s.isWrite) {
      // 智慧推斷前置讀取工具
      const readToolMap: Record<string, string> = {
        'create_order': 'query_menus',
        'cancel_order': 'query_orders',
        'send_message': 'query_conversations',
        'register_event': 'query_events',
        'unregister_event': 'query_events',
        'reserve_library_seat': 'query_library',
        'borrow_book': 'query_library',
        'renew_book': 'query_loans',
        'return_book': 'query_loans',
        'submit_assignment': 'query_assignments',
        'enroll_course': 'query_courses',
        'drop_course': 'query_enrollments',
        'cancel_seat_reservation': 'query_library',
        'check_in_attendance': 'query_courses',
        'request_leave': 'query_courses',
        'start_attendance': 'query_courses',
        'create_assignment': 'query_courses',
        'rate_menu_item': 'query_menus',
        'delete_calendar_event': 'query_calendar',
        'update_calendar_event': 'query_calendar',
        'reserve_washing_machine': 'query_dorm_info',
        'confirm_package_pickup': 'query_dorm_info',
      };
      const readTool = readToolMap[s.tool.name];
      if (readTool) {
        prereqRead = { tool: readTool, args: {} };
      }
    }

    intents.push({
      tool: s.tool.name,
      args,
      priority: Math.round(10 + best.score * 5), // 動態優先級
      reason: `(語意推理 ${Math.round(s.score * 100)}%) ${s.tool.description.slice(0, 20)}`,
      isWrite: s.isWrite,
      requiredArgs: s.isWrite
        ? requiredArgsForGeneratedWrite(s.tool.name, s.tool.parameters.required ?? [])
        : undefined,
      ...(prereqRead ? { prereqRead } : {}),
    });
  }

  // 只取最佳的一個（避免亂執行）
  return intents.slice(0, 1);
}

/**
 * 記錄成功的意圖推理結果，用於未來快速匹配
 */
export function learnFromSuccess(message: string, tool: string, args: Record<string, string>, isWrite: boolean): void {
  if (typeof process !== 'undefined' && process.env.JEST_WORKER_ID != null) return;
  const tokens = tokenize(message.toLowerCase().trim());
  if (tokens.length === 0) return;
  const key = tokens.sort().join('|');
  const existing = learnedPatterns.get(key);
  if (existing) {
    existing.count++;
  } else {
    learnedPatterns.set(key, { tool, args, isWrite, count: 1 });
  }
  // 限制記憶大小（LRU 簡易版）
  if (learnedPatterns.size > 200) {
    const firstKey = learnedPatterns.keys().next().value;
    if (firstKey) learnedPatterns.delete(firstKey);
  }
  console.log(`[AI Learn] 記錄: "${key}" → ${tool} (count: ${existing?.count ?? 1})`);
}

// ════════════════════════════════════════════════════════════
// 5. 代理執行解析器（保留相容性，但 v2 基本不需要）
// ════════════════════════════════════════════════════════════

export type ParsedAction = {
  tool: string;
  args: Record<string, string>;
};

export function parseExecuteCommands(modelResponse: string): ParsedAction[] {
  const actions: ParsedAction[] = [];
  const regex = /\[EXECUTE:(\w+):(\{[^}]+\})\]/g;
  let match;
  while ((match = regex.exec(modelResponse)) !== null) {
    try {
      actions.push({ tool: match[1], args: JSON.parse(match[2]) });
    } catch { /* skip */ }
  }
  return actions;
}

/**
 * 把 StandardToolResult 轉成 ToolCallResult（相容舊回傳介面）。
 * 為了讓上游已經 read 過的程式碼不需要改：
 * - 把 errorCode、isDraft、missingInfo 攤到 result，方便 UI 判斷。
 */
function toToolCallResult(std: StandardToolResult): ToolCallResult {
  const compatErrorParts = [std.error, std.summary].filter(Boolean) as string[];
  return {
    success: std.success,
    summary: std.summary,
    data: std.data,
    error: std.success ? undefined : (std.error ?? compatErrorParts[0]),
    isWrite: std.isWrite,
    choiceMenu: std.choiceMenu,
    learnedSkill: std.learnedSkill,
    // ── 擴充欄位（額外屬性，不破壞既有型別） ──
    ...({
      errorCode: std.errorCode,
      isDraft: std.isDraft,
      missingInfo: std.missingInfo,
      recordId: std.recordId,
    } as any),
  };
}

/**
 * 全域 Action 執行入口。
 *
 * 策略：
 * 1. 若 tool 在 registry（canonical 名稱或 alias）→ 走 executeToolStandard，
 *    取得標準化結果，再轉回 ToolCallResult 相容形狀。
 * 2. 否則 fallback 到舊 executeTool。
 *
 * lastChoiceMenu：用於把上一輪 AI 提供的清單跟使用者「幫我點第 N 個」對齊。
 */
export async function executeAgentActions(
  actions: ParsedAction[],
  ctx: {
    userId?: string;
    schoolId: string;
    role?: CampusActorRole;
    lastUserMessage?: string;
    lastChoiceMenu?: AssistantChoiceMenu;
    isOnline?: boolean;
  },
): Promise<Array<{ tool: string; result: ToolCallResult }>> {
  const results: Array<{ tool: string; result: ToolCallResult }> = [];
  for (const action of actions) {
    const spec = getToolSpec(action.tool);
    if (spec) {
      const std = await executeToolStandard(action.tool, action.args, {
        userId: ctx.userId,
        schoolId: ctx.schoolId,
        role: ctx.role,
        lastUserMessage: ctx.lastUserMessage,
        lastChoiceMenu: ctx.lastChoiceMenu,
        isOnline: ctx.isOnline,
      });
      results.push({ tool: action.tool, result: toToolCallResult(std) });
    } else {
      const result = await executeTool(action.tool, action.args, ctx);
      results.push({ tool: action.tool, result });
    }
  }
  return results;
}

// ════════════════════════════════════════════════════════════
// 6. Reflexion 自主反思引擎
// ════════════════════════════════════════════════════════════
// Act → Observe → Reflect → Retry (最多 MAX_REFLEXION_ROUNDS)
// 每次失敗後，生成反思摘要注入下次 prompt

const MAX_REFLEXION_ROUNDS = 2;

export type ReflexionTrace = {
  round: number;
  action: string;
  observation: string;
  reflection: string;
  success: boolean;
};

/**
 * 帶 Reflexion 的自主執行：失敗後反思 → 調整策略 → 重試
 */
export async function autonomousQueryWithReflexion(
  message: string,
  ctx: {
    userId?: string;
    schoolId: string;
    role?: CampusActorRole;
    lastChoiceMenu?: AssistantChoiceMenu;
    isOnline?: boolean;
  },
  modelInference: (prompt: string) => Promise<string>,
  conversationHistory?: ConversationTurn[],
): Promise<AgentQueryResult & { reflexionTraces: ReflexionTrace[] }> {
  const traces: ReflexionTrace[] = [];
  let lastResult = await autonomousQuery(message, ctx, modelInference, conversationHistory);

  // 如果第一次就成功或有結果 → 直接返回
  const hasGoodResult = lastResult.executedActions.some(a => a.result.success) || lastResult.contextText.length > 20;
  if (hasGoodResult || lastResult.failedActions.length === 0) {
    return { ...lastResult, reflexionTraces: traces };
  }

  // ── Reflexion Loop ──
  for (let round = 1; round <= MAX_REFLEXION_ROUNDS; round++) {
    const failInfo = lastResult.failedActions.map(f => `${f.reason}：${f.missingInfo}`).join('; ');
    const execFail = lastResult.executedActions.filter(a => !a.result.success).map(a => `${a.reason}：${a.result.error}`).join('; ');
    const observation = failInfo || execFail || '未產生任何結果';

    // 讓模型反思失敗原因
    const reflectPrompt = [
      `你是校園 AI 助理。使用者說：「${message}」`,
      `你嘗試了以下操作但失敗了：${observation}`,
      '',
      '請反思失敗原因，並提出一個改進策略。回答格式：',
      '[REFLECTION] 你的反思',
      '[STRATEGY] 改進策略（用哪個工具、如何調整參數）',
      '[TOOL:tool_name] [ARGS:{"key":"value"}]',
    ].join('\n');

    let reflection = '';
    let newTool = '';
    let newArgs: Record<string, string> = {};

    try {
      const reflectResponse = await modelInference(reflectPrompt);
      reflection = reflectResponse.match(/\[REFLECTION\]\s*(.+?)(?:\[|$)/s)?.[1]?.trim() ?? reflectResponse.slice(0, 100);

      // 嘗試從反思中提取新的工具選擇
      const toolMatch = parseToolSelection(reflectResponse);
      if (toolMatch) {
        newTool = toolMatch.tool;
        newArgs = toolMatch.args;
      }
    } catch {
      reflection = '模型反思失敗，嘗試替代策略';
    }

    traces.push({ round, action: failInfo, observation, reflection, success: false });
    console.log(`[Reflexion R${round}] 反思: ${reflection}`);

    // 如果反思產生了新工具 → 直接執行
    if (newTool) {
      try {
        const retryResult = await executeTool(newTool, newArgs, { ...ctx, lastUserMessage: message });
        if (retryResult.success) {
          traces.push({ round, action: `retry: ${newTool}`, observation: retryResult.summary ?? '成功', reflection: '', success: true });
          learnFromSuccess(message, newTool, newArgs, true);
          // 學習為技能
          skillMemory.set(tokenize(message.toLowerCase()).sort().join('|'), {
            tool: newTool, args: newArgs, successCount: 1, lastUsed: Date.now(),
            source: 'reflexion', description: `透過反思學會：${message.slice(0, 30)}`,
          });
          const mergedExec = [
            ...lastResult.executedActions,
            { tool: newTool, result: retryResult, reason: `(反思後重試) ${newTool}` },
          ];
          return {
            ...lastResult,
            executedActions: mergedExec,
            failedActions: [],
            choiceMenu: pickChoiceMenuFromAgent(
              mergedExec.map((ea) => ({ tool: ea.tool, result: ea.result })),
              lastResult.results.map((r) => ({ tool: r.tool, result: r.result })),
            ),
            reflexionTraces: traces,
          };
        }
      } catch { /* continue to next round */ }
    }

    // 替代策略：嘗試用不同參數重新跑 autonomousQuery
    // 加入反思提示讓模型更聰明地選擇
    lastResult = await autonomousQuery(
      `${message}（提示：之前嘗試失敗了，原因是 ${observation}。${reflection}）`,
      ctx, modelInference, conversationHistory,
    );
    if (lastResult.executedActions.some(a => a.result.success)) {
      traces.push({ round, action: 'retry autonomousQuery', observation: '成功', reflection: '', success: true });
      return { ...lastResult, reflexionTraces: traces };
    }
  }

  return { ...lastResult, reflexionTraces: traces };
}

// ════════════════════════════════════════════════════════════
// 7. 自主技能習得系統 (Autonomous Skill Acquisition)
// ════════════════════════════════════════════════════════════
// AI 遇到未知任務 → 用模型推理分解步驟 → 嘗試執行 → 成功後存為技能

export type LearnedSkill = {
  tool: string;
  args: Record<string, string>;
  successCount: number;
  lastUsed: number;
  source: 'reflexion' | 'exploration' | 'user_feedback' | 'pattern_match';
  description: string;
  /** 多步驟技能：按順序執行的工具鏈 */
  steps?: Array<{ tool: string; args: Record<string, string> }>;
};

/** 持久化技能記憶（token pattern → skill） */
const skillMemory = new Map<string, LearnedSkill>();

/** 獲取所有已學技能 */
export function getLearnedSkills(): Map<string, LearnedSkill> { return skillMemory; }

/**
 * 技能查找：看這個請求是否匹配已學技能
 */
export function findLearnedSkill(message: string): LearnedSkill | null {
  const tokens = tokenize(message.toLowerCase().trim());
  if (tokens.length === 0) return null;
  const key = tokens.sort().join('|');

  // 精確匹配
  const exact = skillMemory.get(key);
  if (exact) { exact.lastUsed = Date.now(); return exact; }

  // 模糊匹配：Jaccard >= 0.6
  let bestSkill: LearnedSkill | null = null;
  let bestScore = 0;
  const tokenSet = new Set(tokens);
  for (const [k, skill] of skillMemory) {
    const skillTokens = new Set(k.split('|'));
    const intersection = [...tokenSet].filter(t => skillTokens.has(t)).length;
    const union = new Set([...tokenSet, ...skillTokens]).size;
    const jaccard = union > 0 ? intersection / union : 0;
    if (jaccard > bestScore && jaccard >= 0.6) {
      bestScore = jaccard;
      bestSkill = skill;
    }
  }
  return bestSkill;
}

/**
 * 探索式技能習得：沒有工具鏈時，讓模型自行分解任務並嘗試
 */
export async function exploreAndLearn(
  message: string,
  ctx: { userId?: string; schoolId: string; role?: CampusActorRole },
  modelInference: (prompt: string) => Promise<string>,
): Promise<{ success: boolean; result: string; skillLearned: boolean }> {
  const tools = getToolDeclarations(ctx.role);
  const toolList = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');

  const explorationPrompt = [
    '你是校園 AI 助理，擁有以下工具：',
    toolList,
    '',
    `使用者要求：「${message}」`,
    '',
    '你可能沒有完美匹配的工具，但請嘗試用現有工具組合解決。',
    '分析步驟：',
    '1. 這個請求的核心需求是什麼？',
    '2. 哪些現有工具可以部分滿足？',
    '3. 如何組合這些工具達成目標？',
    '',
    '回答格式（每步一行）：',
    '[STEP:1] [TOOL:tool_name] [ARGS:{"key":"value"}] [REASON:為什麼]',
    '[STEP:2] [TOOL:tool_name] [ARGS:{"key":"value"}] [REASON:為什麼]',
    '如果真的無法完成，回答 [CANNOT] 原因',
  ].join('\n');

  try {
    const response = await modelInference(explorationPrompt);

    // 檢查是否真的無法完成
    if (/\[CANNOT\]/.test(response)) {
      return { success: false, result: response.match(/\[CANNOT\]\s*(.+)/)?.[1] ?? '無法完成此操作', skillLearned: false };
    }

    // 解析步驟
    const stepRegex = /\[STEP:\d+\]\s*\[TOOL:(\w+)\]\s*\[ARGS:(\{[^}]+\})\]/g;
    const steps: Array<{ tool: string; args: Record<string, string> }> = [];
    let stepMatch;
    while ((stepMatch = stepRegex.exec(response)) !== null) {
      try {
        const toolName = stepMatch[1];
        const args = JSON.parse(stepMatch[2]);
        // 驗證工具存在
        if (tools.find(t => t.name === toolName)) {
          steps.push({ tool: toolName, args });
        }
      } catch { /* skip invalid JSON */ }
    }

    if (steps.length === 0) {
      // 退而求其次：嘗試 parseToolSelection
      const fallback = parseToolSelection(response);
      if (fallback && tools.find(t => t.name === fallback.tool)) {
        steps.push({ tool: fallback.tool, args: fallback.args });
      }
    }

    if (steps.length === 0) {
      return { success: false, result: '無法分解出可執行的步驟', skillLearned: false };
    }

    // 按順序執行步驟
    const results: string[] = [];
    let allSuccess = true;
    for (const step of steps) {
      try {
        const r = await executeTool(step.tool, step.args, { ...ctx, lastUserMessage: message });
        results.push(r.success ? (r.summary ?? '完成') : (r.error ?? '失敗'));
        if (!r.success) allSuccess = false;
      } catch (e: any) {
        results.push(`${step.tool} 失敗: ${e.message}`);
        allSuccess = false;
      }
    }

    // 如果成功 → 存為技能
    if (allSuccess) {
      const tokens = tokenize(message.toLowerCase().trim());
      const key = tokens.sort().join('|');
      const skill: LearnedSkill = {
        tool: steps[0].tool,
        args: steps[0].args,
        successCount: 1,
        lastUsed: Date.now(),
        source: 'exploration',
        description: `自主探索學會：${message.slice(0, 40)}`,
        steps: steps.length > 1 ? steps : undefined,
      };
      skillMemory.set(key, skill);
      // 也存到 learnedPatterns 以便快速路徑
      for (const step of steps) {
        learnFromSuccess(message, step.tool, step.args, true);
      }
      console.log(`[Skill Acquired] 學會新技能: "${message.slice(0, 30)}" → ${steps.map(s => s.tool).join(' → ')}`);
    }

    return {
      success: allSuccess,
      result: results.join('\n'),
      skillLearned: allSuccess,
    };
  } catch (e: any) {
    return { success: false, result: `探索失敗: ${e.message}`, skillLearned: false };
  }
}

/**
 * 執行已學技能
 */
export async function executeLearnedSkill(
  skill: LearnedSkill,
  ctx: { userId?: string; schoolId: string; role?: CampusActorRole; lastUserMessage?: string },
): Promise<ToolCallResult> {
  if (skill.steps && skill.steps.length > 1) {
    // 多步驟技能
    const results: string[] = [];
    let lastResult: ToolCallResult = { success: false, error: '無步驟', summary: '無步驟' };
    for (const step of skill.steps) {
      lastResult = await executeTool(step.tool, step.args, ctx);
      if (lastResult.success) {
        results.push(lastResult.summary ?? '完成');
      } else {
        return { success: false, error: `步驟 ${step.tool} 失敗: ${lastResult.error}`, summary: results.join('\n') };
      }
    }
    skill.successCount++;
    return { success: true, summary: results.join('\n'), data: lastResult.data };
  }
  // 單步驟
  const result = await executeTool(skill.tool, skill.args, ctx);
  if (result.success) skill.successCount++;
  return result;
}

// ════════════════════════════════════════════════════════════
// Agent Write — Firebase Cloud Function 代理寫入
// (原 agentWrite.ts，已併入此檔案)
// ════════════════════════════════════════════════════════════

import { getFunctions, httpsCallable, type HttpsCallableResult } from 'firebase/functions';
import { getFirebaseApp, getCloudFunctionRegion } from '../firebase';

export type ExecuteAgentWriteParams = {
  toolName: string;
  input: Record<string, unknown>;
  context?: { groupId?: string; timezone?: string };
  agentRunId?: string;
};

export type ExecuteAgentWriteResult = {
  success?: boolean;
  toolName?: string;
  requestId?: string;
  repairId?: string;
  orderId?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  [key: string]: unknown;
};

export async function executeAgentWrite(
  params: ExecuteAgentWriteParams,
): Promise<ExecuteAgentWriteResult> {
  const fn = httpsCallable<ExecuteAgentWriteParams, ExecuteAgentWriteResult>(
    getFunctions(getFirebaseApp(), getCloudFunctionRegion()),
    'executeAgentWrite',
  );
  const result: HttpsCallableResult<ExecuteAgentWriteResult> = await fn(params);
  return (result.data ?? {}) as ExecuteAgentWriteResult;
}
