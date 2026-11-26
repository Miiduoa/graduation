import { NuniError } from '@campus/shared/src/nuni';
import type { TronClassCourseIndex, TronClassCourseIndexError } from '@campus/shared/src/tronClassCourseIndex';
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
import type { LmsReadOptions, LmsReadResult, LmsReadonlySource } from './tronClassLmsSource';
import { tronClassLmsReadonlySource } from './tronClassLmsSource';
import { createTronClassBindingService, type TronClassBoundSession } from './tronClassBinding';
import { isTronClassSourceVisible } from './tronClassSourceVisibility';
import { isTronClassMaterialDownloadAllowed, tronClassMaterialUploadKey } from './tronClassMaterialFile';

const MAX_OVERVIEW_COURSES = 40;
const READ_BUDGET_MS = 50_000;
const MAX_FEED_ITEMS = 5_000;

type BindingReader = Pick<ReturnType<typeof createTronClassBindingService>, 'requireBinding' | 'assertCurrent'>;
type Source = LmsReadonlySource;
type CourseContents = Pick<TronClassSnapshot, 'announcements' | 'materials' | 'errors'>;
type ReadStep = <T>(request: (options: LmsReadOptions) => Promise<T>) => Promise<T>;

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
  if (status === 403) throw new NuniError(403, 'TRONCLASS_COURSE_ACCESS_DENIED');
}

function rethrowSession(error: unknown): void {
  if (error instanceof NuniError && ([401, 403, 409].includes(error.status) || error.code === 'TRONCLASS_READ_TIMEOUT')) throw error;
  if (classifySchoolReadError(error) === 'session' || schoolHttpStatus(error) === 401) {
    throw new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED');
  }
  if (schoolHttpStatus(error) === 403) throw new NuniError(403, 'TRONCLASS_COURSE_ACCESS_DENIED');
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
  check: () => Promise<void>, read: ReadStep,
): Promise<{ homework: TronClassHomeworkItem[]; errors: TronClassSyncError[] }> {
  const items: TronClassHomeworkItem[] = [];
  const seen = new Set<number>();
  let accumulated = 0;
  try {
    for (let page = 1; page <= HOMEWORK_MAX_PAGES; page++) {
      await check();
      const response = await read(options => source.fetchHomeworkPage(cookies, course.id, page, HOMEWORK_PAGE_SIZE, options));
      if (!response.ok) {
        requireAuthorized(response.status);
        return { homework: [], errors: [courseError(course, 'homework')] };
      }
      const rows = response.value.homework_activities;
      if (!Array.isArray(rows) || rows.length > HOMEWORK_PAGE_SIZE) throw new Error('Invalid homework page');
      for (const raw of rows) {
        const row = record(raw);
        const id = positiveId(row.id);
        if (!id || seen.has(id) || (row.course_id !== undefined && positiveId(row.course_id) !== course.id)) {
          throw new Error('Invalid or repeated homework');
        }
        seen.add(id);
        if (!isTronClassSourceVisible(row)) continue;
        const item = parseHomework(row, course);
        if (!item) throw new Error('Invalid homework');
        items.push(item);
      }
      // The source total counts hidden rows too; filtering must not hide a
      // missing page or turn a complete source response into a partial one.
      accumulated += rows.length;
      const next = homeworkPageAdvance({
        page, pageSize: HOMEWORK_PAGE_SIZE, pageLength: rows.length,
        accumulated, total: response.value.total,
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
  if (!isTronClassSourceVisible(row)) return null;
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
  if (!isTronClassSourceVisible(row)) return null;
  const id = positiveId(row.id);
  const title = text(row.title || row.name);
  const type = text(row.type, 40);
  if (!id || !title || !type || !isMaterialActivityType(type) ||
    (row.course_id !== undefined && positiveId(row.course_id) !== course.id)) return null;
  const uploads = Array.isArray(row.uploads) ? row.uploads : Array.isArray(row.attachments) ? row.attachments : [];
  const files = uploads.slice(0, 30).flatMap((item) => {
    const file = record(item);
    if (!isTronClassSourceVisible(file)) return [];
    const name = text(file.name || file.filename, 200);
    if (!name) return [];
    const key = isTronClassMaterialDownloadAllowed(file) ? tronClassMaterialUploadKey(file) : null;
    const allowDownload = file.allow_download === true;
    return [{ name, allowDownload, downloadHref: allowDownload && key ? tronClassUploadHref(key) : null }];
  });
  return { id, courseId: course.id, courseName: course.name, title, type, files, href: tronClassActivityHref(course.id, id) };
}

function visibleSourceRows(rows: unknown[]): unknown[] {
  // A stale public copy in another feed must not override a hidden copy of the
  // same activity. Course announcements have their own ID namespace.
  const denied = new Set<number>();
  for (const raw of rows) {
    const id = positiveId(record(raw).id);
    if (id && !isTronClassSourceVisible(raw)) denied.add(id);
  }
  return rows.filter((raw) => isTronClassSourceVisible(raw) && !denied.has(positiveId(record(raw).id) ?? 0));
}

async function readContents(
  source: Source, cookies: Record<string, string>, course: TronClassCourseSummary,
  check: () => Promise<void>, read: ReadStep,
  include: { announcements?: boolean; materials?: boolean } = { announcements: true, materials: true },
): Promise<CourseContents> {
  await check();
  const load = async (request: (options: LmsReadOptions) => Promise<LmsReadResult<unknown[]>>) => {
    try {
      const response = await read(request);
      if (!response.ok) requireAuthorized(response.status);
      return response;
    }
    catch (error) { rethrowSession(error); return { ok: false as const, status: schoolHttpStatus(error) }; }
  };
  const skipped = { ok: true as const, value: [] as unknown[] };
  const needAnnouncements = include.announcements === true;
  const needMaterials = include.materials === true;
  // Activity announcements live on the course activity feed, so announcement
  // reads still request it; courseware is only needed for materials.
  const [activities, courseware, notices] = await Promise.all([
    needAnnouncements || needMaterials ? load(options => source.fetchActivities(cookies, course.id, '', options)) : skipped,
    needMaterials ? load(options => source.fetchActivities(cookies, course.id, 'type=courseware_activity', options)) : skipped,
    needAnnouncements ? load(options => source.fetchCourseAnnouncements(cookies, course.id, options)) : skipped,
  ]);
  await check();
  for (const response of [activities, courseware, notices]) if (!response.ok) requireAuthorized(response.status);
  const errors: TronClassSyncError[] = [];
  if (needMaterials && (!activities.ok || (!courseware.ok && courseware.status !== 404))) errors.push(courseError(course, 'materials'));
  if (needAnnouncements && (!activities.ok || (!notices.ok && notices.status !== 404))) errors.push(courseError(course, 'announcements'));
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
  for (const raw of visibleSourceRows(notices.ok ? notices.value : [])) addAnnouncement(announcement(raw, course, 'course'));
  const activityRows = visibleSourceRows([...(activities.ok ? activities.value : []), ...(courseware.ok ? courseware.value : [])]);
  for (const raw of activityRows) {
    const item = needMaterials ? material(raw, course) : null;
    if (item && !seenMaterials.has(item.id)) { seenMaterials.add(item.id); materials.push(item); }
    if (needAnnouncements && isAnnouncementActivityType(record(raw).type)) addAnnouncement(announcement(raw, course, 'activity'));
  }
  return { announcements, materials, errors };
}

export type TronClassReaderDependencies = {
  bindings?: BindingReader; source?: Source; now?: () => number; budgetMs?: number;
};

export type TronClassSnapshotAuthorization = {
  binding: TronClassBoundSession;
  assertGrant: () => Promise<void>;
};

type CourseReadContext = {
  binding: Awaited<ReturnType<BindingReader['requireBinding']>>;
  courses: TronClassCourseSummary[];
  errors: TronClassCourseIndexError[];
  check: () => Promise<void>;
  read: ReadStep;
  source: Source;
  now: () => number;
};

/** Shared identity, course-list and cancellation boundary for both read shapes. */
function createTronClassCourseOperation(dependencies: TronClassReaderDependencies) {
  const bindings = dependencies.bindings ?? createTronClassBindingService();
  const source = dependencies.source ?? tronClassLmsReadonlySource;
  const now = dependencies.now ?? Date.now;
  return async <T>(ownerKey: string, readResult: (context: CourseReadContext) => Promise<T>,
    signal?: AbortSignal, authorization?: TronClassSnapshotAuthorization, revision?: string): Promise<T> => {
    const deadline = now() + (dependencies.budgetMs ?? READ_BUDGET_MS);
    const controller = new AbortController();
    let failure: NuniError | undefined;
    let rejectCancelled!: (error: NuniError) => void;
    const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
    const stop = (error: NuniError): NuniError => {
      if (!controller.signal.aborted) {
        failure = error;
        controller.abort();
        rejectCancelled(error);
      }
      return failure ?? error;
    };
    const timeout = () => new NuniError(503, 'TRONCLASS_READ_TIMEOUT');
    const abort = () => { stop(timeout()); };
    const active = () => {
      if (controller.signal.aborted) throw failure ?? timeout();
      if (now() >= deadline) throw stop(timeout());
    };
    const checkBinding = async (revision: string) => {
      active();
      await bindings.assertCurrent(ownerKey, revision);
      active();
    };
    const read: ReadStep = async request => {
      active();
      if (authorization) {
        await authorization.assertGrant();
        await checkBinding(authorization.binding.revision);
        active();
      }
      try {
        const result = await request({ signal: controller.signal, timeoutMs: Math.max(1, Math.ceil(deadline - now())) });
        active();
        return result;
      } catch (error) {
        // Abort-aware transports and legacy adapters may fail differently.
        // Keep the original cancellation/authorization outcome for this sync.
        active();
        throw error;
      }
    };
    const operation = async (): Promise<T> => {
      try {
        active();
        const binding = authorization?.binding ?? await bindings.requireBinding(ownerKey, revision);
        if (revision !== undefined && binding.revision !== revision) throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
        const check = () => checkBinding(binding.revision);
        await check();
        const courses = parseCourses(await read(readOptions => source.fetchCourses(binding.cookies, { userId: binding.userId, status: 'ongoing' }, readOptions)));
        const errors: TronClassCourseIndexError[] = [];
        await check();
        try {
          const upcoming = parseCourses(await read(readOptions => source.fetchCourses(binding.cookies, { userId: binding.userId, status: 'upcoming' }, readOptions)));
          const seen = new Set(courses.map((item) => item.id));
          for (const item of upcoming) if (!seen.has(item.id)) { seen.add(item.id); courses.push(item); }
        } catch (error) {
          rethrowSession(error);
          errors.push({ courseId: null, area: 'courses', message: '尚未完整讀取即將開始的課程，請稍後重新整理。' });
        }
        const result = await readResult({ binding, courses, errors, check, read, source, now });
        await check();
        return result;
      } catch (error) {
        let reason = error;
        try { rethrowSession(error); }
        catch (classified) { reason = classified; }
        throw stop(reason instanceof NuniError ? reason : new NuniError(503, 'TRONCLASS_SOURCE_UNAVAILABLE'));
      }
    };
    // One deadline covers identity checks and all reads for the selected operation.
    // Racing the cancellation also bounds providers that ignore AbortSignal.
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, Math.max(1, deadline - now()));
    try {
      return await Promise.race([operation(), cancelled]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  };
}

/** Read only the verified owner's course picker; never starts a homework request. */
export function createTronClassCourseIndexReader(dependencies: TronClassReaderDependencies = {}) {
  const operation = createTronClassCourseOperation(dependencies);
  return (ownerKey: string, signal?: AbortSignal, revision?: string): Promise<TronClassCourseIndex> =>
    operation(ownerKey, async ({ binding, courses, errors, now }) => ({
      kind: 'course-index' as const, revision: binding.revision,
      fetchedAt: new Date(now()).toISOString(), courses, errors, partial: errors.length > 0,
    }), signal, undefined, revision);
}

export type TronClassSnapshotReadOptions = {
  courseId?: number;
  revision?: string;
  requireCompleteCourses?: boolean;
  acceptCourseIndex?: (index: Pick<TronClassSnapshot, 'courses' | 'errors' | 'partial'>) => boolean;
  include?: {
    homework?: boolean;
    announcements?: boolean;
    materials?: boolean;
  };
};

/** When include is omitted, keep the existing sync shape: homework always, course contents only for a selected course. */
export function resolveSnapshotInclude(options: TronClassSnapshotReadOptions): {
  homework: boolean; announcements: boolean; materials: boolean;
} {
  if (options.include) {
    return {
      homework: options.include.homework === true,
      announcements: options.include.announcements === true,
      materials: options.include.materials === true,
    };
  }
  return {
    homework: true,
    announcements: options.courseId !== undefined,
    materials: options.courseId !== undefined,
  };
}

export function createTronClassIntegrationReader(dependencies: TronClassReaderDependencies = {}) {
  const operation = createTronClassCourseOperation(dependencies);
  return async (ownerKey: string, options: TronClassSnapshotReadOptions = {}, signal?: AbortSignal,
    authorization?: TronClassSnapshotAuthorization): Promise<TronClassSnapshot> => {
    if (options.courseId !== undefined && positiveId(options.courseId) !== options.courseId) {
      throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
    }
    return operation(ownerKey, async ({ binding, courses, errors: courseErrors, check, read, source, now }) => {
      // Recheck automatic selection against the index used by this operation.
      const index = { courses, errors: courseErrors, partial: courseErrors.length > 0 };
      if ((options.requireCompleteCourses && courseErrors.some((error) => error.area === 'courses')) ||
        options.acceptCourseIndex?.(index) === false) {
        return {
          revision: binding.revision, fetchedAt: new Date(now()).toISOString(),
          homework: [], announcements: [], materials: [], ...index,
        };
      }
      const include = resolveSnapshotInclude(options);
      const errors: TronClassSyncError[] = [...courseErrors];
      if (options.courseId && !courses.some((course) => course.id === options.courseId)) {
        throw new NuniError(403, 'TRONCLASS_COURSE_NOT_FOUND');
      }
      const selected = options.courseId
        ? courses.filter((course) => course.id === options.courseId) : courses.slice(0, MAX_OVERVIEW_COURSES);
      if (include.homework && !options.courseId && courses.length > MAX_OVERVIEW_COURSES) {
        errors.push({ courseId: null, area: 'homework', message: `這次整理前 ${MAX_OVERVIEW_COURSES} 門課的作業；選擇個別課程可讀取該課完整清單。` });
      }
      const homework: TronClassHomeworkItem[] = [];
      if (include.homework) {
        let cursor = 0;
        let stopped = false;
        const worker = async () => {
          try {
            while (!stopped && cursor < selected.length) {
              const course = selected[cursor++];
              const result = await readHomework(source, binding.cookies, course, check, read);
              homework.push(...result.homework);
              errors.push(...result.errors);
            }
          } catch (error) { stopped = true; throw error; }
        };
        await Promise.all(Array.from({ length: Math.min(3, selected.length) }, worker));
      }
      const contents = (include.announcements || include.materials) && options.courseId
        ? await readContents(source, binding.cookies, selected[0], check, read, {
          announcements: include.announcements, materials: include.materials,
        })
        : { announcements: [], materials: [], errors: [] };
      errors.push(...contents.errors);
      return {
        revision: binding.revision, fetchedAt: new Date(now()).toISOString(), courses,
        homework: homework.sort((a, b) => a.courseId - b.courseId || a.id - b.id),
        announcements: contents.announcements, materials: contents.materials,
        errors, partial: errors.length > 0,
      };
    }, signal, authorization, options.revision);
  };
}
