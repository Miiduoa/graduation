/**
 * LMS v2 Feature Flag — Web 版
 * 與 Mobile 對應 (apps/mobile/src/services/lmsV2FeatureFlag.ts)
 *
 * 啟用條件 (ALL):
 *   1. NEXT_PUBLIC_LMS_V2 = 'true'
 *   2. NEXT_PUBLIC_SUPABASE_URL 不為空
 *   3. NEXT_PUBLIC_SUPABASE_ANON_KEY 不為空
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const FLAG_RAW = process.env.NEXT_PUBLIC_LMS_V2 ?? 'false';

const isTruthy = (v: string | undefined) =>
  typeof v === 'string' && /^(1|true|yes|on)$/i.test(v.trim());

export function isLmsV2Enabled(): boolean {
  return isTruthy(FLAG_RAW) && !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}

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
