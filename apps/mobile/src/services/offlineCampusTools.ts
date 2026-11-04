import { suggestCampusDestinations } from '@campus/shared/src/campusIntent';
import type { OnDeviceSchoolContext } from './onDeviceSchoolContext';
import { validCampusSenseSnapshot, type CampusSenseSnapshot } from './campusSenseSnapshot';
import { confirmedTimestamp, taipeiDayNumber } from './campusStudyAgenda';
import { parseAssignmentDeadlineWindow } from './assignmentDeadlineWindow';
import { filterAssignmentQuery } from './assignmentQueryFilter';
import { buildOfflineCampusPlan, type CampusEvidencePlan } from './offlineCampusPlanner';

export interface AssignmentRead {
  reviewReminder?: boolean;
  userId: string;
  schoolId: string;
  checkedAt: string;
  filterQuestion: string;
  items: CampusSenseSnapshot['assignments']['items'];
}

export type OfflineCampusToolResult = {
  assignmentRead?: AssignmentRead;
  content: string;
  tool: 'saved-timetable' | 'campus-snapshot' | 'campus-plan' | 'online-required' | 'open-service';
  plan?: CampusEvidencePlan;
  route?: string;
};

const DAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;
const WEEKDAY_MAP: Record<string, number> = {
  日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
};

function taiwanWeekday(date: Date): number {
  const english = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', weekday: 'short',
  }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(english);
}

function dayForQuestion(message: string, now: Date): number | 'week' {
  const explicit = message.match(/(?:星期|禮拜|週)\s*([一二三四五六日天])/);
  if (explicit) return WEEKDAY_MAP[explicit[1]] ?? 'week';
  if (/明天|明日/.test(message)) return taiwanWeekday(new Date(now.getTime() + 86_400_000));
  if (/今天|今日/.test(message)) return taiwanWeekday(now);
  return 'week';
}

function slotLabel(start: number, end: number): string {
  return start === end ? `第 ${start} 節` : `第 ${start}–${end} 節`;
}

function lastSaved(value: string | null): string {
  if (!value) return '儲存時間不詳';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '儲存時間不詳';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function courseLines(
  courses: OnDeviceSchoolContext['timetable']['courses'],
  day: number,
): string[] {
  return courses
    .filter((item) => item.day === day && item.start > 0 && item.end >= item.start)
    .sort((a, b) => a.start - b.start)
    .map((item) => `• ${slotLabel(item.start, item.end)}｜${item.name}${item.room ? `（${item.room}）` : ''}`);
}

function gaps(courses: OnDeviceSchoolContext['timetable']['courses'], day: number): string[] {
  const rows = courses
    .filter((item) => item.day === day && item.start > 0 && item.end >= item.start)
    .sort((a, b) => a.start - b.start);
  const free: string[] = [];
  let previousEnd: number | null = null;
  for (const row of rows) {
    if (previousEnd != null && row.start > previousEnd + 1) {
      free.push(slotLabel(previousEnd + 1, row.start - 1));
    }
    previousEnd = Math.max(previousEnd ?? row.end, row.end);
  }
  return free;
}


function syncedTime(value: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

// A bare “截止” could refer to event registration, library loans, or another service.
function asksForAssignments(question: string): boolean {
  if (!/作業|功課|報告|習題|測驗/.test(question) &&
      /借閱|還書|圖書館|報名|活動|繳費|學費|帳單|註冊|住宿|水費|電費/.test(question)) return false;
  return /作業|功課|待交|待繳/.test(question) ||
    /(?:報告|習題|測驗).*(?:繳交期限|截止|到期)|(?:哪天|幾號|何時|什麼時候|幾點)(?:要|得|需|必須)?(?:繳交|繳|交)/.test(question);
}

const PRIORITY_QUESTION = /今日重點|今天要做|今天要先|今天先做|今天該做|先處理|待辦摘要|校園摘要|先完成哪|有什麼重要的/;

function syncedCampusAnswer(
  question: string,
  context: OnDeviceSchoolContext,
  snapshot: CampusSenseSnapshot | null,
  assignmentOnly: boolean,
  filterQuestion: string,
): OfflineCampusToolResult | null {
  if (!snapshot) return null;
  const now = Date.parse(context.checkedAt);
  const askingAssignments = assignmentOnly || asksForAssignments(question);
  const askingAnnouncements = /公告|通知/.test(question);
  const askingPriority = PRIORITY_QUESTION.test(question);
  // Writing a submission is never a read-only snapshot action.
  if (/幫我.{0,12}(?:交作業|繳作業|提交|刪除|修改)|(?:代交|自動繳交)/.test(question)) {
    return null;
  }
  if (!askingAssignments && !askingAnnouncements && !askingPriority) return null;

  const lines: string[] = [
    '上次主動同步：' + syncedTime(snapshot.checkedAt) + '（非即時查詢）。',
    '資料只包含 nuni 已接通並獲授權的來源，並非完整的校方 LMS。',
  ];
  let matched = false;
  let assignmentRead: AssignmentRead | undefined;
  if (askingAssignments || askingPriority) {
    const assignments = snapshot.assignments;
    if (assignments.status === 'available') {
      matched = true;
      const filtered = assignmentOnly ? filterAssignmentQuery(filterQuestion, assignments.items)
        : { items: assignments.items, scope: null };
      const window = assignmentOnly ? parseAssignmentDeadlineWindow(question, now) : null;
      if (window === 'clarify') return {
        tool: 'campus-snapshot', route: '/classroom',
        content: '你想查哪段時間截止的作業？可以指定單一天（例如「這週五」）、整週或「未來七天」。',
      };
      const dated = filtered.items.map((item) => ({ item, due: confirmedTimestamp(item.dueAt) }));
      const matches = (window ? dated.filter(({ due }) => {
        const day = taipeiDayNumber(due);
        return day >= window.startDay && day < window.endDay &&
          (!/未來|接下來/.test(window.label) || due >= now);
      }) : dated).sort((a, b) =>
        (Number.isFinite(a.due) ? a.due : Infinity) - (Number.isFinite(b.due) ? b.due : Infinity));
      const preview = matches.slice(0, askingPriority ? 3 : 8);
      if (assignmentOnly) {
        assignmentRead = { filterQuestion, userId: snapshot.userId, schoolId: snapshot.schoolId,
          checkedAt: snapshot.checkedAt, items: preview.map(({ item }) => item) };
      }
      if (filtered.scope || window) {
        const detail = [filtered.scope, window && window.label + '截止（台灣時間）'].filter(Boolean).join('、');
        lines.push('已同步作業中符合「' + detail + '」的有 ' + matches.length + ' 筆。');
      } else {
        lines.push('已接通課程的待交作業：' + assignments.count + ' 筆。');
        if (!matches.length) lines.push('這次同步沒有列出作業，不代表其他校務系統已全部繳交。');
      }
      for (const [index, { item, due }] of preview.entries()) {
        const deadline = Number.isFinite(due)
          ? (due < now ? '｜期限已過 ' : '｜截止 ') + syncedTime(item.dueAt!)
          : '｜截止時間未確認';
        lines.push((assignmentOnly ? (index + 1) + '. ' : '• ') + item.title +
          (item.groupName ? '（' + item.groupName + '）' : '') + deadline);
      }
      if (matches.length > preview.length) {
        lines.push('此回覆先列出 ' + preview.length + ' 筆；另有 ' + (matches.length - preview.length) +
          ' 筆已同步但未在此預覽展開，可從「未來七天」的逐日安排與其他作業區查看。');
      }
      if (window) {
        const undated = dated.filter(({ due }) => !Number.isFinite(due)).length;
        if (undated) lines.push('另有 ' + undated + ' 筆截止時間未確認，無法按日期歸入這段期間。');
      }
      if (assignments.count !== null && assignments.count > assignments.items.length) {
        lines.push('另有 ' + (assignments.count - assignments.items.length) +
          ' 筆尚未同步，未納入本機規劃；其餘待交內容請開啟課程頁核對。');
      }
    } else {
      lines.push('待交作業來源目前無法取得，不能判定是否已繳交。');
    }
  }
  if (askingAnnouncements || askingPriority) {
    const announcements = snapshot.announcements;
    if (announcements.status === 'available') {
      matched = true;
      lines.push('同步時可讀取的校園公告（僅列部分）：');
      if (!announcements.items.length) lines.push('本次沒有列出公告，不能當作校方最新公告為空。');
      for (const item of announcements.items.slice(0, askingPriority ? 2 : 8)) {
        lines.push('• ' + item.title +
          (item.publishedAt ? '｜發布 ' + syncedTime(item.publishedAt) : '｜發布時間未提供'));
      }
    } else {
      lines.push('校園公告來源目前無法取得，不能判定有沒有新公告。');
    }
  }
  if (!matched) return null;
  if (askingPriority) {
    if (context.timetable.source === 'saved-device-copy') {
      const day = taiwanWeekday(new Date(context.checkedAt));
      const today = courseLines(context.timetable.courses, day);
      lines.push(today.length
        ? '今日手機課表副本：\n' + today.slice(0, 6).join('\n') +
          (today.length > 6 ? '\n其餘課程請開啟課表核對。' : '')
        : '今日手機課表副本未排課，不能據此判定學校正式停課。');
    } else {
      lines.push('手機沒有已保存的個人課表副本。');
    }
    const tasks = snapshot.assignments.status === 'available'
      ? [...snapshot.assignments.items]
        .filter((item) => item.dueAt && Number.isFinite(Date.parse(item.dueAt)))
        .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))
      : [];
    if (tasks.length) {
      const first = tasks[0];
      lines.push('建議下一步：先核對「' + first.title +
        '」的繳交要求及截止時間，再依剩餘時間安排工作；是否已繳交仍以課程頁為準。');
    } else {
      lines.push('建議下一步：先開啟課程與公告服務核對來源，再安排今天的工作。');
    }
  }
  return {
    tool: 'campus-snapshot',
    ...(assignmentRead ? { assignmentRead } : {}),
    route: askingAssignments || askingPriority ? '/classroom' : '/announcements',
    content: lines.join('\n'),
  };
}

function realtimeOnly(question: string): OfflineCampusToolResult | null {
  const source: Array<{ pattern: RegExp; route?: string; label: string }> = [
    { pattern: /(?:最新|即時|今天|本週|這週|近期|有哪些|查詢|查).{0,8}公告|公告.{0,8}(?:最新|即時|本週|這週|近期|有哪些)/, route: '/announcements', label: '校園公告' },
    { pattern: /(?:最新|即時|今天|本週|這週|近期|有哪些|查詢|查).{0,8}活動|活動.{0,8}(?:最新|即時|本週|這週|近期|有哪些)/, route: '/events', label: '校園活動' },
    { pattern: /(?:我|我的|今天|明天|本週|這週|下週|有哪些|截止|待交|待繳|未交|還沒交|查詢|查).{0,12}(?:作業|測驗|考試|待辦)|(?:作業|測驗|考試).{0,12}(?:截止|繳交|有哪些|幾份|還有|交完)/, route: '/classroom', label: '個人作業／測驗' },
    { pattern: /(?:我的|我這|這學期|本學期|查).{0,10}(?:成績|GPA|學分)|(?:成績|GPA|學分).{0,10}(?:最新|查|多少|幾分|這學期|我的|已修)/i, route: '/grades', label: '個人成績／學分' },
    { pattern: /(?:公車|校車).{0,9}(?:到站|還要|幾分鐘|即時|哪班)|(?:到站|幾分鐘).{0,9}(?:公車|校車)/, route: '/bus', label: '即時公車' },
    { pattern: /(?:菜單|餐點|餐廳).{0,8}(?:今天|多少錢|有哪些|最新|營業)/, route: '/cafeteria', label: '即時餐廳資料' },
    { pattern: /(?:請假).{0,8}(?:狀態|進度|紀錄|編號)|(?:我的|查|追蹤).{0,8}請假/, route: '/classroom', label: '請假申請' },
    { pattern: /(?:報修).{0,8}(?:狀態|進度|紀錄|編號)|(?:我的|查|追蹤).{0,8}報修/, route: '/dormitory', label: '宿舍報修' },
    { pattern: /(?:訂單).{0,8}(?:狀態|進度|紀錄|編號)|(?:我的|查|追蹤).{0,8}訂單/, route: '/cafeteria', label: '餐廳訂單' },
    { pattern: /(?:借閱|借書).{0,8}(?:狀態|進度|紀錄|編號)|(?:我的|查|追蹤).{0,8}借閱/, route: '/library', label: '圖書借閱' },
    { pattern: /(?:今天|明天|目前|現在|即時).{0,12}(?:天氣|氣溫|降雨|空氣品質|下雨)|(?:天氣|氣溫|降雨|空氣品質).{0,12}(?:今天|明天|目前|現在|即時)/, label: '即時天氣' },
  ];
  const item = source.find((entry) => entry.pattern.test(question));
  return item
    ? {
        tool: 'online-required',
        ...(item.route ? { route: item.route } : {}),
        content: `「${item.label}」需要正式資料來源才能核實。手機離線模式沒有讀取即時資料，也不會猜測結果。請切換「校園即時」模式，或使用下方校園服務入口查證。`,
      }
    : null;
}

function userWriteRequest(question: string): OfflineCampusToolResult | null {
  if (/(?:代交|代繳|自動繳交)|(?:幫我|替我|請|直接|我要).{0,8}(?:繳交|提交|送出|刪除|繳|交)(?:這[份個筆]|那[份個筆]|這門課的|我的|全部|所有|的)?作業/.test(question) &&
      !/(?:查|看|確認|哪些|何時|幾點|哪天|什麼時候)/.test(question)) {
    return { tool: 'open-service', route: '/classroom',
      content: '請開啟課程頁選擇作業，核對內容後再確認送出。' };
  }
  // A request to check a status is a read, not permission to create another request.
  if (/(?:查詢|幫我查|查一下|進度|狀態|紀錄|編號)/.test(question) &&
      !/(?:送出|提交|建立|幫我預約|幫我下單|幫我訂餐)/.test(question)) {
    return null;
  }
  if (!/(?:幫我|替我|我要|我想|請幫|幫忙|請直接|送出|幫我處理).{0,22}(?:請假|報修|預約|借書|續借|還書|下單|訂餐|付款|傳訊息|發訊息)/.test(question)) {
    return null;
  }
  const targets: Array<{ pattern: RegExp; route: string; label: string }> = [
    { pattern: /請假/, route: '/classroom', label: '請假申請' },
    { pattern: /報修|洗衣|洗衣機/, route: '/dormitory', label: '宿舍服務' },
    { pattern: /借書|續借|還書|預約.{0,5}座位/, route: '/library', label: '圖書館服務' },
    { pattern: /訂餐|下單|點餐|付款/, route: '/cafeteria', label: '餐廳服務' },
    { pattern: /傳訊息|發訊息/, route: '/dms', label: '訊息服務' },
  ];
  const task = targets.find((item) => item.pattern.test(question));
  return {
    tool: 'open-service',
    route: task?.route || '/classroom',
    content: `可以先開啟${task?.label || '對應校園服務'}檢查可用功能，但離線 AI 無法代替你送出或確認這項操作。請點下方服務入口，在登入及檢查內容後自行確認；我沒有建立任何申請或付款。`,
  };
}

const SAFE_OFFLINE_DESTINATIONS: Record<string, string> = {
  '/map': '校園地圖',
  '/bus': '公車',
  '/classroom': '課程與作業',
  '/timetable': '我的課表',
  '/library': '圖書館',
  '/grades': '成績',
  '/cafeteria': '校園餐廳',
  '/dormitory': '宿舍服務',
  '/events': '校園活動',
  '/announcements': '校園公告',
  '/dms': '私訊',
};

function openReadOnlyService(question: string): OfflineCampusToolResult | null {
  // A generic query is not an instruction to navigate. Only direct
  // navigation requests may be handled without running a local model.
  if (!/(?:開啟|打開|前往|帶我去|我要找|我想找|幫我找|幫我開|怎麼走|怎麼去|導航|在哪裡|服務入口)/.test(question)) {
    return null;
  }
  const routes = suggestCampusDestinations(question).filter((route) =>
    Object.prototype.hasOwnProperty.call(SAFE_OFFLINE_DESTINATIONS, route));
  // Ambiguous destinations go to the assistant instead of guessing.
  if (routes.length !== 1) return null;
  const route = routes[0];
  return {
    tool: 'open-service',
    route,
    content: `可以開啟「${SAFE_OFFLINE_DESTINATIONS[route]}」查看資料或使用功能。這只是提供入口，沒有替你送出任何申請或執行操作。`,
  };
}

/**
 * Deterministic, read-only local tool execution. No LLM, cloud call or mutation.
 * Only course slots actually stored on this device are eligible for an answer.
 */
export function runOfflineCampusTool(
  question: string,
  context: OnDeviceSchoolContext,
  senseSnapshot?: CampusSenseSnapshot | null,
  ownerUid = '',
  assignmentFilterQuestion?: string,
): OfflineCampusToolResult | null {
  const text = question.trim().slice(0, 1600);
  if (!text) return null;
  const requestedWrite = userWriteRequest(text);
  if (requestedWrite) return requestedWrite;
  if (/作業|功課|報告|截止/.test(text) &&
      /翻譯|翻成|改寫|潤飾|寫一篇|解釋|什麼意思|什麼是|造句/.test(text)) return null;
  if (asksForAssignments(text) && /設(?:定)?(?:作業|截止)?提醒|提醒我/.test(text)) {
    return { tool: 'open-service', route: '/classroom',
      content: '請先查詢待交作業，選定要提醒的那一份，再確認提醒時間。' };
  }
  if (asksForAssignments(text) && /已(?:經)?[交繳]|[交繳]了(?:沒|嗎)|是否已[交繳]/.test(text)) {
    return { tool: 'online-required', route: '/classroom',
      content: '已同步的摘要只列待交項目。請在原始課程頁核對繳交紀錄。' };
  }
  const now = Date.parse(context.checkedAt);
  const snapshot = Number.isFinite(now)
    ? validCampusSenseSnapshot(senseSnapshot, { uid: ownerUid, schoolId: context.schoolId }, now) : null;
  // A deadline list (including “未來七天”) is a query over assignments, not a study plan.
  const assignmentOnly = (asksForAssignments(text) || assignmentFilterQuestion !== undefined) &&
    !PRIORITY_QUESTION.test(text) && !/安排|規劃|計畫|優先順序|公告|通知|提醒|課表|空堂/.test(text);
  const plan = ownerUid && !assignmentOnly ? buildOfflineCampusPlan({
    question: text, context, snapshot, uid: ownerUid,
  }) : null;
  if (plan) {
    return {
      tool: 'campus-plan',
      content: plan.content,
      plan,
      route: plan.steps[0]?.route,
    };
  }
  const synced = syncedCampusAnswer(text, context, snapshot, assignmentOnly, assignmentFilterQuestion ?? text);
  if (synced) return synced;
  if (assignmentOnly && (!snapshot || snapshot.assignments.status !== 'available')) {
    return { tool: 'online-required', route: '/classroom',
      content: '手機目前沒有可核對的作業摘要。請先同步校園資料，或開啟課程頁確認截止時間。' };
  }
  const live = realtimeOnly(text);
  if (live) return live;
  const navigation = openReadOnlyService(text);
  if (navigation) return navigation;
  // A planning request needs a synthesized answer, not a raw timetable dump.
  if (/(規劃|安排|制定|拆成|讀書計畫|學習計畫)/.test(text) &&
      /(課表|空堂|學習|讀書|複習|報告)/.test(text)) return null;
  const wantsTimetable = /課表|有課|沒課|上課|哪幾堂|哪些課|幾堂課|空堂|空檔|課程時間/.test(text);
  if (!wantsTimetable) return null;

  const saved = context.timetable;
  if (saved.source !== 'saved-device-copy') {
    return {
      tool: 'saved-timetable',
      route: '/timetable',
      content: '這台手機目前沒有可確認的個人課表副本。請先開啟「我的課表」匯入或儲存資料；在此之前，離線 AI 無法知道你實際上了哪些課。',
    };
  }

  const date = new Date(context.checkedAt);
  if (!Number.isFinite(date.getTime())) return null;
  const day = dayForQuestion(text, date);
  const details = [
    `資料來源：這台手機已儲存的個人課表（${lastSaved(saved.updatedAt)}）。`,
    '這不是校方即時課務紀錄；停課、補課與調課仍應以正式通知為準。',
  ];
  const rows = saved.courses;
  if (day === 'week') {
    const days = [1, 2, 3, 4, 5].map((index) => {
      const dayRows = courseLines(rows, index);
      return `星期${DAYS[index]}：${dayRows.length ? dayRows.length + ' 堂' : '副本未排定課程'}`;
    });
    return {
      tool: 'saved-timetable',
      route: '/timetable',
      content: ['依目前手機內的課表副本，平日安排如下：', ...days, ...details].join('\n'),
    };
  }

  const dayRows = courseLines(rows, day);
  const out = [`星期${DAYS[day]}的個人課表副本：`];
  if (dayRows.length) out.push(...dayRows);
  else out.push('副本沒有排定這一天的課程，不代表正式學校課表一定沒有課。');

  if (/空堂|空檔/.test(text) && dayRows.length > 1) {
    const slots = gaps(rows, day);
    out.push(slots.length
      ? `已排定課程之間的空堂：${slots.join('、')}。`
      : '已排定課程之間沒有空堂。');
  }
  if (/幾點|時間/.test(text)) {
    out.push('此處保存的是節次索引，未確認鐘點換算；確切上課時間請開啟課表查看。');
  }
  return { tool: 'saved-timetable', route: '/timetable', content: [...out, ...details].join('\n') };
}
