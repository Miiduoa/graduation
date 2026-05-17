/**
 * Supabase Client (Mobile) — LMS v2
 * ───────────────────────────────────────────────────────────
 * 行為:
 *   - flag OFF 時:不初始化、不打網路。getSupabaseClient() 回傳 null。
 *   - flag ON 時:用 EXPO_PUBLIC_SUPABASE_* 建立 client,並用 AsyncStorage
 *     (Web 用 localStorage) 持久化 session。
 *
 * 安全:任何呼叫方都應該先檢查 isLmsV2Enabled() 再呼叫 getSupabaseClient()。
 * 若強行在 flag OFF 時呼叫,會收到 null,呼叫方需 graceful fallback。
 */

import { getSupabaseConfig, isLmsV2Enabled } from './lmsV2FeatureFlag';

// 動態 import 以避免 flag OFF 時把 @supabase/supabase-js 打進 bundle
// (注意:RN/Expo 沒有 dynamic import 行為,但 const 賦值已足以延遲初始化)
type SupabaseClient = any; // 避免硬相依 — 真實型別由 runtime 提供

let clientInstance: SupabaseClient | null = null;
let initAttempted = false;

function buildAuthStorage(): any {
  // Lazy require,避免 web SSR / node 環境出錯
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Platform } = require('react-native');
    return {
      getItem: (key: string) => {
        if (Platform.OS === 'web') {
          if (typeof window === 'undefined') return Promise.resolve(null);
          try {
            return Promise.resolve(window.localStorage.getItem(key));
          } catch {
            return Promise.resolve(null);
          }
        }
        return AsyncStorage.getItem(key);
      },
      setItem: (key: string, value: string) => {
        if (Platform.OS === 'web') {
          if (typeof window === 'undefined') return Promise.resolve();
          try {
            window.localStorage.setItem(key, value);
          } catch {
            /* ignore */
          }
          return Promise.resolve();
        }
        return AsyncStorage.setItem(key, value);
      },
      removeItem: (key: string) => {
        if (Platform.OS === 'web') {
          if (typeof window === 'undefined') return Promise.resolve();
          try {
            window.localStorage.removeItem(key);
          } catch {
            /* ignore */
          }
          return Promise.resolve();
        }
        return AsyncStorage.removeItem(key);
      },
    };
  } catch (err) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[supabaseClient] failed to build auth storage:', err);
    }
    return undefined;
  }
}

/**
 * 取得 Supabase client。Flag OFF 時回傳 null。
 * 第一次呼叫時惰性初始化,後續直接取 cache。
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isLmsV2Enabled()) return null;
  if (clientInstance) return clientInstance;
  if (initAttempted) return clientInstance;
  initAttempted = true;

  const { url, anonKey } = getSupabaseConfig();

  try {
    // 延遲 require — 只在 flag ON 時才把 @supabase/supabase-js 載入記憶體
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react-native-url-polyfill/auto');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createClient } = require('@supabase/supabase-js');

    clientInstance = createClient(url, anonKey, {
      auth: {
        storage: buildAuthStorage(),
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
    return clientInstance;
  } catch (err) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        '[supabaseClient] LMS v2 flag is ON but @supabase/supabase-js failed to load:',
        err,
      );
    }
    return null;
  }
}

/**
 * 把 Supabase JWT 注入到 client (Firebase ID → Supabase JWT 流程之後呼叫)
 */
export async function setSupabaseAccessToken(
  accessToken: string,
  refreshToken?: string,
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  try {
    await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken ?? accessToken,
    });
    return true;
  } catch (err) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[supabaseClient] setSession failed:', err);
    }
    return false;
  }
}

/**
 * 健康檢查 — 跑一個無副作用的 select,回傳 { ok, durationMs, error? }
 */
export async function probeSupabase(): Promise<{
  ok: boolean;
  durationMs: number;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) return { ok: false, durationMs: 0, error: 'flag-off' };
  const t0 = Date.now();
  try {
    const { error } = await client
      .from('courses')
      .select('id', { count: 'exact', head: true });
    return {
      ok: !error,
      durationMs: Date.now() - t0,
      error: error?.message,
    };
  } catch (err: any) {
    return {
      ok: false,
      durationMs: Date.now() - t0,
      error: err?.message ?? String(err),
    };
  }
}
