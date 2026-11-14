import { NuniError } from '@campus/shared/src/nuni';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import {
  HOMEWORK_MAX_PAGES,
  HOMEWORK_PAGE_SIZE,
  classifySchoolReadError,
  formatHomeworkDeadlineTaipei,
  homeworkDescriptionText,
  homeworkPageAdvance,
  isAnnouncementActivityType,
  isMaterialActivityType,
  schoolHttpStatus,
  tronClassActivityHref,
  tronClassCourseHref,
  tronClassUploadHref,
} from '@campus/shared/src/puLmsReadonly';
import type {
  TronClassCourseSummary,
  TronClassHomeworkItem,
  TronClassSnapshot,
  TronClassSyncError,
} from '../tronClassIntegrationTypes';
import type { LmsReadonlySource } from './tronClassLmsSource';
import { tronClassLmsReadonlySource } from './tronClassLmsSource';
import { createTronClassBindingService } from './tronClassBinding';

const MAX_OVERVIEW_COURSES = 40;
const READ_BUDGET_MS = 50_000;
const MAX_FEED_ITEMS = 5_000;

type BindingReader = Pick<ReturnType<typeof createTronClassBindingService>, 'requireBinding' | 'assertCurrent'>;
type Source = LmsReadonlySource;
type CourseContents = Pick<TronClassSnapshot, 'announcements' | 'materials' | 'errors'>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function positiveId(value: unknown): number | null {
  const id = typeof value === 'number' ? value
    : typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function time(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 80) return null;
  const instant = parseTaipeiInstant(value);
  return instant === null ? null : new Date(instant).toISOString();
}

function requireAuthorized(status: number | null): void {
  if (status === 401) throw new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED');
}

function rethrowSession(error: unknown): void {
  if (error instanceof NuniError && [401, 403, 409].includes(error.status)) throw error;
  if (classifySchoolReadError(error) === 'session' || schoolHttpStatus(error) === 401) {
    throw new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED');
  }
}

function parseCourses(raw: unknown): TronClassCourseSummary[] {
  if (!Array.isArray(raw) || raw.length > 1000) throw new NuniError(502, 'TRONCLASS_INVALID_SOURCE');
  const seen = new Set<number>();
  return raw.map((value) => {
    const row = record(value);
    const id = positiveId(row.id);
    const name = text(row.name);
    if (!id || !name || seen.has(id)) throw new NuniError(502, 'TRONCLASS_INVALID_SOURCE');
    seen.add(id);
    const semester = record(row.semester);
    const teachers = Array.isArray(row.teachers) ? row.teachers : Array.isArray(row.instructors) ? row.instructors : [];
    return {
      id, name, code: text(row.course_code, 100),
      teachers: teachers.slice(0, 30).map((person) => text(record(person).name, 100)).filter(Boolean),
      semester: text(row.semester, 100) || text(semester.name, 100) || text(semester.code, 100) || null,
      status: text(row.status, 40), href: tronClassCourseHref(id),
    };
  });
}

function parseHomework(raw: unknown, course: TronClassCourseSummary): TronClassHomeworkItem | null {
  const row = record(raw);
  const id = positiveId(row.id);
  const title = text(row.title || row.name);
  if (!id || !title || (row.course_id !== undefined && positiveId(row.course_id) !== course.id)) return null;
  const deadline = time(row.deadline) || time(row.end_time);
  return {
    id, courseId: course.id, courseName: course.name, title, deadline,
    deadlineLabel: formatHomeworkDeadlineTaipei(deadline),
    // A draft or an unrecognised response must never be labelled as submitted.
    submitted: typeof row.submitted === 'boolean' ? row.submitted : null,
    description: homeworkDescriptionText(record(row.data).description ?? row.description),
    href: tronClassActivityHref(course.id, id),
  };
}

function courseError(course: TronClassCourseSummary, area: TronClassSyncError['area']): TronClassSyncError {
  const names = { homework: '作業', materials: '教材', announcements: '公告', courses: '課程' };
  return { courseId: course.id, area, message: `${course.name}的${names[area]}尚未完整讀取，請重新整理。` };
}

async function readHomework(
  source: Source, cookies: Record<string, string>, course: TronClassCourseSummary,
  check: () => Promise<void>,
): Promise<{ homework: TronClassHomeworkItem[]; errors: TronClassSyncError[] }> {
  const items: TronClassHomeworkItem[] = [];
  const seen = new Set<number>();
  try {
    for (let page = 1; page <= HOMEWORK_MAX_PAGES; page++) {
      await check();
      const response = await source.fetchHomeworkPage(cookies, course.id, page, HOMEWORK_PAGE_SIZE);
      if (!response.ok) {
        requireAuthorized(response.status);
        return { homework: [], errors: [courseError(course, 'homework')] };
      }
      const rows = response.value.homework_activities;
      if (!Array.isArray(rows) || rows.length > HOMEWORK_PAGE_SIZE) throw new Error('Invalid homework page');
      for (const raw of rows) {
        const item = parseHomework(raw, course);
        if (!item || seen.has(item.id)) throw new Error('Invalid or repeated homework');
        seen.add(item.id);
        items.push(item);
      }
      const next = homeworkPageAdvance({
        page, pageSize: HOMEWORK_PAGE_SIZE, pageLength: rows.length,
        accumulated: items.length, total: response.value.total,
      });
      if (next === 'complete') return { homework: items, errors: [] };
      if (next === 'incomplete') break;
    }
  } catch (error) {
    rethrowSession(error);
  }
  return { homework: [], errors: [courseError(course, 'homework')] };
}

function announcement(raw: unknown, course: TronClassCourseSummary, source: 'course' | 'activity') {
  const row = record(raw);
  const id = positiveId(row.id);
  const title = text(row.title || row.name);
  if (!id || !title || (row.course_id !== undefined && positiveId(row.course_id) !== course.id)) return null;
  return {
    id: `${source}:${course.id}:${id}`, courseId: course.id, courseName: course.name, title,
    content: homeworkDescriptionText(row.content ?? record(row.data).description ?? row.description),
    publishedAt: time(row.created_at) || time(row.publish_time), source,
    href: source === 'activity' ? tronClassActivityHref(course.id, id) : tronClassCourseHref(course.id),
  };
}

function material(raw: unknown, course: TronClassCourseSummary) {
  const row = record(raw);
  const id = positiveId(row.id);
  const title = text(row.title || row.name);
  const type = text(row.type, 40);
  if (!id || !title || !type || !isMaterialActivityType(type) ||
    (row.course_id !== undefined && positiveId(row.course_id) !== course.id)) return null;
  const uploads = Array.isArray(row.uploads) ? row.uploads : Array.isArray(row.attachments) ? row.attachments : [];
  const files = uploads.slice(0, 30).flatMap((item) => {
    const file = record(item);
    const name = text(file.name || file.filename, 200);
    if (!name) return [];
    const key = text(file.key || file.file_key || file.upload_id, 200);
    const allowDownload = file.allow_download === true;
    return [{ name, allowDownload, downloadHref: allowDownload && key ? tronClassUploadHref(key) : null }];
  });
  return { id, courseId: course.id, courseName: course.name, title, type, files, href: tronClassActivityHref(course.id, id) };
}

async function readContents(
  source: Source, cookies: Record<string, string>, course: TronClassCourseSummary,
  check: () => Promise<void>,
): Promise<CourseContents> {
  await check();
  const load = async <T>(request: () => Promise<T>) => {
    try { return await request(); }
    catch (error) { rethrowSession(error); return { ok: false as const, status: schoolHttpStatus(error) }; }
  };
  const [activities, courseware, notices] = await Promise.all([
    load(() => source.fetchActivities(cookies, course.id, '')),
    load(() => source.fetchActivities(cookies, course.id, 'type=courseware_activity')),
    load(() => source.fetchCourseAnnouncements(cookies, course.id)),
  ]);
  await check();
  for (const response of [activities, courseware, notices]) if (!response.ok) requireAuthorized(response.status);
  const errors: TronClassSyncError[] = [];
  if (!activities.ok || (!courseware.ok && courseware.status !== 404)) errors.push(courseError(course, 'materials'));
  if (!notices.ok && notices.status !== 404) errors.push(courseError(course, 'announcements'));
  for (const result of [activities, courseware, notices]) {
    if (result.ok && (!Array.isArray(result.value) || result.value.length > MAX_FEED_ITEMS)) {
      throw new NuniError(502, 'TRONCLASS_INVALID_SOURCE');
    }
  }
  const materials: TronClassSnapshot['materials'] = [];
  const announcements: TronClassSnapshot['announcements'] = [];
  const seenMaterials = new Set<number>();
  const seenAnnouncements = new Set<string>();
  const addAnnouncement = (item: ReturnType<typeof announcement>) => {
    if (!item) return;
    const key = JSON.stringify([item.courseId, item.id.split(':').at(-1), item.title, item.content]);
    if (!seenAnnouncements.has(key)) { seenAnnouncements.add(key); announcements.push(item); }
  };
  for (const raw of notices.ok ? notices.value : []) addAnnouncement(announcement(raw, course, 'course'));
  for (const raw of [...(activities.ok ? activities.value : []), ...(courseware.ok ? courseware.value : [])]) {
    const item = material(raw, course);
    if (item && !seenMaterials.has(item.id)) { seenMaterials.add(item.id); materials.push(item); }
    if (isAnnouncementActivityType(record(raw).type)) addAnnouncement(announcement(raw, course, 'activity'));
  }
  return { announcements, materials, errors };
}

export function createTronClassIntegrationReader(dependencies: {
  bindings?: BindingReader; source?: Source; now?: () => number; budgetMs?: number;
} = {}) {
  const bindings = dependencies.bindings ?? createTronClassBindingService();
  const source = dependencies.source ?? tronClassLmsReadonlySource;
  const now = dependencies.now ?? Date.now;
  return async (ownerKey: string, options: { courseId?: number } = {}): Promise<TronClassSnapshot> => {
    if (options.courseId !== undefined && positiveId(options.courseId) !== options.courseId) {
      throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
    }
    const binding = await bindings.requireBinding(ownerKey);
    const deadline = now() + (dependencies.budgetMs ?? READ_BUDGET_MS);
    let expired = false;
    const check = async () => {
      if (expired || now() >= deadline) throw new NuniError(503, 'TRONCLASS_READ_TIMEOUT');
      await bindings.assertCurrent(ownerKey, binding.revision);
    };
    const operation = async (): Promise<TronClassSnapshot> => {
      try {
        await check();
        const courses = parseCourses(await source.fetchCourses(binding.cookies, { userId: binding.userId, status: 'ongoing' }));
        const errors: TronClassSyncError[] = [];
        await check();
        try {
          const upcoming = parseCourses(await source.fetchCourses(binding.cookies, { userId: binding.userId, status: 'upcoming' }));
          const seen = new Set(courses.map((item) => item.id));
          for (const item of upcoming) if (!seen.has(item.id)) { seen.add(item.id); courses.push(item); }
        } catch (error) {
          rethrowSession(error);
          errors.push({ courseId: null, area: 'courses', message: '尚未完整讀取即將開始的課程，請稍後重新整理。' });
        }
        if (options.courseId && !courses.some((course) => course.id === options.courseId)) {
          throw new NuniError(403, 'TRONCLASS_COURSE_NOT_FOUND');
        }
        const selected = options.courseId
          ? courses.filter((course) => course.id === options.courseId) : courses.slice(0, MAX_OVERVIEW_COURSES);
        if (!options.courseId && courses.length > MAX_OVERVIEW_COURSES) {
          errors.push({ courseId: null, area: 'homework', message: `這次整理前 ${MAX_OVERVIEW_COURSES} 門課的作業；選擇個別課程可讀取該課完整清單。` });
        }
        const homework: TronClassHomeworkItem[] = [];
        let cursor = 0;
        let stopped = false;
        const worker = async () => {
          try {
            while (!stopped && cursor < selected.length) {
              const course = selected[cursor++];
              const result = await readHomework(source, binding.cookies, course, check);
              homework.push(...result.homework);
              errors.push(...result.errors);
            }
          } catch (error) { stopped = true; throw error; }
        };
        await Promise.all(Array.from({ length: Math.min(3, selected.length) }, worker));
        const contents = options.courseId ? await readContents(source, binding.cookies, selected[0], check)
          : { announcements: [], materials: [], errors: [] };
        errors.push(...contents.errors);
        await check();
        return {
          revision: binding.revision, fetchedAt: new Date(now()).toISOString(), courses,
          homework: homework.sort((a, b) => a.courseId - b.courseId || a.id - b.id),
          announcements: contents.announcements, materials: contents.materials,
          errors, partial: errors.length > 0,
        };
      } catch (error) {
        rethrowSession(error);
        if (error instanceof NuniError) throw error;
        throw new NuniError(503, 'TRONCLASS_SOURCE_UNAVAILABLE');
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { expired = true; reject(new NuniError(503, 'TRONCLASS_READ_TIMEOUT')); }, Math.max(1, deadline - now()));
        }),
      ]);
    } finally { expired = true; clearTimeout(timer); }
  };
}
