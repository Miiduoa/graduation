/**
 * Supabase Client (Web) — LMS v2
 * ───────────────────────────────────────────────────────────
 * 行為與 Mobile 對稱:
 *   - flag OFF → getSupabaseClient() 回 null,不打網路
 *   - flag ON → 建立 client,session 用 cookie + localStorage
 *
 * 用法:
 *   const sb = getSupabaseClient();
 *   if (!sb) return; // graceful fallback to demo / TronClass
 *   const { data, error } = await sb.from('courses').select('*');
 */

import { getSupabaseConfig, isLmsV2Enabled } from './lmsV2FeatureFlag';

type SupabaseClient = any;

let clientInstance: SupabaseClient | null = null;
let initAttempted = false;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isLmsV2Enabled()) return null;
  if (clientInstance) return clientInstance;
  if (initAttempted) return clientInstance;
  initAttempted = true;

  const { url, anonKey } = getSupabaseConfig();

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createClient } = require('@supabase/supabase-js');
    clientInstance = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
    return clientInstance;
  } catch (err) {
    if (typeof window !== 'undefined' && (window as any).__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[supabaseClient/web] failed to init:', err);
    }
    return null;
  }
}

/**
 * 用 Next.js Route Handler 取得的 Supabase JWT 注入 client
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
  } catch {
    return false;
  }
}

/**
 * 同 Mobile 的健康檢查
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
    return { ok: !error, durationMs: Date.now() - t0, error: error?.message };
  } catch (err: any) {
    return { ok: false, durationMs: Date.now() - t0, error: err?.message ?? String(err) };
  }
}
