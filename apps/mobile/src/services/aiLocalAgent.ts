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
import type { AssistantChoiceMenu, CampusActorRole } from '../data';

// ════════════════════════════════════════════════════════════
// 0. 對話上下文指代解析 (Anaphora Resolution)
// ════════════════════════════════════════════════════════════

export type ConversationTurn = { role: 'user' | 'assistant'; content: string };

/** 從 AI 回覆中提取有序列表項目 */
function extractListItems(text: string): Array<{ index: number; text: string; name: string; detail: string; location: string }> {
  const items: Array<{ index: number; text: string; name: string; detail: string; location: string }> = [];
  const lines = text.split('\n');
  let idx = 0;
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)[.、)）]\s*(.+)/);
    if (m) {
      idx++;
      const fullText = m[2].trim();
      const parts = fullText.match(/^([^|｜]+?)(?:\s*[|｜]\s*(.+?))?(?:\s*[（(](.+?)[)）])?$/);
      items.push({
        index: idx,
        text: fullText,
        name: parts?.[1]?.trim() ?? fullText,
        detail: parts?.[2]?.trim() ?? '',
        location: parts?.[3]?.trim() ?? '',
      });
    }
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
  const ordinalMatch = msg.match(/第\s*([一二三四五六七八九十\d]+)\s*個/);
  const demonstrativeMatch = /就?(?:剛剛?|上面|前面)?那[一個]?個?啊?|就[是]?(?:那|這|它)啊?|對[，,]?\s*(?:就是)?(?:那|這|它)/.test(msg);
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
};

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
  const after = msg.match(/(?:說|寫|傳|內容[是為]?)\s*[:：]?\s*(.{2,})/);
  if (after) return after[1].trim();
  return '';
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

/**
 * 分析使用者訊息，判斷需要呼叫哪些工具
 * v2: 同時萃取參數 + 設定鏈式執行前置讀取
 */
export function analyzeIntents(message: string): DetectedIntent[] {
  const msg = message.toLowerCase().trim();
  const origMsg = message.trim();
  const intents: DetectedIntent[] = [];
  const timeArgs = extractTime(msg);
  const content = extractContent(origMsg);

  // ══════════════════════════════════
  // 讀取意圖（priority >= 7）
  // ══════════════════════════════════

  // ── 課程/課表 ──
  if (/課[表程]|今天[有的].*課|上什麼課|下一堂|幾點.*課|星期.*課|明天.*課/.test(msg)) {
    const filter = /今天|今日/.test(msg) ? 'today' : /下一堂|下一節|接下來/.test(msg) ? 'next' : 'all';
    intents.push({ tool: 'query_courses', args: { filter }, priority: 10, reason: '查詢課程' });
  }

  if (/成績|分數|幾分|考幾分|gpa|績點|排名|學期成績/.test(msg)) {
    intents.push({ tool: 'query_grades', args: {}, priority: 10, reason: '查詢成績' });
  }

  if (/作業|功課|報告|繳交|deadline|截止|考試|測驗|quiz|exam|待辦|todo/.test(msg)) {
    const status = /逾期|過期|遲交/.test(msg) ? 'overdue' : /全部/.test(msg) ? 'all' : 'pending';
    intents.push({ tool: 'query_assignments', args: { status }, priority: 10, reason: '查詢作業' });
  }

  // ── 請假（寫入）vs 查出席（讀取）──
  if (/幫我.*請假|我要請假|請.*假|請病假|請事假/.test(msg)) {
    const reasonMatch = origMsg.match(/(?:因為|原因|因)\s*(.{2,20})/);
    const courseMatch = origMsg.match(/(?:的|課|堂)\s*(.{2,15}?)(?:的|請假|$)/);
    const reason = reasonMatch?.[1]?.trim() || (/生病|不舒服|發燒|感冒|頭痛|拉肚子/.test(msg) ? '身體不適' : /事|家|私/.test(msg) ? '個人事務' : '個人因素');
    const leaveType = /生病|不舒服|發燒|感冒|頭痛|拉肚子|身體/.test(msg) ? 'sick' : /公假|公務/.test(msg) ? 'official' : 'personal';
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

  if (/公告|最新消息|校務|學校.*通知/.test(msg)) {
    intents.push({ tool: 'query_announcements', args: {}, priority: 8, reason: '查詢公告' });
  }

  if (/活動|社團|比賽|演講|工作坊|校慶/.test(msg) && !/報名|參加|取消/.test(msg)) {
    intents.push({ tool: 'query_events', args: {}, priority: 8, reason: '查詢活動' });
  }

  if (/吃|餐[廳點]|菜單|午餐|晚餐|早餐|便當|價[格錢]|好吃|美食|飯/.test(msg) && !/評分|打分|幾星|幫我[點訂]|我要[點訂]|點一[個份碗]|訂一[個份碗]/.test(msg)) {
    // 萃取食物關鍵字，例如「我想吃滷肉飯」→ keyword=「滷肉飯」
    const foodKw = origMsg.match(/(?:想吃|想喝|有沒有|有什麼|吃)\s*(.{1,10}?)(?:嗎|呢|的|吧|啊|？|$)/)?.[1]?.trim() ?? '';
    const menuArgs: Record<string, string> = {};
    if (foodKw && foodKw.length >= 2 && !/什麼|好吃|推薦|餐廳/.test(foodKw)) {
      menuArgs.keyword = foodKw;
    }
    intents.push({ tool: 'query_menus', args: menuArgs, priority: 8, reason: foodKw ? `查詢「${foodKw}」` : '查詢餐廳' });
  }

  if (/圖書[館室]|借書|還書|座位|自習|k書|讀書/.test(msg) && !/幫我/.test(msg)) {
    const action = /借.*書|借閱|我借/.test(msg) ? 'loans' : /座位|自習|位子/.test(msg) ? 'seats' : 'search';
    const keyword = msg.match(/搜[尋索].*?[「『"](.*?)[」』"]/) ?. [1] ?? '';
    intents.push({ tool: 'query_library', args: { action, keyword }, priority: 8, reason: '查詢圖書館' });
  }

  if (/公車|巴士|交通|怎麼[去到]|搭車|火車|高鐵|ubike/.test(msg)) {
    intents.push({ tool: 'query_bus', args: {}, priority: 7, reason: '查詢交通' });
  }

  if (/未讀|notification|消息/.test(msg) && !/幫我/.test(msg)) {
    intents.push({ tool: 'query_notifications', args: { unreadOnly: 'true' }, priority: 7, reason: '查詢通知' });
  }

  if (/行事曆|日程|行程|排程|calendar|幾號.*有|這週/.test(msg) && !/新增|建立|修改|刪除|加/.test(msg)) {
    intents.push({ tool: 'query_calendar', args: {}, priority: 8, reason: '查詢行事曆' });
  }

  if (/私訊|訊息|對話|聊天|dm|message|有人找/.test(msg) && !/幫我.*[發送傳]/.test(msg)) {
    intents.push({ tool: 'query_conversations', args: {}, priority: 7, reason: '查詢訊息' });
  }

  if (/訂單|外送|外賣|付款|消費|交易/.test(msg) && !/取消/.test(msg)) {
    intents.push({ tool: 'query_orders', args: { status: 'all' }, priority: 7, reason: '查詢訂單' });
  }

  if (/宿舍|宿[室]|包裹|洗衣機|寢室/.test(msg) && !/幫我.*預約/.test(msg)) {
    intents.push({ tool: 'query_dorm_info', args: {}, priority: 8, reason: '查詢宿舍' });
  }

  if (/健康|看[診病]|醫生|掛號|健檢|身體/.test(msg) && !/幫我.*預約|幫我.*掛號/.test(msg)) {
    intents.push({ tool: 'query_health_records', args: {}, priority: 7, reason: '查詢健康' });
  }

  if (/借閱|借了.*書|我的書|圖書.*紀錄/.test(msg)) {
    intents.push({ tool: 'query_loans', args: {}, priority: 8, reason: '查詢借閱' });
  }

  if (/選課.*紀錄|我選了|已選|退選.*紀錄/.test(msg)) {
    intents.push({ tool: 'query_enrollments', args: {}, priority: 8, reason: '查詢選課' });
  }

  // ── 綜合分析 ──
  if (/分析|報告|總結|全面|整體|狀態|怎麼樣|概況|overview/.test(msg)) {
    intents.push({ tool: 'comprehensive_analysis', args: {}, priority: 10, reason: '綜合分析' });
  }

  // ── 今日簡報 ──
  if (/今天|今日.*[嗎有什]|摘要|簡報|briefing|早安.*什|忙不忙/.test(msg)) {
    if (intents.length === 0) {
      intents.push({ tool: 'daily_briefing', args: {}, priority: 10, reason: '今日簡報' });
    }
  }

  // ══════════════════════════════════
  // 寫入意圖（isWrite: true）
  // 現在帶真實參數 + 前置讀取鏈
  // ══════════════════════════════════

  // ── 發送訊息 ──
  if (/[發送傳].*訊息|私訊/.test(msg)) {
    const nameMatch = origMsg.match(/(?:給|跟|傳給|發給|私訊)\s*([^\s,，。！]{1,10})/);
    const peerName = nameMatch?.[1] ?? '';
    intents.push({
      tool: 'send_message', isWrite: true, priority: 12,
      args: { peerId: peerName, content: content || '你好' },
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
            const peerId = members.find((id: string) => id !== '__self__') ?? c.peerId ?? '';
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
      reason: `取消報名「${eventName || '(自動選擇)'}」`,
      prereqRead: { tool: 'query_events', args: {} },
      resolveFromRead: (res) => {
        const id = fuzzyMatchFromData(res.data, eventName, 'id', ['title', 'name']);
        return id ? { eventId: id } : {};
      },
    });
  }

  // ── 預約圖書館座位 ──
  if (/預約.*座位|訂.*座/.test(msg)) {
    intents.push({
      tool: 'reserve_library_seat', isWrite: true, priority: 12,
      args: {
        seatId: '', // 自動從查詢結果取第一個可用
        date: timeArgs.date ?? new Date().toISOString().split('T')[0],
        startTime: timeArgs.startTime ?? '09:00',
        endTime: timeArgs.endTime ?? '12:00',
      },
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
  if (/幫我.*借.*書|借.*這本/.test(msg)) {
    const bookName = origMsg.match(/借\s*[「『"]?([^」』"\s]{2,20})/)?.[1] ?? '';
    intents.push({
      tool: 'borrow_book', isWrite: true, priority: 12,
      args: { bookId: '' },
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
      reason: `續借「${bookName || '(自動選擇)'}」`,
      prereqRead: { tool: 'query_loans', args: {} },
      resolveFromRead: (res) => {
        const id = fuzzyMatchFromData(res.data, bookName, 'id', ['title', 'name', 'bookTitle', 'loanId']);
        return id ? { loanId: id } : {};
      },
    });
  }

  // ── 還書 ──
  if (/還書|歸還.*書/.test(msg)) {
    const bookName = origMsg.match(/還\s*[「『"]?([^」』"\s]{2,20})/)?.[1] ?? '';
    intents.push({
      tool: 'return_book', isWrite: true, priority: 12,
      args: { loanId: '' },
      reason: `歸還「${bookName || '(自動選擇)'}」`,
      prereqRead: { tool: 'query_loans', args: {} },
      resolveFromRead: (res) => {
        const id = fuzzyMatchFromData(res.data, bookName, 'id', ['title', 'name', 'bookTitle', 'loanId']);
        return id ? { loanId: id } : {};
      },
    });
  }

  // ── 建立行事曆事件 ──
  if (/新增.*行事曆|加.*行程|建立.*提醒|排.*讀書計畫|幫我.*排.*時間|幫我.*加.*行程/.test(msg)) {
    const titleMatch = origMsg.match(/(?:新增|建立|加)\s*[「『"]?(.{2,30}?)[」』"]?\s*(?:到|進|的?行事曆|的?行程|$)/);
    const title = titleMatch?.[1] ?? (content || '新行程');
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
  if (/刪除.*行程|刪.*行事曆|取消.*事件/.test(msg)) {
    const eventName = origMsg.match(/(?:刪除|取消)\s*[「『"]?([^」』"\s]{2,20})/)?.[1] ?? '';
    intents.push({
      tool: 'delete_calendar_event', isWrite: true, priority: 12,
      args: { eventId: '' },
      reason: `刪除行程「${eventName || '(自動選擇)'}」`,
      prereqRead: { tool: 'query_calendar', args: {} },
      resolveFromRead: (res) => {
        const id = fuzzyMatchFromData(res.data, eventName, 'id', ['title', 'name', 'eventId']);
        return id ? { eventId: id } : {};
      },
    });
  }

  // ── 修改行事曆 ──
  if (/修改.*行程|改.*行事曆|更新.*事件/.test(msg)) {
    const eventName = origMsg.match(/(?:修改|更新)\s*[「『"]?([^」』"\s]{2,20})/)?.[1] ?? '';
    intents.push({
      tool: 'update_calendar_event', isWrite: true, priority: 12,
      args: {
        eventId: '',
        ...(timeArgs.startAt ? { startAt: timeArgs.startAt } : {}),
        ...(timeArgs.endAt ? { endAt: timeArgs.endAt } : {}),
      },
      reason: `修改行程「${eventName || '(自動選擇)'}」`,
      prereqRead: { tool: 'query_calendar', args: {} },
      resolveFromRead: (res) => {
        const id = fuzzyMatchFromData(res.data, eventName, 'id', ['title', 'name', 'eventId']);
        return id ? { eventId: id } : {};
      },
    });
  }

  // ── 報修 ──
  if (/報修|維修|壞了|故障|水管|電|燈/.test(msg)) {
    const typeMap: Record<string, string> = { '水': 'plumbing', '電': 'electrical', '燈': 'electrical', '家具': 'furniture', '冷氣': 'appliance' };
    let repairType = 'other';
    for (const [k, v] of Object.entries(typeMap)) { if (msg.includes(k)) { repairType = v; break; } }
    const desc = content || origMsg.replace(/幫我|請|報修/g, '').trim();
    intents.push({
      tool: 'create_repair_request', isWrite: true, priority: 12,
      args: { type: repairType, title: desc.slice(0, 30), description: desc },
      reason: `報修：${desc.slice(0, 20)}`,
    });
  }

  // ── 繳交作業 ──
  if (/繳交|交作業|提交.*作業/.test(msg)) {
    const assignName = origMsg.match(/(?:繳交|提交)\s*[「『"]?([^」』"\s]{2,20})/)?.[1] ?? '';
    intents.push({
      tool: 'submit_assignment', isWrite: true, priority: 12,
      args: { assignmentId: '', groupId: '', content: content || '已完成' },
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

  // ── 選課 ──
  if (/選課|加選|選修.*課|我要.*選/.test(msg) && !/紀錄|我選了|已選/.test(msg)) {
    const courseName = origMsg.match(/(?:選|加選)\s*[「『"]?([^」』"\s]{2,20})/)?.[1] ?? '';
    intents.push({
      tool: 'enroll_course', isWrite: true, priority: 12,
      args: { courseId: '', semester: '' },
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
  if (/退選|退掉.*課/.test(msg)) {
    const courseName = origMsg.match(/退選?\s*[「『"]?([^」』"\s]{2,20})/)?.[1] ?? '';
    intents.push({
      tool: 'drop_course', isWrite: true, priority: 12,
      args: { enrollmentId: '' },
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

  // ── 簽到 ──
  if (/簽到|打卡|出席.*簽/.test(msg)) {
    intents.push({
      tool: 'check_in_attendance', isWrite: true, priority: 12,
      args: { courseSpaceId: '', sessionId: '' },
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
  if (/預約.*看[診病]|掛號|看.*醫生|健康中心.*預約/.test(msg)) {
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
  if (/失物|遺失|撿到|拾獲|丟了|掉了/.test(msg)) {
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

  // ── 訂餐 / 點餐 ──
  // 排除已被其他意圖處理的訊息（請假、報修、預約等）
  if (!/請.*假|報修|維修|預約.*座|預約.*看|掛號|借.*書|還書|選課|退選|報名.*活動|發.*訊|繳交|簽到|打卡|點名/.test(msg)) {
    // 匹配模式：幫我點X、我要點X、點一碗X、訂一份X、來個X、買個X
    const orderMatch = origMsg.match(/(?:幫我[點訂]|我要[點訂吃]|給我|來[一個份碗]?|買[一個份]?|訂[一個份碗]?|點[一個份碗]?)\s*(.{1,20}?)(?:吧|啊|呀|喔|哦|！|!|$)/);
    // 也匹配直接說食物名+動詞的模式：「牛肉麵 一碗」、「點牛肉麵」
    const orderMatch2 = origMsg.match(/^(?:點|訂)\s*(.{2,15})$/);
    // 「我想吃X」模式
    const orderMatch3 = origMsg.match(/(?:我想[吃喝]|想[吃喝]|好想[吃喝])\s*(.{1,15}?)(?:吧|啊|呀|喔|哦|！|!|$)/);
    const foodName = orderMatch?.[1]?.trim() ?? orderMatch2?.[1]?.trim() ?? orderMatch3?.[1]?.trim() ?? '';

    // 驗證 foodName 不是非食物操作關鍵字
    const isNotFood = /假|修|預約|借|還|選|退|報名|發|繳|簽|打卡|點名|課|訊息/.test(foodName);

    if (foodName && !isNotFood && /點|訂|幫我|我要|我想吃|想吃|來[一個份碗]|買/.test(msg)) {
      // 萃取數量
      const qtyMatch = origMsg.match(/(\d+)\s*[碗份個杯盤]/);
      const quantity = qtyMatch?.[1] ?? '1';
      // 萃取備註
      const noteMatch = origMsg.match(/[，,]\s*(.{2,20})$/);
      const note = noteMatch?.[1] ?? '';

      intents.push({
        tool: 'create_order', isWrite: true, priority: 15, // 高於 query_menus 的 8
        args: { itemName: foodName, quantity, ...(note ? { note } : {}) },
        reason: `訂餐「${foodName}」x${quantity}`,
      });
    }
  }

  // ── 取消訂單 ──
  if (/取消.*訂單|不要.*訂/.test(msg)) {
    intents.push({
      tool: 'cancel_order', isWrite: true, priority: 12,
      args: { orderId: '' },
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

  // ── 通知全部已讀 ──
  if (/已讀|全部.*已讀|通知.*清|清.*通知/.test(msg)) {
    intents.push({
      tool: 'mark_notifications_read', isWrite: true, priority: 12,
      args: { action: 'all' },
      reason: '通知全部標為已讀',
    });
  }

  // ── 領包裹 ──
  if (/領.*包裹|取.*包裹|確認.*領取/.test(msg)) {
    intents.push({
      tool: 'confirm_package_pickup', isWrite: true, priority: 12,
      args: { packageId: '' },
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
  if (/開始.*點名|啟動.*簽到/.test(msg)) {
    intents.push({
      tool: 'start_attendance', isWrite: true, priority: 12,
      args: { courseSpaceId: '' },
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
  if (/出.*作業|建立.*作業|派.*作業/.test(msg)) {
    const titleMatch = origMsg.match(/(?:出|建立|派)\s*.*?作業\s*[「『"]?([^」』"\s]{2,30})?/);
    intents.push({
      tool: 'create_assignment', isWrite: true, priority: 12,
      args: {
        groupId: '',
        title: titleMatch?.[1] ?? (content || '新作業'),
        description: content || '',
        ...(timeArgs.startAt ? { dueAt: timeArgs.startAt } : {}),
      },
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

  // ── 餐點評分 ──
  if (/評分|打分|幾星|好不好吃/.test(msg) && /餐|菜|食|吃/.test(msg)) {
    const ratingMatch = msg.match(/(\d)\s*[星分]/);
    intents.push({
      tool: 'rate_menu_item', isWrite: true, priority: 12,
      args: { menuItemId: '', rating: ratingMatch?.[1] ?? '4' },
      reason: '餐點評分',
      prereqRead: { tool: 'query_menus', args: {} },
      resolveFromRead: (res) => {
        const data = res.data as any;
        const items = Array.isArray(data) ? data : (data?.menus ?? data?.items ?? []);
        if (Array.isArray(items) && items.length > 0) {
          return { menuItemId: String(items[0].id ?? items[0].menuItemId ?? '') };
        }
        return {};
      },
    });
  }

  // ── 列印 ──
  if (/列印|印.*文件|print/.test(msg)) {
    const fileName = origMsg.match(/(?:列印|印)\s*[「『"]?([^」』"\s]{2,30})/)?.[1] ?? 'document.pdf';
    const copies = msg.match(/(\d+)\s*份/)?.[1] ?? '1';
    const isColor = /彩色|color/.test(msg);
    intents.push({
      tool: 'create_print_job', isWrite: true, priority: 12,
      args: { printerId: 'default', fileName, copies, colorMode: isColor ? 'color' : 'bw' },
      reason: `列印「${fileName}」${copies}份`,
    });
  }

  // 排序：高優先級先執行
  intents.sort((a, b) => b.priority - a.priority);
  return intents.slice(0, 6);
}

// ════════════════════════════════════════════════════════════
// 2. 自主查詢 + 鏈式代理執行器
// ════════════════════════════════════════════════════════════

function pickChoiceMenuFromAgent(
  executed: Array<{ result: ToolCallResult }>,
  reads: Array<{ result: ToolCallResult }>,
): AssistantChoiceMenu | undefined {
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
  ctx: { userId?: string; schoolId: string; role?: CampusActorRole },
  /** 可選的模型推理回調 — 當所有規則都失敗時，讓模型自己選工具 */
  modelInference?: (prompt: string) => Promise<string>,
  /** 對話歷史（用於指代解析） */
  conversationHistory?: ConversationTurn[],
): Promise<AgentQueryResult> {
  const start = Date.now();

  // ── Step 0: 指代解析 ──
  let resolvedMessage = message;
  if (conversationHistory && conversationHistory.length > 0) {
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

  const toolCtx = { ...ctx, lastUserMessage: resolvedMessage };

  // ── Step 0.5: 技能快取查找 — 已學會的操作直接執行 ──
  const cachedSkill = findLearnedSkill(resolvedMessage);
  if (cachedSkill && cachedSkill.successCount >= 2) {
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
          const isWrite = selection.tool.startsWith('create_') || selection.tool.startsWith('send_')
            || selection.tool.startsWith('submit_') || selection.tool.startsWith('register_')
            || selection.tool.startsWith('reserve_') || selection.tool.startsWith('borrow_')
            || selection.tool.startsWith('cancel_') || selection.tool.startsWith('drop_')
            || selection.tool.startsWith('delete_') || selection.tool.startsWith('update_')
            || selection.tool.startsWith('mark_') || selection.tool.startsWith('rate_')
            || selection.tool === 'request_leave' || selection.tool.startsWith('check_in')
            || selection.tool.startsWith('start_') || selection.tool.startsWith('return_')
            || selection.tool.startsWith('renew_') || selection.tool.startsWith('confirm_')
            || selection.tool.startsWith('join_') || selection.tool.startsWith('unregister_');
          intents.push({
            tool: selection.tool,
            args: selection.args,
            priority: 13,
            reason: `(模型推理) ${toolDecl.description.slice(0, 20)}`,
            isWrite,
          });
          console.log(`[AI Agent] 模型選擇: ${selection.tool}`, selection.args);
        }
      }
    } catch (e) {
      console.warn('[AI Agent] 模型驅動工具選擇失敗:', e);
    }
  }

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
        finalArgs = { ...finalArgs, ...resolved };
      }
    }

    // 檢查必要參數是否齊全
    const missingRequired = Object.entries(finalArgs)
      .filter(([_, v]) => v === '' || v === undefined || v === null)
      .map(([k]) => k);

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
    contextParts.push(
      ea.result.success
        ? `【✅ ${ea.reason}】\n${ea.result.summary}`
        : `【❌ ${ea.reason}失敗】\n${ea.result.summary ?? ea.result.error ?? '執行失敗'}`,
    );
  }

  // 加入無法執行的操作
  for (const fa of failedActions) {
    contextParts.push(
      `【⚠️ ${fa.reason}無法自動執行】\n${fa.missingInfo}。助理仍須代理：請在回覆中附分步計畫＋草稿欄位範例＋建議導頁，不可只推回使用者。`,
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
      executedActions.map((ea) => ({ result: ea.result })),
      readResults.map((r) => ({ result: r.result })),
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
    const isWrite = t.name.startsWith('create_') || t.name.startsWith('send_')
      || t.name.startsWith('submit_') || t.name.startsWith('register_')
      || t.name.startsWith('reserve_') || t.name.startsWith('borrow_')
      || t.name.startsWith('cancel_') || t.name.startsWith('drop_')
      || t.name.startsWith('delete_') || t.name.startsWith('update_')
      || t.name.startsWith('mark_') || t.name.startsWith('rate_')
      || t.name === 'request_leave' || t.name.startsWith('check_in')
      || t.name.startsWith('start_') || t.name.startsWith('return_')
      || t.name.startsWith('renew_') || t.name.startsWith('confirm_')
      || t.name.startsWith('join_') || t.name.startsWith('unregister_');
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
    const isWrite = tool.name.startsWith('create_') || tool.name.startsWith('send_')
      || tool.name.startsWith('submit_') || tool.name.startsWith('register_')
      || tool.name.startsWith('reserve_') || tool.name.startsWith('borrow_')
      || tool.name.startsWith('renew_') || tool.name.startsWith('return_')
      || tool.name.startsWith('cancel_') || tool.name.startsWith('drop_')
      || tool.name.startsWith('delete_') || tool.name.startsWith('update_')
      || tool.name.startsWith('mark_') || tool.name.startsWith('rate_')
      || tool.name.startsWith('unregister_') || tool.name.startsWith('confirm_')
      || tool.name.startsWith('check_in') || tool.name.startsWith('join_')
      || tool.name.startsWith('start_') || tool.name === 'request_leave';

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

export async function executeAgentActions(
  actions: ParsedAction[],
  ctx: { userId?: string; schoolId: string; role?: CampusActorRole; lastUserMessage?: string },
): Promise<Array<{ tool: string; result: ToolCallResult }>> {
  const results: Array<{ tool: string; result: ToolCallResult }> = [];
  for (const action of actions) {
    const result = await executeTool(action.tool, action.args, ctx);
    results.push({ tool: action.tool, result });
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
  ctx: { userId?: string; schoolId: string; role?: CampusActorRole },
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
          return {
            ...lastResult,
            executedActions: [...lastResult.executedActions, { tool: newTool, result: retryResult, reason: `(反思後重試) ${newTool}` }],
            failedActions: [],
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
