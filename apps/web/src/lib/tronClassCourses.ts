import { getAuth, getCloudFunctionUrl, isFirebaseConfigured } from './firebase';
import { AcademicConnectionError } from './academicClient';
import { withSchoolDataDeadline } from './schoolDataRequest';

export type TronClassCourseStatus = 'ongoing' | 'completed' | 'upcoming';
export type SchoolLmsCourse = {
  id: number;
  name: string;
  code: string;
  teachers: string[];
  semester: string | null;
  status: string;
  href: string;
};
export type SchoolLmsSnapshot = {
  ownerUid: string;
  schoolId: 'pu';
  source: 'pu-tronclass';
  fetchedAt: string;
  status: TronClassCourseStatus;
  courses: SchoolLmsCourse[];
};

export async function loadTronClassCourses(
  uid: string,
  status: TronClassCourseStatus = 'ongoing',
  expectedSchool = 'pu',
): Promise<SchoolLmsSnapshot> {
  const user = getAuth()?.currentUser;
  if (!uid || !isFirebaseConfigured() || expectedSchool !== 'pu' || !user || user.uid !== uid) {
    throw new AcademicConnectionError('unavailable');
  }
  if (!['ongoing', 'completed', 'upcoming'].includes(status)) {
    throw new AcademicConnectionError('unavailable');
  }
  try {
    return await withSchoolDataDeadline(async (signal): Promise<SchoolLmsSnapshot> => {
      const token = await user.getIdToken();
      if (getAuth()?.currentUser !== user) throw new AcademicConnectionError('reconnect');
      if (signal.aborted) throw new AcademicConnectionError('unavailable');
      const response = await fetch(getCloudFunctionUrl('getMyTronClassCourses'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ data: { status } }),
        cache: 'no-store',
        signal,
      });
      const payload: unknown = await response.json();
      if (getAuth()?.currentUser !== user) throw new AcademicConnectionError('reconnect');
      if (signal.aborted) throw new AcademicConnectionError('unavailable');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid response');
      const envelope = payload as Record<string, unknown>;
      if (!response.ok || envelope.error) {
        const error = envelope.error && typeof envelope.error === 'object'
          ? envelope.error as Record<string, unknown> : {};
        if (response.status === 401 || ['UNAUTHENTICATED', 'FAILED_PRECONDITION'].includes(String(error.status))) {
          throw new AcademicConnectionError('reconnect');
        }
        if (response.status === 403 || error.status === 'PERMISSION_DENIED') {
          throw new AcademicConnectionError('permission');
        }
        throw new AcademicConnectionError('unavailable');
      }
      const row = envelope.result as Record<string, unknown> | undefined;
      if (!row || row.success !== true || row.ownerUid !== uid || row.schoolId !== expectedSchool ||
        row.source !== 'pu-tronclass' || row.status !== status || typeof row.fetchedAt !== 'string' ||
        !Number.isFinite(Date.parse(row.fetchedAt)) || !Array.isArray(row.courses) || row.courses.length > 1000) {
        throw new Error('School course response does not match the active account');
      }
      const seen = new Set<number>();
      const courses = row.courses.map((value: unknown): SchoolLmsCourse => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid course');
        const course = value as Record<string, unknown>;
        if (typeof course.id !== 'number' || !Number.isSafeInteger(course.id) || course.id <= 0 || seen.has(course.id) ||
          typeof course.name !== 'string' || !course.name.trim() || course.name.length > 300 ||
          typeof course.code !== 'string' || typeof course.status !== 'string' ||
          !(course.semester === null || typeof course.semester === 'string') ||
          !Array.isArray(course.teachers) || course.teachers.some((name) => typeof name !== 'string')) {
          throw new Error('Invalid course');
        }
        seen.add(course.id);
        // 課程連結由可信 ID 組成，不採用來源回應中的任意外部網址。
        return { id: course.id, name: course.name, code: course.code,
          teachers: course.teachers as string[], semester: course.semester as string | null,
          status: course.status, href: `https://tronclass.pu.edu.tw/course/${course.id}/content` };
      });
      return { ownerUid: uid, schoolId: 'pu', source: 'pu-tronclass', fetchedAt: row.fetchedAt, status, courses };
    });
  } catch (error) {
    if (error instanceof AcademicConnectionError) throw error;
    throw new AcademicConnectionError('unavailable', error);
  }
}
