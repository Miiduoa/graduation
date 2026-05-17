/**
 * LMS Auth Bridge (Mobile) — Firebase ID Token → Supabase JWT
 * ───────────────────────────────────────────────────────────
 * 流程:
 *   1. 用戶用 Firebase Auth 登入 (現狀)
 *   2. 拿 firebaseUser.getIdToken() → POST 給 callable issueSupabaseJwt
 *   3. callable 在 Firebase 端用 service_role 簽一個 Supabase JWT 回傳
 *   4. 本檔把 JWT 注入 supabase-js client
 *
 * 失敗模式:
 *   - Flag OFF → 直接 noop 回 false
 *   - Firebase 未登入 → 回 false (不擋 UI,只是 LMS v2 工具不可用)
 *   - callable 報錯 → log + 回 false
 */

import { isLmsV2Enabled } from './lmsV2FeatureFlag';
import { setSupabaseAccessToken, getSupabaseClient } from './supabaseClient';

type BridgeResult = {
  success: boolean;
  reason?: 'flag-off' | 'no-firebase-user' | 'callable-failed' | 'set-session-failed' | 'unknown';
  jwtExpiresAt?: number;
};

let lastBridgeAt = 0;
let lastBridgeJwtExp = 0;
const BRIDGE_MIN_INTERVAL_MS = 60_000;          // 1 min 內不重打
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60_000;    // 過期前 5 min 主動更新

/**
 * 主要 API:嘗試把 Firebase 身分換成 Supabase JWT 並注入 client。
 * 在 App 啟動、登入後、進入 LMS 頁面前呼叫。可重複呼叫,有去重。
 */
export async function bridgeFirebaseToSupabase(opts?: {
  force?: boolean;
}): Promise<BridgeResult> {
  if (!isLmsV2Enabled()) return { success: false, reason: 'flag-off' };

  const now = Date.now();
  const stillFresh =
    lastBridgeJwtExp > 0 &&
    lastBridgeJwtExp - now > REFRESH_BEFORE_EXPIRY_MS &&
    now - lastBridgeAt < BRIDGE_MIN_INTERVAL_MS;
  if (!opts?.force && stillFresh) {
    return { success: true, jwtExpiresAt: lastBridgeJwtExp };
  }

  // Lazy require — 不在 flag OFF 時把 firebase 強拉進來
  let getAuth: any = null;
  let getFunctions: any = null;
  let httpsCallable: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ getAuth } = require('firebase/auth'));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ getFunctions, httpsCallable } = require('firebase/functions'));
  } catch (err) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[lmsAuthBridge] firebase modules not available:', err);
    }
    return { success: false, reason: 'unknown' };
  }

  let user: any = null;
  try {
    user = getAuth()?.currentUser ?? null;
  } catch {
    /* ignore */
  }
  if (!user) return { success: false, reason: 'no-firebase-user' };

  let idToken = '';
  try {
    idToken = await user.getIdToken();
  } catch {
    return { success: false, reason: 'no-firebase-user' };
  }

  try {
    const fns = getFunctions();
    const callable = httpsCallable(fns, 'issueSupabaseJwt');
    const res: any = await callable({ idToken });
    const accessToken: string | undefined = res?.data?.accessToken;
    const refreshToken: string | undefined = res?.data?.refreshToken;
    const expiresAt: number | undefined = res?.data?.expiresAt;
    if (!accessToken) {
      return { success: false, reason: 'callable-failed' };
    }
    const ok = await setSupabaseAccessToken(accessToken, refreshToken);
    if (!ok) return { success: false, reason: 'set-session-failed' };
    lastBridgeAt = now;
    lastBridgeJwtExp = typeof expiresAt === 'number' ? expiresAt : now + 60 * 60 * 1000;
    return { success: true, jwtExpiresAt: lastBridgeJwtExp };
  } catch (err) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[lmsAuthBridge] callable failed:', err);
    }
    return { success: false, reason: 'callable-failed' };
  }
}

/**
 * 登出時清掉 session
 */
export async function clearLmsV2Session(): Promise<void> {
  if (!isLmsV2Enabled()) return;
  const client = getSupabaseClient();
  if (!client) return;
  try {
    await client.auth.signOut();
  } catch {
    /* ignore */
  }
  lastBridgeAt = 0;
  lastBridgeJwtExp = 0;
}

/**
 * 取目前 bridge 狀態 (給 settings / debug 畫面顯示)
 */
export function getLmsV2BridgeStatus(): {
  enabled: boolean;
  lastBridgeAt: number;
  jwtExpiresAt: number;
  isFresh: boolean;
} {
  const now = Date.now();
  return {
    enabled: isLmsV2Enabled(),
    lastBridgeAt,
    jwtExpiresAt: lastBridgeJwtExp,
    isFresh:
      lastBridgeJwtExp > 0 && lastBridgeJwtExp - now > REFRESH_BEFORE_EXPIRY_MS,
  };
}
