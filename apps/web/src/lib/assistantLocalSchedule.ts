'use client';

import { buildPersonalToday, type PersonalTodayEntry } from '@campus/shared/src/imports/today';
import type { PersonalImportRecord } from '@campus/shared/src/imports/types';
import { exclusiveAllDayEnd } from '@campus/shared/src/imports/eventCalendar';
import {
  classDate,
  manualClassRecords,
  validClassDate,
  withClassExceptions,
} from '@campus/shared/src/timetable/classExceptions';
import type { AssistantServiceId } from '@campus/shared/src/assistantServices';
import { readPersonalImports, type PersonalImportScope } from './personalImports';
import { readPersonalTimetableOnDevice } from './timetable/store';

type DayPart = 'morning' | 'noon' | 'afternoon' | 'evening';
export type LocalScheduleIntent = {
  kind: 'classes' | 'next-class' | 'events';
  day: number | string;
  part?: DayPart;
};
type LocalScheduleAnswer = {
  content: string;
  serviceIds: AssistantServiceId[];
  availability: 'available' | 'missing' | 'unavailable';
};

const DAY_MS = 86_400_000;
const PARTS: Readonly<Record<string, DayPart>> = {
  早上: 'morning', 上午: 'morning', 中午: 'noon', 下午: 'afternoon', 晚上: 'evening', 夜間: 'evening',
};
const PART_WINDOWS: Readonly<Record<DayPart, readonly [string, string]>> = {
  morning: ['00:00', '12:00'], noon: ['11:00', '14:00'],
  afternoon: ['12:00', '18:00'], evening: ['18:00', '24:00'],
};
const PART_LABELS: Readonly<Record<DayPart, string>> = {
  morning: '上午', noon: '中午', afternoon: '下午', evening: '晚上',
};

/** Only complete read questions are local; mixed requests and mutations keep their task handlers. */
export function parseLocalScheduleIntent(question: string): LocalScheduleIntent | null {
  if (question.length > 160 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(question)) return null;
  let text = question.normalize('NFKC').trim().replace(/[?!.。]+$/u, '').trim();
  text = text.replace(/^(?:(?:請問|請|麻煩)(?:你)?\s*)?(?:(?:可以|能不能|可不可以)(?:幫我|告訴我)?\s*)?(?:(?:幫我|替我|我想知道|我想看|我要看)\s*)?(?:(?:查詢|查看|查一下|看一下|看看|告訴我|列出)\s*)?/u, '');
  text = text.replace(/(?:好嗎|可以嗎|謝謝)$/u, '').trim();
  // No quoted tasks, extra clauses or hidden second action may be swallowed here.
  if (/[「」『』“”"'`,，;；]|新增|加入|建立|安排|預約|修改|刪除|取消|提醒|順便|然後|並且|作業|測驗|教材/.test(text)) return null;
  if (/^(?:我(?:的)?)?(?:下一堂|下堂|接下來一堂)(?:課|課程)?(?:的)?(?:是(?:什麼|哪一堂|哪堂)(?:課)?|在(?:哪裡|哪|哪個教室)|教室(?:在哪裡|在哪|是什麼)?|幾點(?:開始|上課)?|什麼時間)?$/u.test(text))
    return { kind: 'next-class', day: 0 };
  const match = /^(?:我(?:的)?)?(今天|今日|明天|明日|後天|\d{4}-\d{2}-\d{2})(早上|上午|中午|下午|晚上|夜間)?(?:我)?(?:的)?(.+)$/u.exec(text);
  if (!match) return null;
  const day = /^\d/.test(match[1]) ? match[1]
    : /明天|明日/.test(match[1]) ? 1 : match[1] === '後天' ? 2 : 0;
  if (typeof day === 'string' && !validClassDate(day)) return null;
  const part = match[2] ? PARTS[match[2]] : undefined;
  const rest = match[3];
  if (/^(?:課表(?:有哪些|有什麼|是什麼)?|(?:要上|有|上)?(?:哪些|什麼|幾堂|幾節|哪幾堂|哪幾節)?(?:課|課程)(?:的)?(?:時間|教室|在哪裡|在哪|幾點|幾點開始|有哪些|有什麼|嗎)?|要上課嗎)$/u.test(rest))
    return { kind: 'classes', day, ...(part ? { part } : {}) };
  if (/^(?:(?:有|要做)?(?:哪些|什麼|幾個)?(?:行程|個人事件|個人活動|行事曆|日曆)(?:有哪些|有什麼|是什麼|時間|嗎)?)$/u.test(rest))
    return { kind: 'events', day, ...(part ? { part } : {}) };
  return null;
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(date + 'T12:00:00+08:00') + days * DAY_MS).toISOString().slice(0, 10);
const stamp = (now: Date) => new Date(now.getTime() + 28_800_000).toISOString().slice(0, 16).replace('T', ' ');
// Local answers render as plain React text, so source punctuation remains literal.
const safeText = (value: string) => value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').trim();
const dayLabel = (date: string) => date + '（週' + '日一二三四五六'[new Date(date + 'T12:00:00+08:00').getUTCDay()] + '）';

function inPart(start: number, end: number, day: string, part?: DayPart): boolean {
  if (!part) return true;
  const [from, to] = PART_WINDOWS[part];
  const lower = Date.parse(day + 'T' + from + ':00+08:00');
  const upper = to === '24:00' ? Date.parse(addDays(day, 1) + 'T00:00:00+08:00')
    : Date.parse(day + 'T' + to + ':00+08:00');
  return start < upper && end > lower;
}

function classLine(entry: PersonalTodayEntry): string {
  const location = entry.row.location?.trim() ? safeText(entry.row.location) : '教室未填';
  const teacher = entry.row.teacher?.trim() ? `；教師：${safeText(entry.row.teacher)}` : '';
  const startDay = classDate(new Date(entry.startAt));
  const endDay = classDate(new Date(entry.endAt));
  const time = startDay === endDay ? `${entry.startTime}–${entry.endTime}`
    : `${startDay} ${entry.startTime}–${endDay} ${entry.endTime}`;
  return `${time}\u3000${safeText(entry.row.title)}；教室：${location}${teacher}${entry.conflict ? '（時段重疊，請核對）' : ''}`;
}

function timetableAnswer(
  intent: LocalScheduleIntent,
  records: PersonalImportRecord[],
  schoolId: string,
  now: Date,
): Pick<LocalScheduleAnswer, 'content' | 'availability'> {
  const date = typeof intent.day === 'string' ? intent.day : addDays(classDate(now), intent.day);
  const view = buildPersonalToday(records, { schoolId, now: new Date(date + 'T12:00:00+08:00') });
  if (!view.terms.length)
    return { availability: 'missing', content: '還沒讀到這個帳號在此瀏覽器保存的課表，無法判定當天是否有課。匯入或手動保存課表後，就能直接問時間與教室。' };
  const term = view.terms.find((item) => item.key === view.termKey)!;
  const termLabel = term.academicYear === '未填' && term.semester === '未填'
    ? '手動課表（未填學期）' : `${term.academicYear} 學年度第 ${term.semester} 學期`;
  const source = `依此瀏覽器保存的 ${termLabel} 週課表與已記錄的單次調整整理；未記錄的停課、補課不包含在內。`;
  const incomplete = view.unplacedCount ? `\n另有 ${view.unplacedCount} 筆課程的星期或時間尚未填妥，這些課程未列入。` : '';
  if (intent.kind === 'next-class') {
    let next: PersonalTodayEntry | undefined;
    let nextDay = date;
    for (let offset = 0; offset < 8 && !next; offset++) {
      nextDay = addDays(date, offset);
      next = buildPersonalToday(records, {
        schoolId, termKey: view.termKey, now: new Date(nextDay + 'T12:00:00+08:00'),
      }).today.find((entry) => entry.startAt >= now.getTime() && entry.startAt <= now.getTime() + 7 * DAY_MS);
    }
    return { availability: 'available', content: next
      ? `週課表中的下一堂：${dayLabel(nextDay)}\n${classLine(next)}\n\n${source}${incomplete}`
      : `這份週課表在接下來 7 天內沒有找到尚未開始的課程。\n\n${source}${incomplete}` };
  }
  const entries = view.today.filter((entry) => inPart(entry.startAt, entry.endAt, date, intent.part));
  return { availability: 'available', content: [
    `${dayLabel(date)}${intent.part ? PART_LABELS[intent.part] : ''}的課表：`,
    entries.length ? entries.slice(0, 40).map((entry) => `• ${classLine(entry)}`).join('\n') +
      (entries.length > 40 ? `\n另有 ${entries.length - 40} 筆課程，可在完整課表核對。` : '')
      : '這份週課表在查詢時段沒有排課。',
    '', source + incomplete,
  ].join('\n') };
}

function eventAnswer(intent: LocalScheduleIntent, records: PersonalImportRecord[], now: Date): string {
  const date = typeof intent.day === 'string' ? intent.day : addDays(classDate(now), intent.day);
  const from = Date.parse(date + 'T00:00:00+08:00');
  const to = from + DAY_MS;
  const events = records.filter((row) => row.kind === 'events' && row.date).map((row) => {
    const allDay = row.allDay ?? !row.startTime;
    const start = Date.parse(`${row.date}T${allDay ? '00:00' : row.startTime}:00+08:00`);
    const endDate = allDay ? exclusiveAllDayEnd(row.date!, row.endDate) : row.endDate || row.date;
    const end = Date.parse(`${endDate}T${allDay ? '00:00' : row.endTime}:00+08:00`);
    return { row, allDay, start, end };
  }).filter((item) => item.start < to && item.end > from && inPart(item.start, item.end, date, intent.part))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const lines = events.slice(0, 40).map(({ row, allDay, start, end }) => {
    const time = allDay ? '全天' : `${start < from ? row.date + ' ' : ''}${row.startTime}–${end > to ? (row.endDate || row.date) + ' ' : ''}${row.endTime}`;
    return `• ${time}\u3000${safeText(row.title)}${row.location?.trim() ? `；地點：${safeText(row.location)}` : ''}`;
  });
  return `${dayLabel(date)}${intent.part ? PART_LABELS[intent.part] : ''}的個人行程：\n${lines.length ? lines.join('\n') : '此瀏覽器保存的個人事件中，查詢時段沒有紀錄。'}${events.length > 40 ? `\n另有 ${events.length - 40} 筆個人事件，可在行事曆核對。` : ''}\n\n來源：此帳號在此瀏覽器保存的個人事件；未同步到這台裝置的行程不包含在內。`;
}

export function answerLocalSchedule(
  intent: LocalScheduleIntent,
  scope: PersonalImportScope,
  now = new Date(),
): LocalScheduleAnswer {
  const serviceIds: AssistantServiceId[] = intent.kind === 'events' ? ['calendar', 'import'] : ['timetable', 'import'];
  if (!/^(?:platform|school):[^\s:][^\r\n]{0,199}$/.test(scope.owner))
    return { content: '請先登入目前使用的帳號，才能核對這個帳號保存的課表與個人行程。', serviceIds, availability: 'unavailable' };
  if (!Number.isFinite(now.getTime()))
    return { content: '目前無法確認裝置日期，請確認系統時間後重試。', serviceIds, availability: 'unavailable' };
  try {
    const imported = readPersonalImports(scope);
    let answer: Pick<LocalScheduleAnswer, 'content' | 'availability'>;
    if (intent.kind === 'events') {
      answer = imported.some((row) => row.kind === 'events')
        ? { availability: 'available', content: eventAnswer(intent, imported, now) }
        : { availability: 'missing', content: '還沒讀到這個帳號在此瀏覽器保存的個人事件，無法判定當天是否有行程。' };
    } else {
      const local = readPersonalTimetableOnDevice(scope.schoolId, scope.owner);
      const records = withClassExceptions(
        [...imported, ...(local.found ? manualClassRecords(local.timetable) : [])],
        local.timetable.classExceptions,
      );
      answer = timetableAnswer(intent, records, scope.schoolId, now);
    }
    return { ...answer, content: answer.content + `\n裝置資料讀取時間：${stamp(now)}（台灣時間）。`, serviceIds };
  } catch {
    return { content: '這個帳號的裝置資料暫時讀不到，無法確認課程或行程；原資料仍保留，請稍後重試。', serviceIds, availability: 'unavailable' };
  }
}
