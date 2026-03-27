import { signInWithCustomToken, signOut } from 'firebase/auth';
import type {
  PuAnnouncementPayload,
  PuCourseResultPayload,
  PuGradeResultPayload,
  PuStudentInfoPayload,
  PuStudentLoginResponse,
} from '@campus/shared/src';

import { clearAllCache } from '../data/cachedSource';
import { getAdapter } from '../data/apiAdapters';
import { PUAdapter } from '../data/apiAdapters/PUAdapter';
import { PROVIDENCE_UNIVERSITY_INTERNAL_SCHOOL_ID } from '../data/schoolIds';
import { getAuthInstance, hasUsableFirebaseConfig } from '../firebase';
import { getCloudFunctionUrl } from './cloudFunctions';
import { clearMockAuthSession, saveMockAuthSession, type MockAuthSession } from './mockAuth';
import {
  clearPUCache,
  refreshAnnouncements,
  refreshCourses,
  refreshGrades,
  refreshTCCourses,
  seedCachedAnnouncements,
  seedCachedCourses,
  seedCachedGrades,
  seedCachedStudentInfo,
  syncAllData,
} from './puDataCache';
import { puFetchStudentInfo, puLogin, type PUSession } from './puDirectScraper';
import { clearTCSession, setTCBackendSession, tcLogin } from './tronClassClient';

import type { UserRole } from '../state/auth';

let _currentPUSession: PUSession | null = null;

export function getPUSession(): PUSession | null {
  return _currentPUSession;
}

export function clearPUSession(): void {
  _currentPUSession = null;
}

export type StudentIdLoginResult = {
  uid: string;
  email: string;
  displayName: string;
  studentId: string;
  department: string;
  role: UserRole;
  schoolId: string;
  session: PUSession;
};

export type PuLoginBootstrapStage =
  | 'authenticating'
  | 'syncingCampus'
  | 'syncingTronClass';

export type PuLoginStageChange = (
  stage: PuLoginBootstrapStage,
  detail: string,
) => void;

type BootstrapResult = {
  session: PUSession;
  studentId: string;
  displayName: string;
  department: string;
};

type PuCampusBootstrapPayload = {
  puSessionId?: string | null;
  studentInfo?: PuStudentInfoPayload | null;
  courses?: PuCourseResultPayload | null;
  grades?: PuGradeResultPayload | null;
  announcements?: PuAnnouncementPayload[] | null;
};

export function isStudentIdLoginAvailable(): boolean {
  return true;
}

function emitStage(
  onStageChange: PuLoginStageChange | undefined,
  stage: PuLoginBootstrapStage,
  detail: string,
): void {
  console.log(`[studentIdAuth][${stage}] ${detail}`);
  onStageChange?.(stage, detail);
}

async function parsePuLoginResponse(
  response: Response,
): Promise<Partial<PuStudentLoginResponse> & { error?: string }> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as Partial<PuStudentLoginResponse> & { error?: string };
  } catch {
    return {
      error: response.ok
        ? '靜宜學號登入端點回傳了無法解析的內容'
        : `靜宜學號登入失敗（HTTP ${response.status}）`,
    };
  }
}

async function requestPuBackendLogin(params: {
  studentId: string;
  password: string;
  skipFirebase?: boolean;
}): Promise<Partial<PuStudentLoginResponse> & { error?: string }> {
  const response = await fetch(getCloudFunctionUrl('signInPuStudentId'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      studentId: params.studentId,
      password: params.password,
      ...(params.skipFirebase ? { skipFirebase: true } : {}),
    }),
  });

  const data = await parsePuLoginResponse(response);
  if (!response.ok) {
    throw new Error(data.error || `靜宜學號登入失敗（HTTP ${response.status}）`);
  }

  return data;
}

async function getPuAdapter(): Promise<PUAdapter | null> {
  try {
    const adapter = await getAdapter(PROVIDENCE_UNIVERSITY_INTERNAL_SCHOOL_ID);
    return adapter instanceof PUAdapter ? adapter : null;
  } catch (error) {
    console.warn('[studentIdAuth] Failed to load PU adapter:', error);
    return null;
  }
}

async function fetchPuCampusDataFromBackend<T>(
  sessionId: string,
  dataType: 'studentInfo' | 'courses' | 'grades' | 'announcements',
): Promise<T | null> {
  const response = await fetch(getCloudFunctionUrl('puFetchCampusData'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sessionId,
      dataType,
    }),
  });

  const text = await response.text();
  let payload: { success?: boolean; result?: T; error?: string } | null = null;
  if (text.trim()) {
    try {
      payload = JSON.parse(text) as { success?: boolean; result?: T; error?: string };
    } catch {
      payload = null;
    }
  }

  if (!response.ok || payload?.success !== true) {
    throw new Error(
      payload?.error || `PU 校務代理請求失敗（${dataType}, HTTP ${response.status}）`,
    );
  }

  const result = payload?.result as Record<string, unknown> | undefined;

  switch (dataType) {
    case 'studentInfo':
      return ((result?.studentInfo ?? null) as T | null);
    case 'courses':
      if (!result) return null;
      return ({
        courses: Array.isArray(result.courses) ? result.courses : [],
        studentInfo:
          (result.studentInfo as PuCourseResultPayload['studentInfo'] | undefined) ?? {
            studentId: null,
            name: null,
            className: null,
            currentSemester: null,
          },
        semester: typeof result.semester === 'string' ? result.semester : null,
        totalCredits:
          typeof result.totalCredits === 'number' ? result.totalCredits : 0,
      } as T);
    case 'grades':
      if (!result) return null;
      return ({
        grades: Array.isArray(result.grades) ? result.grades : [],
        allSemesters: Array.isArray(result.allSemesters) ? result.allSemesters : [],
        summary:
          typeof result.summary === 'object' && result.summary
            ? result.summary
            : {},
      } as T);
    case 'announcements':
      return ((Array.isArray(result?.announcements) ? result?.announcements : []) as T);
    default:
      return null;
  }
}

function normalizeStudentInfo(
  payload: PuStudentInfoPayload | null | undefined,
): ReturnType<typeof buildStudentInfoCache> {
  return buildStudentInfoCache(payload);
}

function buildStudentInfoCache(payload: PuStudentInfoPayload | null | undefined) {
  if (!payload) {
    return {
      studentId: null,
      name: null,
      className: null,
      currentSemester: null,
    };
  }

  return {
    studentId: payload.studentId ?? null,
    name: payload.name ?? null,
    className: payload.className ?? payload.class ?? null,
    currentSemester: payload.currentSemester ?? null,
  };
}

async function hydratePuCampusBootstrapData(
  payload: PuCampusBootstrapPayload,
): Promise<{
  studentInfo: ReturnType<typeof buildStudentInfoCache>;
  courses: PuCourseResultPayload | null;
  grades: PuGradeResultPayload | null;
  announcements: PuAnnouncementPayload[];
}> {
  if (!payload.puSessionId) {
    throw new Error('PU 校務代理尚未就緒');
  }

  const [studentInfoRaw, coursesRaw, gradesRaw, announcementsRaw] = await Promise.all([
    payload.studentInfo
      ? Promise.resolve(payload.studentInfo)
      : fetchPuCampusDataFromBackend<PuStudentInfoPayload>(payload.puSessionId, 'studentInfo'),
    payload.courses
      ? Promise.resolve(payload.courses)
      : fetchPuCampusDataFromBackend<PuCourseResultPayload>(payload.puSessionId, 'courses'),
    payload.grades
      ? Promise.resolve(payload.grades)
      : fetchPuCampusDataFromBackend<PuGradeResultPayload>(payload.puSessionId, 'grades'),
    payload.announcements
      ? Promise.resolve(payload.announcements)
      : fetchPuCampusDataFromBackend<PuAnnouncementPayload[]>(payload.puSessionId, 'announcements'),
  ]);

  const studentInfo = normalizeStudentInfo(studentInfoRaw);
  const courses = coursesRaw ?? null;
  const grades = gradesRaw ?? null;
  const announcements = announcementsRaw ?? [];

  if (studentInfo.studentId || studentInfo.name) {
    await seedCachedStudentInfo(studentInfo);
  }

  if (courses) {
    await seedCachedCourses({
      courses: courses.courses ?? [],
      studentInfo: {
        studentId: courses.studentInfo?.studentId ?? studentInfo.studentId,
        name: courses.studentInfo?.name ?? studentInfo.name,
        className:
          courses.studentInfo?.className ??
          courses.studentInfo?.class ??
          studentInfo.className,
        currentSemester:
          courses.studentInfo?.currentSemester ?? courses.semester ?? studentInfo.currentSemester,
      },
      semester: courses.semester ?? null,
      totalCredits: courses.totalCredits ?? 0,
    });
  }

  if (grades) {
    await seedCachedGrades({
      grades: (grades.grades ?? []).map((grade) => ({
        semester: grade.semester,
        courseName: grade.courseName,
        courseNameEn: grade.courseNameEn,
        className: grade.className ?? grade.class ?? '',
        courseType: grade.courseType,
        credits: grade.credits,
        score: grade.score,
      })),
      allSemesters: grades.allSemesters ?? [],
      summary: grades.summary ?? {},
    });
  }

  await seedCachedAnnouncements(
    announcements.map((announcement) => ({
      title: announcement.title,
      url: announcement.url,
      date: announcement.date,
    })),
  );

  return {
    studentInfo,
    courses,
    grades,
    announcements,
  };
}

async function resetPuRuntimeState(): Promise<void> {
  clearPUSession();
  await clearAllCache().catch(() => undefined);
  await clearTCSession().catch(() => undefined);
  await clearMockAuthSession().catch(() => undefined);
  await clearPUCache().catch(() => undefined);

  const adapter = await getPuAdapter();
  if (adapter) {
    await adapter.logout().catch(() => undefined);
  }
}

async function primePuAdapterSession(
  session: PUSession,
  studentId: string,
): Promise<void> {
  const adapter = await getPuAdapter();
  if (!adapter) return;

  adapter.setDirectSession(session, studentId);
}

async function primePuAdapterBackendSession(params: {
  sessionId: string;
  studentId?: string | null;
  displayName?: string | null;
}): Promise<void> {
  const adapter = await getPuAdapter();
  if (!adapter) return;

  adapter.setBackendSession(
    params.sessionId,
    params.studentId ?? null,
    params.displayName ?? null,
  );
}

async function bootstrapPuDataSession(params: {
  studentId: string;
  password: string;
  onStageChange?: PuLoginStageChange;
  puSessionId?: string | null;
  studentInfo?: PuStudentInfoPayload | null;
  courses?: PuCourseResultPayload | null;
  grades?: PuGradeResultPayload | null;
  announcements?: PuAnnouncementPayload[] | null;
  tronClassSessionId?: string | null;
  tronClassUserId?: number | null;
}): Promise<BootstrapResult> {
  emitStage(params.onStageChange, 'authenticating', '驗證靜宜帳密');

  if (params.puSessionId) {
    const session: PUSession = {
      loggedIn: true,
      studentName: params.studentInfo?.name ?? null,
    };

    emitStage(params.onStageChange, 'syncingCampus', '同步 E 校園資料');

    const campusData = await hydratePuCampusBootstrapData({
      puSessionId: params.puSessionId,
      studentInfo: params.studentInfo,
      courses: params.courses,
      grades: params.grades,
      announcements: params.announcements,
    });

    const displayName =
      campusData.studentInfo.name ??
      params.studentId ??
      `${params.studentId} 同學`;
    const realStudentId =
      campusData.studentInfo.studentId ??
      params.studentId;
    const department = campusData.studentInfo.className ?? '';

    const hasAnyCampusContent =
      (campusData.courses?.courses?.length ?? 0) > 0 ||
      (campusData.grades?.grades?.length ?? 0) > 0 ||
      campusData.announcements.length > 0;

    if (!campusData.courses || !campusData.grades || !hasAnyCampusContent) {
      const failures: string[] = [];
      if (!campusData.courses) failures.push('課表');
      if (!campusData.grades) failures.push('成績');
      if (!hasAnyCampusContent) failures.push('校務資料');
      throw new Error(`E 校園資料同步失敗：${failures.join('、')}`);
    }

    await primePuAdapterBackendSession({
      sessionId: params.puSessionId,
      studentId: realStudentId,
      displayName,
    });

    emitStage(params.onStageChange, 'syncingTronClass', '同步 TronClass 課程');

    if (params.tronClassSessionId) {
      await setTCBackendSession(
        params.tronClassSessionId,
        params.tronClassUserId ?? null,
      );
    } else {
      throw new Error('TronClass 代理尚未就緒，請先部署最新的 Cloud Functions');
    }

    try {
      const tcCourses = await refreshTCCourses();
      void syncAllData(session, { tcCourses }).catch((error) => {
        console.warn('[studentIdAuth] deferred syncAllData failed:', error);
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '無法同步 TronClass 課程';
      throw new Error(`TronClass 課程同步失敗：${message}`);
    }

    return {
      session,
      studentId: realStudentId,
      displayName,
      department,
    };
  }

  const loginResult = await puLogin(params.studentId, params.password);
  if (!loginResult.success || !loginResult.session) {
    throw new Error(
      `E 校園登入失敗：${loginResult.error ?? '請確認學號與密碼是否正確'}`,
    );
  }

  const session = loginResult.session;
  _currentPUSession = session;

  await primePuAdapterSession(session, params.studentId);

  emitStage(params.onStageChange, 'syncingCampus', '同步 E 校園資料');

  const [studentInfoResult, coursesResult, gradesResult, announcementsResult] =
    await Promise.allSettled([
      puFetchStudentInfo(session),
      refreshCourses(session),
      refreshGrades(session),
      refreshAnnouncements(session),
    ]);

  const campusFailures: string[] = [];

  let displayName = session.studentName ?? `${params.studentId} 同學`;
  let department = '';
  let realStudentId = params.studentId;

  if (studentInfoResult.status === 'fulfilled') {
    const info = studentInfoResult.value;
    if (!info.success || !info.data) {
      campusFailures.push('學生資料');
    } else {
      if (info.data.name) displayName = info.data.name;
      if (info.data.studentId) realStudentId = info.data.studentId;
      if (info.data.className) department = info.data.className;
    }
  } else {
    campusFailures.push('學生資料');
  }

  if (coursesResult.status !== 'fulfilled' || !coursesResult.value) {
    campusFailures.push('課表');
  }
  if (gradesResult.status !== 'fulfilled' || !gradesResult.value) {
    campusFailures.push('成績');
  }
  if (announcementsResult.status !== 'fulfilled' || !announcementsResult.value) {
    campusFailures.push('公告');
  }

  if (campusFailures.length > 0) {
    throw new Error(`E 校園資料同步失敗：${campusFailures.join('、')}`);
  }

  await primePuAdapterSession(session, realStudentId);

  emitStage(params.onStageChange, 'syncingTronClass', '同步 TronClass 課程');

  if (params.tronClassSessionId) {
    await setTCBackendSession(
      params.tronClassSessionId,
      params.tronClassUserId ?? null,
    );
  } else if (hasUsableFirebaseConfig()) {
    throw new Error('TronClass 代理尚未就緒，請先部署最新的 Cloud Functions');
  } else {
    const tronClassLogin = await tcLogin(realStudentId, params.password);
    if (!tronClassLogin.success) {
      throw new Error(
        `TronClass 登入失敗：${tronClassLogin.error ?? '無法建立 TronClass 工作階段'}`,
      );
    }
  }

  try {
    const tcCourses = await refreshTCCourses();
    void syncAllData(session, { tcCourses }).catch((error) => {
      console.warn('[studentIdAuth] deferred syncAllData failed:', error);
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '無法同步 TronClass 課程';
    throw new Error(`TronClass 課程同步失敗：${message}`);
  }

  return {
    session,
    studentId: realStudentId,
    displayName,
    department,
  };
}

async function signInWithStudentIdFallback(params: {
  studentId: string;
  password: string;
  schoolId: string;
  onStageChange?: PuLoginStageChange;
}): Promise<StudentIdLoginResult> {
  let puSessionId: string | null = null;
  let tronClassSessionId: string | null = null;
  let tronClassUserId: number | null = null;
  let studentInfo: PuStudentInfoPayload | null = null;
  let courses: PuCourseResultPayload | null = null;
  let grades: PuGradeResultPayload | null = null;
  let announcements: PuAnnouncementPayload[] | null = null;

  const backendLogin = await requestPuBackendLogin({
    studentId: params.studentId,
    password: params.password,
    skipFirebase: true,
  });
  puSessionId =
    typeof backendLogin.puSessionId === 'string'
      ? backendLogin.puSessionId
      : null;
  tronClassSessionId =
    typeof backendLogin.tronClassSessionId === 'string'
      ? backendLogin.tronClassSessionId
      : null;
  tronClassUserId =
    typeof backendLogin.tronClassUserId === 'number'
      ? backendLogin.tronClassUserId
      : null;
  studentInfo = (backendLogin.studentInfo as PuStudentInfoPayload | null | undefined) ?? null;
  courses = (backendLogin.courses as PuCourseResultPayload | null | undefined) ?? null;
  grades = (backendLogin.grades as PuGradeResultPayload | null | undefined) ?? null;
  announcements = (backendLogin.announcements as PuAnnouncementPayload[] | null | undefined) ?? null;

  if (!puSessionId) {
    throw new Error('E 校園代理尚未就緒，請確認本機 Functions emulator 或後端部署狀態');
  }

  const warmed = await bootstrapPuDataSession({
    studentId: params.studentId,
    password: params.password,
    onStageChange: params.onStageChange,
    puSessionId,
    studentInfo,
    courses,
    grades,
    announcements,
    tronClassSessionId,
    tronClassUserId,
  });
  await clearAllCache().catch(() => undefined);

  const email = `${warmed.studentId.toLowerCase()}@pu.edu.tw`;
  const uid = `pu-${warmed.studentId.toLowerCase()}`;
  const mockSession: MockAuthSession = {
    uid,
    email,
    schoolId: params.schoolId,
    displayName: warmed.displayName,
    role: 'student',
    department: warmed.department || null,
    studentId: warmed.studentId,
  };

  await saveMockAuthSession(mockSession);

  return {
    uid,
    email,
    displayName: warmed.displayName,
    studentId: warmed.studentId,
    department: warmed.department,
    role: 'student',
    schoolId: params.schoolId,
    session: warmed.session,
  };
}

export async function signInWithStudentId(params: {
  studentId: string;
  password: string;
  schoolId: string;
  schoolName?: string;
  onStageChange?: PuLoginStageChange;
}): Promise<StudentIdLoginResult> {
  const studentId = params.studentId.trim().toUpperCase();

  if (!studentId) {
    throw new Error('請輸入學號');
  }
  if (!params.password.trim()) {
    throw new Error('請輸入密碼');
  }

  await resetPuRuntimeState();

  if (!hasUsableFirebaseConfig()) {
    try {
      return await signInWithStudentIdFallback({
        studentId,
        password: params.password,
        schoolId: params.schoolId,
        onStageChange: params.onStageChange,
      });
    } catch (error) {
      await resetPuRuntimeState();
      throw error;
    }
  }

  const data = await requestPuBackendLogin({
    studentId,
    password: params.password,
  });
  if (typeof data.customToken !== 'string' || typeof data.uid !== 'string') {
    throw new Error(data.error || '學號登入失敗，請確認帳號密碼是否正確');
  }
  if (typeof data.puSessionId !== 'string' || !data.puSessionId.trim()) {
    throw new Error('E 校園代理尚未就緒，請確認後端已部署最新登入流程');
  }

  try {
    const warmed = await bootstrapPuDataSession({
      studentId:
        typeof data.studentId === 'string' ? data.studentId : studentId,
      password: params.password,
      onStageChange: params.onStageChange,
      puSessionId:
        typeof data.puSessionId === 'string'
          ? data.puSessionId
          : null,
      studentInfo:
        (data.studentInfo as PuStudentInfoPayload | null | undefined) ?? null,
      courses:
        (data.courses as PuCourseResultPayload | null | undefined) ?? null,
      grades:
        (data.grades as PuGradeResultPayload | null | undefined) ?? null,
      announcements:
        (data.announcements as PuAnnouncementPayload[] | null | undefined) ?? null,
      tronClassSessionId:
        typeof data.tronClassSessionId === 'string'
          ? data.tronClassSessionId
          : null,
      tronClassUserId:
        typeof data.tronClassUserId === 'number'
          ? data.tronClassUserId
          : null,
    });

    await clearAllCache().catch(() => undefined);
    await signInWithCustomToken(getAuthInstance(), data.customToken);

    return {
      uid: data.uid,
      email: `${warmed.studentId.toLowerCase()}@pu.edu.tw`,
      displayName:
        warmed.displayName ||
        (typeof data.displayName === 'string'
          ? data.displayName
          : `${studentId} 同學`),
      studentId: warmed.studentId,
      department:
        warmed.department ||
        (typeof data.department === 'string' ? data.department : ''),
      role: 'student',
      schoolId: params.schoolId,
      session: warmed.session,
    };
  } catch (error) {
    await signOut(getAuthInstance()).catch(() => undefined);
    await resetPuRuntimeState();
    throw error;
  }
}
