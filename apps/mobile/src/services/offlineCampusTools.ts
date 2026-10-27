import { suggestCampusDestinations } from '@campus/shared/src/campusIntent';
import type { OnDeviceSchoolContext } from './onDeviceSchoolContext';

export type OfflineCampusToolResult = {
  content: string;
  tool: 'saved-timetable' | 'online-required' | 'open-service';
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
): OfflineCampusToolResult | null {
  const text = question.trim().slice(0, 1600);
  if (!text) return null;
  const requestedWrite = userWriteRequest(text);
  if (requestedWrite) return requestedWrite;
  const live = realtimeOnly(text);
  if (live) return live;
  const navigation = openReadOnlyService(text);
  if (navigation) return navigation;
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
