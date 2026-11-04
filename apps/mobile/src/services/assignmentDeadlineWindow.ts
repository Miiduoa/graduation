import { taipeiDayNumber } from './campusStudyAgenda';

const DAY_MS = 86_400_000;
const WEEKDAYS = '一二三四五六日';
const PERIOD = /[上下本這]?(?:週|周|星期|禮拜)[一二三四五六日天末]?|今天|今日|明天|明日|後天|昨天|昨日|(?:接下來|未來)\s*[七7]\s*天/g;

export function stripAssignmentDeadlinePeriods(question: string): string {
  return question.replace(PERIOD, ' ');
}

export type AssignmentDeadlineWindow = { startDay: number; endDay: number; label: string };

export function resolveAssignmentDeadlineWindow(question: string, timestamp: number): AssignmentDeadlineWindow | null {
  const window = parseAssignmentDeadlineWindow(question, timestamp);
  return window === 'clarify' ? null : window;
}

/** Weeks run Monday through Sunday, including earlier deadlines in the requested week. */
export function parseAssignmentDeadlineWindow(question: string, timestamp: number): AssignmentDeadlineWindow | 'clarify' | null {
  // A literal title can contain calendar words without imposing a deadline window.
  const text = question.replace(/「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"/g, ' ');
  const periods = text.match(PERIOD);
  if (/(?:下下|上上)(?:週|周|星期|禮拜)|大後天|今明|明後|昨今|(?:未來|接下來)\s*(?![七7]\s*天)[一二兩三四五六八九十\d]+\s*天|\d{1,2}\s*月\s*\d{1,2}\s*[日號]|\d{1,4}[-/]\d{1,2}/.test(text)) return 'clarify';
  if (!periods) return null;
  if (periods.length !== 1) return 'clarify';
  const calendarTail = text.slice(text.indexOf(periods[0]) + periods[0].length).trimStart();
  if (/^(?:之|以)?[前後]|^(?:到|至|起|底|早上|上午|中午|下午|晚上|凌晨|[零一二三四五六七八九十\d]+\s*[點時:：])/.test(calendarTail)) return 'clarify';
  const day = taipeiDayNumber(timestamp);
  if (!Number.isFinite(day)) return null;
  const label = periods[0];
  let start = day;
  let length = 1;
  if (/明天|明日/.test(label)) start += 1;
  else if (label === '後天') start += 2;
  else if (/昨天|昨日/.test(label)) start -= 1;
  else if (/接下來|未來/.test(label)) length = 7;
  else if (/週|周|星期|禮拜/.test(label)) {
    const weekday = (new Date(day * DAY_MS).getUTCDay() + 6) % 7;
    start = day - weekday + (label.startsWith('下') ? 7 : label.startsWith('上') ? -7 : 0);
    const last = label.slice(-1).replace('天', '日');
    const wantedDay = WEEKDAYS.indexOf(last);
    if (last === '末') {
      start += 5;
      length = 2;
    } else if (wantedDay >= 0) start += wantedDay;
    else if (label.length > 1 && /^[上下本這]/.test(label)) length = 7;
    else return null;
  }
  return { startDay: start, endDay: start + length, label };
}
