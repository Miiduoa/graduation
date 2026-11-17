import { findSchoolById } from '@campus/shared/src/schools';
import { canonical, V2Error } from './contracts';

export type TeachingArguments = { limit?: number };
export type TeachingWork = {
  id: string;
  title: string;
  state: 'open' | 'closed';
  dueAt: string | null;
  receivedCount: number;
};
export type TeachingCourse = {
  workspaceId: string;
  schoolId: string;
  title: string;
  memberRole: 'owner-teacher';
  assignments: TeachingWork[];
  quizzes: TeachingWork[];
  partial: boolean;
  href: string;
};
export const TEACHING_PARTIAL_REASONS = [
  'course-limit', 'api-budget', 'scope-unverified', 'source-unavailable', 'work-limit',
] as const;
export type TeachingPartialReason = typeof TEACHING_PARTIAL_REASONS[number];
export type TeachingRead = {
  version: 1;
  source: 'platform-teaching';
  schoolId: string;
  checkedAt: string;
  query: { limit: number };
  status: 'ready' | 'unavailable';
  courses: TeachingCourse[];
  partial: boolean;
  partialReasons: TeachingPartialReason[];
  /** Account teaching workspaces not yet scoped/read; null means the list failed. */
  unreadCourseCount: number | null;
  href: '/classroom';
  unavailable?: 'NOT_CONNECTED' | 'SOURCE_UNAVAILABLE' | 'SCOPE_UNVERIFIED' | 'API_BUDGET';
};

function record(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(raw))) throw new Error('Invalid record');
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== 'string' || !keys.includes(key)) throw new Error('Unknown field');
    const descriptor = Object.getOwnPropertyDescriptor(raw, key)!;
    if (!descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined)
      throw new Error('Invalid field');
    result[key] = descriptor.value;
  }
  return result;
}
function list(raw: unknown, max: number): unknown[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > max)
    throw new Error('Invalid array');
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(descriptors).length !== raw.length + 1) throw new Error('Invalid array fields');
  const values: unknown[] = [];
  for (let index = 0; index < raw.length; index++) {
    const item = descriptors[String(index)];
    if (!item || !item.enumerable || !('value' in item)) throw new Error('Invalid array item');
    values.push(item.value);
  }
  return values;
}

/** Role and school are supplied by authenticated membership, never tool arguments. */
export function parseTeachingArguments(raw: unknown): { limit: number } {
  try {
    const value = record(raw, ['limit']);
    const limit = Object.hasOwn(value, 'limit') ? value.limit : 3;
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 3) throw new Error('Invalid limit');
    return { limit: Number(limit) };
  } catch { throw new V2Error(422, 'TEACHING_INVALID_INPUT'); }
}

/** Whole, unfiltered reads only. Never discard a named course, date, write or negation. */
export function parseTeachingRead(question: string): { tool: 'get_teaching_overview'; args: TeachingArguments } | null {
  if (typeof question !== 'string' || !question.trim() || question.length > 160 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question)) return null;
  let value = question.normalize('NFKC').trim().replace(/[。！？!?]+$/, '').replace(/\s+/g, '');
  value = value.replace(/^(?:(?:麻煩你|麻煩|請問|請|幫我|替我|我想|想|查詢|查看|查一下|看一下|看看|列出|顯示|查|看|核對|目前的|目前))*/, '');
  value = value.replace(/(?:有哪些|有什麼|如何|怎麼樣|資訊|資料)?(?:嗎|呢)?$/, '');
  if (!/^(?:(?:我的|本人|我)(?:授課|教學|負責授課)(?:的)?(?:課程|課務|作業|測驗)?(?:概況|摘要|總覽|狀況|進度)?|(?:教師|老師|授課|教學)(?:工作|課務)?(?:概況|摘要|總覽)|(?:我教|我開)的課(?:程)?(?:概況|摘要|總覽|作業|測驗)?)$/.test(value)) return null;
  return { tool: 'get_teaching_overview', args: {} };
}

function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string' || !raw.trim() || raw !== raw.trim() || raw.length > max ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(raw)) throw new Error('Invalid text');
  return raw;
}
function instant(raw: unknown): string {
  const value = cleanText(raw, 40);
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    throw new Error('Invalid instant');
  return value;
}
function identifier(raw: unknown, prefix: string): string {
  const value = cleanText(raw, 40);
  if (!new RegExp(`^${prefix}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, 'u').test(value))
    throw new Error('Invalid identifier');
  return value;
}
function work(raw: unknown, prefix: 'cwa' | 'cwq'): TeachingWork[] {
  const parsed = list(raw, 5).map(item => {
    const value = record(item, ['id', 'title', 'state', 'dueAt', 'receivedCount']);
    if (!['open', 'closed'].includes(String(value.state)) || !Number.isSafeInteger(value.receivedCount) ||
        Number(value.receivedCount) < 0) throw new Error('Invalid work status');
    return { id: identifier(value.id, prefix), title: cleanText(value.title, 160),
      state: value.state as TeachingWork['state'], dueAt: value.dueAt === null ? null : instant(value.dueAt),
      receivedCount: Number(value.receivedCount) };
  });
  if (new Set(parsed.map(item => item.id)).size !== parsed.length) throw new Error('Duplicate work');
  return parsed;
}

/** Revalidate the fixed-school projection; student answers and identities are never accepted. */
export function parseTeachingResult(raw: unknown, schoolId: string, args: unknown = {}): TeachingRead {
  try {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(schoolId) || schoolId === 'personal') throw new Error('Invalid school');
    const query = parseTeachingArguments(args);
    const value = record(raw, ['version', 'source', 'schoolId', 'checkedAt', 'query', 'status', 'courses',
      'partial', 'partialReasons', 'unreadCourseCount', 'href', 'unavailable']);
    const rawCourses = list(value.courses, query.limit);
    const partialReasons = list(value.partialReasons, TEACHING_PARTIAL_REASONS.length);
    if (value.version !== 1 || value.source !== 'platform-teaching' || value.schoolId !== schoolId ||
        canonical(parseTeachingArguments(value.query)) !== canonical(query) || value.href !== '/classroom' ||
        !['ready', 'unavailable'].includes(String(value.status)) || typeof value.partial !== 'boolean' ||
        partialReasons.some(reason => !TEACHING_PARTIAL_REASONS.includes(reason as TeachingPartialReason)) ||
        new Set(partialReasons).size !== partialReasons.length ||
        value.partial !== (partialReasons.length > 0) ||
        (value.unreadCourseCount !== null && (!Number.isSafeInteger(value.unreadCourseCount) ||
          Number(value.unreadCourseCount) < 0 || Number(value.unreadCourseCount) > 5000)) ||
        (value.unreadCourseCount !== 0 && !value.partial)) throw new Error('Invalid scope');
    const courses = rawCourses.map(rawCourse => {
      const course = record(rawCourse, ['workspaceId', 'schoolId', 'title', 'memberRole', 'assignments', 'quizzes', 'partial', 'href']);
      const workspaceId = identifier(course.workspaceId, 'cw');
      if (course.schoolId !== schoolId || course.memberRole !== 'owner-teacher' || typeof course.partial !== 'boolean' ||
          course.href !== `/classroom/course/${workspaceId}` || (course.partial && !partialReasons.includes('work-limit')))
        throw new Error('Invalid course scope');
      return { workspaceId, schoolId, title: cleanText(course.title, 200), memberRole: 'owner-teacher' as const,
        assignments: work(course.assignments, 'cwa'), quizzes: work(course.quizzes, 'cwq'),
        partial: course.partial, href: course.href as string };
    });
    if (new Set(courses.map(course => course.workspaceId)).size !== courses.length ||
        (partialReasons.includes('work-limit') && !courses.some(course => course.partial)) ||
        (courses.length > 0 && value.unreadCourseCount === null)) throw new Error('Invalid coverage');
    if (value.status === 'unavailable' ? courses.length > 0 || !value.partial ||
      !['NOT_CONNECTED', 'SOURCE_UNAVAILABLE', 'SCOPE_UNVERIFIED', 'API_BUDGET'].includes(String(value.unavailable))
      : value.unavailable !== undefined || (!courses.length && value.partial)) throw new Error('Invalid availability');
    return { version: 1, source: 'platform-teaching', schoolId, checkedAt: instant(value.checkedAt), query,
      status: value.status as TeachingRead['status'], courses, partial: value.partial,
      partialReasons: partialReasons as TeachingPartialReason[], unreadCourseCount: value.unreadCourseCount as number | null, href: '/classroom',
      ...(value.unavailable ? { unavailable: value.unavailable as TeachingRead['unavailable'] } : {}) };
  } catch { throw new V2Error(502, 'INVALID_TEACHING_RESULT'); }
}

const taipeiTime = (value: string) => new Date(Date.parse(value) + 28800000).toISOString().slice(0, 16).replace('T', ' ');
function excerpt(value: string, max: number): string {
  const plain = value.replace(/<[^>]*>/g, ' ').replace(/[\\`*_{}[\]()#+!>|]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > max ? plain.slice(0, max - 1) + '…' : plain;
}

/** Counts come from course activity summaries, never the teacher's own submission. */
export function formatTeachingRead(read: TeachingRead): string {
  const lines = [`校園：${findSchoolById(read.schoolId)?.name || read.schoolId}；查詢時間：${taipeiTime(read.checkedAt)}（台北）。`,
    '範圍：已核對校園的本人負責授課課程。來源：/classroom'];
  if (read.unreadCourseCount) lines.push(`另有 ${read.unreadCourseCount} 個授課工作區尚未核對校園或讀取內容，未列入本次摘要。`);
  if (read.status === 'unavailable') {
    lines.push(read.unavailable === 'SCOPE_UNVERIFIED' ? '授課身分或課程所屬校園尚未核對完成，目前無法確認課務內容。'
      : read.unavailable === 'API_BUDGET' ? '本次查詢額度不足，授課課務尚未讀取，請再查一次。'
        : '授課課務來源目前無法核對，請稍後重試。');
    return lines.join('\n');
  }
  if (read.partial) lines.push('這是部分課務摘要；其他課程、未核對範圍或未展開的作業測驗仍需從課程頁查看。');
  if (!read.courses.length) {
    lines.push('此帳號目前沒有可供本工具讀取的有效負責授課課程。');
    return lines.join('\n');
  }
  lines.push('已交／已答數來自課程摘要，尚未查核批閱狀態與全班缺交人數。');
  for (const course of read.courses) {
    const linesBefore = lines.length;
    lines.push(`【${excerpt(course.title, 55)}】\n${course.href}`);
    const items = [...course.assignments.map(item => ({ ...item, kind: '作業', countLabel: '已交' })),
      ...course.quizzes.map(item => ({ ...item, kind: '測驗', countLabel: '已答' }))]
      .sort((a, b) => (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity));
    if (!items.length) lines.push('目前已讀取的課程沒有作業或測驗。');
    let shown = 0;
    for (const item of items) {
      const state = item.state === 'closed' ? '已關閉' : item.dueAt && item.dueAt <= read.checkedAt ? '仍開放，已過截止' : '開放中';
      const entry = `・${item.kind} ${excerpt(item.title, 45)}｜${state}｜${item.dueAt ? '截止 ' + taipeiTime(item.dueAt) : '未設截止'}｜${item.countLabel} ${item.receivedCount}`;
      if (shown >= 3 || lines.join('\n').length + entry.length > 1000) break;
      lines.push(entry); shown++;
    }
    if (shown < items.length || course.partial) lines.push('其餘作業與測驗請從課程頁核對。');
    if (lines.join('\n').length > 1100) { lines.splice(linesBefore); lines.push('其餘已讀取課程請從來源頁核對。'); break; }
  }
  return lines.join('\n');
}
