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
export type DeadlineBucket = 'today' | 'next7Days' | 'later' | 'none';
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
  const nowDay = taipeiDayUtc(now);
  const dueDay = taipeiDayUtc(due);
  if (nowDay === null || dueDay === null) return 'none';
  const diffDays = Math.round((dueDay - nowDay) / 86_400_000);
  if (diffDays <= 0) return 'today';
  if (diffDays <= 7) return 'next7Days';
  return 'later';
}

export function selectDeadlineAxis<T extends { submitted: boolean; deadline: string | null }>(
  items: readonly T[],
  now: Date,
): { today: T[]; next7Days: T[] } {
  const today: T[] = [];
  const next7Days: T[] = [];
  for (const item of items) {
    if (item.submitted === true) continue;
    const bucket = homeworkDeadlineBucket(item.deadline, now);
    if (bucket === 'today') today.push(item);
    else if (bucket === 'next7Days') next7Days.push(item);
  }
  const byDeadline = (left: T, right: T) =>
    (homeworkDeadlineMs(left.deadline) ?? Number.POSITIVE_INFINITY) -
    (homeworkDeadlineMs(right.deadline) ?? Number.POSITIVE_INFINITY);
  today.sort(byDeadline);
  next7Days.sort(byDeadline);
  return { today, next7Days };
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

export function homeworkDescriptionText(value: unknown, max = 8_000): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
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
