import type { CallableRequest } from './groupInviteHandlers';
import { HttpsError } from './httpsError';
import {
  requireAcademicAccount,
  schoolSessionCookies,
  schoolSessionExpiry,
  type AcademicFirestore,
} from './academicRecordsHandlers';

export type LmsCoursesFetcher = (
  cookies: Record<string, string>,
  options: { userId?: number; status: 'ongoing' | 'completed' | 'upcoming' },
) => Promise<unknown>;

function reconnect(): never {
  throw new HttpsError('failed-precondition', 'WOW Class 尚未連線或登入已到期，請重新連線學校帳號。');
}

function shortText(value: unknown, maximum = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function semesterName(value: unknown): string | null {
  if (typeof value === 'string') return shortText(value, 100) || null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const semester = value as Record<string, unknown>;
  return shortText(semester.name, 100) || shortText(semester.code, 100) || null;
}

function publicCourses(input: unknown) {
  if (!Array.isArray(input) || input.length > 1000) {
    throw new HttpsError('unavailable', 'WOW Class 課程資料不完整，請稍後重試。');
  }
  const seen = new Set<number>();
  return input.map((item) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const id = typeof row.id === 'number' ? row.id
      : typeof row.id === 'string' && /^[0-9]+$/.test(row.id) ? Number(row.id) : Number.NaN;
    const name = shortText(row.name);
    if (!Number.isSafeInteger(id) || id <= 0 || !name || seen.has(id)) {
      throw new HttpsError('unavailable', 'WOW Class 課程資料不完整，請稍後重試。');
    }
    seen.add(id);
    const people = Array.isArray(row.teachers) ? row.teachers : [];
    return {
      id,
      name,
      code: shortText(row.course_code, 100),
      teachers: people.map((person) => shortText(person?.name, 100)).filter(Boolean).slice(0, 30),
      semester: semesterName(row.semester),
      status: shortText(row.status, 40),
      href: `https://tronclass.pu.edu.tw/course/${id}/content`,
    };
  });
}

export function createTronClassCoursesHandler({
  db,
  fetchCourses,
  now = Date.now,
}: {
  db: AcademicFirestore;
  fetchCourses: LmsCoursesFetcher;
  now?: () => number;
}) {
  return async (request: CallableRequest) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入校園帳號。');
    if (request.auth?.token?.schoolId !== 'pu') {
      throw new HttpsError('permission-denied', '此帳號尚未連結靜宜大學。');
    }
    if (!request.data || typeof request.data !== 'object' || Array.isArray(request.data)) {
      throw new HttpsError('invalid-argument', '請選擇有效的課程狀態。');
    }
    const data = request.data as Record<string, unknown>;
    const status = data.status === undefined ? 'ongoing' : data.status;
    if (typeof status !== 'string' || !['ongoing', 'completed', 'upcoming'].includes(status) ||
      Object.keys(data).some((key) => key !== 'status')) {
      throw new HttpsError('invalid-argument', '請選擇有效的課程狀態。');
    }
    try {
      await requireAcademicAccount(db, uid);
      const sessions = await db.collection('_puSessions').where('ownerUid', '==', uid)
        .orderBy('expiresAt', 'desc').limit(1).get();
      const portalSnapshot = sessions.docs[0];
      const portal = portalSnapshot?.data();
      if (portal?.ownerUid !== uid || !(schoolSessionExpiry(portal.expiresAt) > now())) reconnect();
      const linkedId = portal.tronClassSessionId;
      if (typeof linkedId !== 'string' || !/^[a-f0-9]{32}$/.test(linkedId)) reconnect();
      const sessionRef = db.doc(`_puTronClassSessions/${linkedId}`);
      const sessionSnapshot = await sessionRef.get();
      const session = sessionSnapshot.data();
      const cookies = schoolSessionCookies(session?.cookies);
      if (!sessionSnapshot.exists || session?.ownerUid !== uid || !cookies ||
        !(schoolSessionExpiry(session.expiresAt) > now())) reconnect();

      let courses;
      try {
        courses = publicCourses(await fetchCourses(cookies, {
          ...(typeof session.userId === 'number' ? { userId: session.userId } : {}),
          status: status as 'ongoing' | 'completed' | 'upcoming',
        }));
      } catch (error) {
        if (error instanceof Error && /session 已失效/.test(error.message)) reconnect();
        throw error;
      }
      await requireAcademicAccount(db, uid);
      const [currentPortal, currentSession] = await Promise.all([portalSnapshot.ref.get(), sessionRef.get()]);
      if (!currentPortal.exists || currentPortal.data()?.ownerUid !== uid ||
        currentPortal.data()?.tronClassSessionId !== linkedId ||
        !(schoolSessionExpiry(currentPortal.data()?.expiresAt) > now()) ||
        !currentSession.exists || currentSession.data()?.ownerUid !== uid ||
        !(schoolSessionExpiry(currentSession.data()?.expiresAt) > now()) ||
        !schoolSessionCookies(currentSession.data()?.cookies)) reconnect();

      return { success: true, ownerUid: uid, schoolId: 'pu', source: 'pu-tronclass',
        fetchedAt: new Date(now()).toISOString(), status, courses };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('unavailable', '暫時無法讀取 WOW Class，校務成績與學分可分別查看。');
    }
  };
}
