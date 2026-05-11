import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── 常數 ────────────────────────────────────────────────────────────────────
const PU_CACHE_PREFIX = '@pu_cache_v1:';

// 依來源設定不同 TTL（毫秒）
const SOURCE_TTL: Record<PuCacheSource, number> = {
  pu: 24 * 60 * 60 * 1000, // E 校園資料：1 天
  tron: 10 * 60 * 1000, // TronClass：10 分鐘
  firebase: 2 * 60 * 1000, // Firebase：2 分鐘
  computed: 60 * 60 * 1000, // postLoginRouter 計算結果：1 小時
};

// ─── 型別 ────────────────────────────────────────────────────────────────────
export type PuCacheSource = 'pu' | 'tron' | 'firebase' | 'computed';

export interface PuCacheEntry<T> {
  data: T;
  fetchedAt: string; // ISO 字串
  source: PuCacheSource;
  ttlMs: number;
}

export type PuCacheKey =
  | `${string}:profile`
  | `${string}:courses:${string}` // e.g. 'pu:courses:2025S2'
  | `${string}:grades:${string}`
  | `${string}:announcements`
  | `${string}:absence`
  | `${string}:creditSummary`
  | `${string}:tronCourses`
  | `${string}:tronMembers:${string}` // e.g. 'tron:tronMembers:{courseId}'
  | `${string}:orders`
  | `${string}:repairRequests`
  | `${string}:resolvedRoles` // computed
  | `${string}:postLoginContext`; // computed

// ─── 讀寫 API ────────────────────────────────────────────────────────────────
export async function puCacheSet<T>(
  key: PuCacheKey,
  data: T,
  source: PuCacheSource,
): Promise<void> {
  const entry: PuCacheEntry<T> = {
    data,
    fetchedAt: new Date().toISOString(),
    source,
    ttlMs: SOURCE_TTL[source],
  };
  await AsyncStorage.setItem(PU_CACHE_PREFIX + key, JSON.stringify(entry));
}

export async function puCacheGet<T>(
  key: PuCacheKey,
  opts: { allowStale?: boolean } = {},
): Promise<{ data: T; isStale: boolean; fetchedAt: string } | null> {
  const raw = await AsyncStorage.getItem(PU_CACHE_PREFIX + key);
  if (!raw) return null;

  const entry = JSON.parse(raw) as PuCacheEntry<T>;
  const age = Date.now() - new Date(entry.fetchedAt).getTime();
  const isStale = age > entry.ttlMs;

  if (isStale && !opts.allowStale) return null;

  return { data: entry.data, isStale, fetchedAt: entry.fetchedAt };
}

export async function puCacheInvalidate(pattern?: string): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const targets = keys.filter(
    (k) => k.startsWith(PU_CACHE_PREFIX) && (pattern ? k.includes(pattern) : true),
  );
  if (targets.length > 0) await AsyncStorage.multiRemove(targets);
}

export async function puCacheClearAll(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const targets = keys.filter((k) => k.startsWith(PU_CACHE_PREFIX));
  if (targets.length > 0) await AsyncStorage.multiRemove(targets);
}

/** 切換學校或換帳號時清掉該學校在 @pu_cache_v1: 下的項目（不動 @campus_cache_ 等）。 */
export async function puCacheClearForSchool(schoolId: string): Promise<void> {
  if (!schoolId.trim()) return;
  const keys = await AsyncStorage.getAllKeys();
  const needle = `${schoolId}:`;
  const targets = keys.filter((k) => k.startsWith(PU_CACHE_PREFIX) && k.includes(needle));
  if (targets.length > 0) await AsyncStorage.multiRemove(targets);
}
