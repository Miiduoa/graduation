import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import { classDate } from '@campus/shared/src/timetable/classExceptions';
import { chineseOrDecimal } from './chineseOrDecimal';
import type { OnDeviceSchoolContext } from './onDeviceSchoolContext';

type DayPart = 'morning' | 'afternoon' | 'evening';
export type SavedClassGapQuery = { day: 'today' | 'tomorrow'; minMinutes: number; part?: DayPart };

const partBounds = {
  morning: { start: 0, end: 12, label: '上午（00:00–12:00）' },
  afternoon: { start: 12, end: 18, label: '下午（12:00–18:00）' },
  evening: { start: 18, end: 24, label: '晚上（18:00–24:00）' },
};

function questionText(question: string) {
  return question.normalize('NFKC').replace(/\s+/g, '').replace(/[?!。！？，,]+$/, '')
    .replace(/^(?:請問|我想知道|想知道|幫我(?:看|查)(?:一下)?)/, '').replace(/[嗎呢啊呀]$/, '');
}

const duration = /(?:至少|最少)?(半|兩|[零一二三四五六七八九十]+|\d+)(分鐘|(?:個)?(?:小時|鐘頭))(?:以上)?/;

function readDuration(text: string) {
  const match = duration.exec(text);
  if (!match) return null;
  const quantity = match[1] === '半' ? 0.5 : chineseOrDecimal(match[1].replace('兩', '二'));
  const minutes = quantity * (match[2] === '分鐘' ? 1 : 60);
  return Number.isSafeInteger(minutes) && minutes > 0 ? { minutes, rest: text.replace(match[0], '') } : null;
}

function readScope(text: string) {
  let rest = text.replace(/^我的?/, '').replace(/^([今明])([早晚])/, (_, day, part) =>
    day + '天' + (part === '早' ? '早上' : '晚上'));
  const date = /^(今天|今日|明天|明日|接下來)/.exec(rest);
  let day: SavedClassGapQuery['day'] | undefined;
  if (date) {
    day = date[0].startsWith('明') ? 'tomorrow' : 'today';
    rest = rest.slice(date[0].length).replace(/^我的?/, '');
  }
  const period = /^(?:的)?(早上|上午|下午|晚上)/.exec(rest);
  let part: DayPart | undefined;
  if (period) {
    part = period[1] === '下午' ? 'afternoon' : period[1] === '晚上' ? 'evening' : 'morning';
    rest = rest.slice(period[0].length).replace(/^我的?/, '');
  }
  return { day, part, rest };
}

const gapNoun = /(?:空堂|空檔|空閒時段)(?:時間)?/;
const betweenClasses = /^(?:兩堂課之間|課[跟與]課之間|課間)/;
const beforeGap = /^(?:還)?(?:有沒有|是否有|有哪(?:些|幾段)|哪(?:些|幾個|幾段)|(?:什麼時候|何時|哪時(?:候)?)有|有什麼|有)?(?:一段)?的?(?:課間的?)?$/;
const afterGap = /^(?:有(?:沒有)?|是?(?:幾點(?:到幾點)?|什麼時候)|有哪些|有多(?:久|長))?$/;
const gapPurpose = /(?:可以|能)(?:吃飯|吃午餐|讀書|自習|寫作業)(?:的(?=空堂|空檔|空閒時段)|$)/;

export function savedClassGapQuery(question: string): SavedClassGapQuery | null {
  const { day, part, rest } = readScope(questionText(question));
  if (!day && !part) return null;
  let text = rest.replace(/^的?課表(?:上|裡)?/, '')
    .replace(/^(?:剩下(?:來)?的?|接下來的?)/, '');
  const between = betweenClasses.exec(text);
  if (between) text = text.slice(between[0].length);
  const threshold = readDuration(text);
  text = (threshold?.rest ?? text).replace(gapPurpose, '');
  // The class-gap request must account for the entire sentence, including its optional purpose.
  const noun = gapNoun.exec(text);
  if (noun) {
    if (!beforeGap.test(text.slice(0, noun.index)) || !afterGap.test(text.slice(noun.index + noun[0].length))) return null;
  } else if (!between || !threshold || !/^(?:還)?有(?:沒有)?$/.test(text)) {
    return null;
  }
  return { day: day ?? 'today', minMinutes: threshold?.minutes ?? 0, ...(part && { part }) };
}

export function savedClassGapFollowUp(question: string, previous: SavedClassGapQuery): SavedClassGapQuery | null {
  const { day, part, rest } = readScope(questionText(question).replace(/^(?:那麼|那)/, ''));
  const threshold = readDuration(rest);
  if ((!day && !part && !threshold) || (threshold?.rest ?? rest)) return null;
  const selectedPart = part ?? previous.part;
  return {
    day: day ?? previous.day, minMinutes: threshold?.minutes ?? previous.minMinutes,
    ...(selectedPart && { part: selectedPart }),
  };
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

  const now = Date.parse(context.checkedAt);
  if (!timetable.classGaps || !Number.isFinite(now)) {
    return reply('這份手機課表的資料不足，無法核對課間空堂。請開啟「我的課表」確認學期和上課時間。');
  }
  const tomorrow = query.day === 'tomorrow';
  const date = classDate(new Date(now + (tomorrow ? DAY : 0)));
  const midnight = Date.parse(date + 'T00:00:00+08:00');
  const label = (tomorrow ? '明天' : '今天剩下的時間') + '（' + date.slice(5).replace('-', '/') + '）';
  const bounds = query.part && partBounds[query.part];
  const from = Math.max(now, midnight + (bounds?.start ?? 0) * 60 * MINUTE);
  const until = midnight + (bounds?.end ?? 24) * 60 * MINUTE;
  const minimum = query.minMinutes ? '至少 ' + query.minMinutes + ' 分鐘的' : '';
  const windows = timetable.classGaps.map(({ startAt, endAt }) => ({
    start: Math.ceil(Math.max(startAt, from) / MINUTE) * MINUTE,
    end: Math.floor(Math.min(endAt, until) / MINUTE) * MINUTE,
  })).filter(({ start, end }) => end > start && end - start >= query.minMinutes * MINUTE)
    .sort((a, b) => a.start - b.start);
  const saved = timetable.updatedAt && formatTaipeiDateTime(timetable.updatedAt, { seconds: false });
  const source = saved ? '依手機課表計算，課表儲存於 ' + saved + '。' : '依手機課表計算，儲存時間不詳。';
  const lines = windows.map(({ start, end }) =>
    clock.format(start) + '–' + (end === midnight + DAY ? '24:00' : clock.format(end)) + '（' + (end - start) / MINUTE + ' 分鐘）');
  return reply([
    label + (bounds?.label ?? '') + (windows.length ? '有 ' + windows.length + ' 段' : '沒有') + minimum + '課間空堂。',
    ...lines, source,
  ].join('\n'));
}
