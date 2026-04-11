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
import {
  syncAllData,
  refreshCourses,
  refreshGrades,
  refreshStudentInfo,
  refreshAnnouncements,
} from './puDataCache';
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

  // ── Step 2: 先把 session 注入 PUAdapter（refreshXxx 會用到） ──
  // 這裡先用原始 studentId，後面拿到 realStudentId 再重新設定。
  try {
    const adapter = await getAdapter('tw-pu');
    if (adapter && adapter instanceof PUAdapter) {
      adapter.setDirectSession(session, studentId);
    }
  } catch {
    // Adapter 尚未註冊也沒關係
  }

  // ── Step 3: 同步抓取 E 校園核心資料（學生資料/課表/成績/公告） ──
  // 這些是學分試算、課程中樞、成績頁會立即用到的，必須登入時就抓完並寫入快取，
  // 不能只是背景跑 —— 否則 user 進去畫面就會是空白的。
  console.log('[studentIdAuth] Step 3: fetching essential campus data…');
  const [studentInfoResult, coursesResult, gradesResult, announcementsResult] =
    await Promise.allSettled([
      refreshStudentInfo(session),
      refreshCourses(session),
      refreshGrades(session),
      refreshAnnouncements(session),
    ]);

  let displayName = session.studentName ?? `${studentId} 同學`;
  let department = '';
  let realStudentId = studentId;

  if (studentInfoResult.status === 'fulfilled' && studentInfoResult.value) {
    const info = studentInfoResult.value;
    if (info.name) displayName = info.name;
    if (info.studentId) realStudentId = info.studentId;
    if (info.className) department = info.className;
  } else {
    // studentInfo 抓不到就回退用 puFetchStudentInfo（這不寫快取，僅提供 displayName）
    try {
      const infoResult = await puFetchStudentInfo(session);
      if (infoResult.success && infoResult.data) {
        if (infoResult.data.name) displayName = infoResult.data.name;
        if (infoResult.data.studentId) realStudentId = infoResult.data.studentId;
        if (infoResult.data.className) department = infoResult.data.className;
      }
    } catch {
      // 都抓不到也沒關係
    }
  }

  const essentialStats = {
    studentInfo: studentInfoResult.status === 'fulfilled' && !!studentInfoResult.value,
    courses: coursesResult.status === 'fulfilled' && !!coursesResult.value,
    grades: gradesResult.status === 'fulfilled' && !!gradesResult.value,
    announcements:
      announcementsResult.status === 'fulfilled' && !!announcementsResult.value,
  };
  console.log('[studentIdAuth] essential sync:', essentialStats);

  // ── Step 4: 存 auth session ──
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

  // ── Step 5: 用 realStudentId 重新注入 PUAdapter ──
  try {
    const adapter = await getAdapter('tw-pu');
    if (adapter && adapter instanceof PUAdapter) {
      adapter.setDirectSession(session, realStudentId);
    }
  } catch {
    // Adapter 尚未註冊也沒關係
  }

  // ── Step 6: 背景同步 TronClass（登入 + 拉資料） ──
  // TronClass 走另一個伺服器（identity.pu.edu.tw via domain fronting），
  // 可能網路不穩，所以放背景跑，不讓它卡住登入流程。
  // 不管成功失敗，E 校園的資料都已經就緒 → 學分試算、成績頁照常能用。
  (async () => {
    try {
      console.log('[studentIdAuth] background: logging into TronClass…');
      const tcResult = await tcLogin(realStudentId, params.password);
      if (tcResult.success) {
        console.log(
          '[studentIdAuth] TronClass login OK:',
          tcResult.session?.userName,
          'uid:',
          tcResult.session?.userId,
        );
      } else {
        console.warn('[studentIdAuth] TronClass login FAILED:', tcResult.error);
      }
    } catch (err) {
      console.warn('[studentIdAuth] TronClass login threw:', err);
    }

    try {
      // 補抓 TronClass 課程/作業/出缺勤等資料
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
