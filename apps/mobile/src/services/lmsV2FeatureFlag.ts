import Constants from 'expo-constants';

type Extra = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

function readExtra(): Extra {
  try {
    return (Constants?.expoConfig?.extra ?? {}) as Extra;
  } catch {
    return {};
  }
}

const env = (typeof process !== 'undefined' ? (process.env ?? {}) : {}) as Record<
  string,
  string | undefined
>;
const extra = readExtra();

const featureFlag = env.EXPO_PUBLIC_LMS_V2;
const SUPABASE_URL = env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl ?? '';
const SUPABASE_ANON_KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra.supabaseAnonKey ?? '';

// 設定 URL 和金鑰後會自動啟用。部署時可用 EXPO_PUBLIC_LMS_V2 強制關閉。
export function isLmsV2Enabled(): boolean {
  if (typeof featureFlag === 'string' && /^(0|false|no|off)$/i.test(featureFlag.trim()))
    return false;
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

let DEV_OVERRIDE: boolean | null = null;
export function __setLmsV2OverrideForTesting(value: boolean | null): void {
  DEV_OVERRIDE = value;
}
export function isLmsV2EnabledWithOverride(): boolean {
  if (DEV_OVERRIDE !== null) return DEV_OVERRIDE;
  return isLmsV2Enabled();
}
