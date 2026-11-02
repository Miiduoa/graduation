/**
 * 學號登入先由伺服器驗證校務帳密，再交換真正的 Firebase token。
 * 舊端點未部署時，僅在相容的正式設定下改走網站登入服務；
 * 課表、成績與課程清單另由已登入者的本人資料端點讀取。
 * 明確的伺服器拒絕不轉原生登入；沒有回應時保留既有的原生直連路徑。
 */

import Constants from 'expo-constants';
import { assertPuEcampusDataFetchEnabled } from '@campus/shared/src/puEcampusDataPolicy';
import {
  STUDENT_LOGIN_CLIENT_TIMEOUT_MS,
  TEACHER_LMS_UNAVAILABLE_COPY,
  isTeacherLmsUnavailableNotice,
} from '@campus/shared/src/schoolLogin';
import { isStudentIdLoginAvailable } from './schoolLoginAvailability';
import { signInWithCustomToken, signOut, type User } from 'firebase/auth';

import { clearMockAuthSession, saveMockAuthSession, type MockAuthSession } from './mockAuth';
import {
  puLogin,
  puFetchStudentInfo,
  type PUSession,
  type PUStudentInfo,
  type PUCourseResult,
  type PUGradeResult,
  type PUAnnouncement,
} from './puDirectScraper';
import {
  setTCBackendSession,
  setTCSavedCredentials,
  clearTCSavedCredentials,
  clearTCSession,
} from './tronClassClient';
import { isTronClassDataFetchEnabled } from './tronClassDataEnabled';
import {
  syncAllData,
  clearPUCache,
  type SyncAllResult,
  refreshCourses,
  refreshGrades,
  refreshStudentInfo,
  refreshAnnouncements,
  seedCachedCourses,
  seedCachedGrades,
  seedCachedStudentInfo,
  seedCachedAnnouncements,
} from './puDataCache';
import { getAdapter } from '../data/apiAdapters';
import { PUAdapter } from '../data/apiAdapters/PUAdapter';
import { canUseHostedSchoolFallback, getCloudFunctionUrl } from './cloudFunctions';
import { getAuthInstance, hasUsableFirebaseConfig } from '../firebase';
import type { UserRole } from '../state/auth';
import { buildSchoolSyncSummary, type SchoolSyncSummary } from './schoolSyncSummary';

// ─── Progress Callback ──────────────────────────────────

export type LoginProgress = 'authenticating' | 'syncingCampus' | 'syncingTronClass' | 'linking';

export type OnLoginProgress = (step: LoginProgress, detail?: string) => void;

// ─── 全域 PU Session 存取 ────────────────────────────────
// 登入成功後存在這裡，PUAdapter 可以透過 getPUSession() 取得。
let _currentPUSession: PUSession | null = null;
let schoolLoginGeneration = 0;

export function getPUSession(): PUSession | null {
  return _currentPUSession;
}

export function clearPUSession(): void {
  schoolLoginGeneration += 1;
  _currentPUSession = null;
  clearTCSavedCredentials().catch(() => {});
  clearTCSession().catch(() => {});
}

// ─── Types ───────────────────────────────────────────────

export type StudentIdLoginResult = {
  uid: string;
  email: string;
  displayName: string;
  studentId: string;
  department: string;
  role: UserRole;
  schoolId: string;
  session: PUSession;
  syncSummary?: SchoolSyncSummary;
};

export { isStudentIdLoginAvailable } from './schoolLoginAvailability';

function getExpoExtra(): Record<string, unknown> {
  return ((Constants.expoConfig as { extra?: Record<string, unknown> } | null)?.extra ??
    {}) as Record<string, unknown>;
}

function isLocalMockAuthAllowed(): boolean {
  const extra = getExpoExtra();
  return extra.appEnv === 'development' && extra.allowLocalMockAuth === true;
}

// ─── Backend Unified Login ──────────────────────────────

/**
 * 嘗試使用後端 signInPuStudentId 統一登入。
 * 一次呼叫同時搞定 E校園 + TronClass。
 */
async function tryBackendUnifiedLogin(
  studentId: string,
  password: string,
  schoolId: string,
): Promise<{
  success: boolean;
  data?: {
    uid: string;
    customToken?: string;
    studentId: string;
    displayName: string;
    department: string;
    puSessionId: string | null;
    tronClassSessionId: string | null;
    tronClassUserId: number | null;
    studentInfo: PUStudentInfo | null;
    courses: PUCourseResult | null;
    grades: PUGradeResult | null;
    announcements: PUAnnouncement[] | null;
    source: 'cloud' | 'hosted';
    localMock: boolean;
  };
  error?: string;
  code?: string;
  allowNativeFallback?: boolean;
}> {
  const url = getCloudFunctionUrl('signInPuStudentId');
  const hostedUrl = 'https://nuni.tw/api/fn/signInPuStudentId';
  const useLocalMockAuth = !hasUsableFirebaseConfig() && isLocalMockAuthAllowed();
  let receivedResponse = false;
  let usingHosted = url === hostedUrl;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('學校登入逾時，請稍後再試。'));
    }, STUDENT_LOGIN_CLIENT_TIMEOUT_MS);
  });
  try {
    console.log('[studentIdAuth] Trying backend unified login…');
    const request = async () => {
      if (usingHosted && !canUseHostedSchoolFallback(url)) {
        throw new Error('此版本尚未設定可用的學校登入服務。');
      }
      const options: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          studentId,
          password,
          schoolId,
          ...(useLocalMockAuth ? { skipFirebase: true } : {}),
        }),
      };
      let response = await fetch(url, options);
      receivedResponse = true;
      if (response.status === 404 && url !== hostedUrl && !useLocalMockAuth && canUseHostedSchoolFallback(url)) {
        if (controller.signal.aborted) throw new Error('學校登入逾時，請稍後再試。');
        usingHosted = true;
        response = await fetch(hostedUrl, options);
      }
      const text = await response.text();
      if (controller.signal.aborted) throw new Error('學校登入逾時，請稍後再試。');
      return { response, text };
    };
    const { response, text } = await Promise.race([request(), expired]);
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    if (!response.ok || data?.success !== true) {
      const errorMsg = (data?.error as string) || `HTTP ${response.status}`;
      const code = typeof data?.code === 'string' ? data.code : undefined;
      console.warn('[studentIdAuth] Backend unified login failed:', errorMsg);
      return { success: false, error: errorMsg, code, allowNativeFallback: false };
    }

    if (!useLocalMockAuth && (typeof data.customToken !== 'string' || !data.customToken.trim() ||
        typeof data.uid !== 'string' || !data.uid.trim())) {
      return { success: false, error: '登入服務未完成身分驗證，請稍後再試。', allowNativeFallback: false };
    }

    console.log('[studentIdAuth] Backend unified login succeeded!');
    return {
      success: true,
      data: {
        uid: data.uid as string,
        customToken: data.customToken as string | undefined,
        studentId: (data.studentId as string) || studentId,
        displayName: (data.displayName as string) || `${studentId} 同學`,
        department: (data.department as string) || '',
        puSessionId: typeof data.puSessionId === 'string' && data.puSessionId.trim() ? data.puSessionId : null,
        tronClassSessionId: (data.tronClassSessionId as string) || null,
        tronClassUserId: (data.tronClassUserId as number) ?? null,
        studentInfo: data.studentInfo as PUStudentInfo | null,
        courses: data.courses as PUCourseResult | null,
        grades: data.grades as PUGradeResult | null,
        announcements: data.announcements as PUAnnouncement[] | null,
        source: usingHosted ? 'hosted' : 'cloud',
        localMock: useLocalMockAuth,
      },
    };
  } catch (err) {
    console.warn('[studentIdAuth] Backend unified login error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : '後端連線失敗',
      allowNativeFallback: !receivedResponse && !usingHosted && !useLocalMockAuth && canUseHostedSchoolFallback(url),
    };
  } finally {
    clearTimeout(timeout!);
  }
}

import { seedTestData } from './testSeedData';
import { syncPostLoginContextFromCaches } from './postLoginContextFromCaches';
import { routePostLoginData, routePostLoginDataWithContext } from './postLoginDataRouter';

async function runPostLoginContextPipeline(p: {
  uid: string;
  schoolId: string;
  role: UserRole;
  email: string;
}): Promise<void> {
  try {
    await syncPostLoginContextFromCaches({
      uid: p.uid,
      schoolId: p.schoolId,
      role: p.role,
      email: p.email,
    });
    await routePostLoginDataWithContext(p.schoolId);
  } catch (e) {
    console.warn('[studentIdAuth] post-login context pipeline failed (continuing):', e);
  }
}

// ─── 測試帳號 ──────────────────────────────────────────
// 每個角色各一組，帳號格式: test_<role>，密碼統一 test1234
// 用正常的學號/密碼欄位登入即可，不經過真實校園系統

type TestAccount = {
  account: string; // 登入帳號（輸入在學號欄位）
  password: string; // 密碼
  role: UserRole;
  displayName: string;
  department: string;
  studentId: string; // 模擬學號
};

const TEST_ACCOUNTS: TestAccount[] = [
  {
    account: 'test_student',
    password: 'test1234',
    role: 'student',
    displayName: '測試學生',
    department: '資訊工程學系',
    studentId: 'T11100001',
  },
  {
    account: 'test_teacher',
    password: 'test1234',
    role: 'teacher',
    displayName: '測試教師',
    department: '資訊工程學系',
    studentId: 'T90000001',
  },
  {
    account: 'test_staff',
    password: 'test1234',
    role: 'staff',
    displayName: '測試職員',
    department: '總務處',
    studentId: 'S90000001',
  },
  {
    account: 'test_department',
    password: 'test1234',
    role: 'department',
    displayName: '測試系辦',
    department: '資訊工程學系',
    studentId: 'D90000001',
  },
  {
    account: 'test_department_head',
    password: 'test1234',
    role: 'department_head',
    displayName: '測試系主任',
    department: '資訊工程學系',
    studentId: 'H90000001',
  },
  {
    account: 'test_admin',
    password: 'test1234',
    role: 'admin',
    displayName: '測試管理員',
    department: '資訊中心',
    studentId: 'A90000001',
  },
  {
    account: 'test_school',
    password: 'test1234',
    role: 'school',
    displayName: '測試校方',
    department: '校長室',
    studentId: 'X90000001',
  },
  {
    account: 'test_vendor',
    password: 'test1234',
    role: 'vendor',
    displayName: '測試店家老闆',
    department: '靜園美食街',
    studentId: 'V90000001',
  },
];

/** 取得所有測試帳號列表（供外部 UI 顯示） */
export function getTestAccounts(): ReadonlyArray<{
  account: string;
  password: string;
  role: UserRole;
  displayName: string;
}> {
  return TEST_ACCOUNTS.map((a) => ({
    account: a.account,
    password: a.password,
    role: a.role,
    displayName: a.displayName,
  }));
}

/**
 * 嘗試用測試帳號登入。若帳密匹配測試帳號就直接回傳結果，不經過真實校園系統。
 */
async function tryTestAccountLogin(
  account: string,
  password: string,
  schoolId: string,
  progress: OnLoginProgress,
): Promise<StudentIdLoginResult | null> {
  const test = TEST_ACCOUNTS.find(
    (t) => t.account.toLowerCase() === account.toLowerCase() && t.password === password,
  );
  if (!test) return null;

  console.log(`[studentIdAuth] 🧪 Test account login: ${test.account} (${test.role})`);

  progress('authenticating', '驗證測試帳號');
  progress('syncingCampus', '載入測試資料');

  const uid = `test-${test.role}`;
  const email = `${test.account}@test.campus.app`;

  // 建立 mock session（不連真實伺服器）
  const mockSession: MockAuthSession = {
    uid,
    email,
    schoolId,
    displayName: test.displayName,
    role: test.role,
    department: test.department,
    studentId: test.studentId,
    loginAccount: test.account,
  };
  await saveMockAuthSession(mockSession);

  progress('syncingTronClass', '注入測試資料');

  // 注入跨角色互聯的種子資料（課表、成績、訂單等）
  await seedTestData(test.role);

  // 執行資料路由（測試帳號也要建立關聯圖）
  let routedRole: UserRole = test.role;
  try {
    const routeResult = await routePostLoginData(test.role);
    routedRole = routeResult.roleInference.inferredRole;
  } catch (_) {
    /* ignore */
  }

  await runPostLoginContextPipeline({
    uid,
    email,
    schoolId,
    role: routedRole,
  });

  progress('linking', '完成');

  if (routedRole !== test.role) {
    mockSession.role = routedRole;
    await saveMockAuthSession(mockSession);
  }

  // 建立虛擬 PU session
  const session: PUSession = {
    loggedIn: true,
    studentName: test.displayName,
  };
  _currentPUSession = session;

  return {
    uid,
    email,
    displayName: test.displayName,
    studentId: test.studentId,
    department: test.department,
    role: routedRole,
    schoolId,
    session,
  };
}

// ─── Main Login ─────────────────────────────────────────

/**
 * 用學號 + 密碼登入靜宜大學。
 *
 * 策略：
 *   0. 若帳密匹配測試帳號 → 直接建 mock session，不連伺服器
 *   1. 優先用後端 signInPuStudentId（同時登入 E校園 + TronClass）
 *   2. 若後端不可用，降級為手機直連 E校園 + 後端代理 TronClass
 */
export async function signInWithStudentId(params: {
  studentId: string;
  password: string;
  schoolId: string;
  schoolName?: string;
  onProgress?: OnLoginProgress;
}): Promise<StudentIdLoginResult> {
  if (!isStudentIdLoginAvailable(params.schoolId)) {
    throw new Error('這所學校的帳號連線尚未開放。公開資訊與 Google 帳號仍可使用。');
  }
  const studentId = params.studentId.trim();
  const progress = params.onProgress ?? (() => {});

  if (!studentId) {
    throw new Error('請輸入學號');
  }
  if (!params.password.trim()) {
    throw new Error('請輸入密碼');
  }
  const generation = ++schoolLoginGeneration;
  const previousSession = _currentPUSession;
  const firebaseConfigured = hasUsableFirebaseConfig();
  const previousUser = firebaseConfigured ? getAuthInstance().currentUser : null;
  const assertAttempt = () => {
    if (generation !== schoolLoginGeneration) throw new Error('登入已取消，請重新登入。');
  };
  const assertBeforeExchange = () => {
    assertAttempt();
    if (_currentPUSession !== previousSession ||
        (firebaseConfigured && getAuthInstance().currentUser !== previousUser)) {
      throw new Error('帳號已變更，請重新登入。');
    }
  };

  // ── 策略 0: 測試帳號快速登入 ──
  const testResult = await tryTestAccountLogin(
    studentId,
    params.password,
    params.schoolId,
    progress,
  );
  if (testResult) {
    return testResult;
  }
  assertBeforeExchange();

  assertPuEcampusDataFetchEnabled();
  progress('authenticating', '驗證靜宜帳密');

  // ── 策略 A: 嘗試後端統一登入 ──
  const backendResult = await tryBackendUnifiedLogin(studentId, params.password, params.schoolId);
  assertBeforeExchange();

  if (backendResult.success && backendResult.data) {
    return await handleBackendLoginSuccess(backendResult.data, params, progress, assertBeforeExchange, assertAttempt);
  }

  if (!backendResult.allowNativeFallback) {
    if (isTeacherLmsUnavailableNotice(backendResult.code) || isTeacherLmsUnavailableNotice(backendResult.error)) {
      throw new Error(TEACHER_LMS_UNAVAILABLE_COPY);
    }
    throw new Error(backendResult.error || '學校登入未完成，請稍後再試。');
  }

  // ── 策略 B: 後端未回應時保留原生直連；明確拒絕不改走另一個登入管道。 ──
  console.log('[studentIdAuth] Backend unavailable, falling back to hybrid login…');
  try {
    return await handleHybridLogin(studentId, params, progress);
  } catch (error) {
    if (
      isTeacherLmsUnavailableNotice(backendResult.code) ||
      isTeacherLmsUnavailableNotice(backendResult.error)
    ) {
      throw new Error(TEACHER_LMS_UNAVAILABLE_COPY);
    }
    throw error;
  }
}

/**
 * 策略 A 成功：後端統一登入回來的資料處理
 */
async function handleBackendLoginSuccess(
  data: NonNullable<Awaited<ReturnType<typeof tryBackendUnifiedLogin>>['data']>,
  params: { studentId: string; password: string; schoolId: string; schoolName?: string },
  progress: OnLoginProgress,
  assertBeforeExchange: () => void,
  assertAttempt: () => void,
): Promise<StudentIdLoginResult> {
  const { studentId, displayName, department, puSessionId, tronClassSessionId, tronClassUserId } =
    data;
  let requester: User | null = null;
  let loginSession: PUSession | null = null;
  const assertCurrent = () => {
    assertAttempt();
    if ((requester && getAuthInstance().currentUser !== requester) ||
        (loginSession && _currentPUSession !== loginSession)) {
      throw new Error('帳號已變更，請重新登入。');
    }
  };

  progress('linking', '連上學校帳號');
  let uid = data.uid;
  const email = `${studentId.toLowerCase()}@pu.edu.tw`;
  if (data.customToken) {
    assertBeforeExchange();
    const auth = getAuthInstance();
    const credential = await signInWithCustomToken(auth, data.customToken);
    if (!credential.user || credential.user.uid !== data.uid) {
      if (credential.user && auth.currentUser === credential.user) await signOut(auth);
      throw new Error('學校登入身分不一致，請重新登入。');
    }
    try {
      assertAttempt();
    } catch (error) {
      if (auth.currentUser === credential.user) await signOut(auth);
      throw error;
    }
    if (auth.currentUser !== credential.user) throw new Error('帳號已變更，請重新登入。');
    requester = credential.user;
    uid = credential.user.uid;
    await clearMockAuthSession();
    assertCurrent();
  } else if (data.localMock && isLocalMockAuthAllowed()) {
    uid = uid || `pu-${studentId.toLowerCase()}`;
    await saveMockAuthSession({
      uid, email, schoolId: params.schoolId, displayName, role: 'student',
      department: department || null, studentId, loginAccount: params.studentId,
    });
  } else {
    throw new Error('登入服務未完成身分驗證，請稍後再試。');
  }
  assertCurrent();

  progress('syncingCampus', '同步 E 校園資料');

  // 建立 PU Session（cookie 保存在後端 session）
  const session: PUSession = {
    loggedIn: true,
    studentName: displayName,
    backendSessionId: puSessionId,
    backendOwnerUid: data.localMock ? undefined : uid,
  };
  loginSession = session;
  _currentPUSession = session;

  // 注入 PUAdapter
  let adapter: Awaited<ReturnType<typeof getAdapter>>;
  try {
    adapter = await getAdapter('tw-pu');
  } catch {
    /* Adapter 尚未註冊 */
  }
  assertCurrent();
  if (adapter && adapter instanceof PUAdapter) {
    adapter.setBackendSession(puSessionId, studentId, displayName, data.localMock ? undefined : uid);
  }

  // 新連線不沿用前一個帳號的校務快取。
  await clearPUCache();
  assertCurrent();
  // 快取後端回傳的資料（如果有的話）
  let seededCount = 0;
  if (data.courses) {
    try {
      await seedCachedCourses(data.courses);
      seededCount++;
    } catch (e) {
      console.warn('[studentIdAuth] seed courses error:', e);
    }
    assertCurrent();
  }
  if (data.grades) {
    try {
      await seedCachedGrades(data.grades);
      seededCount++;
    } catch (e) {
      console.warn('[studentIdAuth] seed grades error:', e);
    }
    assertCurrent();
  }
  if (data.studentInfo) {
    try {
      await seedCachedStudentInfo(data.studentInfo);
      seededCount++;
    } catch (e) {
      console.warn('[studentIdAuth] seed studentInfo error:', e);
    }
    assertCurrent();
  }
  if (data.announcements) {
    try {
      await seedCachedAnnouncements(data.announcements);
      seededCount++;
    } catch (e) {
      console.warn('[studentIdAuth] seed announcements error:', e);
    }
    assertCurrent();
  }
  console.log(`[studentIdAuth] Seeded ${seededCount}/4 data types from backend`);

  const result: StudentIdLoginResult = {
    uid,
    email,
    displayName,
    studentId,
    department,
    role: 'student',
    schoolId: params.schoolId,
    session,
  };

  const tcAllowed = isTronClassDataFetchEnabled();

  // ── TronClass 登入 + 資料同步（建置開關可跳過）──
  const userAccount = params.studentId;
  if (!tcAllowed) {
    await clearTCSavedCredentials().catch(() => undefined);
    assertCurrent();
    await clearTCSession().catch(() => undefined);
    assertCurrent();
    progress('syncingTronClass', '已略過 LMS（TronClass）連線');
  } else {
    await setTCSavedCredentials(params.studentId, params.password);
    assertCurrent();
    progress('syncingTronClass', '登入 TronClass');

    try {
      if (tronClassSessionId) {
        await setTCBackendSession(tronClassSessionId, tronClassUserId);
        assertCurrent();
        console.log('[studentIdAuth] TronClass session stored, userId:', tronClassUserId);
      }

      if (!tronClassSessionId && data.source !== 'hosted') {
        console.log('[studentIdAuth] TronClass session missing, retrying…');
        const { tcLogin } = await import('./tronClassClient');
        assertCurrent();
        const tcRetry = await tcLogin(userAccount, params.password);
        assertCurrent();
        console.log('[studentIdAuth] TronClass retry', tcRetry.success ? 'OK' : 'FAILED');
      }
      if (!tronClassSessionId && data.source === 'hosted') {
        await clearTCSession();
        assertCurrent();
      }
    } catch (err) {
      console.warn('[studentIdAuth] TronClass login error (continuing):', err);
    }
    assertCurrent();

    progress('syncingTronClass', '同步 TronClass 課程資料');
  }

  let synchronized: SyncAllResult | null = null;
  try {
    synchronized = await syncAllData(session, {
      includeEssential: true,
      fetchTronClass: !(data.source === 'hosted' && !tronClassSessionId),
      includeExtended: data.source !== 'hosted',
    });
    console.log('[studentIdAuth] syncAllData completed');
  } catch (err) {
    console.warn('[studentIdAuth] syncAllData failed (continuing):', err);
  }
  assertCurrent();

  result.syncSummary = buildSchoolSyncSummary(synchronized, tcAllowed);

  // ── 登入後資料路由：推斷角色 + 建立師生關聯 ──
  try {
    const routeResult = await routePostLoginData(result.role);
    if (routeResult.roleInference.inferredRole !== result.role) {
      result.role = routeResult.roleInference.inferredRole;
      console.log(
        `[studentIdAuth] Role updated to: ${result.role} (${routeResult.roleInference.reason})`,
      );
    }
  } catch (err) {
    console.warn('[studentIdAuth] postLoginDataRouter failed (continuing):', err);
  }
  assertCurrent();

  await runPostLoginContextPipeline({
    uid: result.uid,
    schoolId: result.schoolId,
    role: result.role,
    email: result.email,
  });
  assertCurrent();

  return result;
}

/**
 * 策略 B: 手機直連 E校園 + TronClass
 *
 * 當後端統一登入不可用時（Cloud Functions 未部署、網路問題等），
 * 降級為：
 *   1. 手機直接連 alcat.pu.edu.tw 登入 E校園
 *   2. 同一組帳密直接登入 TronClass（原生 API /api/login）
 *   3. 如果 E校園 失敗但 TronClass 成功 → 仍允許登入（TronClass-only 模式）
 *
 * 重要：E校園 和 TronClass 共用同一組帳密（使用者輸入的那組）。
 *       帳號 ≠ 學號（例如帳號 B11234567，學號 411211325）。
 */
async function handleHybridLogin(
  userAccount: string,
  params: { studentId: string; password: string; schoolId: string; schoolName?: string },
  progress: OnLoginProgress,
): Promise<StudentIdLoginResult> {
  const password = params.password;

  // ── Step 1: E 校園 +（可選）TronClass 並行 ──
  progress('authenticating', '連線校園系統');

  let tcLoginOk = false;
  let tcSession: { userId: number | null; userName: string | null } | null = null;
  const tcAllowed = isTronClassDataFetchEnabled();

  const tcLoginPromise = tcAllowed
    ? (async () => {
        try {
          console.log('[studentIdAuth] Hybrid: TronClass login (parallel)…');
          const { tcLogin } = await import('./tronClassClient');
          const tcResult = await tcLogin(userAccount, password);
          if (tcResult.success && tcResult.session) {
            tcLoginOk = true;
            tcSession = { userId: tcResult.session.userId, userName: tcResult.session.userName };
            console.log(
              '[studentIdAuth] Hybrid: TronClass login OK, user:',
              tcResult.session.userName,
            );
          } else {
            console.warn('[studentIdAuth] Hybrid: TronClass login failed:', tcResult.error);
          }
          return tcResult;
        } catch (err) {
          console.warn('[studentIdAuth] Hybrid: TronClass login error:', err);
          return null;
        }
      })()
    : Promise.resolve(null);

  // 同時嘗試 E校園 直連
  let puLoginOk = false;
  let session: PUSession | null = null;
  const puLoginPromise = (async () => {
    try {
      console.log('[studentIdAuth] Hybrid: E-campus login (parallel)…');
      const loginResult = await puLogin(userAccount, password);
      if (loginResult.success && loginResult.session) {
        puLoginOk = true;
        session = loginResult.session;
        console.log('[studentIdAuth] Hybrid: E-campus login OK');
      } else {
        console.warn('[studentIdAuth] Hybrid: E-campus login failed:', loginResult.error);
      }
      return loginResult;
    } catch (err) {
      console.warn('[studentIdAuth] Hybrid: E-campus login error:', err);
      return null;
    }
  })();

  // 各請求本身已有逾時；等到登入完成再決定結果，避免舊請求在下一次登入時晚到。
  await Promise.allSettled(tcAllowed ? [tcLoginPromise, puLoginPromise] : [puLoginPromise]);

  // ── 判斷登入結果 ──
  if (!puLoginOk && !tcLoginOk) {
    throw new Error(
      tcAllowed
        ? '帳號或密碼錯誤，請確認後再試（E校園和 TronClass 均無法登入）'
        : '帳號或密碼錯誤，請確認後再試（E校園無法登入）',
    );
  }

  // 如果 E校園 成功，使用它的 session
  if (puLoginOk && session) {
    _currentPUSession = session;
    try {
      const adapter = await getAdapter('tw-pu');
      if (adapter && adapter instanceof PUAdapter) {
        adapter.setDirectSession(session, userAccount);
      }
    } catch {
      /* Adapter 尚未註冊 */
    }
  } else {
    // E校園 失敗但 TronClass 成功 → 建立一個最小 session
    console.log('[studentIdAuth] Hybrid: E-campus failed, using TronClass-only mode');
    session = { loggedIn: true, studentName: tcSession?.userName ?? null };
    _currentPUSession = session;
  }

  await clearPUCache();

  // ── Step 2: 嘗試同步 E校園 資料（如果 E校園 有連上） ──
  let displayName = session!.studentName ?? tcSession?.userName ?? `${userAccount} 同學`;
  let department = '';
  let realStudentId = userAccount;

  if (puLoginOk) {
    progress('syncingCampus', '同步 E 校園資料');
    console.log('[studentIdAuth] Hybrid: fetching E-campus data…');
    const [studentInfoResult] = await Promise.allSettled([
      refreshStudentInfo(session!),
      refreshCourses(session!),
      refreshGrades(session!),
      refreshAnnouncements(session!),
    ]);

    if (studentInfoResult.status === 'fulfilled' && studentInfoResult.value) {
      const info = studentInfoResult.value;
      if (info.name) displayName = info.name;
      if (info.studentId) realStudentId = info.studentId;
      if (info.className) department = info.className;
    } else {
      try {
        const infoResult = await puFetchStudentInfo(session!);
        if (infoResult.success && infoResult.data) {
          if (infoResult.data.name) displayName = infoResult.data.name;
          if (infoResult.data.studentId) realStudentId = infoResult.data.studentId;
          if (infoResult.data.className) department = infoResult.data.className;
        }
      } catch {
        /* ignore */
      }
    }

    // 重新注入 PUAdapter（用 realStudentId）
    try {
      const adapter = await getAdapter('tw-pu');
      if (adapter && adapter instanceof PUAdapter) {
        adapter.setDirectSession(session!, realStudentId);
      }
    } catch {
      /* ignore */
    }
  } else {
    progress('syncingCampus', 'E校園暫時無法連線，使用 TronClass 資料');
    // TronClass-only mode: 從 TronClass 取得基本使用者資訊
    if (tcSession?.userName) {
      displayName = tcSession.userName;
    }
  }

  // ── Step 3: 建立帳號 ──
  progress('linking', '連上學校帳號');

  const email = `${realStudentId.toLowerCase()}@pu.edu.tw`;
  const uid = `pu-${realStudentId.toLowerCase()}`;

  const mockSession: MockAuthSession = {
    uid,
    email,
    schoolId: params.schoolId,
    displayName,
    role: 'student',
    department: department || null,
    studentId: realStudentId,
    loginAccount: userAccount,
  };
  await saveMockAuthSession(mockSession);
  if (isTronClassDataFetchEnabled()) {
    await setTCSavedCredentials(userAccount, password);
  } else {
    await clearTCSavedCredentials().catch(() => undefined);
  }

  const result: StudentIdLoginResult = {
    uid,
    email,
    displayName,
    studentId: realStudentId,
    department,
    role: 'student',
    schoolId: params.schoolId,
    session: session!,
  };

  let synchronized: SyncAllResult | null = null;

  // ── Step 4: TronClass 資料同步（建置關閉或登入失敗時僅同步 E 校園可及資料）──
  if (tcLoginOk) {
    progress('syncingTronClass', '同步 TronClass 課程資料');
    try {
      synchronized = await syncAllData(session!, { includeEssential: true });
      console.log('[studentIdAuth] Hybrid: syncAllData completed');
    } catch (err) {
      console.warn('[studentIdAuth] Hybrid: syncAllData failed (continuing):', err);
    }
  } else if (puLoginOk) {
    if (tcAllowed) {
      console.log('[studentIdAuth] Hybrid: TronClass failed, skipping retry to avoid long wait');
      progress('syncingTronClass', 'TronClass 暫時無法連線');
    } else {
      progress('syncingTronClass', '已略過 LMS（TronClass）連線');
    }

    try {
      synchronized = await syncAllData(session!, { includeEssential: true });
      console.log('[studentIdAuth] Hybrid: syncAllData completed (E-campus / 無 TronClass)');
    } catch (err) {
      console.warn('[studentIdAuth] Hybrid: syncAllData failed (continuing):', err);
    }
  }

  result.syncSummary = buildSchoolSyncSummary(synchronized, tcAllowed);

  // ── 登入後資料路由：推斷角色 + 建立師生關聯 ──
  try {
    const routeResult = await routePostLoginData(result.role);
    if (routeResult.roleInference.inferredRole !== result.role) {
      result.role = routeResult.roleInference.inferredRole;
      console.log(
        `[studentIdAuth] Hybrid: Role updated to: ${result.role} (${routeResult.roleInference.reason})`,
      );
    }
  } catch (err) {
    console.warn('[studentIdAuth] Hybrid: postLoginDataRouter failed (continuing):', err);
  }

  await runPostLoginContextPipeline({
    uid: result.uid,
    schoolId: result.schoolId,
    role: result.role,
    email: result.email,
  });

  return result;
}
