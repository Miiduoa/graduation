/**
 * LMS v2 Feature Flag — Web 版 (自動啟用版)
 * 與 Mobile 對應 (apps/mobile/src/services/lmsV2FeatureFlag.ts)
 *
 * 規則:
 *   1. NEXT_PUBLIC_LMS_V2='false' → 強制關閉 (緊急回退)
 *   2. 有 SUPABASE_URL + ANON_KEY → 自動啟用
 *   3. 沒設 Supabase → 關閉 (避免 build error)
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const FLAG_RAW = process.env.NEXT_PUBLIC_LMS_V2; // undefined = 自動

const isFalsy = (v: string | undefined) =>
  typeof v === 'string' && /^(0|false|no|off)$/i.test(v.trim());

export function isLmsV2Enabled(): boolean {
  if (isFalsy(FLAG_RAW)) return false;
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
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
