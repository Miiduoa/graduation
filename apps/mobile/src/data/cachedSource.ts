import AsyncStorage from "@react-native-async-storage/async-storage";
import { DataSource, QueryOptions } from "./source";

const CACHE_PREFIX = "@campus_cache_";
const DEFAULT_CACHE_EXPIRY_MS = 5 * 60 * 1000;
const CACHE_VERSION = 2; // 增加版本號以使舊快取失效
const MAX_CACHE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const CACHE_CLEANUP_THRESHOLD = 0.8; // 80%

// 正在進行中的請求追蹤（用於請求去重）
const pendingRequests = new Map<string, Promise<unknown>>();

// 背景更新鎖（防止同一個 key 同時進行多個背景更新）
const backgroundUpdateLocks = new Set<string>();

// 快取版本追蹤（用於防止舊資料覆蓋新資料）
const cacheVersionMap = new Map<string, number>();

type DataCategory = "realtime" | "frequent" | "stable" | "static";
type CachePriority = "essential" | "important" | "optional";

const CACHE_EXPIRY_BY_CATEGORY: Record<DataCategory, number> = {
  realtime: 30 * 1000,       // 30 秒
  frequent: 5 * 60 * 1000,   // 5 分鐘
  stable: 30 * 60 * 1000,    // 30 分鐘
  static: 24 * 60 * 60 * 1000, // 24 小時
};

// 離線模式下的過期時間倍數
const OFFLINE_EXPIRY_MULTIPLIER = 4;

// 儲存離線狀態
let isOfflineMode = false;
let offlineModeUnsubscribe: (() => void) | null = null;

export function setOfflineMode(offline: boolean): void {
  const wasOffline = isOfflineMode;
  isOfflineMode = offline;
  
  if (wasOffline !== offline) {
    console.log(`[cache] Offline mode changed: ${wasOffline} -> ${offline}`);
  }
}

export function getOfflineMode(): boolean {
  return isOfflineMode;
}

/**
 * 初始化離線模式同步 - 監聽網路狀態並自動更新快取層的離線模式
 * 這解決了 offline.ts 和 cachedSource.ts 之間離線狀態不同步的問題
 */
export async function initOfflineModeSync(): Promise<() => void> {
  // 避免重複初始化
  if (offlineModeUnsubscribe) {
    return offlineModeUnsubscribe;
  }
  
  try {
    const { subscribeToNetworkStatus, getNetworkStatus, initNetworkMonitoring } = await import("../services/offline");
    
    // 確保網路監控已經初始化
    initNetworkMonitoring();
    
    // 取得初始狀態
    const initialStatus = getNetworkStatus();
    const initialOffline = !initialStatus.isConnected || initialStatus.isInternetReachable === false;
    setOfflineMode(initialOffline);
    
    // 訂閱網路狀態變化
    const unsubscribe = subscribeToNetworkStatus((status) => {
      const offline = !status.isConnected || status.isInternetReachable === false;
      setOfflineMode(offline);
    });
    
    offlineModeUnsubscribe = () => {
      unsubscribe();
      offlineModeUnsubscribe = null;
    };
    
    return offlineModeUnsubscribe;
  } catch (e) {
    console.warn("[cache] Failed to init offline mode sync:", e);
    return () => {};
  }
}

export function getEffectiveExpiry(category: DataCategory): number {
  const baseExpiry = CACHE_EXPIRY_BY_CATEGORY[category];
  return isOfflineMode ? baseExpiry * OFFLINE_EXPIRY_MULTIPLIER : baseExpiry;
}

const CACHE_PRIORITY_BY_PREFIX: Record<string, CachePriority> = {
  announcements: "essential",
  events: "essential",
  pois: "important",
  menus: "important",
  courses: "important",
  busRoutes: "optional",
  lostFound: "optional",
  announcement: "essential",
  event: "essential",
  poi: "important",
  menuItem: "optional",
  course: "important",
  busRoute: "optional",
  group: "optional",
};

const METHOD_CACHE_CATEGORY: Record<string, DataCategory> = {
  listAnnouncements: "frequent",
  getAnnouncement: "frequent",
  listEvents: "frequent",
  getEvent: "frequent",
  listMenus: "frequent",
  getMenuItem: "frequent",
  
  listPois: "static",
  getPoi: "static",
  listBusRoutes: "stable",
  getBusRoute: "stable",
  
  listCourses: "stable",
  getCourse: "stable",
  
  listLostFoundItems: "frequent",
  getLostFoundItem: "frequent",
  
  getBusArrivals: "realtime",
  
  listGroups: "frequent",
  getGroup: "frequent",
  listGroupPosts: "frequent",
  getGroupPost: "frequent",
};

function getCacheExpiry(methodName: string): number {
  const category = METHOD_CACHE_CATEGORY[methodName];
  if (category) {
    return getEffectiveExpiry(category);
  }
  return isOfflineMode ? DEFAULT_CACHE_EXPIRY_MS * OFFLINE_EXPIRY_MULTIPLIER : DEFAULT_CACHE_EXPIRY_MS;
}

type CacheEntry<T> = {
  data: T;
  timestamp: number;
  schoolId: string;
  version: number;
  category?: DataCategory;
  updateVersion?: number; // 用於追蹤更新順序
};

type CacheUpdateListener = (key: string, data: unknown) => void;
const cacheUpdateListeners = new Set<CacheUpdateListener>();

export function subscribeToCacheUpdates(listener: CacheUpdateListener): () => void {
  cacheUpdateListeners.add(listener);
  return () => cacheUpdateListeners.delete(listener);
}

function notifyCacheUpdate(key: string, data: unknown): void {
  cacheUpdateListeners.forEach((listener) => {
    try {
      listener(key, data);
    } catch (e) {
      console.warn("[cache] Listener error:", e);
    }
  });
}

type GetCacheOptions = {
  allowStale?: boolean;
  expiryMs?: number;
};

async function getCache<T>(
  key: string, 
  schoolId: string, 
  options: GetCacheOptions = {}
): Promise<{ data: T; isStale: boolean; cachedAt: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;

    const entry: CacheEntry<T> = JSON.parse(raw);
    
    if (entry.version !== CACHE_VERSION) {
      await AsyncStorage.removeItem(`${CACHE_PREFIX}${key}`);
      return null;
    }
    
    if (entry.schoolId !== schoolId && schoolId !== "global") {
      return null;
    }

    // 根據資料類別和離線狀態計算有效過期時間
    let effectiveExpiry: number;
    if (options.expiryMs !== undefined) {
      effectiveExpiry = options.expiryMs;
    } else if (entry.category) {
      effectiveExpiry = getEffectiveExpiry(entry.category);
    } else {
      effectiveExpiry = isOfflineMode 
        ? DEFAULT_CACHE_EXPIRY_MS * OFFLINE_EXPIRY_MULTIPLIER 
        : DEFAULT_CACHE_EXPIRY_MS;
    }
    
    const age = Date.now() - entry.timestamp;
    const isStale = age > effectiveExpiry;
    
    if (isStale && !options.allowStale) {
      return null;
    }

    return { data: entry.data, isStale, cachedAt: entry.timestamp };
  } catch (e) {
    console.warn("[cache] Failed to read cache:", key, e);
    return null;
  }
}

async function setCache<T>(
  key: string, 
  data: T, 
  schoolId: string,
  category?: DataCategory,
  updateVersion?: number
): Promise<boolean> {
  try {
    // 檢查更新版本，防止舊資料覆蓋新資料
    if (updateVersion !== undefined) {
      const currentVersion = cacheVersionMap.get(key) ?? 0;
      if (updateVersion < currentVersion) {
        console.log(`[cache] Skipping stale update for ${key}: version ${updateVersion} < ${currentVersion}`);
        return false;
      }
      cacheVersionMap.set(key, updateVersion);
    }

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      schoolId,
      version: CACHE_VERSION,
      category,
      updateVersion,
    };
    await AsyncStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(entry));
    
    // Check if cleanup is needed (run in background)
    checkAndCleanupCache().catch((e) => {
      console.warn("[cache] Background cleanup failed:", e);
    });
    return true;
  } catch (e) {
    console.warn("[cache] Failed to write cache:", key, e);
    return false;
  }
}

async function checkAndCleanupCache(): Promise<void> {
  const { approximateBytes } = await getCacheSize();
  
  if (approximateBytes > MAX_CACHE_SIZE_BYTES * CACHE_CLEANUP_THRESHOLD) {
    await cleanupOldestCache();
  }
}

function getCachePriority(key: string): CachePriority {
  const prefix = key.split("_")[0];
  return CACHE_PRIORITY_BY_PREFIX[prefix] ?? "optional";
}

async function cleanupOldestCache(): Promise<void> {
  try {
    const info = await getCacheInfo();
    
    if (info.length === 0) return;
    
    const priorityOrder: Record<CachePriority, number> = {
      optional: 0,
      important: 1,
      essential: 2,
    };
    
    const sorted = info.sort((a, b) => {
      const aPriority = priorityOrder[getCachePriority(a.key)];
      const bPriority = priorityOrder[getCachePriority(b.key)];
      
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      
      if (a.isStale !== b.isStale) {
        return a.isStale ? -1 : 1;
      }
      
      return a.timestamp.getTime() - b.timestamp.getTime();
    });
    
    const toRemoveCount = Math.max(1, Math.ceil(sorted.length * 0.3));
    const keysToRemove = sorted.slice(0, toRemoveCount).map((i) => `${CACHE_PREFIX}${i.key}`);
    
    if (keysToRemove.length > 0) {
      await AsyncStorage.multiRemove(keysToRemove);
      const removedPriorities = keysToRemove.map((k) => getCachePriority(k.replace(CACHE_PREFIX, "")));
      console.log(`[cache] Cleaned up ${keysToRemove.length} cache entries (priorities: ${[...new Set(removedPriorities)].join(", ")})`);
    }
  } catch (e) {
    console.warn("[cache] Failed to cleanup old cache:", e);
  }
}

type CachedDataSourceOptions = {
  onBackgroundUpdateError?: (key: string, error: unknown) => void;
};

async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  delayMs = 1000
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
}

/**
 * 將 QueryOptions 序列化為快取 key 的一部分
 * 確保不同的查詢參數會使用不同的快取條目
 */
function serializeQueryOptions(options: QueryOptions): string {
  const parts: string[] = [];
  
  if (options.limit !== undefined) {
    parts.push(`l${options.limit}`);
  }
  if (options.pageSize !== undefined) {
    parts.push(`ps${options.pageSize}`);
  }
  if (options.page !== undefined) {
    parts.push(`p${options.page}`);
  }
  if (options.cursor) {
    parts.push(`c${options.cursor}`);
  }
  if (options.orderBy) {
    parts.push(`o${options.orderBy}`);
  } else if (options.sortBy) {
    parts.push(`o${options.sortBy}`);
  }
  if (options.orderDirection) {
    parts.push(`d${options.orderDirection}`);
  } else if (options.sortOrder) {
    parts.push(`d${options.sortOrder}`);
  }
  if (options.search) {
    parts.push(`s${options.search}`);
  }
  if (options.filters && options.filters.length > 0) {
    const filterStr = options.filters
      .map(f => `${f.field}${f.operator}${f.value}`)
      .sort()
      .join(",");
    parts.push(`f${filterStr}`);
  }
  
  return parts.join("_");
}

// 可被快取的列表方法定義（方法名 -> 快取 key 前綴）
const CACHEABLE_LIST_METHODS: Record<string, string> = {
  listAnnouncements: "announcements",
  listEvents: "events",
  listPois: "pois",
  listMenus: "menus",
  listCourses: "courses",
  listBusRoutes: "busRoutes",
  listLostFoundItems: "lostFound",
};

// 不允許快取空陣列的方法（避免登入前空結果被快取、登入後一直讀到空資料）
const NEVER_CACHE_EMPTY_METHODS = new Set([
  "listAnnouncements",
  "listCourses",
]);

// 可被快取的單項目獲取方法（需要 id 參數）
const CACHEABLE_GET_METHODS: Record<string, string> = {
  getAnnouncement: "announcement",
  getEvent: "event",
  getPoi: "poi",
  getMenuItem: "menuItem",
  getCourse: "course",
  getBusRoute: "busRoute",
  getGroup: "group",
};

export function createCachedSource(
  source: DataSource, 
  options: CachedDataSourceOptions = {}
): DataSource {
  const { onBackgroundUpdateError } = options;

  async function fetchAndCacheListWithExpiry<T>(
    cacheKey: string,
    schoolId: string,
    fetcher: () => Promise<T[]>,
    expiryMs: number,
    methodName?: string
  ): Promise<T[]> {
    const skipCacheEmpty = methodName ? NEVER_CACHE_EMPTY_METHODS.has(methodName) : false;

    const cached = await getCache<T[]>(cacheKey, schoolId, { allowStale: true, expiryMs });

    if (cached) {
      // 如果快取是空陣列且屬於不允許快取空結果的方法，跳過快取直接重新取得
      if (skipCacheEmpty && Array.isArray(cached.data) && cached.data.length === 0) {
        console.log(`[cache] Skipping empty cached result for ${methodName} (${cacheKey})`);
        // 不 return，讓它 fall through 到下面的 fetch 邏輯
      } else {
        if (cached.isStale && !backgroundUpdateLocks.has(cacheKey)) {
          // 取得背景更新鎖
          backgroundUpdateLocks.add(cacheKey);
          const updateVersion = Date.now();

          fetchWithRetry(fetcher)
            .then(async (fresh) => {
              if (skipCacheEmpty && Array.isArray(fresh) && fresh.length === 0) {
                console.log(`[cache] Background refresh returned empty for ${methodName}, not caching`);
                return;
              }
              const saved = await setCache(cacheKey, fresh, schoolId, undefined, updateVersion);
              if (saved) {
                notifyCacheUpdate(cacheKey, fresh);
              }
            })
            .catch((e) => {
              console.warn("[cache] Background refresh failed:", cacheKey, e);
              onBackgroundUpdateError?.(cacheKey, e);
            })
            .finally(() => {
              backgroundUpdateLocks.delete(cacheKey);
            });
        }
        return cached.data;
      }
    }

    // 請求去重：如果已經有相同的請求在進行中，等待它完成
    const pendingKey = `list_${cacheKey}`;
    if (pendingRequests.has(pendingKey)) {
      return pendingRequests.get(pendingKey) as Promise<T[]>;
    }

    const fetchPromise = (async () => {
      try {
        const updateVersion = Date.now();
        const fresh = await fetchWithRetry(fetcher);
        // 不快取空陣列（對關鍵方法）
        if (skipCacheEmpty && Array.isArray(fresh) && fresh.length === 0) {
          console.log(`[cache] ${methodName} returned empty array, skipping cache write (${cacheKey})`);
          return fresh;
        }
        await setCache(cacheKey, fresh, schoolId, undefined, updateVersion);
        return fresh;
      } catch (e) {
        const staleCached = await getCache<T[]>(cacheKey, schoolId, { allowStale: true, expiryMs: Infinity });
        if (staleCached) {
          console.warn("[cache] Using stale cache due to fetch error:", cacheKey);
          return staleCached.data;
        }
        throw e;
      } finally {
        pendingRequests.delete(pendingKey);
      }
    })();

    pendingRequests.set(pendingKey, fetchPromise);
    return fetchPromise;
  }

  async function fetchAndCacheSingleWithExpiry<T>(
    cacheKey: string,
    fetcher: () => Promise<T | null>,
    expiryMs: number
  ): Promise<T | null> {
    const cached = await getCache<T>(cacheKey, "global", { allowStale: true, expiryMs });
    
    if (cached) {
      if (cached.isStale && !backgroundUpdateLocks.has(cacheKey)) {
        backgroundUpdateLocks.add(cacheKey);
        const updateVersion = Date.now();
        
        fetchWithRetry(fetcher)
          .then(async (fresh) => {
            if (fresh !== null) {
              const saved = await setCache(cacheKey, fresh, "global", undefined, updateVersion);
              if (saved) {
                notifyCacheUpdate(cacheKey, fresh);
              }
            }
          })
          .catch((e) => {
            console.warn("[cache] Background refresh failed:", cacheKey, e);
            onBackgroundUpdateError?.(cacheKey, e);
          })
          .finally(() => {
            backgroundUpdateLocks.delete(cacheKey);
          });
      }
      return cached.data;
    }

    // 請求去重
    const pendingKey = `single_${cacheKey}`;
    if (pendingRequests.has(pendingKey)) {
      return pendingRequests.get(pendingKey) as Promise<T | null>;
    }

    const fetchPromise = (async () => {
      try {
        const updateVersion = Date.now();
        const fresh = await fetchWithRetry(fetcher);
        if (fresh !== null) {
          await setCache(cacheKey, fresh, "global", undefined, updateVersion);
        }
        return fresh;
      } catch (e) {
        const staleCached = await getCache<T>(cacheKey, "global", { allowStale: true, expiryMs: Infinity });
        if (staleCached) {
          console.warn("[cache] Using stale cache due to fetch error:", cacheKey);
          return staleCached.data;
        }
        throw e;
      } finally {
        pendingRequests.delete(pendingKey);
      }
    })();

    pendingRequests.set(pendingKey, fetchPromise);
    return fetchPromise;
  }

  return new Proxy(source, {
    get(target, prop: string) {
      const originalMethod = target[prop as keyof DataSource];
      
      if (typeof originalMethod !== "function") {
        return originalMethod;
      }

      const expiryMs = getCacheExpiry(prop);

      if (CACHEABLE_LIST_METHODS[prop]) {
        const cachePrefix = CACHEABLE_LIST_METHODS[prop];
        const methodName = prop;
        const listMethod = originalMethod as (
          schoolId?: string,
          options?: QueryOptions
        ) => Promise<unknown>;
        return async (schoolId: string = "default", options?: QueryOptions) => {
          // 將 QueryOptions 序列化納入快取 key，確保不同查詢條件不會共用快取
          const optionsKey = options ? serializeQueryOptions(options) : "";
          const cacheKey = optionsKey
            ? `${cachePrefix}_${schoolId}_${optionsKey}`
            : `${cachePrefix}_${schoolId}`;
          return fetchAndCacheListWithExpiry(
            cacheKey,
            schoolId,
            () => listMethod.call(target, schoolId, options),
            expiryMs,
            methodName
          );
        };
      }

      if (CACHEABLE_GET_METHODS[prop]) {
        const cachePrefix = CACHEABLE_GET_METHODS[prop];
        const getMethod = originalMethod as (id: string, ...args: unknown[]) => Promise<unknown>;
        return async (id: string, ...args: unknown[]) => {
          const cacheKey = `${cachePrefix}_${id}`;
          return fetchAndCacheSingleWithExpiry(
            cacheKey,
            () => getMethod.call(target, id, ...args),
            expiryMs
          );
        };
      }

      return originalMethod.bind(target);
    },
  }) as DataSource;
}

export async function clearAllCache(): Promise<void> {
  try {
    pendingRequests.clear();
    backgroundUpdateLocks.clear();
    cacheVersionMap.clear();

    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    if (cacheKeys.length > 0) {
      await AsyncStorage.multiRemove(cacheKeys);
    }
    console.log(`[cache] clearAllCache: removed ${cacheKeys.length} entries, cleared ${pendingRequests.size} pending requests`);
  } catch (e) {
    console.warn("[cache] Failed to clear cache:", e);
  }
}

/**
 * 登入完成後呼叫：強制清除所有快取和正在進行的請求，
 * 確保下次讀取會直接打到 adapter 而不是使用舊的快取/pending promise。
 */
export async function invalidateAllCacheForLogin(): Promise<void> {
  // 1. 取消所有 pending 請求（它們可能帶著舊的空結果）
  pendingRequests.clear();
  backgroundUpdateLocks.clear();
  cacheVersionMap.clear();

  // 2. 刪除所有 @campus_cache_ 前綴的快取
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    if (cacheKeys.length > 0) {
      await AsyncStorage.multiRemove(cacheKeys);
    }
    console.log(`[cache] invalidateAllCacheForLogin: cleared ${cacheKeys.length} cache entries`);
  } catch (e) {
    console.warn("[cache] invalidateAllCacheForLogin failed:", e);
  }
}

export async function getCacheSize(): Promise<{ count: number; approximateBytes: number }> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    
    if (cacheKeys.length === 0) {
      return { count: 0, approximateBytes: 0 };
    }
    
    const values = await AsyncStorage.multiGet(cacheKeys);
    let totalBytes = 0;

    for (const [, value] of values) {
      if (value) {
        totalBytes += value.length * 2;
      }
    }

    return { count: cacheKeys.length, approximateBytes: totalBytes };
  } catch (e) {
    console.warn("[cache] Failed to get cache size:", e);
    return { count: 0, approximateBytes: 0 };
  }
}

export async function getCacheInfo(): Promise<Array<{ 
  key: string; 
  schoolId: string; 
  timestamp: Date; 
  size: number;
  isStale: boolean;
  category?: DataCategory;
}>> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    
    if (cacheKeys.length === 0) {
      return [];
    }
    
    const values = await AsyncStorage.multiGet(cacheKeys);
    const info: Array<{ key: string; schoolId: string; timestamp: Date; size: number; isStale: boolean; category?: DataCategory }> = [];
    const now = Date.now();

    for (const [key, value] of values) {
      if (value) {
        try {
          const entry = JSON.parse(value) as CacheEntry<unknown>;
          
          // 使用與實際快取讀取相同的過期判斷邏輯
          let effectiveExpiry: number;
          if (entry.category) {
            effectiveExpiry = getEffectiveExpiry(entry.category);
          } else {
            effectiveExpiry = isOfflineMode 
              ? DEFAULT_CACHE_EXPIRY_MS * OFFLINE_EXPIRY_MULTIPLIER 
              : DEFAULT_CACHE_EXPIRY_MS;
          }
          
          info.push({
            key: key.replace(CACHE_PREFIX, ""),
            schoolId: entry.schoolId,
            timestamp: new Date(entry.timestamp),
            size: value.length * 2,
            isStale: now - entry.timestamp > effectiveExpiry,
            category: entry.category,
          });
        } catch (e) {
          console.warn("[cache] Failed to parse cache entry:", key, e);
        }
      }
    }

    return info.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  } catch (e) {
    console.warn("[cache] Failed to get cache info:", e);
    return [];
  }
}

export async function invalidateCache(pattern?: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => {
      if (!k.startsWith(CACHE_PREFIX)) return false;
      if (pattern) {
        return k.includes(pattern);
      }
      return true;
    });
    
    if (cacheKeys.length > 0) {
      await AsyncStorage.multiRemove(cacheKeys);
    }
  } catch (e) {
    console.warn("[cache] Failed to invalidate cache:", e);
  }
}

export async function clearCacheForSchool(schoolId: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    
    if (cacheKeys.length === 0) return;
    
    const values = await AsyncStorage.multiGet(cacheKeys);
    const keysToRemove: string[] = [];
    
    for (const [key, value] of values) {
      if (value) {
        try {
          const entry = JSON.parse(value) as CacheEntry<unknown>;
          if (entry.schoolId === schoolId) {
            keysToRemove.push(key);
          }
        } catch {
          keysToRemove.push(key);
        }
      }
    }
    
    if (keysToRemove.length > 0) {
      await AsyncStorage.multiRemove(keysToRemove);
      console.log(`[cache] Cleared ${keysToRemove.length} cache entries for school: ${schoolId}`);
    }
  } catch (e) {
    console.warn("[cache] Failed to clear cache for school:", schoolId, e);
  }
}

export async function clearCacheExceptSchool(schoolId: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    
    if (cacheKeys.length === 0) return;
    
    const values = await AsyncStorage.multiGet(cacheKeys);
    const keysToRemove: string[] = [];
    
    for (const [key, value] of values) {
      if (value) {
        try {
          const entry = JSON.parse(value) as CacheEntry<unknown>;
          if (entry.schoolId !== schoolId) {
            keysToRemove.push(key);
          }
        } catch {
          keysToRemove.push(key);
        }
      }
    }
    
    if (keysToRemove.length > 0) {
      await AsyncStorage.multiRemove(keysToRemove);
      console.log(`[cache] Cleared ${keysToRemove.length} cache entries for other schools (keeping: ${schoolId})`);
    }
  } catch (e) {
    console.warn("[cache] Failed to clear cache for other schools:", e);
  }
}
