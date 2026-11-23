import type { AssistantRoleProfileId } from './assistantRoleProfiles';
import { isPersonalImportDate, isPersonalImportTime } from './imports/validation';
import { taipeiParts } from './taipeiTime';

/** A request for the user's own time, never permission to perform the work. */
export type AssistantWorkSessionIntent = {
  profileId: Exclude<AssistantRoleProfileId, 'student'>;
  mode: 'find' | 'prepare';
  title: string;
  date: string;
  from: string;
  to: string;
  minutes: number;
};

const tasks: Readonly<Record<string, AssistantWorkSessionIntent['profileId']>> = Object.freeze({
  備課: 'teacher', 批改: 'teacher', 批改作業: 'teacher',
  盤點: 'merchant', 備料: 'merchant',
  社團籌備: 'club', 行政會議: 'school',
  維護檢查: 'platform', 平台維護: 'platform',
});
const periods: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  早上: ['08:00', '12:00'], 上午: ['08:00', '12:00'],
  中午: ['11:00', '13:00'], 下午: ['13:00', '18:00'],
  晚上: ['18:00', '22:00'], 晚間: ['18:00', '22:00'],
});
const duration = '(\\d{1,3}分鐘|半小時|一小時|兩小時|二小時|三小時)';
const title = '(' + Object.keys(tasks).sort((left, right) => right.length - left.length).join('|') + ')';
const durationFirst = new RegExp(`^${duration}(?:的)?(?:空檔|空堂)?(?:的)?${title}(?:時間|時段|空檔|空堂)?$`, 'u');
const titleFirst = new RegExp(`^${title}(?:時間|時段|空檔|空堂)?(?:的)?${duration}(?:空檔|空堂)?$`, 'u');
const command = /^(?:(?:請|麻煩)(?:你)?)?(?:幫我|替我)?(安排|規劃|找)(今天|明天|後天|\d{4}[-/]\d{1,2}[-/]\d{1,2})(早上|上午|中午|下午|晚上|晚間|\d{1,2}:\d{2}(?:到|至|[-~～–—])\d{1,2}:\d{2})(.+)$/u;

function day(value: string, now: number): string | null {
  const offset = ['今天', '明天', '後天'].indexOf(value);
  if (offset >= 0) {
    const parts = taipeiParts(now);
    if (!parts || !Number.isFinite(parts.year)) return null;
    const timestamp = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset));
    return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString().slice(0, 10) : null;
  }
  const result = value.split(/[-/]/u).map((part, index) => index ? part.padStart(2, '0') : part).join('-');
  return isPersonalImportDate(result) ? result : null;
}

/** Exact, bounded personal-work requests. Missing dates, duration, windows and
 * extra commands stay unparsed; job titles and source content cannot add work. */
export function parseAssistantWorkSessionIntent(question: unknown, now = Date.now()): AssistantWorkSessionIntent | null {
  if (typeof question !== 'string' || !question.trim() || question.length > 200 ||
      !Number.isFinite(new Date(now).getTime()) || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question)) return null;
  const text = question.normalize('NFKC').trim().replace(/[。.!！?？]+$/u, '').replace(/\s+/gu, '');
  const match = command.exec(text);
  if (!match) return null;
  const [, verb, rawDate, rawWindow, body] = match;
  const first = durationFirst.exec(body), second = first ? null : titleFirst.exec(body);
  if (!first && !second) return null;
  const rawDuration = first ? first[1] : second![2], name = first ? first[2] : second![1];
  const minutes = rawDuration === '半小時' ? 30 : rawDuration === '一小時' ? 60
    : rawDuration === '兩小時' || rawDuration === '二小時' ? 120
      : rawDuration === '三小時' ? 180 : Number(rawDuration.replace('分鐘', ''));
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 180) return null;
  const selectedDate = day(rawDate, now);
  if (!selectedDate || !isPersonalImportDate(selectedDate)) return null;
  const bounds = periods[rawWindow] ?? rawWindow.split(/到|至|[-~～–—]/u).map(value => value.padStart(5, '0'));
  const [from, to] = bounds;
  if (!from || !to || !isPersonalImportTime(from) || !isPersonalImportTime(to) || from >= to) return null;
  const windowMinutes = Number(to.slice(0, 2)) * 60 + Number(to.slice(3)) - Number(from.slice(0, 2)) * 60 - Number(from.slice(3));
  if (minutes > windowMinutes) return null;
  return { profileId: tasks[name], mode: verb === '找' ? 'find' : 'prepare', title: name,
    date: selectedDate, from, to, minutes };
}
