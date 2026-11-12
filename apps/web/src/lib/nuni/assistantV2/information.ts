import { addDays, date, taipeiDate, type Obj } from './contracts';

export type InformationKind = 'schedule' | 'work' | 'orders';
export type InformationRead = {
  kind: InformationKind;
  name: 'get_schedule' | 'get_due_work' | 'list_food_orders';
  args: Obj;
  view?: 'next' | 'now';
  taskKind?: 'assignment' | 'quiz';
};
export type InformationResult = { read: InformationRead; result?: unknown; detail?: unknown };

/** A data question must not silently turn into a request to open a screen. */
export function explicitPageRequest(question: string): boolean {
  const text = question.replace(/(?:不要|不用|不必|無須|不需要|別)\s*(?:幫我)?(?:開啟|打開|進入|跳轉)[^，。！？,!?]*/g, '');
  return /開啟|打開|進入|切換到|跳(?:轉)?到|(?:前往|帶我(?:到|去)).{0,12}(?:頁面|功能|畫面)/.test(text);
}

export function informationKinds(question: string): InformationKind[] {
  if (question.length > 1000 || explicitPageRequest(question) ||
      /翻譯|這句話|造句|例句|假設|如果|(?:不要|不用|不必|不需要|別)(?:幫我)?(?:查|讀)/.test(question) ||
      /規劃|安排|排寫|幫我排|幫我留|新增|加入.{0,8}(?:行事曆|行程)|刪除|取消|下單|幫我點|幫我訂|再點|跟上次一樣/.test(question))
    return [];
  const kinds: InformationKind[] = [];
  if (/課表|下一堂|下堂|上什麼課|有哪些課|有什麼課|(?:今天|明天|後天|現在|這週|本週|這禮拜).{0,16}課|上課.{0,8}(?:幾點|哪裡|何時)/.test(question))
    kinds.push('schedule');
  if (/作業|測驗|待繳|未繳|未交|功課|要交/.test(question)) kinds.push('work');
  if (/訂單|訂餐紀錄|點餐紀錄|餐(?:點)?(?:好(?:了)?嗎|好了|做.{0,3}了嗎|進度|狀態)|取餐(?:進度|狀態|號碼)|(?:可以|能)取餐/.test(question))
    kinds.push('orders');
  return kinds;
}

/** null is an unsupported/invalid scope; undefined alone permits a default. */
function requestedRange(question: string, now: number): { from: string; to: string } | null | undefined {
  const today = taipeiDate(now);
  // These readers accept complete days/weeks only. Do not erase a requested
  // morning, evening, weekday, range, or conflicting second date.
  if (/(?:星期|週|禮拜)[一二三四五六日天1-7]|今晚|今夜|今早|明早|明晚|明夜|早上|早晨|上午|中午|下午|傍晚|晚上|晚間|凌晨|\d{1,2}[:：]\d{2}|\d{1,2}月\d{1,2}|(?:^|\D)\d{1,2}\/\d{1,2}(?!\d)/.test(question)) return null;
  const dates = [...question.matchAll(/\b(\d{4}-\d{1,2}-\d{1,2})\b/g)].map((match) => match[1]);
  const relative = new Set(question.match(/今天|明天|後天|這週|本週|這禮拜|本禮拜|下週|下禮拜/g) || []);
  if (dates.length > 1 || relative.size > 1 || (dates.length && relative.size)) return null;
  if (dates.length) {
    try {
      const day = date(dates[0]);
      return { from: day, to: day };
    } catch {
      return null;
    }
  }
  if (/後天/.test(question)) return { from: addDays(today, 2), to: addDays(today, 2) };
  if (/明天/.test(question)) return { from: addDays(today, 1), to: addDays(today, 1) };
  if (/今天/.test(question)) return { from: today, to: today };
  if (/這週|本週|這禮拜|本禮拜|下週|下禮拜/.test(question)) {
    const weekday = new Date(today + 'T12:00:00Z').getUTCDay() || 7;
    const from = addDays(today, 1 - weekday + (/下週|下禮拜/.test(question) ? 7 : 0));
    return { from, to: addDays(from, 6) };
  }
}

function genericOrderQuestion(question: string): boolean {
  const parts = question.split(/[，。！？,!?；;]+/).map((part) => part.replace(/\s+/g, '')).filter(Boolean);
  return parts.length > 0 && parts.length <= 3 && parts.every((part) => {
    // Whole phrases only: a merchant name, date, identifier, state filter, or
    // request for all history must not become an unfiltered latest-five read.
    for (let n = 0; n < 16; n++) {
      const next = part.replace(/^(?:我想知道|我想查看|我想查|請問|麻煩你|麻煩|幫我|替我|告訴我|查詢|查一下|查看|看一下|看看|請|查|看|我的|我點的|我訂的|目前的|目前|現在的|現在|最近的|最近)/, '');
      if (next === part) break;
      part = next;
    }
    return /^(?:訂單(?:的)?(?:進度|狀態|紀錄)?(?:如何|怎麼樣|是什麼|到哪了|到哪一步了)?|訂單(?:目前|現在)?(?:是)?什麼(?:狀態|進度)|(?:訂餐|點餐)紀錄|(?:餐|餐點|便當)(?:好了|做好了|好了沒|做好了沒)|(?:可以|能)取餐(?:了)?|取餐(?:進度|狀態|號碼)(?:是什麼|是多少)?)(?:嗎|呢)?$/.test(part);
  });
}

export function informationReads(question: string, now: number): InformationRead[] {
  // A bounded fallback is useful only when it preserves the user's scope.
  // Named courses/tasks, weekdays and multi-date requests stay with the model
  // tools instead of quietly becoming an all-course query for today.
  if (!Number.isFinite(now) || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}「」『』“”"`]/u.test(question)) return [];
  question = question.normalize('NFKC').trim();
  const kinds = informationKinds(question);
  if (!kinds.length) return [];
  const range = requestedRange(question, now);
  if (range === null || (/(?:現在|目前)/.test(question) && range &&
      (range.from !== taipeiDate(now) || range.to !== taipeiDate(now)))) return [];
  if (kinds.includes('schedule') && (
    (/下一堂|下堂/.test(question) && /課表|(?:有什麼|有哪些|幾堂|多少)課/.test(question)) ||
    (/現在|目前/.test(question) && !/(?:現在|目前)(?:上什麼|有什麼|有哪些)課/.test(question))
  )) return [];
  if (kinds.includes('orders')) {
    if (kinds.length !== 1 || range || !genericOrderQuestion(question)) return [];
  } else {
    const residue = question.normalize('NFKC')
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
      .replace(/(?:今天|明天|後天|這週|本週|這禮拜|本禮拜|下週|下禮拜|目前|現在|下一堂|下堂|教室|課表|課程|上課|下課|作業|測驗|待繳|未繳|未交|功課|要交|還沒交|尚未交|截止|期限|日期|時間|幾點|何時|哪裡|在哪|哪些|什麼|多少|幾堂|幫我|麻煩|請問|請|查詢|查一下|查看|告訴我|想知道|還有|總共|順便|以及|可以|看看|看一下|了嗎|我|的|有|課|要|和|與|跟|在|哪|嗎|呢|沒|交|查)/g, '')
      .replace(/[\s，。！？,.!?、：:（）()]/g, '');
    if (residue) return [];
  }
  return kinds.map<InformationRead>((kind) => {
    if (kind === 'orders') return { kind, name: 'list_food_orders', args: {} };
    if (kind === 'work') {
      const assignment = /作業|功課/.test(question), quiz = /測驗/.test(question);
      return { kind, name: 'get_due_work', args: range || {},
        ...(assignment !== quiz ? { taskKind: quiz ? 'quiz' : 'assignment' } : {}) };
    }
    const today = taipeiDate(now);
    const view = /下一堂|下堂/.test(question) ? 'next' : /現在|目前/.test(question) ? 'now' : undefined;
    return { kind, name: 'get_schedule', args: range || { from: today, to: view === 'next' ? addDays(today, 6) : today }, view };
  });
}

const record = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
const unwrap = (value: unknown): Obj => {
  const row = record(value);
  return row.data && typeof row.data === 'object' ? record(row.data) : row;
};
const rows = (value: unknown) => Array.isArray(value) ? value.map(record) : [];
const label = (value: unknown, fallback = '') => typeof value === 'string'
  ? value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').slice(0, 160).trim() || fallback
  : fallback;
function time(value: unknown): string {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '';
}
const ORDER_STATES: Record<string, string> = {
  'payment-pending': '等待付款', paid: '已付款', accepted: '店家已接單', preparing: '製作中',
  ready: '可取餐', fulfilled: '已完成取餐', canceled: '已取消', rejected: '店家已拒絕',
  'payment-expired': '付款期限已過', 'cancellation-pending-refund': '取消後等待退款',
  'rejection-pending-refund': '店家拒絕後等待退款',
};

/** These sentences use successful reader results, never the model's claim to have read. */
export function informationAnswer(results: InformationResult[], now: number): string {
  return results.map(({ read, result, detail }) => {
    const data = unwrap(result);
    if (result === undefined) {
      const name = read.kind === 'schedule' ? '課表' : read.kind === 'work'
        ? read.taskKind === 'quiz' ? '測驗' : read.taskKind === 'assignment' ? '作業' : '作業與測驗' : '訂單';
      return `${name}目前未能讀取，暫時無法確認內容，請稍後再試。`;
    }
    if (read.kind === 'schedule') {
      let classes = rows(data.classes);
      if (read.view === 'next') classes = classes.filter((row) => Number(row.start) >= now).sort((a, b) => Number(a.start) - Number(b.start)).slice(0, 1);
      if (read.view === 'now') classes = classes.filter((row) => Number(row.start) <= now && now < Number(row.end));
      const heading = read.view === 'next' ? '下一堂課（依已同步課表）' : read.view === 'now' ? '目前課程（依已同步課表）' : `課表 ${read.args.from}${read.args.to !== read.args.from ? ' 至 ' + read.args.to : ''}`;
      const lines = classes.slice(0, 20).map((row) => `・${label(row.date)} ${label(row.startTime)}–${label(row.endTime)}　${label(row.title, '未命名課程')}｜${label(row.location, '教室未提供')}`);
      if (!classes.length) lines.push('已同步課表中，這個查詢範圍沒有符合的課程紀錄。');
      if (classes.length > 20) lines.push(`另有 ${classes.length - 20} 堂課，請縮小日期範圍查看。`);
      if (Number(data.unplaced) > 0) lines.push(`另有 ${Number(data.unplaced)} 筆課程尚未定位時間，以上不是完整課表。`);
      lines.push('範圍：已同步的個人課表。');
      return heading + '\n' + lines.join('\n');
    }
    if (read.kind === 'work') {
      const matches = (value: unknown) => rows(value).filter((row) => !read.taskKind || row.kind === read.taskKind);
      const pending = matches(data.pending), undated = matches(data.undated), overdue = matches(data.overdue);
      const unknownKinds = read.taskKind ? [...rows(data.pending), ...rows(data.undated), ...rows(data.overdue)]
        .filter((row) => row.kind !== 'assignment' && row.kind !== 'quiz').length : 0;
      const taskLabel = read.taskKind === 'assignment' ? '作業' : read.taskKind === 'quiz' ? '測驗' : '作業與測驗';
      const lines = pending.slice(0, 15).map((row) => `・${label(row.title, '未命名項目')}｜截止 ${time(row.dueAt) || '時間未提供'}`);
      if (!pending.length) lines.push(data.partial || unknownKinds
        ? '已讀取的部分尚未讀到符合的待繳項目；其餘項目仍待確認。'
        : '已讀取的課程中，這個日期範圍沒有設定截止日的待繳項目。');
      if (undated.length) {
        lines.push('另有未設定截止時間的項目，無法判定是否屬於上述截止日期範圍：');
        lines.push(...undated.slice(0, 5).map((row) => `・${label(row.title, '未命名項目')}｜未設定截止時間`));
      }
      if (unknownKinds) lines.push(`另有 ${unknownKinds} 筆項目未標示作業或測驗類型，未納入上述清單。`);
      if (pending.length > 15 || undated.length > 5) lines.push('項目較多，請縮小日期或指定課程查看其餘內容。');
      const unqueried = rows(data.unqueried);
      if (data.partial) lines.push('部分課程未能讀取' + (unqueried.length ? '：' + unqueried.slice(0, 5).map((row) => label(row.title, '未命名課程')).join('、') : '') + '，以上不是全部課程的結果。');
      if (overdue.length) lines.push(`另有 ${overdue.length} 筆已逾期未繳，未列入上述待繳清單。`);
      return `待繳${taskLabel} ${label(data.from)} 至 ${label(data.to)}\n` + lines.join('\n');
    }
    const orders = rows(data.orders);
    const full = unwrap(detail);
    const lines = orders.map((row) => {
      const current = full.id === row.id ? { ...row, ...full } : row;
      const name = label(current.location || current.title, '訂單');
      const state = ORDER_STATES[String(current.state)] || '狀態尚未確認';
      const pickup = label(current.pickupNumber);
      return `・${name}｜${state}${pickup ? '｜取餐號碼 ' + pickup : ''}${time(current.requestedPickupAt) ? '｜預定取餐 ' + time(current.requestedPickupAt) : ''}`;
    });
    if (!orders.length) lines.push('本次查詢沒有近期訂單紀錄；不代表沒有歷史訂單。');
    if (data.nextCursor) lines.push('目前列出最近五筆，還有更早的訂單。');
    return '訂單進度（依本次查詢紀錄）\n' + lines.join('\n');
  }).join('\n\n');
}
