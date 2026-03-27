/**
 * 學號密碼登入 — 直接連靜宜大學 alcat.pu.edu.tw 做真實認證。
 *
 * 流程：
 *   1. 用學號 + 密碼打 alcat.pu.edu.tw/index_check.php
 *   2. 成功後取得 session cookies
 *   3. 用 cookies 抓學生基本資料（姓名、班級、學號）
 *   4. 存 mock auth session（讓 app 的 auth state 認得這個使用者）
 *   5. 把 PU session 注入 PUAdapter（後續抓課表、成績用）
 */

import { saveMockAuthSession, type MockAuthSession } from './mockAuth';
import { puLogin, puFetchStudentInfo, type PUSession } from './puDirectScraper';
import { tcLogin } from './tronClassClient';
import { syncAllData } from './puDataCache';
import { getAdapter } from '../data/apiAdapters';
import { PUAdapter } from '../data/apiAdapters/PUAdapter';
import { hasUsableFirebaseConfig } from '../firebase';
import type { UserRole } from '../state/auth';

// ─── 全域 PU Session 存取 ────────────────────────────────
// 登入成功後存在這裡，PUAdapter 可以透過 getPUSession() 取得。
let _currentPUSession: PUSession | null = null;

export function getPUSession(): PUSession | null {
  return _currentPUSession;
}

export function clearPUSession(): void {
  _currentPUSession = null;
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

/**
 * 用學號 + 密碼登入靜宜大學。
 *
 * 直接連 alcat.pu.edu.tw 做認證，成功後抓學生資料，
 * 然後存 mock session 讓 app 認得這個使用者。
 */
export async function signInWithStudentId(params: {
  studentId: string;
  password: string;
  schoolId: string;
  schoolName?: string;
}): Promise<StudentIdLoginResult> {
  const studentId = params.studentId.trim().toUpperCase();

  if (!studentId) {
    throw new Error('請輸入學號');
  }
  if (!params.password.trim()) {
    throw new Error('請輸入密碼');
  }

  // ── Step 1: 登入靜宜 ──
  const loginResult = await puLogin(studentId, params.password);

  if (!loginResult.success || !loginResult.session) {
    throw new Error(loginResult.error ?? '登入失敗，請確認學號和密碼是否正確');
  }

  const session = loginResult.session;
  _currentPUSession = session;

  // ── Step 2: 抓學生資料 ──
  let displayName = session.studentName ?? `${studentId} 同學`;
  let department = '';
  let realStudentId = studentId;

  try {
    const infoResult = await puFetchStudentInfo(session);
    if (infoResult.success && infoResult.data) {
      if (infoResult.data.name) displayName = infoResult.data.name;
      if (infoResult.data.studentId) realStudentId = infoResult.data.studentId;
      if (infoResult.data.className) department = infoResult.data.className;
    }
  } catch {
    // 抓不到詳細資料沒關係，用登入時拿到的就好
  }

  // ── Step 3: 存 auth session ──
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
  };

  await saveMockAuthSession(mockSession);

  // ── Step 4: 注入 session 到 PUAdapter（讓後續的資料抓取用） ──
  try {
    const adapter = await getAdapter('tw-pu');
    if (adapter && adapter instanceof PUAdapter) {
      adapter.setDirectSession(session, realStudentId);
      // If Firebase is configured, also authenticate via Cloud Functions to get a sessionId.
      // This makes grade fetching (mypu domain) more reliable than relying on native cookie jars.
      if (hasUsableFirebaseConfig()) {
        await adapter.authenticate(realStudentId, params.password);
      }
    }
  } catch {
    // Adapter 尚未註冊也沒關係，PUAdapter 可以自己登入
  }

  // ── Step 5: 背景同步所有資料（先登入 TronClass，再同步全部資料） ──
  // 注意：必須先完成 TC 登入取得 cookie，syncAllData 的 TC 資料才抓得到
  (async () => {
    try {
      // 5a: 先登入 TronClass（取得 session cookie）
      const tcResult = await tcLogin(studentId, params.password);
      if (tcResult.success) {
        console.log('[studentIdAuth] TronClass login success:', tcResult.session?.userName);
      } else {
        console.warn('[studentIdAuth] TronClass login failed:', tcResult.error);
      }
    } catch (err) {
      console.warn('[studentIdAuth] TronClass login error:', err);
    }

    try {
      // 5b: TronClass 登入完成後（不管成功失敗），再同步所有資料
      await syncAllData(session);
    } catch (err) {
      console.warn('[studentIdAuth] background syncAllData failed:', err);
    }
  })();

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
