/**
 * 學號密碼登入 — 統一登入靜宜大學 E校園 + TronClass。
 *
 * 核心設計：
 *   優先使用後端 signInPuStudentId 雲端函數，一次呼叫同時完成：
 *     1. E校園 (alcat.pu.edu.tw) 登入
 *     2. TronClass (tronclass.pu.edu.tw) 登入（透過 Node.js IPv4 pin 繞過 IPv6 問題）
 *     3. 取得學生資料、課表、成績、公告
 *   回傳 puSessionId + tronClassSessionId，後續 API 呼叫走後端代理。
 *
 *   若後端不可用（例如 Firebase 未設定），降級為手機直連 E校園 + 後端代理 TronClass。
 *
 * 為什麼 TronClass 不從手機直接登入：
 *   identity.pu.edu.tw / tronclass.pu.edu.tw 有 IPv6 AAAA 記錄，
 *   iOS/Android 的 fetch 優先走 IPv6 但連不上，
 *   加上 CAS redirect 跨域 cookie 在 React Native 中不可靠，
 *   所以 TronClass 登入必須走後端 Node.js（可以 pin IPv4）。
 */

import Constants from 'expo-constants';
import { signInWithCustomToken } from 'firebase/auth';

import { saveMockAuthSession, type MockAuthSession } from './mockAuth';
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
import {
  syncAllData,
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
import { getCloudFunctionUrl } from './cloudFunctions';
import { getAuthInstance, hasUsableFirebaseConfig } from '../firebase';
import type { UserRole } from '../state/auth';

// ─── Progress Callback ──────────────────────────────────

export type LoginProgress = 'authenticating' | 'syncingCampus' | 'syncingTronClass' | 'linking';

export type OnLoginProgress = (step: LoginProgress, detail?: string) => void;

// ─── 全域 PU Session 存取 ────────────────────────────────
// 登入成功後存在這裡，PUAdapter 可以透過 getPUSession() 取得。
let _currentPUSession: PUSession | null = null;

export function getPUSession(): PUSession | null {
  return _currentPUSession;
}

export function clearPUSession(): void {
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
};

/**
 * 學號登入永遠可用（這是 app 的主要登入入口）。
 */
export function isStudentIdLoginAvailable(): boolean {
  return true;
}

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
): Promise<{
  success: boolean;
  data?: {
    uid: string;
    customToken?: string;
    studentId: string;
    displayName: string;
    department: string;
    puSessionId: string;
    tronClassSessionId: string | null;
    tronClassUserId: number | null;
    studentInfo: PUStudentInfo | null;
    courses: PUCourseResult | null;
    grades: PUGradeResult | null;
    announcements: PUAnnouncement[] | null;
  };
  error?: string;
}> {
  try {
    const url = getCloudFunctionUrl('signInPuStudentId');
    const useLocalMockAuth = !hasUsableFirebaseConfig() && isLocalMockAuthAllowed();
    console.log('[studentIdAuth] Trying backend unified login…');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          studentId,
          password,
          ...(useLocalMockAuth ? { skipFirebase: true } : {}),
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    if (!response.ok || !data?.success) {
      const errorMsg = (data?.error as string) || `HTTP ${response.status}`;
      console.warn('[studentIdAuth] Backend unified login failed:', errorMsg);
      return { success: false, error: errorMsg };
    }

    if (!useLocalMockAuth && typeof data.customToken !== 'string') {
      return { success: false, error: '登入端點未回傳 Firebase token' };
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
        puSessionId: data.puSessionId as string,
        tronClassSessionId: (data.tronClassSessionId as string) || null,
        tronClassUserId: (data.tronClassUserId as number) ?? null,
        studentInfo: data.studentInfo as PUStudentInfo | null,
        courses: data.courses as PUCourseResult | null,
        grades: data.grades as PUGradeResult | null,
        announcements: data.announcements as PUAnnouncement[] | null,
      },
    };
  } catch (err) {
    console.warn('[studentIdAuth] Backend unified login error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : '後端連線失敗',
    };
  }
}

import { seedTestData } from './testSeedData';
import { routePostLoginData } from './postLoginDataRouter';

// ─── 測試帳號 ──────────────────────────────────────────
// 每個角色各一組，帳號格式: test_<role>，密碼統一 test1234
// 用正常的學號/密碼欄位登入即可，不經過真實校園系統

type TestAccount = {
  account: string;       // 登入帳號（輸入在學號欄位）
  password: string;      // 密碼
  role: UserRole;
  displayName: string;
  department: string;
  studentId: string;     // 模擬學號
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
export function getTestAccounts(): ReadonlyArray<{ account: string; password: string; role: UserRole; displayName: string }> {
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
  try {
    await routePostLoginData(test.role);
  } catch (_) { /* ignore */ }

  progress('linking', '完成');

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
    role: test.role,
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
  const studentId = params.studentId.trim();
  const progress = params.onProgress ?? (() => {});

  if (!studentId) {
    throw new Error('請輸入學號');
  }
  if (!params.password.trim()) {
    throw new Error('請輸入密碼');
  }

  // ── 策略 0: 測試帳號快速登入 ──
  const testResult = await tryTestAccountLogin(studentId, params.password, params.schoolId, progress);
  if (testResult) {
    return testResult;
  }

  // 帳密只暫存在記憶體，用於本次 app 執行期間自動刷新 TronClass session。
  await setTCSavedCredentials(studentId, params.password);

  progress('authenticating', '驗證靜宜帳密');

  // ── 策略 A: 嘗試後端統一登入 ──
  const backendResult = await tryBackendUnifiedLogin(studentId, params.password);

  if (backendResult.success && backendResult.data) {
    return await handleBackendLoginSuccess(backendResult.data, params, progress);
  }

  // ── 策略 B: 後端失敗 → 降級為手機直連 E校園 + TronClass ──
  // 無論後端為何失敗（404、timeout、網路錯誤），都自動降級
  console.log('[studentIdAuth] Backend unavailable, falling back to hybrid login…');
  return await handleHybridLogin(studentId, params, progress);
}

/**
 * 策略 A 成功：後端統一登入回來的資料處理
 */
async function handleBackendLoginSuccess(
  data: NonNullable<Awaited<ReturnType<typeof tryBackendUnifiedLogin>>['data']>,
  params: { studentId: string; password: string; schoolId: string; schoolName?: string },
  progress: OnLoginProgress,
): Promise<StudentIdLoginResult> {
  const { studentId, displayName, department, puSessionId, tronClassSessionId, tronClassUserId } =
    data;

  progress('syncingCampus', '同步 E 校園資料');

  // 建立 PU Session（cookie 保存在後端 session）
  const session: PUSession = {
    loggedIn: true,
    studentName: displayName,
    backendSessionId: puSessionId,
  };
  _currentPUSession = session;

  // 注入 PUAdapter
  try {
    const adapter = await getAdapter('tw-pu');
    if (adapter && adapter instanceof PUAdapter) {
      adapter.setBackendSession(puSessionId, studentId, displayName);
    }
  } catch {
    /* Adapter 尚未註冊 */
  }

  // 快取後端回傳的資料（如果有的話）
  let seededCount = 0;
  if (data.courses) {
    try {
      await seedCachedCourses(data.courses);
      seededCount++;
    } catch (e) {
      console.warn('[studentIdAuth] seed courses error:', e);
    }
  }
  if (data.grades) {
    try {
      await seedCachedGrades(data.grades);
      seededCount++;
    } catch (e) {
      console.warn('[studentIdAuth] seed grades error:', e);
    }
  }
  if (data.studentInfo) {
    try {
      await seedCachedStudentInfo(data.studentInfo);
      seededCount++;
    } catch (e) {
      console.warn('[studentIdAuth] seed studentInfo error:', e);
    }
  }
  if (data.announcements) {
    try {
      await seedCachedAnnouncements(data.announcements);
      seededCount++;
    } catch (e) {
      console.warn('[studentIdAuth] seed announcements error:', e);
    }
  }
  console.log(`[studentIdAuth] Seeded ${seededCount}/4 data types from backend`);

  // ── 建立帳號（先存 auth session，讓使用者立刻看到登入成功）──
  progress('linking', '建立 Campus One 帳號');

  const email = `${studentId.toLowerCase()}@pu.edu.tw`;
  const uid = `pu-${studentId.toLowerCase()}`;

  const mockSession: MockAuthSession = {
    uid,
    email,
    schoolId: params.schoolId,
    displayName,
    role: 'student',
    department: department || null,
    studentId,
    loginAccount: params.studentId,
  };
  if (data.customToken) {
    await signInWithCustomToken(getAuthInstance(), data.customToken);
  } else {
    // 後端未回傳 customToken → 用 mock auth（開發模式常見：Cloud Functions 未完全部署）
    console.log('[studentIdAuth] No customToken from backend, using mock auth session');
    await saveMockAuthSession(mockSession);
  }

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

  // ── TronClass 登入 + 資料同步（必須等待完成）──
  progress('syncingTronClass', '登入 TronClass');
  const userAccount = params.studentId;

  try {
    // 儲存 TronClass 後端 session（可能為 null）
    if (tronClassSessionId) {
      await setTCBackendSession(tronClassSessionId, tronClassUserId);
      console.log('[studentIdAuth] TronClass session stored, userId:', tronClassUserId);
    }

    // 如果後端統一登入時 TronClass 沒成功，用 tcLogin 重試
    if (!tronClassSessionId) {
      console.log('[studentIdAuth] TronClass session missing, retrying…');
      const { tcLogin } = await import('./tronClassClient');
      const tcRetry = await tcLogin(userAccount, params.password);
      console.log('[studentIdAuth] TronClass retry', tcRetry.success ? 'OK' : 'FAILED');
    }
  } catch (err) {
    console.warn('[studentIdAuth] TronClass login error (continuing):', err);
  }

  // 同步所有資料（含 TronClass 課程）
  progress('syncingTronClass', '同步 TronClass 課程資料');
  try {
    await syncAllData(session, { includeEssential: true });
    console.log('[studentIdAuth] syncAllData completed');
  } catch (err) {
    console.warn('[studentIdAuth] syncAllData failed (continuing):', err);
  }

  // ── 登入後資料路由：推斷角色 + 建立師生關聯 ──
  try {
    const routeResult = await routePostLoginData(result.role);
    if (routeResult.roleInference.inferredRole !== result.role) {
      result.role = routeResult.roleInference.inferredRole;
      console.log(`[studentIdAuth] Role updated to: ${result.role} (${routeResult.roleInference.reason})`);
    }
  } catch (err) {
    console.warn('[studentIdAuth] postLoginDataRouter failed (continuing):', err);
  }

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

  // ── Step 1: 同時嘗試 E校園 + TronClass 登入（平行化加速） ──
  progress('authenticating', '連線校園系統');

  // 先嘗試 TronClass 原生 API（快速、可靠）
  let tcLoginOk = false;
  let tcSession: { userId: number | null; userName: string | null } | null = null;
  const tcLoginPromise = (async () => {
    try {
      console.log('[studentIdAuth] Hybrid: TronClass login (parallel)…');
      const { tcLogin } = await import('./tronClassClient');
      const tcResult = await tcLogin(userAccount, password);
      if (tcResult.success && tcResult.session) {
        tcLoginOk = true;
        tcSession = { userId: tcResult.session.userId, userName: tcResult.session.userName };
        console.log('[studentIdAuth] Hybrid: TronClass login OK, user:', tcResult.session.userName);
      } else {
        console.warn('[studentIdAuth] Hybrid: TronClass login failed:', tcResult.error);
      }
      return tcResult;
    } catch (err) {
      console.warn('[studentIdAuth] Hybrid: TronClass login error:', err);
      return null;
    }
  })();

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

  // 等待兩者完成（最多等 15 秒，避免 IPv6 DNS 問題卡太久）
  const loginTimeout = new Promise<void>((resolve) => setTimeout(resolve, 15000));
  await Promise.race([
    Promise.allSettled([tcLoginPromise, puLoginPromise]),
    loginTimeout,
  ]);

  // ── 判斷登入結果 ──
  if (!puLoginOk && !tcLoginOk) {
    // 兩邊都失敗 → 可能是真的帳密錯誤
    throw new Error('帳號或密碼錯誤，請確認後再試（E校園和 TronClass 均無法登入）');
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
  progress('linking', '建立 Campus One 帳號');

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
  await setTCSavedCredentials(userAccount, password);

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

  // ── Step 4: TronClass 資料同步（如果 TronClass 已登入就同步資料）──
  if (tcLoginOk) {
    progress('syncingTronClass', '同步 TronClass 課程資料');
    try {
      await syncAllData(session!, { includeEssential: true });
      console.log('[studentIdAuth] Hybrid: syncAllData completed');
    } catch (err) {
      console.warn('[studentIdAuth] Hybrid: syncAllData failed (continuing):', err);
    }
  } else if (!tcLoginOk && puLoginOk) {
    // E校園 成功但 TronClass 失敗 → 不重試（避免再等 20+ 秒）
    console.log('[studentIdAuth] Hybrid: TronClass failed, skipping retry to avoid long wait');
    progress('syncingTronClass', 'TronClass 暫時無法連線');

    // 仍然嘗試用 E校園 session 同步可用的資料
    try {
      await syncAllData(session!, { includeEssential: true });
      console.log('[studentIdAuth] Hybrid: syncAllData completed (E-campus only)');
    } catch (err) {
      console.warn('[studentIdAuth] Hybrid: syncAllData failed (continuing):', err);
    }
  }

  // ── 登入後資料路由：推斷角色 + 建立師生關聯 ──
  try {
    const routeResult = await routePostLoginData(result.role);
    if (routeResult.roleInference.inferredRole !== result.role) {
      result.role = routeResult.roleInference.inferredRole;
      console.log(`[studentIdAuth] Hybrid: Role updated to: ${result.role} (${routeResult.roleInference.reason})`);
    }
  } catch (err) {
    console.warn('[studentIdAuth] Hybrid: postLoginDataRouter failed (continuing):', err);
  }

  return result;
}
