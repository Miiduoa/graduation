import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getDb, getFunctionsInstance, isFirebaseConfigured } from './firebase';

export interface AttendanceRecord {
  uid: string;
  displayName: string;
  studentId: string;
  checkedInAt: string | null;
}
export interface AttendanceSession {
  id: string;
  teacherId: string;
  active: boolean;
  startedAt: string | null;
  endedAt: string | null;
  qrExpiresAt: string | null;
  attendeeCount: number;
  ownRecord: AttendanceRecord | null;
}
export interface CourseAttendance {
  courseId: string;
  courseName: string;
  canStart: boolean;
  canReadRoster: boolean;
  sessions: AttendanceSession[];
}
export interface StartAttendanceResult {
  success: boolean;
  sessionId: string;
  active: boolean;
  qrToken: string;
  qrExpiresAt: string;
}
export function watchCourseMembership(
  courseId: string,
  uid: string,
  changed: (role: string | null) => void,
) {
  if (!isFirebaseConfigured()) {
    changed(null);
    return () => {};
  }
  return onSnapshot(
    doc(getDb(), 'groups', courseId, 'members', uid),
    { includeMetadataChanges: true },
    (snapshot) =>
      changed(
        !snapshot.metadata.fromCache && snapshot.exists() && snapshot.data().status === 'active'
          ? String(snapshot.data().role ?? 'member')
          : null,
      ),
    () => changed(null),
  );
}
function iso(value: unknown): string | null {
  if (!value) return null;
  const stamp = value as { toDate?: () => Date };
  const date = typeof stamp.toDate === 'function' ? stamp.toDate() : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function record(uid: string, data: Record<string, unknown>): AttendanceRecord {
  return {
    uid,
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    studentId: typeof data.studentId === 'string' ? data.studentId : '',
    checkedInAt: iso(data.checkedInAt),
  };
}
export async function loadCourseAttendance(
  courseId: string,
  uid: string,
): Promise<CourseAttendance> {
  if (!uid || !isFirebaseConfigured()) throw new Error('校園服務尚未連線。');
  const db = getDb();
  const member = await getDoc(doc(db, 'groups', courseId, 'members', uid));
  if (!member.exists() || member.data().status !== 'active')
    throw new Error('課程成員資格已失效。');
  const role = member.data().role;
  const [course, sessions] = await Promise.all([
    getDoc(doc(db, 'groups', courseId)),
    getDocs(
      query(
        collection(db, 'groups', courseId, 'attendanceSessions'),
        where('schemaVersion', '==', 2),
        orderBy('startedAt', 'desc'),
        limit(50),
      ),
    ),
  ]);
  if (!course.exists()) throw new Error('找不到這門課。');
  return {
    courseId,
    courseName: String(course.data().name ?? '課程'),
    canStart: ['owner', 'instructor'].includes(role),
    canReadRoster: ['owner', 'instructor', 'admin', 'moderator'].includes(role),
    sessions: await Promise.all(
      sessions.docs.map(async (entry) => {
        const data = entry.data();
        const own = await getDoc(
          doc(db, 'groups', courseId, 'attendanceSessions', entry.id, 'attendanceRecords', uid),
        );
        return {
          id: entry.id,
          teacherId: String(data.teacherId ?? ''),
          active: data.active === true,
          startedAt: iso(data.startedAt),
          endedAt: iso(data.endedAt),
          qrExpiresAt: iso(data.qrExpiresAt),
          attendeeCount: Math.max(0, Number(data.attendeeCount) || 0),
          ownRecord: own.exists() ? record(uid, own.data()) : null,
        };
      }),
    ),
  };
}
export async function loadAttendanceRecords(
  courseId: string,
  sessionId: string,
): Promise<AttendanceRecord[]> {
  const snapshot = await getDocs(
    query(
      collection(getDb(), 'groups', courseId, 'attendanceSessions', sessionId, 'attendanceRecords'),
      orderBy('checkedInAt', 'desc'),
      limit(200),
    ),
  );
  return snapshot.docs.map((entry) => record(entry.id, entry.data()));
}
export async function loadAttendanceCode(courseId: string, sessionId: string): Promise<string> {
  const snapshot = await getDoc(doc(getDb(), 'groups', courseId, 'liveSessionSecrets', sessionId));
  if (!snapshot.exists() || typeof snapshot.data().qrToken !== 'string')
    throw new Error('找不到簽到碼，請結束這次點名後重新開啟。');
  return snapshot.data().qrToken;
}
async function call<T>(name: string, input: Record<string, unknown>): Promise<T> {
  if (!isFirebaseConfigured()) throw new Error('校園服務尚未連線。');
  const response = await httpsCallable<Record<string, unknown>, T>(
    getFunctionsInstance(),
    name,
  )(input);
  if (!(response.data as { success?: boolean })?.success) throw new Error('無法確認操作結果。');
  return response.data;
}
export function startCourseAttendance(groupId: string, requestId: string) {
  return call<StartAttendanceResult>('startLiveSession', {
    groupId,
    requestId,
    qrExpiryMinutes: 10,
  });
}
export function endCourseAttendance(groupId: string, sessionId: string) {
  return call('endLiveSession', { groupId, sessionId });
}
export function joinCourseAttendance(groupId: string, sessionId: string, qrToken: string) {
  if (!qrToken.trim()) return Promise.reject(new Error('請輸入教師提供的簽到碼。'));
  return call<{ success: boolean; checkedInAt: string; alreadyJoined: boolean }>(
    'joinLiveSession',
    { groupId, sessionId, qrToken: qrToken.trim() },
  );
}
export function attendanceError(error: unknown): string {
  const code = (error as { code?: string })?.code?.replace('functions/', '');
  if (code === 'permission-denied') return '無法使用這次點名，請確認課程資格與簽到碼。';
  if (code === 'unauthenticated') return '登入已失效，請重新登入。';
  if (code === 'deadline-exceeded') return '簽到碼已過期，請聯絡授課教師。';
  if (code === 'not-found' || code === 'failed-precondition')
    return '點名已結束或尚未開放，請更新紀錄。';
  return '未能確認操作結果。請更新紀錄確認；若未完成，可以重試。';
}
export function attendanceCsv(records: AttendanceRecord[]): string {
  const cell = (value: string) => {
    const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return (
    '\uFEFF' +
    [
      ['學號或帳號', '姓名', '簽到時間'],
      ...records.map((row) => [row.studentId || row.uid, row.displayName, row.checkedInAt ?? '']),
    ]
      .map((row) => row.map(cell).join(','))
      .join('\r\n')
  );
}
