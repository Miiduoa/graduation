import { getAuth, getCloudFunctionUrl, isFirebaseConfigured } from './firebase';
import { AcademicConnectionError } from './academicClient';
import { LMS_CONNECTING_CODE } from './schoolLoginTimeouts';
import { withSchoolDataDeadline } from './schoolDataRequest';
import { selectDeadlineAxis } from '@campus/shared/src/puLmsReadonly';
import type {
  LmsAnnouncementItem,
  LmsCourseError,
  LmsCourseSummary,
  LmsHomeworkItem,
  LmsMaterialItem,
  LmsReadonlySnapshot,
} from './tronClassLmsTypes';

export type {
  LmsAnnouncementItem,
  LmsCourseError,
  LmsCourseSummary,
  LmsHomeworkItem,
  LmsMaterialItem,
  LmsReadonlySnapshot,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function readHomework(value: unknown): LmsHomeworkItem {
  const row = asRecord(value);
  const id = positiveId(row?.id);
  const courseId = positiveId(row?.courseId);
  if (!row || !id || !courseId || typeof row.courseName !== 'string' || typeof row.title !== 'string' ||
    !(row.deadline === null || typeof row.deadline === 'string') || typeof row.deadlineLabel !== 'string' ||
    row.submitted !== true && row.submitted !== false || typeof row.description !== 'string' ||
    typeof row.href !== 'string' || !row.href.startsWith('https://tronclass.pu.edu.tw/')) {
    throw new Error('Invalid homework');
  }
  return {
    id, courseId, courseName: row.courseName, title: row.title, deadline: row.deadline,
    deadlineLabel: row.deadlineLabel, submitted: row.submitted, description: row.description, href: row.href,
  };
}

function readAnnouncement(value: unknown): LmsAnnouncementItem {
  const row = asRecord(value);
  if (!row || typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.content !== 'string' ||
    typeof row.href !== 'string' || !row.href.startsWith('https://tronclass.pu.edu.tw/') ||
    !(row.courseId === null || positiveId(row.courseId)) ||
    !(row.courseName === null || typeof row.courseName === 'string') ||
    !(row.publishedAt === null || typeof row.publishedAt === 'string') ||
    !['course', 'site', 'activity'].includes(String(row.source))) {
    throw new Error('Invalid announcement');
  }
  return {
    id: row.id,
    courseId: row.courseId as number | null,
    courseName: row.courseName as string | null,
    title: row.title,
    content: row.content,
    publishedAt: row.publishedAt as string | null,
    href: row.href,
    source: row.source as LmsAnnouncementItem['source'],
  };
}

function readMaterial(value: unknown): LmsMaterialItem {
  const row = asRecord(value);
  const id = positiveId(row?.id);
  const courseId = positiveId(row?.courseId);
  if (!row || !id || !courseId || typeof row.courseName !== 'string' || typeof row.title !== 'string' ||
    typeof row.type !== 'string' || typeof row.href !== 'string' ||
    !row.href.startsWith('https://tronclass.pu.edu.tw/') || !Array.isArray(row.files) || row.files.length > 30) {
    throw new Error('Invalid material');
  }
  return {
    id, courseId, courseName: row.courseName, title: row.title, type: row.type, href: row.href,
    files: row.files.map((file) => {
      const item = asRecord(file);
      if (!item || typeof item.name !== 'string' || item.allowDownload !== true && item.allowDownload !== false ||
        !(item.downloadHref === null || (typeof item.downloadHref === 'string' &&
          item.downloadHref.startsWith('https://tronclass.pu.edu.tw/api/uploads/')))) {
        throw new Error('Invalid material');
      }
      if (item.allowDownload !== true && item.downloadHref !== null) throw new Error('Invalid material');
      return { name: item.name, allowDownload: item.allowDownload, downloadHref: item.downloadHref as string | null };
    }),
  };
}

function readCourse(value: unknown): LmsCourseSummary {
  const row = asRecord(value);
  const id = positiveId(row?.id);
  if (!row || !id || typeof row.name !== 'string' || !row.name.trim()) throw new Error('Invalid course');
  return { id, name: row.name };
}

function readCourseError(value: unknown): LmsCourseError {
  const row = asRecord(value);
  const courseId = positiveId(row?.courseId);
  if (!row || !courseId || typeof row.courseName !== 'string' ||
    !['homework', 'announcements', 'materials'].includes(String(row.area)) ||
    !(row.status === null || (typeof row.status === 'number' && Number.isInteger(row.status)))) {
    throw new Error('Invalid course error');
  }
  return {
    courseId, courseName: row.courseName,
    area: row.area as LmsCourseError['area'],
    status: row.status as number | null,
  };
}

export async function loadTronClassLms(
  uid: string,
  options: { refresh?: boolean; courseId?: number; expectedSchool?: string } = {},
): Promise<LmsReadonlySnapshot> {
  const expectedSchool = options.expectedSchool ?? 'pu';
  const user = getAuth()?.currentUser;
  if (!uid || !isFirebaseConfigured() || expectedSchool !== 'pu' || !user || user.uid !== uid) {
    throw new AcademicConnectionError('unavailable');
  }
  try {
    return await withSchoolDataDeadline(async (signal): Promise<LmsReadonlySnapshot> => {
      const token = await user.getIdToken();
      if (getAuth()?.currentUser !== user) throw new AcademicConnectionError('reconnect');
      if (signal.aborted) throw new AcademicConnectionError('unavailable');
      const response = await fetch(getCloudFunctionUrl('getMyTronClassLms'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          data: {
            ...(options.refresh ? { refresh: true } : {}),
            ...(options.courseId ? { courseId: options.courseId } : {}),
          },
        }),
        cache: 'no-store',
        signal,
      });
      const payload: unknown = await response.json();
      if (getAuth()?.currentUser !== user) throw new AcademicConnectionError('reconnect');
      if (signal.aborted) throw new AcademicConnectionError('unavailable');
      const envelope = asRecord(payload);
      if (!envelope) throw new Error('Invalid response');
      if (!response.ok || envelope.error) {
        const error = asRecord(envelope.error) ?? {};
        const extra = asRecord(error.details) ?? {};
        if (extra.code === LMS_CONNECTING_CODE || /正在連線/.test(String(error.message || ''))) {
          throw new AcademicConnectionError('connecting');
        }
        if (response.status === 401 || ['UNAUTHENTICATED', 'FAILED_PRECONDITION'].includes(String(error.status))) {
          throw new AcademicConnectionError('reconnect');
        }
        if (response.status === 403 || error.status === 'PERMISSION_DENIED') {
          throw new AcademicConnectionError('permission');
        }
        throw new AcademicConnectionError('unavailable');
      }
      const row = asRecord(envelope.result);
      const cache = asRecord(row?.cache);
      if (!row || row.success !== true || row.ownerUid !== uid || row.schoolId !== expectedSchool ||
        row.source !== 'pu-tronclass' || typeof row.fetchedAt !== 'string' ||
        !Number.isFinite(Date.parse(row.fetchedAt)) || !cache || cache.hit !== true && cache.hit !== false ||
        typeof cache.expiresAt !== 'string' ||         !Array.isArray(row.courses) || row.courses.length > 1000 ||
        !Array.isArray(row.contentsLoadedFor) || row.contentsLoadedFor.length > 1000 ||
        !Array.isArray(row.homework) || row.homework.length > 5000 ||
        !Array.isArray(row.announcements) || row.announcements.length > 2000 ||
        !Array.isArray(row.materials) || row.materials.length > 5000 ||
        !Array.isArray(row.courseErrors) || row.courseErrors.length > 500) {
        throw new Error('School LMS response does not match the active account');
      }
      return {
        success: true,
        ownerUid: uid,
        schoolId: 'pu',
        source: 'pu-tronclass',
        fetchedAt: row.fetchedAt,
        cache: { hit: cache.hit, expiresAt: cache.expiresAt },
        courses: row.courses.map(readCourse),
        contentsLoadedFor: row.contentsLoadedFor.map((value) => {
          const id = positiveId(value);
          if (!id) throw new Error('Invalid course');
          return id;
        }),
        homework: row.homework.map(readHomework),
        announcements: row.announcements.map(readAnnouncement),
        materials: row.materials.map(readMaterial),
        courseErrors: row.courseErrors.map(readCourseError),
        siteAnnouncementError: row.siteAnnouncementError === null ? null
          : asRecord(row.siteAnnouncementError) && (asRecord(row.siteAnnouncementError)!.status === null ||
            typeof asRecord(row.siteAnnouncementError)!.status === 'number')
            ? { status: asRecord(row.siteAnnouncementError)!.status as number | null }
            : (() => { throw new Error('Invalid site announcement error'); })(),
        upcomingCoursesError: row.upcomingCoursesError === null ? null
          : asRecord(row.upcomingCoursesError) && (asRecord(row.upcomingCoursesError)!.status === null ||
            typeof asRecord(row.upcomingCoursesError)!.status === 'number')
            ? { status: asRecord(row.upcomingCoursesError)!.status as number | null }
            : (() => { throw new Error('Invalid upcoming course error'); })(),
      };
    });
  } catch (error) {
    if (error instanceof AcademicConnectionError) throw error;
    throw new AcademicConnectionError('unavailable', error);
  }
}

export function lmsDeadlineAxis(snapshot: LmsReadonlySnapshot, now: Date) {
  return selectDeadlineAxis(snapshot.homework, now);
}

export function findLmsHomework(
  snapshot: LmsReadonlySnapshot,
  courseId: number,
  homeworkId: number,
): LmsHomeworkItem | undefined {
  return snapshot.homework.find((item) => item.courseId === courseId && item.id === homeworkId);
}


export type TronClassSubmissionReceipt = {
  status: 'verified' | 'pending';
  receiptId: string | null;
  submittedAt: string | null;
};

export async function submitTronClassHomework(
  uid: string,
  courseId: number,
  homeworkId: number,
  content: string,
): Promise<TronClassSubmissionReceipt> {
  const user = getAuth()?.currentUser;
  if (!user || !uid || user.uid !== uid || !isFirebaseConfigured() ||
      !positiveId(courseId) || !positiveId(homeworkId)) {
    throw new AcademicConnectionError('reconnect');
  }
  const token = await user.getIdToken();
  if (getAuth()?.currentUser !== user) throw new AcademicConnectionError('reconnect');
  // No automatic retry: a timeout after the remote POST is not proof of failure.
  const response = await fetch(getCloudFunctionUrl('submitMyTronClassHomework'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ data: { courseId, homeworkId, content, confirmed: true } }),
    cache: 'no-store',
  });
  const envelope = asRecord(await response.json().catch(() => null));
  if (getAuth()?.currentUser !== user) throw new AcademicConnectionError('reconnect');
  if (!response.ok || !envelope || envelope.error) {
    const reason = asRecord(envelope?.error);
    throw new Error(typeof reason?.message === 'string'
      ? reason.message.slice(0, 300) : '校方繳交狀態尚未確認，請先至玩課雲核對。');
  }
  const result = asRecord(envelope.result);
  if (!result || !['verified', 'pending'].includes(String(result.status)) ||
      !(result.receiptId === null || typeof result.receiptId === 'string') ||
      !(result.submittedAt === null || typeof result.submittedAt === 'string')) {
    throw new Error('校方回執尚未確認，請先至玩課雲核對。');
  }
  return {
    status: result.status as TronClassSubmissionReceipt['status'],
    receiptId: result.receiptId as string | null,
    submittedAt: result.submittedAt as string | null,
  };
}
