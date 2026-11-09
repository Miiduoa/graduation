import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import { classDate } from '@campus/shared/src/timetable/classExceptions';
import { chineseOrDecimal } from './chineseOrDecimal';
import type { OnDeviceSchoolContext } from './onDeviceSchoolContext';

type DayPart = 'morning' | 'afternoon' | 'evening';
export type SavedClassGapQuery = {
  day: 'today' | 'tomorrow' | 'day-after-tomorrow';
  minMinutes: number;
  part?: DayPart;
  fromMinute?: number;
  untilMinute?: number;
};

const partBounds = {
  morning: { start: 0, end: 12, label: '上午（00:00–12:00）' },
  afternoon: { start: 12, end: 18, label: '下午（12:00–18:00）' },
  evening: { start: 18, end: 24, label: '晚上（18:00–24:00）' },
};

function questionText(question: string) {
  return question.normalize('NFKC').replace(/\s+/g, '').replace(/[?!。！？，,]+$/, '')
    .replace(/^(?:請問|我想知道|想知道|幫我(?:看|查)(?:一下)?)[，,]?/, '').replace(/[嗎呢啊呀]+$/, '');
}

const numberText = '(?:兩|[零一二三四五六七八九十]+|\\d+(?:\\.\\d+)?)';
const hours = new RegExp(`(?:至少|最少)?(${numberText}|半)(?:個)?(半)?(?:小時|鐘頭|h)(?:(半)|(?:又)?(${numberText})分鐘)?(?:以上)?`, 'i');
const minutes = new RegExp(`(?:至少|最少)?(${numberText})分鐘(?:以上)?`);

function quantity(text: string) {
  return /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : chineseOrDecimal(text.replace('兩', '二'));
}

function readDuration(text: string) {
  const hourMatch = hours.exec(text);
  const match = hourMatch ?? minutes.exec(text);
  if (!match) return null;
  const amount = match[1] === '半' ? 0.5 : quantity(match[1]);
  if (hourMatch && ((match[2] && (match[3] || match[4])) ||
      ((match[2] || match[3] || match[4]) && !Number.isInteger(amount)))) return null;
  const value = hourMatch
    ? amount * 60 + (match[2] || match[3] ? 30 : match[4] ? quantity(match[4]) : 0)
    : amount;
  if (hourMatch?.[4] && quantity(hourMatch[4]) >= 60) return null;
  return Number.isSafeInteger(value) && value > 0 && value <= 1440
    ? { minutes: value, rest: text.replace(match[0], '') } : null;
}

function period(text: string | undefined): DayPart | undefined {
  return text === '下午' || text === '中午' ? 'afternoon'
    : text === '晚上' || text === '晚間' ? 'evening'
      : text ? 'morning' : undefined;
}

const clockNumber = '(?:兩|[零一二三四五六七八九十]+|\\d{1,2})';
const clockPeriod = '(?:凌晨|早上|上午|中午|下午|晚上|晚間)';
const clockText = `(?:${clockPeriod})?(?:\\d{1,2}:\\d{2}|${clockNumber}點(?:半|一刻|三刻|${clockNumber}分?)?)`;
const clockRange = new RegExp(`(${clockText})(?:到|至|[-–—~～])(${clockText})(?:之間|內)?`);
const clockAfter = new RegExp(`(${clockText})(?:以後|之後|後)`);
const clockBefore = new RegExp(`(${clockText})(?:以前|之前|前)`);

function readClock(text: string, inherited: DayPart | undefined, ending: boolean) {
  const prefix = /^(凌晨|早上|上午|中午|下午|晚上|晚間)/.exec(text)?.[0];
  const value = prefix ? text.slice(prefix.length) : text;
  const numeric = /^(\d{1,2}):(\d{2})$/.exec(value);
  const spoken = new RegExp(`^(${clockNumber})點(半|一刻|三刻|${clockNumber}分?)?$`).exec(value);
  if (!numeric && !spoken) return null;
  let hour = quantity((numeric ?? spoken)![1]);
  const suffix = spoken?.[2];
  const minute = numeric ? Number(numeric[2]) : suffix === '半' ? 30 : suffix === '一刻' ? 15
    : suffix === '三刻' ? 45 : suffix ? quantity(suffix.replace(/分$/, '')) : 0;
  if (!Number.isInteger(hour) || hour < 0 || hour > 24 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  // An unqualified colon is a 24-hour clock; spoken hours need a day part unless already unambiguous.
  const part = period(prefix) ?? (!numeric ? inherited : undefined);
  if (part) {
    if (prefix === '凌晨' && hour === 12) hour = 0;
    if (part === 'afternoon' && hour >= 1 && hour < 12) hour += 12;
    if (part === 'evening' && hour >= 1 && hour <= 12) hour = hour === 12 ? 24 : hour + 12;
    const bounds = partBounds[part];
    if (hour < bounds.start || hour > bounds.end || (hour === bounds.end && minute > 0)) return null;
  } else if (!numeric && hour > 0 && hour <= 12) {
    return null;
  }
  const result = hour * 60 + minute;
  return result <= 1440 && (ending ? result > 0 : result < 1440) ? result : null;
}

function readClockWindow(text: string, inherited?: DayPart) {
  const range = clockRange.exec(text);
  const after = range ? null : clockAfter.exec(text);
  const before = range || after ? null : clockBefore.exec(text);
  const match = range ?? after ?? before;
  if (!match) return { rest: text };
  const firstPart = period(/^(凌晨|早上|上午|中午|下午|晚上|晚間)/.exec(match[1])?.[0]) ?? inherited;
  const fromMinute = range || after ? readClock(match[1], inherited, false) : undefined;
  const untilMinute = range ? readClock(match[2], firstPart, true)
    : before ? readClock(match[1], inherited, true) : undefined;
  if (fromMinute === null || untilMinute === null ||
      (fromMinute !== undefined && untilMinute !== undefined && fromMinute >= untilMinute)) return null;
  return { rest: text.replace(match[0], ''), fromMinute, untilMinute };
}

function readScope(text: string, inheritedPart?: DayPart) {
  let rest = text.replace(/^我的?/, '').replace(/^([今明])([早晚])/, (_, day, part) =>
    day + '天' + (part === '早' ? '早上' : '晚上'));
  const date = /^(今天|今日|明天|明日|後天|後日|接下來)/.exec(rest);
  let day: SavedClassGapQuery['day'] | undefined;
  if (date) {
    day = date[0].startsWith('明') ? 'tomorrow' : date[0].startsWith('後') ? 'day-after-tomorrow' : 'today';
    rest = rest.slice(date[0].length).replace(/^我的?/, '');
  }
  rest = rest.replace(/^的?課表(?:上|裡)?/, '').replace(/^(?:剩下(?:來)?的?|接下來的?)/, '');
  const allDay = /^(?:的)?(?:全天|全日|整天|全部時段)/.exec(rest);
  if (allDay) rest = rest.slice(allDay[0].length);
  const statedPart = /^(?:的)?(早上|上午|下午|晚上)/.exec(rest);
  const clock = readClockWindow(rest, period(statedPart?.[1]) ?? inheritedPart);
  if (!clock) return null;
  rest = clock.rest;
  const partMatch = /^(?:的)?(早上|上午|下午|晚上)/.exec(rest);
  const part = period(partMatch?.[1]);
  if (partMatch) rest = rest.slice(partMatch[0].length).replace(/^我的?/, '');
  const hasClock = clock.fromMinute !== undefined || clock.untilMinute !== undefined;
  if (allDay && (part || hasClock)) return null;
  return { day, part, allDay: !!allDay, ...clock, rest, hasClock };
}

function readQuestion(question: string, inheritedPart?: DayPart) {
  let text = questionText(question);
  let refinement = false;
  let replaceTime = false;
  for (let count = 0; count < 2; count++) {
    const prefix = /^(?:(?:那麼|那)(?:就)?|改成|改查|改看|換成|只看|只找|查看)[，,]?/.exec(text);
    if (!prefix) break;
    refinement = true;
    if (/^(?:改成|換成)/.test(prefix[0])) replaceTime = true;
    text = text.slice(prefix[0].length);
  }
  const scope = readScope(text, inheritedPart);
  if (!scope) return null;
  const clearDuration = /^(?:不限(?:長度|時長|分鐘)|不限制(?:長度|時長))/.exec(scope.rest);
  const threshold = clearDuration ? null : readDuration(scope.rest);
  const rest = (clearDuration ? scope.rest.slice(clearDuration[0].length) : threshold?.rest ?? scope.rest)
    .replace(gapPurpose, '');
  return { ...scope, refinement, replaceTime, rest, minMinutes: clearDuration ? 0 : threshold?.minutes };
}

const gapNoun = /(?:空堂|空檔|空閒時段)(?:時間)?/;
const betweenClasses = /^(?:兩堂課之間|課[跟與]課之間|課間)/;
const beforeGap = /^(?:還)?(?:有沒有|是否有|有哪(?:些|幾段)|哪(?:些|幾個|幾段)|(?:什麼時候|何時|哪時(?:候)?)有|有什麼|有)?(?:一段)?的?(?:課間的?)?$/;
const afterGap = /^(?:有(?:沒有)?|是?(?:幾點(?:到幾點)?|什麼時候)|有哪些|有多(?:久|長))?$/;
const gapPurpose = /(?:可以|能)(?:吃飯|吃午餐|讀書|自習|寫作業)(?:的(?=空堂|空檔|空閒時段)|$)/;

function isGapRequest(rest: string, hasDuration: boolean) {
  let text = rest;
  const between = betweenClasses.exec(text);
  if (between) text = text.slice(between[0].length);
  // The class-gap request must account for the entire sentence, including its optional purpose.
  const noun = gapNoun.exec(text);
  if (noun) {
    return beforeGap.test(text.slice(0, noun.index)) && afterGap.test(text.slice(noun.index + noun[0].length));
  }
  return !!between && hasDuration && /^(?:還)?有(?:沒有)?$/.test(text);
}

function applyFilters(filters: NonNullable<ReturnType<typeof readQuestion>>, previous?: SavedClassGapQuery): SavedClassGapQuery | null {
  const replacingClock = filters.hasClock && (filters.replaceTime ||
    (filters.fromMinute !== undefined && filters.untilMinute !== undefined));
  const clearClock = filters.allDay || !!filters.part || replacingClock;
  const part = filters.allDay ? undefined : filters.part ?? (replacingClock ? undefined : previous?.part);
  const fromMinute = clearClock ? filters.fromMinute : filters.fromMinute ?? previous?.fromMinute;
  const untilMinute = clearClock ? filters.untilMinute : filters.untilMinute ?? previous?.untilMinute;
  const from = Math.max(fromMinute ?? 0, (part ? partBounds[part].start : 0) * 60);
  const until = Math.min(untilMinute ?? 1440, (part ? partBounds[part].end : 24) * 60);
  if (from >= until) return null;
  return {
    day: filters.day ?? previous?.day ?? 'today',
    minMinutes: filters.minMinutes ?? previous?.minMinutes ?? 0,
    ...(part && { part }),
    ...(fromMinute !== undefined && { fromMinute }),
    ...(untilMinute !== undefined && { untilMinute }),
  };
}

export function savedClassGapQuery(question: string): SavedClassGapQuery | null {
  const filters = readQuestion(question);
  if (!filters || (!filters.day && !filters.part && !filters.allDay && !filters.hasClock) ||
      !isGapRequest(filters.rest, filters.minMinutes !== undefined)) return null;
  return applyFilters(filters);
}

// A follow-up may restore its filters from a previous app session. Validate before
// using an inherited period in the clock parser or reading its time boundaries.
function isValidSavedGapFilters(query: SavedClassGapQuery | null | undefined): query is SavedClassGapQuery {
  if (!query || typeof query !== 'object' ||
      !['today', 'tomorrow', 'day-after-tomorrow'].includes(query.day) ||
      !Number.isSafeInteger(query.minMinutes) || query.minMinutes < 0 || query.minMinutes > 1440 ||
      (query.part !== undefined && query.part !== 'morning' && query.part !== 'afternoon' && query.part !== 'evening') ||
      (query.fromMinute !== undefined && (!Number.isSafeInteger(query.fromMinute) ||
        query.fromMinute < 0 || query.fromMinute >= 1440)) ||
      (query.untilMinute !== undefined && (!Number.isSafeInteger(query.untilMinute) ||
        query.untilMinute <= 0 || query.untilMinute > 1440))) return false;
  const bounds = query.part ? partBounds[query.part] : undefined;
  const start = Math.max((bounds?.start ?? 0) * 60, query.fromMinute ?? 0);
  const end = Math.min((bounds?.end ?? 24) * 60, query.untilMinute ?? 1440);
  return start < end;
}

export function savedClassGapFollowUp(question: string, previous: SavedClassGapQuery): SavedClassGapQuery | null {
  if (!isValidSavedGapFilters(previous)) return null;
  const filters = readQuestion(question, previous.part);
  if (!filters || (!filters.day && !filters.part && !filters.allDay && !filters.hasClock && filters.minMinutes === undefined)) return null;
  if (filters.rest) {
    if (!isGapRequest(filters.rest, filters.minMinutes !== undefined)) return null;
    // Restating a full date-specific question starts fresh unless the student says to refine it.
    if (filters.day && !filters.refinement) return null;
  }
  return applyFilters(filters, previous);
}

/** Identify an unsupported gap lookup without claiming that a mixed action was handled. */
export function isSavedClassGapQuestion(question: string): boolean {
  const text = questionText(question).replace(gapPurpose, '');
  const noun = gapNoun.exec(text);
  return !!noun && afterGap.test(text.slice(noun.index + noun[0].length)) &&
    !/[，,；;]/.test(text) && !/(?:安排|預約|訂餐|訂便當|建立|新增|刪除|取消|提醒|送出|繳交|作業|公告|開會)/.test(text);
}

/** Only use after a verified gap reply; a bare time word must not change another conversation. */
export function isSavedClassGapRefinement(question: string): boolean {
  const normalized = questionText(question);
  if (/^(?:那麼|那|改成|改查|改看|換成|只看|只找|查看)/.test(normalized) && isSavedClassGapQuestion(question)) return true;
  const text = normalized.replace(/^(?:那麼|那)(?:就)?[，,]?/, '')
    .replace(/^(?:改成|改查|改看|換成|只看|只找|查看)/, '');
  const date = '(?:今天|今日|明天|明日|後天|後日|(?:這|下)?(?:週|星期|禮拜)[一二三四五六日天])';
  const scope = '(?:早上|上午|下午|晚上|全天|全日|整天|全部時段)';
  const length = `(?:至少|最少|超過|不超過)?(?:${numberText}|半)(?:個)?(?:半)?(?:小時|鐘頭|h|分鐘)(?:半|(?:又)?${numberText}分鐘)?(?:以上|以內|以下|後)?`;
  const clock = `(?:${clockText})(?:(?:到|至|[-–—~～])(?:${clockText})(?:之間|內)?|(?:以後|之後|後|以前|之前|前))?`;
  return new RegExp(`^(?:${date})?(?:${scope})?(?:${length}|${clock}|不限(?:長度|時長|分鐘)|不限制(?:長度|時長))$`, 'i').test(text) ||
    new RegExp(`^(?:${date})(?:${scope})?$|^${scope}$`).test(text);
}

export function savedClassGapDayOffset(day: SavedClassGapQuery['day']): number {
  return day === 'today' ? 0 : day === 'tomorrow' ? 1 : 2;
}

export function savedClassGapTitle(query: SavedClassGapQuery): string {
  return query.day === 'today' ? '今日空堂' : query.day === 'tomorrow' ? '明日空堂' : '後天空堂';
}

const clock = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const MINUTE = 60_000;
const DAY = 86_400_000;

export function answerSavedClassGapQuery(query: SavedClassGapQuery, context: OnDeviceSchoolContext) {
  const { timetable } = context;
  const reply = (content: string) => ({ tool: 'saved-timetable' as const, route: '/timetable' as const, content });
  if (timetable.source === 'unreadable') return reply('這台手機暫時讀不到已存的課表。請開啟「我的課表」重新讀取。');
  if (timetable.source === 'not-available') return reply('這台手機還沒有這個帳號的個人課表。請先在「我的課表」匯入或儲存課程。');

  // Restored follow-up filters are not trusted merely because the TypeScript type matches.
  // A damaged clock/duration must not crash the formatter or imply the student is free.
  if (!isValidSavedGapFilters(query)) {
    return reply('空堂查詢條件無法核對，請重新指定日期與時間，或開啟「我的課表」確認。');
  }
  const now = Date.parse(context.checkedAt);
  if (!Array.isArray(timetable.classGaps) || !Number.isFinite(now)) {
    return reply('這份手機課表的資料不足，無法核對課間空堂。請開啟「我的課表」確認學期和上課時間。');
  }
  // A damaged local snapshot cannot be treated as proof that a student has no free period.
  if (timetable.classGaps.some((gap) => !gap || typeof gap !== 'object' ||
    !Number.isSafeInteger(gap.startAt) || !Number.isSafeInteger(gap.endAt) || gap.startAt >= gap.endAt)) {
    return reply('這份手機課表的空堂時間資料不足，無法核對。請開啟「我的課表」重新確認上課時間。');
  }
  const offset = savedClassGapDayOffset(query.day);
  const date = classDate(new Date(now + offset * DAY));
  const midnight = Date.parse(date + 'T00:00:00+08:00');
  const label = (offset === 0 ? '今天剩下的時間' : offset === 1 ? '明天' : '後天') + '（' + date.slice(5).replace('-', '/') + '）';
  const bounds = query.part && partBounds[query.part];
  // The clock label must describe the same interval used to calculate gaps.
  // A part-of-day restriction can narrow an explicit clock range (e.g. 15:30–19:00
  // during the afternoon really means 15:30–18:00).
  const startMinute = Math.max((bounds?.start ?? 0) * 60, query.fromMinute ?? 0);
  const endMinute = Math.min((bounds?.end ?? 24) * 60, query.untilMinute ?? 1440);
  if (startMinute >= endMinute) {
    return reply('空堂查詢條件的時間範圍無效，請重新指定開始與結束時間。');
  }
  const from = Math.max(now, midnight + startMinute * MINUTE);
  const until = midnight + endMinute * MINUTE;
  const time = (minute: number) => minute === 1440 ? '24:00' : clock.format(midnight + minute * MINUTE);
  const clockFilter = query.fromMinute !== undefined && query.untilMinute !== undefined
    ? `${time(startMinute)}–${time(endMinute)}`
    : query.fromMinute !== undefined ? `${time(startMinute)} 之後`
      : query.untilMinute !== undefined ? `${time(endMinute)} 之前` : '';
  const minimum = query.minMinutes ? '至少 ' + query.minMinutes + ' 分鐘的' : '';
  // A damaged snapshot may hold duplicate or overlapping free intervals.
  // They cannot prove two separate openings, even if each timestamp looks valid.
  // Only compare intervals that occupy the requested Taiwan date.
  const dailyGaps = timetable.classGaps.map(({ startAt, endAt }) => ({
    start: Math.max(startAt, midnight),
    end: Math.min(endAt, midnight + DAY),
  })).filter(({ start, end }) => end > start).sort((a, b) => a.start - b.start);
  if (dailyGaps.some((gap, index) => index > 0 && gap.start < dailyGaps[index - 1].end)) {
    return reply('這份手機課表有重疊的空堂紀錄，無法核對可用時間。請開啟「我的課表」重新確認課程。');
  }
  // Adjacent saved gaps describe one continuous opening. Combine them before
  // checking the requested duration, or two 60-minute pieces would hide a
  // usable two-hour slot from a student asking for at least 90 minutes.
  const continuousGaps: typeof dailyGaps = [];
  for (const gap of dailyGaps) {
    const last = continuousGaps[continuousGaps.length - 1];
    if (last && last.end === gap.start) last.end = gap.end;
    else continuousGaps.push({ ...gap });
  }
  const windows = continuousGaps.map(({ start, end }) => ({
    start: Math.ceil(Math.max(start, from) / MINUTE) * MINUTE,
    end: Math.floor(Math.min(end, until) / MINUTE) * MINUTE,
  })).filter(({ start, end }) => end > start && end - start >= query.minMinutes * MINUTE);
  const saved = timetable.updatedAt && formatTaipeiDateTime(timetable.updatedAt, { seconds: false });
  const source = saved ? '依手機課表計算，課表儲存於 ' + saved + '。' : '依手機課表計算，儲存時間不詳。';
  const lines = windows.map(({ start, end }) =>
    clock.format(start) + '–' + (end === midnight + DAY ? '24:00' : clock.format(end)) + '（' + (end - start) / MINUTE + ' 分鐘）');
  return reply([
    label + (bounds?.label ?? '') + (clockFilter ? ` ${clockFilter}，` : '') +
      (windows.length ? '有 ' + windows.length + ' 段' : '沒有') + minimum + '課間空堂。',
    ...lines, source,
    '僅依已存課程之間的空檔計算，私人行程、通勤與尚未更新的課表異動仍需核對。',
  ].join('\n'));
}
