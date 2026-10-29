import { formatTaipeiDateTime, parseTaipeiInstant, taipeiParts } from './taipeiTime';

export const TRONCLASS_ORIGIN = 'https://tronclass.pu.edu.tw';
export const LMS_SNAPSHOT_TTL_MS = 10 * 60 * 1000;
export const LMS_COURSE_CONCURRENCY = 3;
export const HOMEWORK_PAGE_SIZE = 50;
export const HOMEWORK_MAX_PAGES = 20;
export const LMS_CACHE_COLLECTION = '_puTronClassLmsCache';

const NON_MATERIAL_TYPES = new Set([
  'homework',
  'exam',
  'quiz',
  'classroom',
  'live',
  'attendance',
  'survey',
  'announcement',
  'notification',
]);

export type HomeworkPageAdvance = 'continue' | 'complete' | 'incomplete';
export type DeadlineBucket = 'overdue' | 'today' | 'next7Days' | 'later' | 'none';
export type SchoolReadErrorKind = 'session' | 'unavailable';

export function isHomeworkSubmitted(homework: { submitted?: unknown }): boolean {
  return homework.submitted === true;
}

export function isHomeworkTodo(homework: { submitted?: unknown }): boolean {
  return !isHomeworkSubmitted(homework);
}

export function isUploadDownloadable(upload: { allow_download?: unknown }): boolean {
  return upload.allow_download === true;
}

export function isMobileUploadDownloadable(upload: { allow_download?: unknown }): boolean {
  return upload.allow_download !== false;
}

export function isMaterialActivityType(type: unknown): boolean {
  return !NON_MATERIAL_TYPES.has(String(type || '').toLowerCase());
}

export function isAnnouncementActivityType(type: unknown): boolean {
  const value = String(type || '').toLowerCase();
  return value === 'announcement' || value === 'notification';
}

export function tronClassCourseHref(courseId: number): string {
  return `${TRONCLASS_ORIGIN}/course/${courseId}/content`;
}

export function tronClassActivityHref(courseId: number, activityId: number): string {
  return `${TRONCLASS_ORIGIN}/course/${courseId}/content#/activity/${activityId}`;
}

export function tronClassUploadHref(uploadKey: string): string {
  return `${TRONCLASS_ORIGIN}/api/uploads/${encodeURIComponent(uploadKey)}/blob`;
}

export function homeworkPageAdvance(input: {
  page: number;
  pageSize: number;
  pageLength: number;
  accumulated: number;
  total: number | null;
  maxPages?: number;
}): HomeworkPageAdvance {
  const maxPages = input.maxPages ?? HOMEWORK_MAX_PAGES;
  if (input.page < 1 || input.pageSize < 1 || input.pageLength < 0 || input.accumulated < 0) {
    return 'incomplete';
  }
  if (input.pageLength > input.pageSize) return 'incomplete';
  if (input.total !== null) {
    if (!Number.isSafeInteger(input.total) || input.total < 0) return 'incomplete';
    if (input.accumulated > input.total) return 'incomplete';
    if (input.accumulated === input.total) return 'complete';
    if (input.pageLength === 0) return 'incomplete';
    if (input.page >= maxPages) return 'incomplete';
    return 'continue';
  }
  if (input.pageLength === 0) return input.accumulated === 0 ? 'complete' : 'incomplete';
  if (input.pageLength < input.pageSize) return 'complete';
  if (input.page >= maxPages) return 'incomplete';
  return 'continue';
}

export function homeworkDeadlineMs(deadline: string | null | undefined): number | null {
  if (typeof deadline !== 'string' || !deadline.trim()) return null;
  return parseTaipeiInstant(deadline);
}

export function formatHomeworkDeadlineTaipei(deadline: string | null | undefined): string {
  if (!deadline) return '';
  return formatTaipeiDateTime(deadline, { seconds: false });
}

function taipeiDayUtc(value: string | number | Date): number | null {
  const parts = taipeiParts(value);
  if (!parts) return null;
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

export function homeworkDeadlineBucket(
  deadline: string | null | undefined,
  now: Date,
): DeadlineBucket {
  const due = homeworkDeadlineMs(deadline);
  if (due === null) return 'none';
  if (due < now.getTime()) return 'overdue';
  const nowDay = taipeiDayUtc(now);
  const dueDay = taipeiDayUtc(due);
  if (nowDay === null || dueDay === null) return 'none';
  const diffDays = Math.round((dueDay - nowDay) / 86_400_000);
  if (diffDays === 0) return 'today';
  if (diffDays <= 7) return 'next7Days';
  return 'later';
}

export function selectDeadlineAxis<T extends { submitted: boolean; deadline: string | null }>(
  items: readonly T[],
  now: Date,
): { overdue: T[]; today: T[]; next7Days: T[] } {
  const overdue: T[] = [];
  const today: T[] = [];
  const next7Days: T[] = [];
  for (const item of items) {
    if (item.submitted === true) continue;
    const bucket = homeworkDeadlineBucket(item.deadline, now);
    if (bucket === 'overdue') overdue.push(item);
    else if (bucket === 'today') today.push(item);
    else if (bucket === 'next7Days') next7Days.push(item);
  }
  const byDeadline = (left: T, right: T) =>
    (homeworkDeadlineMs(left.deadline) ?? Number.POSITIVE_INFINITY) -
    (homeworkDeadlineMs(right.deadline) ?? Number.POSITIVE_INFINITY);
  overdue.sort(byDeadline);
  today.sort(byDeadline);
  next7Days.sort(byDeadline);
  return { overdue, today, next7Days };
}

export function classifySchoolReadError(error: unknown): SchoolReadErrorKind {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /session 已失效/.test(message) ? 'session' : 'unavailable';
}

export function schoolHttpStatus(error: unknown): number | null {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
      return status;
    }
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  const match = /^HTTP (\d{3})$/.exec(message);
  return match ? Number(match[1]) : null;
}

const DESCRIPTION_INPUT_MAX = 20_000;
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  nbsp: ' ',
  quot: '"',
  apos: "'",
};

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isHtmlSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

function lowerAscii(value: string, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i += 1) {
    const code = value.charCodeAt(i);
    out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : value.charAt(i);
  }
  return out;
}

function skipHtmlSpace(value: string, index: number): number {
  while (index < value.length && isHtmlSpace(value.charCodeAt(index))) index += 1;
  return index;
}

function skipQuoted(value: string, index: number): number {
  const quote = value.charCodeAt(index);
  index += 1;
  while (index < value.length && value.charCodeAt(index) !== quote) index += 1;
  return index < value.length ? index + 1 : index;
}

function skipUntilGt(value: string, index: number): number {
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 39) {
      index = skipQuoted(value, index);
      continue;
    }
    if (code === 62) return index + 1;
    index += 1;
  }
  return index;
}

function readTagName(value: string, index: number): { name: string; next: number } {
  const start = index;
  while (index < value.length && isAsciiLetter(value.charCodeAt(index))) index += 1;
  return { name: lowerAscii(value, start, index), next: index };
}

function skipCloseTag(value: string, index: number, name: string): number {
  let next = skipHtmlSpace(value, index + 1);
  if (value.charAt(next) !== '/') return -1;
  next = skipHtmlSpace(value, next + 1);
  if (next + name.length > value.length) return -1;
  if (lowerAscii(value, next, next + name.length) !== name) return -1;
  next += name.length;
  while (next < value.length) {
    const code = value.charCodeAt(next);
    if (code === 62) return next + 1;
    if (code === 60) return -1;
    next += 1;
  }
  return -1;
}

function skipBlockedElement(value: string, index: number, name: string): number {
  index = skipUntilGt(value, index);
  while (index < value.length) {
    if (value.charAt(index) === '<') {
      const close = skipCloseTag(value, index, name);
      if (close !== -1) return close;
    }
    index += 1;
  }
  return value.length;
}

function decodeEntity(value: string, index: number): { text: string; next: number } | null {
  if (value.charAt(index) !== '&') return null;
  const after = index + 1;
  if (value.charAt(after) === '#') {
    let cursor = after + 1;
    let code = 0;
    if (value.charAt(cursor) === 'x' || value.charAt(cursor) === 'X') {
      cursor += 1;
      const hexStart = cursor;
      while (cursor < value.length) {
        const ch = value.charCodeAt(cursor);
        const hex = ch >= 48 && ch <= 57 ? ch - 48
          : ch >= 65 && ch <= 70 ? ch - 55
            : ch >= 97 && ch <= 102 ? ch - 87 : -1;
        if (hex < 0) break;
        code = code * 16 + hex;
        cursor += 1;
        if (cursor - hexStart > 6) return null;
      }
    } else {
      const decStart = cursor;
      while (cursor < value.length && isAsciiDigit(value.charCodeAt(cursor))) {
        code = code * 10 + (value.charCodeAt(cursor) - 48);
        cursor += 1;
        if (cursor - decStart > 7) return null;
      }
    }
    if (cursor === after + 1 || value.charAt(cursor) !== ';' || code <= 0 || code > 0x10ffff) return null;
    return { text: String.fromCodePoint(code), next: cursor + 1 };
  }
  let cursor = after;
  while (cursor < value.length && cursor - after < 8 && isAsciiLetter(value.charCodeAt(cursor))) {
    cursor += 1;
  }
  if (value.charAt(cursor) !== ';') return null;
  const mapped = NAMED_ENTITIES[lowerAscii(value, after, cursor)];
  return mapped === undefined ? null : { text: mapped, next: cursor + 1 };
}

function htmlToPlainText(value: string): string {
  let index = 0;
  let out = '';
  let pendingSpace = false;
  const emit = (chunk: string) => {
    for (let i = 0; i < chunk.length; i += 1) {
      const code = chunk.charCodeAt(i);
      if (isHtmlSpace(code) || code === 160) {
        pendingSpace = out.length > 0;
        continue;
      }
      if (pendingSpace) {
        out += ' ';
        pendingSpace = false;
      }
      out += chunk.charAt(i);
    }
  };
  while (index < value.length) {
    const ch = value.charAt(index);
    if (ch === '<') {
      if (
        value.charAt(index + 1) === '!' &&
        value.charAt(index + 2) === '-' &&
        value.charAt(index + 3) === '-'
      ) {
        index += 4;
        while (index < value.length) {
          if (
            value.charAt(index) === '-' &&
            value.charAt(index + 1) === '-' &&
            value.charAt(index + 2) === '>'
          ) {
            index += 3;
            break;
          }
          index += 1;
        }
        pendingSpace = out.length > 0;
        continue;
      }
      let tagAt = skipHtmlSpace(value, index + 1);
      const closing = value.charAt(tagAt) === '/';
      if (closing) tagAt = skipHtmlSpace(value, tagAt + 1);
      const tag = readTagName(value, tagAt);
      if (!tag.name) {
        emit('<');
        index += 1;
        continue;
      }
      if (tag.name === 'script' || tag.name === 'style') {
        index = closing ? skipUntilGt(value, tag.next) : skipBlockedElement(value, tag.next, tag.name);
        pendingSpace = out.length > 0;
        continue;
      }
      index = skipUntilGt(value, tag.next);
      pendingSpace = out.length > 0;
      continue;
    }
    if (ch === '&') {
      const entity = decodeEntity(value, index);
      if (entity) {
        emit(entity.text);
        index = entity.next;
        continue;
      }
    }
    emit(ch);
    index += 1;
  }
  return out;
}

export function homeworkDescriptionText(value: unknown, max = 8_000): string {
  if (typeof value !== 'string' || max <= 0) return '';
  const input = value.length > DESCRIPTION_INPUT_MAX ? value.slice(0, DESCRIPTION_INPUT_MAX) : value;
  const text = htmlToPlainText(input);
  return text.length > max ? text.slice(0, max) : text;
}

export function cacheStillFresh(expiresAt: unknown, nowMs: number): boolean {
  if (expiresAt instanceof Date) return expiresAt.getTime() > nowMs;
  if (typeof expiresAt === 'string') {
    const time = Date.parse(expiresAt);
    return Number.isFinite(time) && time > nowMs;
  }
  if (expiresAt && typeof expiresAt === 'object' && 'toDate' in expiresAt) {
    const toDate = (expiresAt as { toDate?: unknown }).toDate;
    if (typeof toDate === 'function') {
      const date = toDate.call(expiresAt);
      return date instanceof Date && date.getTime() > nowMs;
    }
  }
  return false;
}
