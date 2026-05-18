/**
 * LMS v2 Demo Sign-In — Bootstrap 用
 * ───────────────────────────────────────────────────────────
 * Demo 期間,Firebase callable issueSupabaseJwt 還沒部署,
 * 直接用 demo 帳號的 email/password 登入 Supabase。
 *
 * 預設帳號 (在 Supabase 已建好,且有對應 course_members 列):
 *   student@demo.local / Demo1234!
 *   teacher@demo.local / Demo1234!
 *
 * 規則:
 *   1. flag OFF 或 client null → noop
 *   2. 已登入 → noop
 *   3. 未登入 → 依當前 DemoRole 選 student 或 teacher 自動登入
 *   4. 只在 App 啟動 / LearnStack mount 時觸發一次
 *
 * Production 上線前要 (a) 移除此檔 (b) 改走 lmsAuthBridge.bridgeFirebaseToSupabase
 */

import { isLmsV2Enabled } from './lmsV2FeatureFlag';
import { getSupabaseClient } from './supabaseClient';

const DEMO_ACCOUNTS = {
  student: { email: 'student@demo.local', password: 'Demo1234!' },
  teacher: { email: 'teacher@demo.local', password: 'Demo1234!' },
};

type DemoPersona = keyof typeof DEMO_ACCOUNTS;

let signInAttempted = false;
let signedInAs: DemoPersona | null = null;

/**
 * 確保 Supabase 客戶端已用 demo 帳號登入。
 * 可重複呼叫,有去重。
 */
export async function ensureLmsV2DemoSignIn(
  persona: DemoPersona = 'student',
): Promise<{ ok: boolean; userId?: string; persona?: DemoPersona; reason?: string }> {
  if (!isLmsV2Enabled()) return { ok: false, reason: 'flag-off' };
  const sb = getSupabaseClient();
  if (!sb) return { ok: false, reason: 'no-client' };

  // 已登入則直接回
  try {
    const { data } = await sb.auth.getUser();
    if (data?.user?.id) {
      signedInAs =
        data.user.email === DEMO_ACCOUNTS.teacher.email ? 'teacher' : 'student';
      return { ok: true, userId: data.user.id, persona: signedInAs };
    }
  } catch {
    /* fallthrough to sign-in */
  }

  // 用 password 登入
  const creds = DEMO_ACCOUNTS[persona];
  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email: creds.email,
      password: creds.password,
    });
    signInAttempted = true;
    if (error || !data?.user?.id) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[lmsV2DemoSignIn] failed:', error?.message);
      }
      return { ok: false, reason: error?.message ?? 'unknown' };
    }
    signedInAs = persona;
    return { ok: true, userId: data.user.id, persona };
  } catch (err: any) {
    return { ok: false, reason: err?.message ?? 'exception' };
  }
}

/**
 * 切換 persona(學生 ↔ 教師)— 給 demo 切角色用
 */
export async function switchLmsV2DemoPersona(
  persona: DemoPersona,
): Promise<{ ok: boolean; userId?: string }> {
  const sb = getSupabaseClient();
  if (!sb) return { ok: false };
  try {
    await sb.auth.signOut();
  } catch {
    /* ignore */
  }
  signedInAs = null;
  return ensureLmsV2DemoSignIn(persona);
}

export function getCurrentDemoPersona(): DemoPersona | null {
  return signedInAs;
}
