import { doc, getDocFromServer } from 'firebase/firestore';
import { getAuth, getDb, isFirebaseConfigured } from './firebase';
import { assembleAttendanceRegister, type RegisterRow } from './attendanceRegister';

export type CorrectionReview = {
  scope: string;
  revision: number | null;
  row: RegisterRow;
  active: boolean;
};
export const correctionReviewScope = (courseId: string, sessionId: string, uid: string) =>
  JSON.stringify([courseId, sessionId, uid]);

function failure(code: string): Error {
  return Object.assign(new Error('無法核對目前出席紀錄'), { code: `functions/${code}` });
}

/** 核對單一學生的目前紀錄；此讀取不寫入資料，也不代替送出時的交易檢查。 */
export async function loadCorrectionReview(
  courseId: string, sessionId: string, studentUid: string,
): Promise<CorrectionReview> {
  if (![courseId, sessionId, studentUid].every((value) => /^[A-Za-z0-9_-]{1,128}$/.test(value))) {
    throw failure('invalid-argument');
  }
  const uid = getAuth()?.currentUser?.uid;
  if (!isFirebaseConfigured() || !uid) throw failure('unauthenticated');
  const db = getDb();
  const teacher = await getDocFromServer(doc(db, 'groups', courseId, 'members', uid));
  if (getAuth()?.currentUser?.uid !== uid) throw failure('unauthenticated');
  if (teacher.metadata.fromCache || teacher.metadata.hasPendingWrites || !teacher.exists() ||
      teacher.data().status !== 'active' || !['owner', 'instructor'].includes(teacher.data().role)) {
    throw failure('permission-denied');
  }
  const [member, session, receipt] = await Promise.all([
    getDocFromServer(doc(db, 'groups', courseId, 'members', studentUid)),
    getDocFromServer(doc(db, 'groups', courseId, 'attendanceSessions', sessionId)),
    getDocFromServer(doc(db, 'groups', courseId, 'attendanceSessions', sessionId, 'attendanceRecords', studentUid)),
  ]);
  if (getAuth()?.currentUser?.uid !== uid) throw failure('unauthenticated');
  if ([member, session, receipt].some((snapshot) => snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites)) {
    throw failure('unavailable');
  }
  if (!member.exists() || member.data().status !== 'active' ||
      !['member', 'student'].includes(member.data().role)) throw failure('permission-denied');
  const data = session.exists() ? session.data() : null;
  if (!data || data.schemaVersion !== 2 || data.groupId !== courseId ||
      data.sessionId !== sessionId || typeof data.active !== 'boolean') throw failure('failed-precondition');
  const identity = member.data();
  const student = {
    uid: studentUid,
    displayName: typeof identity.displayName === 'string' ? identity.displayName : '未提供姓名',
    studentId: typeof identity.studentId === 'string' ? identity.studentId : '',
  };
  const record = receipt.exists() ? receipt.data() : null;
  const [row] = assembleAttendanceRegister([student], record ? [{ id: studentUid, data: record }] : [], {
    courseId, sessionId, complete: true,
  });
  const revision = record ? (record.revision === undefined ? 0 : record.revision) : null;
  if (row.status === 'unavailable' || (record !== null && revision === null) || (revision !== null && (
    typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER
  ))) throw failure('failed-precondition');
  return { scope: correctionReviewScope(courseId, sessionId, studentUid), revision, row, active: data.active };
}
