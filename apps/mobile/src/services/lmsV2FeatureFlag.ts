/**
 * LMS v2 Feature Flag
 * ───────────────────────────────────────────────────────────
 * 中央化 feature flag,所有「LMS v2 是否啟用」的判斷都走這裡。
 * 預設 OFF — 行為與舊版 TronClass LMS 完全一致。
 *
 * 啟用條件 (ALL 必須成立):
 *   1. EXPO_PUBLIC_LMS_V2 = 'true' (或 app.config extra.lmsV2 = true)
 *   2. EXPO_PUBLIC_SUPABASE_URL 不為空
 *   3. EXPO_PUBLIC_SUPABASE_ANON_KEY 不為空
 *
 * 任一缺漏即視為 OFF,並走 puDataCache 舊路徑。
 */

import Constants from 'expo-constants';

type Extra = {
  lmsV2?: boolean;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

function readExtra(): Extra {
  try {
    const e = (Constants?.expoConfig?.extra ?? {}) as Extra;
    return e;
  } catch {
    return {};
  }
}

const env = (typeof process !== 'undefined' ? (process.env ?? {}) : {}) as Record<
  string,
  string | undefined
>;
const extra = readExtra();

const FLAG_RAW =
  env.EXPO_PUBLIC_LMS_V2 ?? (extra.lmsV2 ? 'true' : 'false');
const SUPABASE_URL =
  env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl ?? '';
const SUPABASE_ANON_KEY =
  env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra.supabaseAnonKey ?? '';

const isTruthy = (v: string | undefined) =>
  typeof v === 'string' && /^(1|true|yes|on)$/i.test(v.trim());

/**
 * 主要 API:LMS v2 是否啟用?
 * 任何呼叫 Supabase 的程式碼都要先檢查這個。
 */
export function isLmsV2Enabled(): boolean {
  return isTruthy(FLAG_RAW) && !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}

/**
 * 暴露 keys 給其他 service (supabaseClient.ts 等)
 */
export function getSupabaseConfig(): {
  url: string;
  anonKey: string;
  enabled: boolean;
} {
  return {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    enabled: isLmsV2Enabled(),
  };
}

/**
 * 開發用:暫時強制 ON / OFF (測試用,Production 勿用)
 */
let DEV_OVERRIDE: boolean | null = null;
export function __setLmsV2OverrideForTesting(value: boolean | null): void {
  DEV_OVERRIDE = value;
}
export function isLmsV2EnabledWithOverride(): boolean {
  if (DEV_OVERRIDE !== null) return DEV_OVERRIDE;
  return isLmsV2Enabled();
}
