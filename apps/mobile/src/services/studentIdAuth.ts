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
import type { UserRole } from '../state/auth';

// ─── Progress Callback ──────────────────────────────────

export type LoginProgress =
  | 'authenticating'
  | 'syncingCampus'
  | 'syncingTronClass'
  | 'linking';

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
    const url = getCloudFunctionUrl("signInPuStudentId");
    console.log("[studentIdAuth] Trying backend unified login…");

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId,
        password,
        skipFirebase: true,
      }),
    });

    const text = await response.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    if (!response.ok || !data?.success) {
      const errorMsg = (data?.error as string) || `HTTP ${response.status}`;
      console.warn("[studentIdAuth] Backend unified login failed:", errorMsg);
      return { success: false, error: errorMsg };
    }

    console.log("[studentIdAuth] Backend unified login succeeded!");
    return {
      success: true,
      data: {
        uid: data.uid as string,
        studentId: (data.studentId as string) || studentId,
        displayName: (data.displayName as string) || `${studentId} 同學`,
        department: (data.department as string) || "",
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
    console.warn("[studentIdAuth] Backend unified login error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "後端連線失敗",
    };
  }
}

// ─── Main Login ─────────────────────────────────────────

/**
 * 用學號 + 密碼登入靜宜大學。
 *
 * 策略：
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

  // 儲存帳密供 TronClass session 過期後自動刷新（SecureStore 持久化）
  await setTCSavedCredentials(studentId, params.password);

  progress('authenticating', '驗證靜宜帳密');

  // ── 策略 A: 嘗試後端統一登入 ──
  const backendResult = await tryBackendUnifiedLogin(studentId, params.password);

  if (backendResult.success && backendResult.data) {
    return await handleBackendLoginSuccess(backendResult.data, params, progress);
  }

  // ── 策略 B: 降級為手機直連 E校園 + 後端代理 TronClass ──
  console.log("[studentIdAuth] Falling back to hybrid login…");
  return await handleHybridLogin(studentId, params, progress);
}

/**
 * 策略 A 成功：後端統一登入回來的資料處理
 */
async function handleBackendLoginSuccess(
  data: NonNullable<Awaited<ReturnType<typeof tryBackendUnifiedLogin>>["data"]>,
  params: { studentId: string; password: string; schoolId: string; schoolName?: string },
  progress: OnLoginProgress,
): Promise<StudentIdLoginResult> {
  const {
    studentId,
    displayName,
    department,
    puSessionId,
    tronClassSessionId,
    tronClassUserId,
  } = data;

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
  } catch { /* Adapter 尚未註冊 */ }

  // 快取後端回傳的資料（如果有的話）
  if (data.courses) {
    try { await seedCachedCourses(data.courses); } catch { /* ignore */ }
  }
  if (data.grades) {
    try { await seedCachedGrades(data.grades); } catch { /* ignore */ }
  }
  if (data.studentInfo) {
    try { await seedCachedStudentInfo(data.studentInfo); } catch { /* ignore */ }
  }
  if (data.announcements) {
    try { await seedCachedAnnouncements(data.announcements); } catch { /* ignore */ }
  }

  // ── TronClass 登入 ──
  progress('syncingTronClass', '同步 TronClass 課程');

  // 儲存 TronClass 後端 session（可能為 null，表示 TronClass 登入失敗但 E校園成功）
  if (tronClassSessionId) {
    await setTCBackendSession(tronClassSessionId, tronClassUserId);
    console.log("[studentIdAuth] TronClass session stored, userId:", tronClassUserId);
  } else {
    console.warn("[studentIdAuth] TronClass session not available, retrying…");
  }

  const userAccount = params.studentId;

  // 如果後端統一登入時 TronClass 沒成功，用 tcLogin 重試（backend → direct CAS）
  if (!tronClassSessionId) {
    try {
      console.log('[studentIdAuth] TronClass session missing, retrying…');
      const { tcLogin } = await import('./tronClassClient');
      const tcRetry = await tcLogin(userAccount, params.password);
      if (tcRetry.success) {
        console.log('[studentIdAuth] TronClass retry succeeded');
      } else {
        console.warn('[studentIdAuth] TronClass retry failed:', tcRetry.error);
      }
    } catch (err) {
      console.warn('[studentIdAuth] TronClass retry error:', err);
    }
  }

  // ── 建立帳號 ──
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
  await saveMockAuthSession(mockSession);

  try {
    await syncAllData(session);
  } catch (err) {
    console.warn('[studentIdAuth] syncAllData failed:', err);
  }

  return {
    uid,
    email,
    displayName,
    studentId,
    department,
    role: 'student',
    schoolId: params.schoolId,
    session,
  };
}

/**
 * 策略 B: 手機直連 E校園 + 後端代理 TronClass
 *
 * 當後端統一登入不可用時（Cloud Functions 未部署、網路問題等），
 * 降級為：
 *   1. 手機直接連 alcat.pu.edu.tw 登入 E校園
 *   2. 同一組帳密直接登入 TronClass（原生 API /api/login）
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

  // ── Step 1: 手機直連 E校園 ──
  progress('authenticating', '連線 E 校園');
  const loginResult = await puLogin(userAccount, password);
  if (!loginResult.success || !loginResult.session) {
    throw new Error(loginResult.error ?? '登入失敗，請確認學號和密碼是否正確');
  }

  const session = loginResult.session;
  _currentPUSession = session;

  // 注入 PUAdapter
  try {
    const adapter = await getAdapter('tw-pu');
    if (adapter && adapter instanceof PUAdapter) {
      adapter.setDirectSession(session, userAccount);
    }
  } catch { /* Adapter 尚未註冊 */ }

  // ── Step 2: 同步抓取 E 校園核心資料 ──
  progress('syncingCampus', '同步 E 校園資料');
  console.log('[studentIdAuth] Hybrid: fetching E-campus data…');
  const [studentInfoResult] = await Promise.allSettled([
    refreshStudentInfo(session),
    refreshCourses(session),
    refreshGrades(session),
    refreshAnnouncements(session),
  ]);

  let displayName = session.studentName ?? `${userAccount} 同學`;
  let department = '';
  let realStudentId = userAccount;

  if (studentInfoResult.status === 'fulfilled' && studentInfoResult.value) {
    const info = studentInfoResult.value;
    if (info.name) displayName = info.name;
    if (info.studentId) realStudentId = info.studentId;
    if (info.className) department = info.className;
  } else {
    try {
      const infoResult = await puFetchStudentInfo(session);
      if (infoResult.success && infoResult.data) {
        if (infoResult.data.name) displayName = infoResult.data.name;
        if (infoResult.data.studentId) realStudentId = infoResult.data.studentId;
        if (infoResult.data.className) department = infoResult.data.className;
      }
    } catch { /* ignore */ }
  }

  // 重新注入 PUAdapter（用 realStudentId）
  try {
    const adapter = await getAdapter('tw-pu');
    if (adapter && adapter instanceof PUAdapter) {
      adapter.setDirectSession(session, realStudentId);
    }
  } catch { /* ignore */ }

  // ── Step 3: 登入 TronClass（帳密跟 E校園 相同）──
  // tcLogin 內部策略：後端代理 → 直連 CAS（自動 fallback）
  progress('syncingTronClass', '登入 TronClass');
  await setTCSavedCredentials(userAccount, password);

  try {
    console.log('[studentIdAuth] TronClass: logging in…');
    const { tcLogin } = await import('./tronClassClient');
    const tcResult = await tcLogin(userAccount, password);
    if (tcResult.success) {
      console.log('[studentIdAuth] TronClass login succeeded');
    } else {
      console.warn('[studentIdAuth] TronClass login failed:', tcResult.error);
    }
  } catch (err) {
    console.warn('[studentIdAuth] TronClass login error:', err);
  }

  // ── Step 4: 建立帳號 ──
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

  // ── Step 5: 同步所有資料 ──
  try {
    await syncAllData(session);
  } catch (err) {
    console.warn('[studentIdAuth] syncAllData failed:', err);
  }

  return {
    uid,
    email,
    displayName,
    studentId: realStudentId,
    department,
    role: 'student',
    schoolId: params.schoolId,
    session,
  };
}
