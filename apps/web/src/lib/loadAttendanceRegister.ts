import { collection, doc, getDocFromServer, getDocsFromServer, limit, query } from 'firebase/firestore';
import { getDb } from './firebase';
import { loadCourseAttendanceRoster } from './courseAttendance';
import { assembleAttendanceRegister, type AttendanceRegister } from './attendanceRegister';

export const MAX_REGISTER_RECEIPTS = 500;

/** 只在教師主動開啟或更新時查詢，不對全班逐人讀取或持續輪詢。 */
export async function loadAttendanceRegister(courseId: string, sessionId: string): Promise<AttendanceRegister> {
  // 此入口會先從伺服器核對授課資格，再取得目前有效修課名冊。
  const students = await loadCourseAttendanceRoster(courseId);
  const db = getDb();
  const sessionRef = doc(db, 'groups', courseId, 'attendanceSessions', sessionId);
  const session = await getDocFromServer(sessionRef);
  const data = session.exists() ? session.data() : null;
  if (!data || data.schemaVersion !== 2 || data.groupId !== courseId ||
      data.sessionId !== sessionId || typeof data.active !== 'boolean') {
    throw Object.assign(new Error('點名場次無法核實'), { code: 'functions/failed-precondition' });
  }
  // 不依 checkedInAt 排序，以免漏掉沒有簽到時間的缺席或請假紀錄。
  const snapshot = await getDocsFromServer(query(
    collection(db, 'groups', courseId, 'attendanceSessions', sessionId, 'attendanceRecords'),
    limit(MAX_REGISTER_RECEIPTS + 1),
  ));
  const complete = snapshot.docs.length <= MAX_REGISTER_RECEIPTS;
  return {
    rows: assembleAttendanceRegister(students, snapshot.docs.slice(0, MAX_REGISTER_RECEIPTS)
      .map((entry) => ({ id: entry.id, data: entry.data() })), { courseId, sessionId, complete }),
    complete, active: data.active, checkedAt: new Date().toISOString(),
  };
}
