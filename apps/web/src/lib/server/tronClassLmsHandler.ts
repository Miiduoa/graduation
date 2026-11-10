import { isSchoolLmsReadonlyEnabled } from './schoolLmsReadonly';
import { LMS_CONNECTING_CODE } from '../schoolLoginTimeouts';
import type { CallableRequest } from './groupInviteHandlers';
import { HttpsError } from './httpsError';
import {
  requireAcademicAccount,
  schoolSessionCookies,
  schoolSessionExpiry,
  type AcademicFirestore,
  type AcademicTransaction,
  type SchoolDataSnapshot,
} from './academicRecordsHandlers';
import type { LmsReadonlySource } from './tronClassLmsSource';
import type {
  LmsAnnouncementItem,
  LmsCourseError,
  LmsCourseSummary,
  LmsHomeworkItem,
  LmsMaterialFile,
  LmsMaterialItem,
  LmsReadonlySnapshot,
} from '../tronClassLmsTypes';
import {
  HOMEWORK_MAX_PAGES,
  HOMEWORK_PAGE_SIZE,
  LMS_CACHE_COLLECTION,
  LMS_COURSE_CONCURRENCY,
  LMS_SNAPSHOT_TTL_MS,
  cacheStillFresh,
  classifySchoolReadError,
  schoolHttpStatus,
  formatHomeworkDeadlineTaipei,
  homeworkDescriptionText,
  homeworkPageAdvance,
  isAnnouncementActivityType,
  isHomeworkSubmitted,
  isMaterialActivityType,
  isUploadDownloadable,
  tronClassActivityHref,
  tronClassCourseHref,
  tronClassUploadHref,
} from '@campus/shared/src/puLmsReadonly';

export type {
  LmsAnnouncementItem,
  LmsCourseError,
  LmsCourseSummary,
  LmsHomeworkItem,
  LmsMaterialFile,
  LmsMaterialItem,
  LmsReadonlySnapshot,
};

function reconnect(): never {
  throw new HttpsError('failed-precondition', 'WOW Class 尚未連線或登入已到期，請重新連線學校帳號。');
}

function connecting(): never {
  throw new HttpsError('unavailable', '正在連線玩課雲，請稍候再讀取作業。', {
    code: LMS_CONNECTING_CODE,
  });
}

function shortText(value: unknown, maximum = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function positiveId(value: unknown): number | null {
  const id = typeof value === 'number' ? value
    : typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isoTime(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function documentVersion(snapshot: SchoolDataSnapshot): string | undefined {
  const time = snapshot.updateTime;
  return time && `${time.seconds}:${time.nanoseconds}`;
}

type CourseRow = { id: number; name: string };

function publicCourses(input: unknown): CourseRow[] {
  if (!Array.isArray(input) || input.length > 1000) {
    throw new HttpsError('unavailable', 'WOW Class 課程資料不完整，請稍後重試。');
  }
  const seen = new Set<number>();
  const courses: CourseRow[] = [];
  for (const item of input) {
    const row = record(item);
    const id = positiveId(row.id);
    const name = shortText(row.name);
    if (!id || !name || seen.has(id)) {
      throw new HttpsError('unavailable', 'WOW Class 課程資料不完整，請稍後重試。');
    }
    seen.add(id);
    courses.push({ id, name });
  }
  return courses;
}

function uploadsOf(activity: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(activity.uploads)) return activity.uploads.filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
  if (Array.isArray(activity.attachments)) return activity.attachments.filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
  return [];
}

function parseHomework(
  raw: unknown,
  course: CourseRow,
): LmsHomeworkItem | null {
  const row = record(raw);
  const id = positiveId(row.id);
  const title = shortText(row.title || row.name);
  if (!id || !title) return null;
  const data = record(row.data);
  const deadline = isoTime(row.deadline) || isoTime(row.end_time);
  return {
    id,
    courseId: course.id,
    courseName: course.name,
    title,
    deadline,
    deadlineLabel: formatHomeworkDeadlineTaipei(deadline),
    submitted: isHomeworkSubmitted(row),
    description: homeworkDescriptionText(data.description ?? row.description),
    href: tronClassActivityHref(course.id, id),
  };
}

function parseAnnouncement(
  raw: unknown,
  source: LmsAnnouncementItem['source'],
  course: CourseRow | null,
): LmsAnnouncementItem | null {
  const row = record(raw);
  const numericId = positiveId(row.id);
  const title = shortText(row.title || row.name);
  if (!numericId || !title) return null;
  const content = homeworkDescriptionText(row.content ?? record(row.data).description ?? row.description);
  const publishedAt = isoTime(row.created_at) || isoTime(row.publish_time) || isoTime(record(row.data).publish_time);
  const href = course
    ? (source === 'activity' ? tronClassActivityHref(course.id, numericId) : tronClassCourseHref(course.id))
    : `${tronClassCourseHref(1).replace(/\/course\/1\/content$/, '/')}`;
  return {
    id: `${source}:${course?.id ?? 'site'}:${numericId}`,
    courseId: course?.id ?? null,
    courseName: course?.name ?? null,
    title,
    content,
    publishedAt,
    href: course ? href : 'https://tronclass.pu.edu.tw/',
    source,
  };
}

function parseMaterial(raw: unknown, course: CourseRow): LmsMaterialItem | null {
  const row = record(raw);
  const id = positiveId(row.id);
  const title = shortText(row.title || row.name);
  const type = shortText(row.type, 40) || 'material';
  if (!id || !title || !isMaterialActivityType(type)) return null;
  const files: LmsMaterialFile[] = [];
  for (const upload of uploadsOf(row).slice(0, 30)) {
    const name = shortText(upload.name || upload.filename, 200);
    const key = shortText(upload.key || upload.file_key || upload.upload_id, 200);
    if (!name) continue;
    const allowDownload = isUploadDownloadable(upload);
    files.push({
      name,
      allowDownload,
      downloadHref: allowDownload && key ? tronClassUploadHref(key) : null,
    });
  }
  return {
    id,
    courseId: course.id,
    courseName: course.name,
    title,
    type,
    href: tronClassActivityHref(course.id, id),
    files,
  };
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let sessionError: unknown;
  async function run() {
    while (next < items.length) {
      if (sessionError) return;
      const index = next;
      next += 1;
      try {
        results[index] = await worker(items[index]);
      } catch (error) {
        // Stop dispatching queued courses after an authentication failure.
        // Already in-flight reads may finish, but their data must not be returned.
        if ((error instanceof HttpsError && error.code === 'failed-precondition') ||
          classifySchoolReadError(error) === 'session' || schoolHttpStatus(error) === 401) {
          sessionError = error;
          return;
        }
        throw error;
      }
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, () => run());
  await Promise.all(workers);
  if (sessionError) throw sessionError;
  return results;
}

async function readPagedHomework(
  source: LmsReadonlySource,
  cookies: Record<string, string>,
  course: CourseRow,
): Promise<{ items: LmsHomeworkItem[]; error: LmsCourseError | null }> {
  const seen = new Set<number>();
  const items: LmsHomeworkItem[] = [];
  let total: number | null = null;
  for (let page = 1; page <= HOMEWORK_MAX_PAGES; page += 1) {
    const result = await source.fetchHomeworkPage(cookies, course.id, page, HOMEWORK_PAGE_SIZE);
    if (!result.ok) {
      requireAuthorizedSchoolRead(result.status);
      return { items: [], error: { courseId: course.id, courseName: course.name, area: 'homework', status: result.status } };
    }
    const rows = result.value.homework_activities;
    total = result.value.total;
    const parsed: LmsHomeworkItem[] = [];
    for (const row of rows) {
      const item = parseHomework(row, course);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      parsed.push(item);
    }
    items.push(...parsed);
    const advance = homeworkPageAdvance({
      page,
      pageSize: HOMEWORK_PAGE_SIZE,
      pageLength: rows.length,
      accumulated: items.length,
      total,
    });
    if (advance === 'complete') return { items, error: null };
    if (advance === 'incomplete') {
      return { items: [], error: { courseId: course.id, courseName: course.name, area: 'homework', status: null } };
    }
  }
  return { items: [], error: { courseId: course.id, courseName: course.name, area: 'homework', status: null } };
}

type CourseContents = {
  announcements: LmsAnnouncementItem[];
  materials: LmsMaterialItem[];
  errors: LmsCourseError[];
};

type CachedCourseContents = CourseContents & {
  fetchedAt: string;
  expiresAt: string;
};

async function loadCourseContents(
  source: LmsReadonlySource,
  cookies: Record<string, string>,
  course: CourseRow,
): Promise<CourseContents> {
  const errors: LmsCourseError[] = [];
  const [activitiesResult, announcementResult] = await Promise.all([
    source.fetchActivities(cookies, course.id, ''),
    source.fetchCourseAnnouncements(cookies, course.id),
  ]);

  if (!activitiesResult.ok) requireAuthorizedSchoolRead(activitiesResult.status);
  if (!announcementResult.ok) requireAuthorizedSchoolRead(announcementResult.status);

  const materials: LmsMaterialItem[] = [];
  const activityAnnouncements: LmsAnnouncementItem[] = [];
  if (activitiesResult.ok) {
    for (const raw of activitiesResult.value) {
      const material = parseMaterial(raw, course);
      if (material) materials.push(material);
      if (isAnnouncementActivityType(record(raw).type)) {
        const item = parseAnnouncement(raw, 'activity', course);
        if (item) activityAnnouncements.push(item);
      }
    }
  } else {
    errors.push({ courseId: course.id, courseName: course.name, area: 'materials', status: activitiesResult.status });
  }

  let announcements: LmsAnnouncementItem[] = [];
  if (announcementResult.ok) {
    announcements = announcementResult.value
      .map((item) => parseAnnouncement(item, 'course', course))
      .filter((item): item is LmsAnnouncementItem => Boolean(item));
    // The general activities feed can carry announcements absent from the dedicated
    // endpoint, even when that endpoint succeeds. Preserve both without duplicating
    // identical course/activity records. Do not merge differing content by title alone.
    const key = (item: LmsAnnouncementItem) =>
      JSON.stringify([item.courseId, item.id.split(':').pop(), item.title, item.content]);
    const seen = new Set(announcements.map(key));
    for (const item of activityAnnouncements) {
      const signature = key(item);
      if (seen.has(signature)) continue;
      seen.add(signature);
      announcements.push(item);
    }
  } else if (activitiesResult.ok) {
    announcements = activityAnnouncements;
    if (announcementResult.status !== 404) {
      errors.push({
        courseId: course.id, courseName: course.name, area: 'announcements', status: announcementResult.status,
      });
    }
  } else {
    errors.push({
      courseId: course.id, courseName: course.name, area: 'announcements', status: announcementResult.status,
    });
  }

  return { announcements, materials, errors };
}

function readCachedExtras(value: unknown, nowMs: number): {
  extras: Record<string, CachedCourseContents>;
  pruned: boolean;
} {
  const extras: Record<string, CachedCourseContents> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { extras, pruned: Boolean(value) };
  }
  let pruned = false;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const courseId = positiveId(key);
    const row = record(item);
    if (!courseId || !cacheStillFresh(row.expiresAt, nowMs) ||
      typeof row.fetchedAt !== 'string' || typeof row.expiresAt !== 'string' ||
      !Array.isArray(row.announcements) || !Array.isArray(row.materials) || !Array.isArray(row.errors)) {
      pruned = true;
      continue;
    }
    extras[String(courseId)] = {
      fetchedAt: row.fetchedAt,
      expiresAt: row.expiresAt,
      announcements: row.announcements as LmsAnnouncementItem[],
      materials: row.materials as LmsMaterialItem[],
      errors: row.errors as LmsCourseError[],
    };
  }
  return { extras, pruned };
}

function publicSnapshot(value: unknown, uid: string, nowMs: number): LmsReadonlySnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const cache = record(row.cache);
  // An old or partial cache document must not make the course page fail with a
  // server error. Treat it as a miss so the live session can fetch fresh data.
  if (row.success !== true || row.ownerUid !== uid || row.schoolId !== 'pu' || row.source !== 'pu-tronclass' ||
    typeof row.fetchedAt !== 'string' || !Number.isFinite(Date.parse(row.fetchedAt)) ||
    typeof cache.hit !== 'boolean' ||
    typeof cache.expiresAt !== 'string' || !cacheStillFresh(cache.expiresAt, nowMs) ||
    !Array.isArray(row.courses) || !Array.isArray(row.contentsLoadedFor) ||
    !Array.isArray(row.homework) || !Array.isArray(row.announcements) || !Array.isArray(row.materials) ||
    !Array.isArray(row.courseErrors)) return null;
  return row as LmsReadonlySnapshot;
}

// A 401 can be returned as a per-feed failure rather than a thrown session error.
// Never cache a partial course as successful when the school rejected authentication.
function requireAuthorizedSchoolRead(status: number | null): void {
  if (status === 401) reconnect();
}

function homeworkOnlySnapshot(snapshot: LmsReadonlySnapshot): LmsReadonlySnapshot {
  return {
    ...snapshot,
    announcements: [],
    materials: [],
    contentsLoadedFor: [],
    courseErrors: snapshot.courseErrors.filter((item) => item.area === 'homework'),
    siteAnnouncementError: null,
  };
}

function mergeExtras(
  snapshot: LmsReadonlySnapshot,
  extras: Record<string, CachedCourseContents>,
): LmsReadonlySnapshot {
  const homeworkErrors = snapshot.courseErrors.filter((item) => item.area === 'homework');
  const loaded = Object.keys(extras).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
  return {
    ...snapshot,
    announcements: loaded.flatMap((id) => extras[String(id)]?.announcements ?? []),
    materials: loaded.flatMap((id) => extras[String(id)]?.materials ?? []),
    courseErrors: [...homeworkErrors, ...loaded.flatMap((id) => extras[String(id)]?.errors ?? [])],
    contentsLoadedFor: loaded,
  };
}

function parseRequest(data: unknown): { refresh: boolean; courseId: number | null } {
  const body = data === undefined ? {} : data;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpsError('invalid-argument', '請使用有效的讀取參數。');
  }
  const row = body as Record<string, unknown>;
  const refresh = row.refresh === true;
  if (row.refresh !== undefined && row.refresh !== true && row.refresh !== false) {
    throw new HttpsError('invalid-argument', '請使用有效的讀取參數。');
  }
  let courseId: number | null = null;
  if (row.courseId !== undefined) {
    if (typeof row.courseId !== 'number' || !positiveId(row.courseId)) {
      throw new HttpsError('invalid-argument', '請使用有效的讀取參數。');
    }
    courseId = positiveId(row.courseId);
  }
  if (Object.keys(row).some((key) => key !== 'refresh' && key !== 'courseId')) {
    throw new HttpsError('invalid-argument', '請使用有效的讀取參數。');
  }
  return { refresh, courseId };
}

export function createTronClassLmsHandler({
  db,
  source,
  now = Date.now,
}: {
  db: AcademicFirestore;
  source: LmsReadonlySource;
  now?: () => number;
}) {
  return async (request: CallableRequest): Promise<LmsReadonlySnapshot> => {
    if (!isSchoolLmsReadonlyEnabled()) {
      throw new HttpsError('not-found', '玩課雲唯讀功能未啟用。');
    }
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入校園帳號。');
    if (request.auth?.token?.schoolId !== 'pu') {
      throw new HttpsError('permission-denied', '此帳號尚未連結靜宜大學。');
    }
    const { refresh, courseId } = parseRequest(request.data);

    try {
      await requireAcademicAccount(db, uid);
      const currentPortal = db.collection('_puSessions').where('ownerUid', '==', uid)
        .orderBy('expiresAt', 'desc').limit(1);
      const sessions = await currentPortal.get();
      const portalSnapshot = sessions.docs[0];
      const portal = portalSnapshot?.data();
      if (portal?.ownerUid !== uid || !(schoolSessionExpiry(portal.expiresAt) > now())) reconnect();
      const linkedId = portal.tronClassSessionId;
      const lmsStillConnecting = schoolSessionExpiry(portal.lmsConnectingUntil) > now();
      if (typeof linkedId !== 'string' || !/^[a-f0-9]{32}$/.test(linkedId)) {
        if (lmsStillConnecting) connecting();
        reconnect();
      }
      const sessionRef = db.doc(`_puTronClassSessions/${linkedId}`);
      const sessionSnapshot = await sessionRef.get();
      const sessionVersion = documentVersion(sessionSnapshot);
      const session = sessionSnapshot.data();
      const cookies = schoolSessionCookies(session?.cookies);
      if (!sessionSnapshot.exists || session?.ownerUid !== uid || !cookies ||
        !(schoolSessionExpiry(session.expiresAt) > now())) {
        if (lmsStillConnecting) connecting();
        reconnect();
      }

      // Cache hits must be revalidated too. The linked LMS session may change
      // while Firestore is returning a cached snapshot, without any school call.
      const verifyLinkedSession = async (tx?: AcademicTransaction) => {
        const [portals, latestSession] = await Promise.all([
          tx ? tx.get(currentPortal) : currentPortal.get(),
          tx ? tx.get(sessionRef) : sessionRef.get(),
          requireAcademicAccount(db, uid, tx),
        ]);
        const latestPortal = portals.docs[0];
        const latestCookies = schoolSessionCookies(latestSession.data()?.cookies);
        if (!latestPortal?.exists || latestPortal.ref.path !== portalSnapshot.ref.path ||
          latestPortal.data()?.ownerUid !== uid ||
          latestPortal.data()?.tronClassSessionId !== linkedId ||
          !(schoolSessionExpiry(latestPortal.data()?.expiresAt) > now()) ||
          !latestSession.exists || latestSession.data()?.ownerUid !== uid ||
          documentVersion(latestSession) !== sessionVersion ||
          !(schoolSessionExpiry(latestSession.data()?.expiresAt) > now()) ||
          !latestCookies || latestSession.data()?.userId !== session.userId ||
          Object.keys(latestCookies).length !== Object.keys(cookies).length ||
          Object.entries(cookies).some(([name, value]) => latestCookies[name] !== value)) reconnect();
      };

      const cacheRef = db.doc(`${LMS_CACHE_COLLECTION}/${uid}`);
      let extras: Record<string, CachedCourseContents> = {};
      let cachedHomework: LmsReadonlySnapshot | null = null;
      let shouldPruneExtras = false;
      const cached = await cacheRef.get();
      // A relink can leave the original portal document intact.
      await verifyLinkedSession();
      const cacheData = cached.data();
      const saveCache = async (snapshot: LmsReadonlySnapshot, stampSessionVersion = true) => {
        if (!sessionVersion || !db.runTransaction) return;
        try {
          await db.runTransaction(async (tx) => {
            await verifyLinkedSession(tx);
            const current = await tx.get(cacheRef);
            // A concurrent refresh, relink or cleanup has already replaced our input.
            if (cached.exists !== current.exists || (current.exists &&
              (!current.updateTime || documentVersion(current) !== documentVersion(cached)))) return;
            const currentData = current.data();
            const keepLegacyShape = !stampSessionVersion && current.exists &&
              currentData != null && !('sessionVersion' in currentData);
            tx.set(cacheRef, {
              ownerUid: uid, sessionId: linkedId,
              ...(keepLegacyShape ? {} : { sessionVersion }),
              fetchedAt: snapshot.fetchedAt,
              expiresAt: new Date(snapshot.cache.expiresAt),
              snapshot,
              extras,
            });
          });
        } catch (error) {
          if (error instanceof HttpsError) throw error;
          // Cache storage is optional. The caller still verifies access before responding.
        }
      };

      const legacyCompatibleCache = cacheData != null && !('sessionVersion' in cacheData);
      if (cached.exists && sessionVersion && cacheData &&
        cacheData.ownerUid === uid && cacheData.sessionId === linkedId &&
        (cacheData.sessionVersion === sessionVersion || legacyCompatibleCache) &&
        cacheStillFresh(cacheData.expiresAt, now()) && publicSnapshot(cacheData.snapshot, uid, now())) {
        const pruned = readCachedExtras(cacheData.extras, now());
        extras = refresh ? {} : pruned.extras;
        cachedHomework = refresh ? null : homeworkOnlySnapshot(publicSnapshot(cacheData.snapshot, uid, now())!);
        shouldPruneExtras = !refresh && pruned.pruned;
      }

      if (cachedHomework && !refresh && (!courseId || extras[String(courseId)])) {
        if (shouldPruneExtras) {
          await saveCache(cachedHomework, !legacyCompatibleCache);
          await verifyLinkedSession();
        }
        return {
          ...mergeExtras(cachedHomework, extras),
          cache: { hit: true, expiresAt: cachedHomework.cache.expiresAt },
        };
      }

      let snapshot = cachedHomework;
      let fetchedFromSchool = !cachedHomework;
      if (!snapshot) {
        let courses: CourseRow[] = [];
        let upcomingCoursesError: LmsReadonlySnapshot['upcomingCoursesError'] = null;
        try {
          courses = publicCourses(await source.fetchCourses(cookies, {
            ...(typeof session.userId === 'number' ? { userId: session.userId } : {}),
            status: 'ongoing',
          }));
        } catch (error) {
          if (classifySchoolReadError(error) === 'session' || schoolHttpStatus(error) === 401) reconnect();
          throw error;
        }
        try {
          const upcoming = publicCourses(await source.fetchCourses(cookies, {
            ...(typeof session.userId === 'number' ? { userId: session.userId } : {}),
            status: 'upcoming',
          }));
          const seen = new Set(courses.map((course) => course.id));
          for (const course of upcoming) {
            if (!seen.has(course.id)) courses.push(course);
          }
        } catch (error) {
          if (classifySchoolReadError(error) === 'session' || schoolHttpStatus(error) === 401) reconnect();
          upcomingCoursesError = { status: null };
        }

        const homeworkResults = courses.length
          ? await mapPool(courses, LMS_COURSE_CONCURRENCY, (course) => readPagedHomework(source, cookies, course))
          : [];

        await verifyLinkedSession();

        const fetchedAt = new Date(now()).toISOString();
        const expiresAt = new Date(now() + LMS_SNAPSHOT_TTL_MS).toISOString();
        snapshot = {
          success: true,
          ownerUid: uid,
          schoolId: 'pu',
          source: 'pu-tronclass',
          fetchedAt,
          cache: { hit: false, expiresAt },
          courses: courses.map((course): LmsCourseSummary => ({ id: course.id, name: course.name })),
          contentsLoadedFor: [],
          homework: homeworkResults.flatMap((item) => item.items),
          announcements: [],
          materials: [],
          courseErrors: homeworkResults.flatMap((item) => item.error ? [item.error] : []),
          siteAnnouncementError: null,
          upcomingCoursesError,
        };
        extras = {};
      }

      if (courseId) {
        const course = snapshot.courses.find((item) => item.id === courseId);
        if (course && (refresh || !extras[String(courseId)])) {
          const contents = await loadCourseContents(source, cookies, course);
          fetchedFromSchool = true;
          const fetchedAt = new Date(now()).toISOString();
          extras[String(courseId)] = {
            ...contents,
            fetchedAt,
            expiresAt: new Date(now() + LMS_SNAPSHOT_TTL_MS).toISOString(),
          };
        }
      }

      const homework = homeworkOnlySnapshot(snapshot);
      const merged = mergeExtras(homework, extras);
      merged.cache = { hit: !fetchedFromSchool && !refresh, expiresAt: snapshot.cache.expiresAt };
      await saveCache(homework);
      // Do not return the old session's data if the user relinked during the write.
      await verifyLinkedSession();
      return merged;
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      // Some adapters throw raw HTTP errors instead of returning { ok: false }.
      // Handle those 401s as expired authentication, never as a retryable outage.
      if (classifySchoolReadError(error) === 'session' || schoolHttpStatus(error) === 401) reconnect();
      throw new HttpsError('unavailable', '暫時無法讀取 WOW Class，校務成績與學分可分別查看。');
    }
  };
}
