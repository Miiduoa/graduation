/**
 * LMS v2 Feature Flag (V2 — 自動啟用版)
 * ───────────────────────────────────────────────────────────
 * 用戶決定直接換,不再保留 OFF 路徑作為產品行為。
 * 但保留「Supabase URL/Key 缺失時 graceful fallback 回 TronClass」作為**安全網**
 * (避免 dev 環境沒設變數時 App crash)。
 *
 * 啟用條件 (任一即視為 ON):
 *   1. EXPO_PUBLIC_SUPABASE_URL 與 EXPO_PUBLIC_SUPABASE_ANON_KEY 都不為空
 *   2. (或 app.config extra.supabaseUrl 與 supabaseAnonKey 都有)
 *
 * EXPO_PUBLIC_LMS_V2='false' 仍可強制關閉 (緊急回退用)。
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

const FLAG_RAW = env.EXPO_PUBLIC_LMS_V2; // 預設 undefined = 自動依 URL/Key 判斷
const SUPABASE_URL =
  env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl ?? '';
const SUPABASE_ANON_KEY =
  env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra.supabaseAnonKey ?? '';

const isTruthy = (v: string | undefined) =>
  typeof v === 'string' && /^(1|true|yes|on)$/i.test(v.trim());
const isFalsy = (v: string | undefined) =>
  typeof v === 'string' && /^(0|false|no|off)$/i.test(v.trim());

/**
 * 主要 API:LMS v2 是否啟用?
 *
 * 規則:
 *   1. 若 EXPO_PUBLIC_LMS_V2='false' (或 0/no/off) → 強制關閉 (緊急回退)
 *   2. 若有 SUPABASE_URL + ANON_KEY → 自動啟用
 *   3. 否則(沒設 Supabase) → 關閉 (fallback to TronClass,避免 crash)
 */
export function isLmsV2Enabled(): boolean {
  if (isFalsy(FLAG_RAW)) return false; // 緊急回退
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
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
