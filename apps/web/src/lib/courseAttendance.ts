import { attendanceReceiptTime, awaitAttendanceReceipt } from '@campus/shared/src/attendanceReliability';
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { getAuth, getCloudFunctionUrl, getDb, isFirebaseConfigured } from './firebase';
import { isFunctionsUnconfiguredError } from './functionsUrl';
import { ATTENDANCE_RESULT_UNKNOWN, requestAttendance } from './attendanceRequest';

export interface AttendanceRecord {
  uid: string;
  displayName: string;
  studentId: string;
  checkedInAt: string | null;
  status?: 'present' | 'late' | null;
  source?: 'qr' | 'manual' | null;
  correctedAt?: string | null;
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
  ownStatus?: 'present' | 'late' | 'absent' | 'excused' | null;
}
export interface CourseAttendance {
  courseId: string;
  courseName: string;
  canStart: boolean;
  canReadRoster: boolean;
  sessions: AttendanceSession[];
}
export type AttendanceCorrectionStatus = 'present' | 'late' | 'absent' | 'excused';

export type AttendanceStudent = { uid: string; displayName: string; studentId: string };
export type AttendanceCorrection = {
  id: string;
  studentUid: string;
  teacherUid: string;
  previousStatus: string | null;
  nextStatus: AttendanceCorrectionStatus;
  reason: string;
  correctedAt: string | null;
};
export interface StartAttendanceResult {
  success: boolean;
  sessionId: string;
  active: boolean;
  qrToken: string;
  qrExpiresAt: string;
}
export function studentCheckInSession(sessions: AttendanceSession[]): AttendanceSession | null {
  const active = sessions.filter((session) => session.active);
  if (active.length === 0) return null;
  return [...active].sort((left, right) =>
    String(right.startedAt ?? '').localeCompare(String(left.startedAt ?? '')),
  )[0];
}
export function studentAttendanceHeading(courseName: string, active: boolean): string {
  const name = courseName.trim() || '課程';
  return active ? `${name} · 點名進行中` : `${name} · 點名已結束`;
}
export function hasOwnActiveAttendance(sessions: AttendanceSession[], uid: string): boolean {
  return sessions.some((session) => session.active && session.teacherId === uid);
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
    status: data.status === 'present' || data.status === 'late' ? data.status : null,
    source: data.source === 'qr' || data.source === 'manual' ? data.source : null,
    correctedAt: iso(data.correctedAt),
  };
}
export async function loadCourseAttendance(
  courseId: string,
  uid: string,
): Promise<CourseAttendance> {
  if (!uid || !isFirebaseConfigured()) throw new Error('校園服務尚未連線。');
  const db = getDb();
  const member = await getDocFromServer(doc(db, 'groups', courseId, 'members', uid));
  if (!member.exists() || member.data().status !== 'active')
    throw new Error('課程成員資格已失效。');
  const role = member.data().role;
  const [course, sessions] = await Promise.all([
    getDocFromServer(doc(db, 'groups', courseId)),
    getDocsFromServer(
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
        const own = await getDocFromServer(
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
          ownStatus:
            own.exists() &&
            own.data().uid === uid &&
            own.data().groupId === courseId &&
            own.data().sessionId === entry.id &&
            ['present', 'late', 'absent', 'excused'].includes(own.data().status) &&
            (!['present', 'late'].includes(own.data().status) ||
              iso(own.data().checkedInAt))
              ? own.data().status
              : null,
          ownRecord:
            own.exists() &&
            own.data().uid === uid &&
            own.data().groupId === courseId &&
            own.data().sessionId === entry.id &&
            ['present', 'late'].includes(own.data().status) &&
            iso(own.data().checkedInAt)
              ? record(uid, own.data())
              : null,
        };
      }),
    ),
  };
}
export async function loadAttendanceRecords(
  courseId: string,
  sessionId: string,
): Promise<AttendanceRecord[]> {
  const snapshot = await getDocsFromServer(
    query(
      collection(getDb(), 'groups', courseId, 'attendanceSessions', sessionId, 'attendanceRecords'),
      orderBy('checkedInAt', 'desc'),
      limit(200),
    ),
  );
  return snapshot.docs
    .filter((entry) =>
      ['present', 'late'].includes(entry.data().status) &&
      entry.data().uid === entry.id &&
      entry.data().groupId === courseId &&
      entry.data().sessionId === sessionId &&
      iso(entry.data().checkedInAt),
    )
    .map((entry) => record(entry.id, entry.data()));
}
export async function loadAttendanceCode(courseId: string, sessionId: string): Promise<string> {
  const snapshot = await getDocFromServer(doc(getDb(), 'groups', courseId, 'liveSessionSecrets', sessionId));
  if (!snapshot.exists() || typeof snapshot.data().qrToken !== 'string')
    throw new Error('找不到簽到碼，請結束這次點名後重新開啟。');
  return snapshot.data().qrToken;
}
function callableCode(status: string): string {
  return status.toLowerCase().replaceAll('_', '-');
}

function withCallableCode(message: string, status: string): Error {
  const error = new Error(message);
  (error as Error & { code: string }).code = `functions/${callableCode(status)}`;
  return error;
}

export function attendanceActorUid(): string | null {
  return isFirebaseConfigured() ? getAuth()?.currentUser?.uid ?? null : null;
}

async function call<T>(
  name: 'startLiveSession' | 'endLiveSession' | 'joinLiveSession' | 'correctAttendanceRecord',
  input: Record<string, unknown>,
  expectedUid?: string,
): Promise<T> {
  if (!isFirebaseConfigured()) throw new Error('校園服務尚未連線。');
  return requestAttendance<T>(name, input, {
    getUser: () => getAuth()?.currentUser ?? null,
    resolveUrl: getCloudFunctionUrl,
    expectedUid,
  });
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
export async function joinCourseAttendance(groupId: string, sessionId: string, qrToken: string) {
  if (!qrToken.trim()) return Promise.reject(new Error('請輸入教師提供的簽到碼。'));
  const result = await awaitAttendanceReceipt(call<{ success: boolean; checkedInAt: string; alreadyJoined: boolean }>(
    'joinLiveSession',
    { groupId, sessionId, qrToken: qrToken.trim() },
  ));
  if (!attendanceReceiptTime(result.checkedInAt)) throw new Error('尚未取得有效收據時間');
  return result;
}

async function requireInstructor(courseId: string) {
  if (!isFirebaseConfigured()) throw new Error('校園服務尚未連線。');
  const uid = getAuth()?.currentUser?.uid;
  if (!uid) throw withCallableCode('登入已失效，請重新登入。', 'UNAUTHENTICATED');
  const docRef = doc(getDb(), 'groups', courseId, 'members', uid);
  const member = await getDocFromServer(docRef);
  if (
    !member.exists() ||
    member.data().status !== 'active' ||
    !['owner', 'instructor'].includes(member.data().role)
  ) {
    throw withCallableCode('需要授課教師權限', 'PERMISSION_DENIED');
  }
}

export async function loadCourseAttendanceRoster(courseId: string): Promise<AttendanceStudent[]> {
  await requireInstructor(courseId);
  const snapshot = await getDocsFromServer(collection(getDb(), 'groups', courseId, 'members'));
  return snapshot.docs
    .filter((entry) => entry.data().status === 'active' && ['member', 'student'].includes(entry.data().role))
    .map((entry) => {
      const data = entry.data();
      return {
        uid: entry.id,
        displayName: String(data.displayName || data.userName || '未提供姓名'),
        studentId: String(data.studentId || ''),
      };
    })
    .sort((a, b) => (a.studentId || a.displayName).localeCompare(b.studentId || b.displayName, 'zh-TW'));
}

export async function loadAttendanceCorrections(
  courseId: string,
  sessionId: string,
): Promise<AttendanceCorrection[]> {
  await requireInstructor(courseId);
  const snapshot = await getDocsFromServer(
    query(
      collection(getDb(), 'groups', courseId, 'attendanceSessions', sessionId, 'attendanceCorrections'),
      orderBy('correctedAt', 'desc'),
      limit(20),
    ),
  );
  return snapshot.docs.map((entry) => {
    const data = entry.data();
    return {
      id: entry.id,
      studentUid: String(data.studentUid || ''),
      teacherUid: String(data.teacherUid || ''),
      previousStatus: typeof data.previousStatus === 'string' ? data.previousStatus : null,
      nextStatus: data.nextStatus as AttendanceCorrectionStatus,
      reason: String(data.reason || ''),
      correctedAt: iso(data.correctedAt),
    };
  });
}

export type AttendanceCorrectionCommand = {
  groupId: string;
  sessionId: string;
  studentUid: string;
  status: AttendanceCorrectionStatus;
  reason: string;
  requestId: string;
  expectedRevision?: number | null;
  /** Local retry binding only; the server authenticates the bearer token. */
  actorUid?: string;
};

export function correctCourseAttendance(input: AttendanceCorrectionCommand) {
  if (!input.reason.trim() || input.reason.trim().length < 6 || input.reason.trim().length > 300) {
    return Promise.reject(withCallableCode('請填寫 6 至 300 個字元的更正原因。', 'INVALID_ARGUMENT'));
  }
  const { actorUid, ...command } = input;
  return call<{ success: boolean; reused: boolean; status: AttendanceCorrectionStatus }>(
    'correctAttendanceRecord',
    { ...command, reason: input.reason.trim() },
    actorUid,
  );
}

export function attendanceError(error: unknown): string {
  if (isFunctionsUnconfiguredError(error)) return '點名尚未啟用';
  const code = (error as { code?: string })?.code?.replace('functions/', '');
  if (code === ATTENDANCE_RESULT_UNKNOWN) return '尚未確認操作結果，伺服器可能已保存。請確認原操作結果，不要另建一筆。';
  if (code === 'permission-denied') return '無法使用這次點名，請確認課程資格與簽到碼。';
  if (code === 'unauthenticated') return '登入已失效，請重新登入。';
  if (code === 'deadline-exceeded') return '簽到碼已過期，請聯絡授課教師。';
  if (code === 'already-exists') return '操作識別碼已用於不同更正，請重新確認後送出。';
  if (code === 'invalid-argument') return '資料格式不符，請檢查學生、狀態與更正原因。';
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
      ['學號或帳號', '姓名', '紀錄時間', '出席狀態', '紀錄來源', '教師核定時間'],
      ...records.map((row) => [
        row.studentId || row.uid,
        row.displayName,
        row.checkedInAt ?? '',
        row.status === 'present' ? '出席' : row.status === 'late' ? '遲到' : '未標記',
        row.source === 'manual' ? '教師補登' : row.source === 'qr' ? 'QR 簽到' : '未標記',
        row.source === 'manual' ? row.correctedAt ?? '' : '',
      ]),
    ]
      .map((row) => row.map(cell).join(','))
      .join('\r\n')
  );
}
