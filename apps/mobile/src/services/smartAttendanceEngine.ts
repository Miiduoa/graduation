/* eslint-disable */
/**
 * smartAttendanceEngine.ts — 智慧點名引擎 v4
 *
 * 設計原則：
 * 1. 只保留可實際運作的模式：QR 碼、數字密碼、手動
 * 2. TronClass 真實課程 + 學生名冊優先
 * 3. AsyncStorage 持久化（未來可擴展到 Firestore）
 * 4. 清晰的角色分離：教師建立、學生簽到、管理者查看
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { campusEventBus } from './campusEventBus';
import {
  tcFetchCourses,
  tcFetchAttendance,
  tcFetchCourseMembers,
  hasTCSession,
  type TCCourse,
  type TCAttendance,
  type TCCourseMember,
} from './tronClassClient';
import {
  getAnyCachedTCCourses,
  getAnyCachedTCAttendance,
  getAnyCachedCourses,
  seedCachedTCCourses,
  seedCachedTCAttendance,
} from './puDataCache';
import { loadMockAuthSession } from './mockAuth';
import { isTestAccount, getTestClassRoster } from './testSeedData';
import type { PostLoginEngineBootstrap } from './postLoginBootstrapStore';
import { getDb, isFirebaseMockMode } from '../firebase';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/** 點名模式 — 只保留可實際運作的 */
export type AttendanceMode = 'rotating_qr' | 'number_code' | 'manual';

/** 出席狀態 */
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused';

/** 假單類別 */
export type LeaveCategory = 'medical' | 'family' | 'official' | 'personal' | 'other';

/** 課程資料（從 TronClass 映射） */
export type AttendanceCourse = {
  id: string;
  tcId: number;
  name: string;
  courseCode: string;
  role: 'teacher' | 'student' | 'ta';
  studentCount: number;
  instructorName: string;
  semester: string;
  department: string;
  schedule: string;
  totalSessions: number;
  attended: number;
  absent: number;
  late: number;
  leave: number;
  rate: number;
};

/** 學生簽到紀錄 */
export type AttendanceRecord = {
  id: string;
  sessionId: string;
  studentId: string;
  studentName: string;
  avatarUrl: string | null;
  status: AttendanceStatus;
  checkInTime: number | null;
  note: string;
};

/** 點名場次 */
export type AttendanceSession = {
  id: string;
  courseId: string;
  courseName: string;
  courseCode: string;
  teacherId: string;
  teacherName: string;
  sessionDate: string;
  startTime: number;
  endTime: number | null;
  location: string;
  mode: AttendanceMode;
  status: 'active' | 'completed' | 'cancelled';
  /** QR 碼旋轉密鑰 */
  qrSecret: string;
  /** 數字密碼（6 位） */
  numberCode: string;
  /** 遲到門檻（分鐘） */
  lateThresholdMinutes: number;
  totalStudents: number;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  excusedCount: number;
  records: AttendanceRecord[];
  createdAt: number;
};

/** 假單 */
export type LeaveRequest = {
  id: string;
  studentId: string;
  studentName: string;
  courseId: string;
  courseName: string;
  sessionId: string;
  reason: string;
  category: LeaveCategory;
  status: 'pending' | 'approved' | 'rejected';
  evidence: string | null;
  submittedAt: number;
  reviewedAt: number | null;
  reviewedBy: string | null;
  reviewNote: string | null;
};

/** 學生出席分析 */
export type StudentAnalytics = {
  studentId: string;
  overallRate: number;
  courseBreakdown: {
    courseId: string;
    courseName: string;
    totalSessions: number;
    attended: number;
    late: number;
    absent: number;
    excused: number;
    rate: number;
  }[];
  streak: { current: number; best: number };
  riskLevel: 'safe' | 'warning' | 'danger';
  weekdayPattern: { day: string; rate: number }[];
};

/** 教師出席分析 */
export type TeacherAnalytics = {
  courseId: string;
  courseName: string;
  totalSessions: number;
  averageAttendanceRate: number;
  riskStudents: { studentId: string; studentName: string; rate: number; absences: number }[];
  attendanceTrend: { date: string; rate: number }[];
};

// ============================================================================
// STORAGE KEYS
// ============================================================================

const STORAGE = {
  SESSIONS: '@attend:sessions',
  LEAVE_REQUESTS: '@attend:leaves',
  COURSES: '@attend:courses',
  COURSES_TS: '@attend:coursesTs',
} as const;

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// FIRESTORE 即時同步層 — 跨裝置 sessions 同步
// ============================================================================

const FIRESTORE_COLLECTION = 'attendanceSessions';
const FIRESTORE_LEAVES_COLLECTION = 'attendanceLeaves';

/** 將本地 session 寫入 Firestore（教師建立/更新時呼叫） */
async function syncSessionToFirestore(session: AttendanceSession): Promise<void> {
  if (isFirebaseMockMode()) return;
  try {
    const db = getDb();
    const ref = doc(collection(db, FIRESTORE_COLLECTION), session.id);
    await setDoc(ref, {
      ...session,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    console.warn('[Attendance] Firestore sync failed (non-fatal):', e);
  }
}

/** 從 Firestore 讀取進行中的場次（學生端用） */
async function fetchActiveSessionsFromFirestore(courseIds?: string[]): Promise<AttendanceSession[]> {
  if (isFirebaseMockMode()) return [];
  try {
    const db = getDb();
    const col = collection(db, FIRESTORE_COLLECTION);
    const q = query(col, where('status', '==', 'active'));
    const snap = await getDocs(q);
    let sessions: AttendanceSession[] = [];
    snap.forEach((d) => {
      const data = d.data() as AttendanceSession;
      sessions.push({ ...data, id: d.id });
    });
    // 如果有課程 ID 過濾
    if (courseIds && courseIds.length > 0) {
      const idSet = new Set(courseIds);
      sessions = sessions.filter((s) => idSet.has(s.courseId));
    }
    return sessions;
  } catch (e) {
    console.warn('[Attendance] Firestore fetch failed:', e);
    return [];
  }
}

/** 即時監聽進行中場次（用於 AttendanceLiveScreen 即時更新） */
export function subscribeToSession(
  sessionId: string,
  callback: (session: AttendanceSession | null) => void,
): Unsubscribe {
  if (isFirebaseMockMode()) {
    // fallback：每 3 秒輪詢本地
    const interval = setInterval(async () => {
      const s = await getSessionById(sessionId);
      callback(s);
    }, 3000);
    return () => clearInterval(interval);
  }
  const db = getDb();
  const ref = doc(collection(db, FIRESTORE_COLLECTION), sessionId);
  return onSnapshot(ref, (snap) => {
    if (snap.exists()) {
      callback({ ...(snap.data() as AttendanceSession), id: snap.id });
    } else {
      callback(null);
    }
  }, (err) => {
    console.warn('[Attendance] onSnapshot error:', err);
  });
}

/** 即時監聽學生可見的進行中場次 */
export function subscribeToActiveSessions(
  courseIds: string[],
  callback: (sessions: AttendanceSession[]) => void,
): Unsubscribe {
  if (isFirebaseMockMode()) {
    const interval = setInterval(async () => {
      const s = await getActiveSessions();
      callback(s);
    }, 5000);
    return () => clearInterval(interval);
  }
  const db = getDb();
  const col = collection(db, FIRESTORE_COLLECTION);
  const q = query(col, where('status', '==', 'active'));
  return onSnapshot(q, (snap) => {
    const idSet = new Set(courseIds);
    const sessions: AttendanceSession[] = [];
    snap.forEach((d) => {
      const data = d.data() as AttendanceSession;
      if (idSet.size === 0 || idSet.has(data.courseId)) {
        sessions.push({ ...data, id: d.id });
      }
    });
    callback(sessions);
  }, (err) => {
    console.warn('[Attendance] subscribeToActiveSessions error:', err);
  });
}

// (已移除硬編碼假課程 — 改由 puDataCache 統一快取提供真實課表資料)
// (已移除 FALLBACK_STUDENTS 假名字 — 無真實名冊時回傳空陣列)

// ============================================================================
// QR CODE SYSTEM — 每 3 秒旋轉的 TOTP 碼
// ============================================================================

export function generateRotatingQR(sessionId: string, secret: string, timestamp?: number): string {
  const ts = timestamp || Date.now();
  const timeStep = Math.floor(ts / 3000);
  const input = `${secret}:${timeStep}`;
  const payload = `${sessionId}:${input}`;
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString().padStart(10, '0').substring(0, 8);
}

export function validateRotatingQR(
  sessionId: string,
  secret: string,
  code: string,
  tolerance = 1,
): boolean {
  const now = Date.now();
  for (let i = -tolerance; i <= tolerance; i++) {
    if (generateRotatingQR(sessionId, secret, now + i * 3000) === code) return true;
  }
  return false;
}

// ============================================================================
// NUMBER CODE SYSTEM — 6 位數字密碼
// ============================================================================

export function generateNumberCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ============================================================================
// COURSE LOADING (TronClass → fallback)
// ============================================================================

export async function getAttendanceCourses(): Promise<AttendanceCourse[]> {
  try {
    // Check cache
    const cached = await AsyncStorage.getItem(STORAGE.COURSES);
    const cachedTs = await AsyncStorage.getItem(STORAGE.COURSES_TS);
    if (cached && cachedTs && Date.now() - parseInt(cachedTs) < CACHE_TTL) {
      return JSON.parse(cached);
    }

    // Try TronClass
    if (await hasTCSession()) {
      const tcCourses = await tcFetchCourses('ongoing');
      const tcAttendance = await tcFetchAttendance();

      const courses: AttendanceCourse[] = tcCourses.map((c: TCCourse) => {
        const att = tcAttendance.find((a: TCAttendance) => a.course_id === c.id);
        return {
          id: c.id.toString(),
          tcId: c.id,
          name: c.name,
          courseCode: c.course_code || c.name,
          role: (c.role === 'teacher'
            ? 'teacher'
            : c.role === 'ta'
              ? 'ta'
              : 'student') as AttendanceCourse['role'],
          studentCount: c.student_count || 30,
          instructorName: c.instructors?.[0]?.name || '教師',
          semester: c.semester?.code || '1131',
          department: c.department?.name || '資管系',
          schedule: (c as any).schedule || '',
          totalSessions: att?.total_sessions || 0,
          attended: att?.attended || 0,
          absent: att?.absent || 0,
          late: att?.late || 0,
          leave: att?.leave || 0,
          rate: att ? Math.round((att.attended / (att.total_sessions || 1)) * 100) : 0,
        };
      });

      await AsyncStorage.setItem(STORAGE.COURSES, JSON.stringify(courses));
      await AsyncStorage.setItem(STORAGE.COURSES_TS, Date.now().toString());

      // 回寫統一快取 — 讓其他引擎也能讀到最新資料
      await seedCachedTCCourses(tcCourses);
      await seedCachedTCAttendance(tcAttendance);

      return courses;
    }
  } catch (e) {
    console.log('TronClass direct fetch failed, trying cached data:', e);
  }

  // Fallback 層級 1：從 puDataCache 讀取 TronClass 快取（與課表相同來源）
  try {
    const cachedTC = await getAnyCachedTCCourses();
    const cachedAttendance = await getAnyCachedTCAttendance();
    if (cachedTC && cachedTC.length > 0) {
      const courses: AttendanceCourse[] = cachedTC.map((c) => {
        const att = cachedAttendance?.find((a) => a.course_id === c.id);
        return {
          id: c.id.toString(),
          tcId: c.id,
          name: c.name,
          courseCode: c.course_code || c.name,
          role: (c.role === 'teacher'
            ? 'teacher'
            : c.role === 'ta'
              ? 'ta'
              : 'student') as AttendanceCourse['role'],
          studentCount: c.student_count || 30,
          instructorName: c.instructors?.[0]?.name || '教師',
          semester: c.semester?.code || '1131',
          department: c.department?.name || '資管系',
          schedule: (c as any).schedule || '',
          totalSessions: att?.total_sessions || 0,
          attended: att?.attended || 0,
          absent: att?.absent || 0,
          late: att?.late || 0,
          leave: att?.leave || 0,
          rate: att ? Math.round((att.attended / (att.total_sessions || 1)) * 100) : 0,
        };
      });
      await AsyncStorage.setItem(STORAGE.COURSES, JSON.stringify(courses));
      await AsyncStorage.setItem(STORAGE.COURSES_TS, Date.now().toString());
      console.log(
        `[Attendance] Loaded ${courses.length} courses from puDataCache (same as schedule)`,
      );
      return courses;
    }
  } catch (_) {}

  // Fallback 層級 2：從 E校園快取讀取課表（與 SmartDashboard / 課表資料源一致）
  try {
    const puCourses = await getAnyCachedCourses();
    if (puCourses && puCourses.courses.length > 0) {
      const courses: AttendanceCourse[] = puCourses.courses.map((c, idx) => ({
        id: `pu_${idx}`,
        tcId: 0,
        name: c.name,
        courseCode: c.code || c.name,
        role: 'student' as const,
        studentCount: 30,
        instructorName: c.teacherName || '教師',
        semester: puCourses.semester || '1131',
        department: '',
        schedule: c.timePlaceRaw || '',
        totalSessions: 0,
        attended: 0,
        absent: 0,
        late: 0,
        leave: 0,
        rate: 0,
      }));
      await AsyncStorage.setItem(STORAGE.COURSES, JSON.stringify(courses));
      await AsyncStorage.setItem(STORAGE.COURSES_TS, Date.now().toString());
      console.log(`[Attendance] Loaded ${courses.length} courses from E校園 cache`);
      return courses;
    }
  } catch (_) {}

  // Fallback 層級 3：完全無資料時才用假資料（不應該正常發生）
  console.warn('[Attendance] No real course data available, returning empty list');
  return [];
}

/**
 * 取得「有點名紀錄」的課程 — 過濾掉老師從未點名的課
 * 用於出席分析頁面：只顯示老師真的有開過點名的課程
 */
export async function getCoursesWithAttendance(): Promise<AttendanceCourse[]> {
  const courses = await getAttendanceCourses();
  // totalSessions > 0 代表老師至少點名過一次
  // 或者本地 sessions 中有該課程的紀錄
  const sessions = await getAllSessions();
  const localCourseIds = new Set(sessions.map((s) => s.courseId));

  return courses.filter((c) => c.totalSessions > 0 || localCourseIds.has(c.id));
}

/** 取得課程的真實學生名冊 */
export async function getCourseStudents(courseId: number): Promise<
  {
    id: string;
    name: string;
    avatarUrl: string | null;
  }[]
> {
  try {
    if (await hasTCSession()) {
      const members = await tcFetchCourseMembers(courseId);
      return members
        .filter((m: TCCourseMember) => m.role === 'student')
        .map((s: TCCourseMember) => ({
          id: s.id.toString(),
          name: s.name,
          avatarUrl: s.avatar_url ?? null,
        }));
    }
  } catch (e) {
    console.log('Failed to fetch members:', e);
  }
  // 測試帳號 → 回傳共用同學名冊
  try {
    const session = await loadMockAuthSession();
    if (session && isTestAccount(session.uid)) {
      const roster = getTestClassRoster();
      return roster.map((c) => ({
        id: c.uid,
        name: c.displayName,
        avatarUrl: null,
      }));
    }
  } catch (_) { /* ignore */ }

  // 無法取得真實名冊 — 回傳空陣列，UI 層應顯示「無法載入名冊」
  console.warn('[Attendance] No real student roster available');
  return [];
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/** 建立點名場次（教師） */
export async function createSession(config: {
  courseId: string;
  tcCourseId: number;
  courseName: string;
  courseCode: string;
  teacherId: string;
  teacherName: string;
  mode: AttendanceMode;
  location?: string;
  lateThresholdMinutes?: number;
}): Promise<AttendanceSession> {
  const now = Date.now();
  const id = `sess_${now}`;
  const students = await getCourseStudents(config.tcCourseId);

  const session: AttendanceSession = {
    id,
    courseId: config.courseId,
    courseName: config.courseName,
    courseCode: config.courseCode,
    teacherId: config.teacherId,
    teacherName: config.teacherName,
    sessionDate: new Date().toISOString().split('T')[0],
    startTime: now,
    endTime: null,
    location: config.location || '',
    mode: config.mode,
    status: 'active',
    qrSecret: `qr_${now}_${Math.random().toString(36).slice(2)}`,
    numberCode: generateNumberCode(),
    lateThresholdMinutes: config.lateThresholdMinutes ?? 15,
    totalStudents: students.length || 30,
    presentCount: 0,
    lateCount: 0,
    absentCount: 0,
    excusedCount: students.length || 30,
    records: students.map((s) => ({
      id: `rec_${now}_${s.id}`,
      sessionId: id,
      studentId: s.id,
      studentName: s.name,
      avatarUrl: s.avatarUrl,
      status: 'absent' as const,
      checkInTime: null,
      note: '',
    })),
    createdAt: now,
  };

  const sessions = await getAllSessions();
  sessions.push(session);
  await AsyncStorage.setItem(STORAGE.SESSIONS, JSON.stringify(sessions));

  // 同步到 Firestore — 讓學生端即時看到
  await syncSessionToFirestore(session);

  // Emit event → 行事曆 + 推播引擎會自動反應
  campusEventBus.emit('session:started', {
    sessionId: id,
    courseId: config.courseId,
    courseName: config.courseName,
    teacherId: config.teacherId,
    mode: config.mode,
  });

  return session;
}

/** 取得所有場次 */
export async function getAllSessions(courseId?: string): Promise<AttendanceSession[]> {
  const data = await AsyncStorage.getItem(STORAGE.SESSIONS);
  let sessions: AttendanceSession[] = data ? JSON.parse(data) : [];
  if (courseId) sessions = sessions.filter((s) => s.courseId === courseId);
  return sessions;
}

/** 取得單一場次 */
export async function getSessionById(sessionId: string): Promise<AttendanceSession | null> {
  const sessions = await getAllSessions();
  return sessions.find((s) => s.id === sessionId) || null;
}

/** 取得進行中的場次 */
export async function getActiveSession(courseId?: string): Promise<AttendanceSession | null> {
  const sessions = await getAllSessions(courseId);
  return sessions.find((s) => s.status === 'active') || null;
}

/** 取得任何進行中的場次（學生用） */
export async function getActiveSessions(): Promise<AttendanceSession[]> {
  const sessions = await getAllSessions();
  return sessions.filter((s) => s.status === 'active');
}

/**
 * 取得學生可簽到的場次 — 只回傳「我有修的課 + 老師已啟動點名」的場次
 *
 * 規則：
 * 1. 必須是學生有選修的課程（courseId 在 enrolledCourseIds 中）
 * 2. 必須是教師已啟動的進行中場次（status === 'active'）
 * 3. 兩個條件缺一不可
 */
export async function getActiveSessionsForStudent(
  enrolledCourseIds?: string[],
): Promise<AttendanceSession[]> {
  // 1. 嘗試取得學生的選課 ID 列表
  let courseIdFilter: string[] = enrolledCourseIds || [];
  if (courseIdFilter.length === 0) {
    try {
      const cachedRaw = await AsyncStorage.getItem(STORAGE.COURSES);
      if (cachedRaw) {
        const cachedCourses: AttendanceCourse[] = JSON.parse(cachedRaw);
        courseIdFilter = cachedCourses.filter((c) => c.role === 'student').map((c) => c.id);
      }
    } catch (_) {}
  }

  // 2. 同時查詢本機 + Firestore（教師場次在雲端）
  const [localSessions, firestoreSessions] = await Promise.all([
    getAllSessions().then((s) => s.filter((ss) => ss.status === 'active')),
    fetchActiveSessionsFromFirestore(courseIdFilter.length > 0 ? courseIdFilter : undefined),
  ]);

  // 3. 合併去重（以 session.id 為主鍵，Firestore 版本優先）
  const merged = new Map<string, AttendanceSession>();
  localSessions.forEach((s) => merged.set(s.id, s));
  firestoreSessions.forEach((s) => merged.set(s.id, s)); // Firestore 覆蓋本地

  let results = Array.from(merged.values());

  // 4. 嚴格過濾：只回傳學生修的課
  if (courseIdFilter.length > 0) {
    const idSet = new Set(courseIdFilter);
    results = results.filter((s) => idSet.has(s.courseId));
  }

  return results;
}

/** 結束點名場次 */
export async function endSession(sessionId: string): Promise<void> {
  const sessions = await getAllSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return;

  session.status = 'completed';
  session.endTime = Date.now();
  session.presentCount = session.records.filter((r) => r.status === 'present').length;
  session.lateCount = session.records.filter((r) => r.status === 'late').length;
  session.absentCount = session.records.filter((r) => r.status === 'absent').length;
  session.excusedCount = session.records.filter((r) => r.status === 'excused').length;

  await AsyncStorage.setItem(STORAGE.SESSIONS, JSON.stringify(sessions));

  // 同步到 Firestore — 學生端 + 管理端即時看到完成
  await syncSessionToFirestore(session);

  // 嘗試回寫 TronClass（best-effort — API 端點可能不可用）
  try {
    if (await hasTCSession()) {
      // TronClass attendance write-back API 目前返回 404/403
      // 當 API 可用時，這裡應呼叫 tcSubmitAttendanceRecords()
      console.log('[Attendance] TronClass write-back: API endpoints currently unavailable (404/403). Session data saved locally and to Firestore.');
    }
  } catch (_) {}

  // Emit event → 出席分析 + 風險預警
  const rate =
    session.totalStudents > 0
      ? Math.round(((session.presentCount + session.lateCount) / session.totalStudents) * 100)
      : 0;
  campusEventBus.emit('session:ended', {
    sessionId,
    courseId: session.courseId,
    presentCount: session.presentCount,
    totalStudents: session.totalStudents,
    rate,
  });
}

// ============================================================================
// CHECK-IN（學生簽到）
// ============================================================================

export async function checkIn(
  sessionId: string,
  studentId: string,
  studentName: string,
): Promise<{ success: boolean; status: AttendanceStatus; message: string }> {
  const sessions = await getAllSessions();
  const session = sessions.find((s) => s.id === sessionId);

  if (!session) return { success: false, status: 'absent', message: '點名場次不存在' };
  if (session.status !== 'active')
    return { success: false, status: 'absent', message: '點名已結束' };

  const elapsed = (Date.now() - session.startTime) / 60000;
  const isLate = elapsed > session.lateThresholdMinutes;
  const status: AttendanceStatus = isLate ? 'late' : 'present';

  let record = session.records.find((r) => r.studentId === studentId);
  if (record) {
    if (record.checkInTime) {
      return { success: false, status: record.status, message: '你已經簽到過了' };
    }
    record.status = status;
    record.checkInTime = Date.now();
  } else {
    record = {
      id: `rec_${Date.now()}_${studentId}`,
      sessionId,
      studentId,
      studentName,
      avatarUrl: null,
      status,
      checkInTime: Date.now(),
      note: '',
    };
    session.records.push(record);
  }

  // Update counts
  session.presentCount = session.records.filter((r) => r.status === 'present').length;
  session.lateCount = session.records.filter((r) => r.status === 'late').length;
  session.absentCount = session.records.filter((r) => r.status === 'absent').length;

  await AsyncStorage.setItem(STORAGE.SESSIONS, JSON.stringify(sessions));

  // 同步到 Firestore — 教師端即時看到學生簽到
  syncSessionToFirestore(session).catch(() => {});

  // Emit event → XP + 校園脈動
  campusEventBus.emit('attendance:checked_in', {
    sessionId,
    courseId: session.courseId,
    studentId,
    studentName,
    status,
  });

  return {
    success: true,
    status,
    message:
      status === 'present'
        ? '簽到成功！準時出席'
        : `簽到成功，但已遲到 ${Math.round(elapsed)} 分鐘`,
  };
}

/** 教師手動更改學生狀態 */
export async function updateStudentStatus(
  sessionId: string,
  studentId: string,
  newStatus: AttendanceStatus,
  note?: string,
): Promise<void> {
  const sessions = await getAllSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return;

  const record = session.records.find((r) => r.studentId === studentId);
  if (record) {
    record.status = newStatus;
    if (note) record.note = note;
    if (newStatus === 'present' || newStatus === 'late')
      record.checkInTime = record.checkInTime || Date.now();
  }

  session.presentCount = session.records.filter((r) => r.status === 'present').length;
  session.lateCount = session.records.filter((r) => r.status === 'late').length;
  session.absentCount = session.records.filter((r) => r.status === 'absent').length;
  session.excusedCount = session.records.filter((r) => r.status === 'excused').length;

  await AsyncStorage.setItem(STORAGE.SESSIONS, JSON.stringify(sessions));

  // 同步到 Firestore
  syncSessionToFirestore(session).catch(() => {});
}

// ============================================================================
// LEAVE REQUESTS（假單系統）
// ============================================================================

export async function submitLeaveRequest(req: {
  studentId: string;
  studentName: string;
  courseId: string;
  courseName: string;
  sessionId: string;
  reason: string;
  category: LeaveCategory;
}): Promise<LeaveRequest> {
  const requests = await getLeaveRequests();
  const newReq: LeaveRequest = {
    ...req,
    id: `leave_${Date.now()}`,
    status: 'pending',
    evidence: null,
    submittedAt: Date.now(),
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: null,
  };
  requests.push(newReq);
  await AsyncStorage.setItem(STORAGE.LEAVE_REQUESTS, JSON.stringify(requests));
  return newReq;
}

export async function reviewLeaveRequest(
  requestId: string,
  approved: boolean,
  note?: string,
): Promise<void> {
  const requests = await getLeaveRequests();
  const req = requests.find((r) => r.id === requestId);
  if (req) {
    req.status = approved ? 'approved' : 'rejected';
    req.reviewedAt = Date.now();
    req.reviewNote = note || '';
    await AsyncStorage.setItem(STORAGE.LEAVE_REQUESTS, JSON.stringify(requests));

    // Emit event → 連接器會自動更新出席紀錄
    campusEventBus.emit('leave:reviewed', {
      requestId,
      studentId: req.studentId,
      approved,
      courseId: req.courseId,
    });
  }
}

export async function getLeaveRequests(
  courseId?: string,
  studentId?: string,
): Promise<LeaveRequest[]> {
  const data = await AsyncStorage.getItem(STORAGE.LEAVE_REQUESTS);
  let requests: LeaveRequest[] = data ? JSON.parse(data) : [];
  if (courseId) requests = requests.filter((r) => r.courseId === courseId);
  if (studentId) requests = requests.filter((r) => r.studentId === studentId);
  return requests;
}

// ============================================================================
// ANALYTICS
// ============================================================================

export async function getStudentAnalytics(studentId?: string): Promise<StudentAnalytics> {
  const courses = await getAttendanceCourses();
  const studentCourses = courses.filter((c) => c.role === 'student');

  const courseBreakdown = studentCourses.map((c) => ({
    courseId: c.id,
    courseName: c.name,
    totalSessions: c.totalSessions,
    attended: c.attended,
    late: c.late,
    absent: c.absent,
    excused: c.leave,
    rate: c.rate,
  }));

  const overallRate =
    courseBreakdown.length > 0
      ? Math.round(courseBreakdown.reduce((sum, c) => sum + c.rate, 0) / courseBreakdown.length)
      : 0;

  // 從本地 session records 計算真實連勝天數 + 星期幾出席模式
  const allSessions = await getAllSessions();
  const myRecords = allSessions
    .filter((s) => s.status === 'completed')
    .sort((a, b) => b.startTime - a.startTime);

  // ── 計算連勝 ──
  let currentStreak = 0;
  let bestStreak = 0;
  let tempStreak = 0;
  for (const sess of myRecords) {
    const myRec = studentId
      ? sess.records.find((r) => r.studentId === studentId)
      : sess.records.find((r) => r.status === 'present' || r.status === 'late');
    const wasPresent = myRec && (myRec.status === 'present' || myRec.status === 'late');
    if (wasPresent) {
      tempStreak++;
      bestStreak = Math.max(bestStreak, tempStreak);
    } else {
      if (currentStreak === 0) currentStreak = tempStreak;
      tempStreak = 0;
    }
  }
  if (currentStreak === 0) currentStreak = tempStreak;
  bestStreak = Math.max(bestStreak, tempStreak);

  // ── 計算星期幾出席率 ──
  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const dayStats = new Map<number, { total: number; attended: number }>();
  for (let d = 0; d < 7; d++) dayStats.set(d, { total: 0, attended: 0 });
  for (const sess of myRecords) {
    const dayOfWeek = new Date(sess.startTime).getDay();
    const stat = dayStats.get(dayOfWeek)!;
    stat.total++;
    const myRec = studentId
      ? sess.records.find((r) => r.studentId === studentId)
      : sess.records[0];
    if (myRec && (myRec.status === 'present' || myRec.status === 'late')) {
      stat.attended++;
    }
  }
  // 只回傳週一到週五（有課的日子）
  const weekdayPattern = [1, 2, 3, 4, 5]
    .map((d) => {
      const stat = dayStats.get(d)!;
      return {
        day: dayNames[d],
        rate: stat.total > 0 ? Math.round((stat.attended / stat.total) * 100) : 0,
      };
    });

  // 如果本地沒有 session 資料，從 TronClass 課程出席率推算
  if (myRecords.length === 0 && courseBreakdown.length > 0) {
    const avgRate = overallRate;
    weekdayPattern.forEach((wp) => { wp.rate = avgRate; });
  }

  return {
    studentId: studentId || '',
    overallRate,
    courseBreakdown,
    streak: { current: currentStreak, best: bestStreak },
    riskLevel: overallRate >= 85 ? 'safe' : overallRate >= 70 ? 'warning' : 'danger',
    weekdayPattern,
  };
}

export async function getTeacherAnalytics(courseId?: string): Promise<TeacherAnalytics> {
  const courses = await getAttendanceCourses();
  const course = courseId
    ? courses.find((c) => c.id === courseId)
    : courses.find((c) => c.role === 'teacher' || c.role === 'ta');

  const sessions = await getAllSessions(courseId);
  const completedSessions = sessions.filter((s) => s.status === 'completed');

  const avgRate =
    completedSessions.length > 0
      ? Math.round(
          completedSessions.reduce(
            (sum, s) => sum + ((s.presentCount + s.lateCount) / s.totalStudents) * 100,
            0,
          ) / completedSessions.length,
        )
      : course?.rate || 0;

  // Identify risk students from completed sessions
  const studentAbsences = new Map<string, { name: string; absences: number; total: number }>();
  completedSessions.forEach((s) => {
    s.records.forEach((r) => {
      if (!studentAbsences.has(r.studentId)) {
        studentAbsences.set(r.studentId, { name: r.studentName, absences: 0, total: 0 });
      }
      const info = studentAbsences.get(r.studentId)!;
      info.total++;
      if (r.status === 'absent') info.absences++;
    });
  });

  const riskStudents = Array.from(studentAbsences.entries())
    .map(([id, info]) => ({
      studentId: id,
      studentName: info.name,
      rate: info.total > 0 ? Math.round(((info.total - info.absences) / info.total) * 100) : 100,
      absences: info.absences,
    }))
    .filter((s) => s.absences > 0)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 5);

  return {
    courseId: courseId || course?.id || '',
    courseName: course?.name || '',
    totalSessions: completedSessions.length || course?.totalSessions || 0,
    averageAttendanceRate: avgRate,
    riskStudents,
    attendanceTrend: completedSessions.slice(-10).map((s) => ({
      date: s.sessionDate,
      rate: Math.round(((s.presentCount + s.lateCount) / s.totalStudents) * 100),
    })),
  };
}

// ============================================================================
// HIGH RISK STUDENTS（教師用 — 哪些學生快被扣考）
// ============================================================================

export type HighRiskStudent = {
  studentId: string;
  studentName: string;
  courseId: string;
  courseName: string;
  attendanceRate: number;
  absences: number;
  totalSessions: number;
  riskLevel: 'warning' | 'danger'; // warning: 70-80%, danger: <70%
};

/** 取得所有高風險學生（出席率低於 80% 的） — 教師 + 管理者用 */
export async function getHighRiskStudents(courseId?: string): Promise<HighRiskStudent[]> {
  const sessions = await getAllSessions(courseId);
  const completedSessions = sessions.filter((s) => s.status === 'completed');
  if (completedSessions.length === 0) return [];

  // 按課程分組
  const courseMap = new Map<string, { courseName: string; sessions: AttendanceSession[] }>();
  completedSessions.forEach((s) => {
    if (!courseMap.has(s.courseId)) {
      courseMap.set(s.courseId, { courseName: s.courseName, sessions: [] });
    }
    courseMap.get(s.courseId)!.sessions.push(s);
  });

  const riskStudents: HighRiskStudent[] = [];

  courseMap.forEach(({ courseName, sessions: courseSessions }, cId) => {
    // 計算每位學生的出席率
    const studentStats = new Map<string, { name: string; present: number; total: number }>();
    courseSessions.forEach((s) => {
      s.records.forEach((r) => {
        if (!studentStats.has(r.studentId)) {
          studentStats.set(r.studentId, { name: r.studentName, present: 0, total: 0 });
        }
        const stat = studentStats.get(r.studentId)!;
        stat.total++;
        if (r.status === 'present' || r.status === 'late' || r.status === 'excused') {
          stat.present++;
        }
      });
    });

    studentStats.forEach((stat, sId) => {
      const rate = stat.total > 0 ? Math.round((stat.present / stat.total) * 100) : 100;
      if (rate < 80) {
        riskStudents.push({
          studentId: sId,
          studentName: stat.name,
          courseId: cId,
          courseName,
          attendanceRate: rate,
          absences: stat.total - stat.present,
          totalSessions: stat.total,
          riskLevel: rate < 70 ? 'danger' : 'warning',
        });
      }
    });
  });

  return riskStudents.sort((a, b) => a.attendanceRate - b.attendanceRate);
}

// ============================================================================
// ADMIN ANALYTICS（管理者用 — 全系/全校跨課程彙總）
// ============================================================================

export type AdminAnalytics = {
  totalCourses: number;
  totalSessions: number;
  overallAttendanceRate: number;
  courseRanking: {
    courseId: string;
    courseName: string;
    instructorName: string;
    sessions: number;
    averageRate: number;
  }[];
  riskStudentCount: number;
  departmentSummary: {
    department: string;
    courseCount: number;
    avgRate: number;
  }[];
};

/** 管理者全系出席率統計（跨所有課程彙總） */
export async function getAdminAnalytics(): Promise<AdminAnalytics> {
  const courses = await getAttendanceCourses();
  const allSessions = await getAllSessions();
  const completedSessions = allSessions.filter((s) => s.status === 'completed');

  // 課程排名（依出席率）
  const courseRanking = courses.map((c) => {
    const courseSess = completedSessions.filter((s) => s.courseId === c.id);
    const avgRate = courseSess.length > 0
      ? Math.round(
          courseSess.reduce(
            (sum, s) => sum + ((s.presentCount + s.lateCount) / Math.max(s.totalStudents, 1)) * 100,
            0,
          ) / courseSess.length,
        )
      : c.rate;
    return {
      courseId: c.id,
      courseName: c.name,
      instructorName: c.instructorName,
      sessions: courseSess.length || c.totalSessions,
      averageRate: avgRate,
    };
  }).sort((a, b) => a.averageRate - b.averageRate);

  // 科系彙總
  const deptMap = new Map<string, { count: number; totalRate: number }>();
  courses.forEach((c) => {
    const dept = c.department || '未分類';
    if (!deptMap.has(dept)) deptMap.set(dept, { count: 0, totalRate: 0 });
    const d = deptMap.get(dept)!;
    d.count++;
    d.totalRate += c.rate;
  });
  const departmentSummary = Array.from(deptMap.entries()).map(([dept, d]) => ({
    department: dept,
    courseCount: d.count,
    avgRate: d.count > 0 ? Math.round(d.totalRate / d.count) : 0,
  }));

  // 全域出席率
  const overallRate = courses.length > 0
    ? Math.round(courses.reduce((sum, c) => sum + c.rate, 0) / courses.length)
    : 0;

  const riskStudents = await getHighRiskStudents();

  return {
    totalCourses: courses.length,
    totalSessions: completedSessions.length,
    overallAttendanceRate: overallRate,
    courseRanking,
    riskStudentCount: riskStudents.length,
    departmentSummary,
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function getModeName(mode: AttendanceMode): string {
  return { rotating_qr: '動態 QR 碼', number_code: '數字密碼', manual: '手動點名' }[mode];
}

export function getModeIcon(mode: AttendanceMode): string {
  return { rotating_qr: 'qr-code', number_code: 'keypad', manual: 'clipboard' }[mode];
}

export function getStatusColor(status: AttendanceStatus): string {
  return { present: '#10B981', late: '#F59E0B', absent: '#EF4444', excused: '#6366F1' }[status];
}

export function getStatusLabel(status: AttendanceStatus): string {
  return { present: '出席', late: '遲到', absent: '缺席', excused: '請假' }[status];
}

export function getRiskColor(level: 'safe' | 'warning' | 'danger'): string {
  return { safe: '#10B981', warning: '#F59E0B', danger: '#EF4444' }[level];
}

// Legacy compatibility exports
export {
  type AttendanceSession as SmartAttendanceSession,
  type AttendanceRecord as SmartAttendanceRecord,
  type StudentAnalytics as AttendanceAnalytics,
};
export const getAttendanceModeName = getModeName;
export const getAttendanceModeIcon = getModeIcon;
export const getAttendanceCourses_legacy = getAttendanceCourses;
export const createAttendanceSession = createSession;
export const getCurrentClass = async () => {
  const courses = await getAttendanceCourses();
  return courses.length > 0 ? courses[0] : null;
};
export const predictAbsenceRisk = async (studentId: string) => {
  const analytics = await getStudentAnalytics(studentId);
  return {
    risk: analytics.riskLevel === 'danger' ? 80 : analytics.riskLevel === 'warning' ? 40 : 10,
    factors: [],
  };
};
export const sendEngagementPulse = async () => ({}) as any;
export const respondToEngagementPulse = async () => {};
export const markAbsent = async (sessionId: string, studentId: string) =>
  updateStudentStatus(sessionId, studentId, 'absent');
export const updateStatus = updateStudentStatus;
export const generateNumberCode_legacy = (sessionId: string) => ({
  code: generateNumberCode(),
  expiresAt: Date.now() + 30000,
});
export const validateNumberCode = (sessionId: string, code: string) => /^\d{6}$/.test(code);
export const validateRotatingQR_legacy = validateRotatingQR;
export const calculateFraudScore = () => ({ score: 0, flags: [] });

let postLoginBootstrap: PostLoginEngineBootstrap | null = null;

/** 由 postLoginDataRouter 在登入後注入（供日後點名流程讀取 server 解析結果） */
export function initFromPostLoginContext(ctx: PostLoginEngineBootstrap): void {
  postLoginBootstrap = ctx;
}

export function getPostLoginBootstrapForAttendance(): PostLoginEngineBootstrap | null {
  return postLoginBootstrap;
}
