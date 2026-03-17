import { useEffect, useState, useCallback, useRef } from "react";
import { subscribeToCacheUpdates } from "../data/cachedSource";

type CacheSubscriptionOptions<T> = {
  cacheKey: string;
  initialData?: T;
  enabled?: boolean;
  transform?: (data: unknown) => T;
};

type CacheSubscriptionResult<T> = {
  data: T | undefined;
  lastUpdate: Date | null;
  updateCount: number;
  isStale: boolean;
  markAsStale: () => void;
};

export function useCacheSubscription<T>({
  cacheKey,
  initialData,
  enabled = true,
  transform,
}: CacheSubscriptionOptions<T>): CacheSubscriptionResult<T> {
  const [data, setData] = useState<T | undefined>(initialData);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [updateCount, setUpdateCount] = useState(0);
  const [isStale, setIsStale] = useState(false);
  
  const transformRef = useRef(transform);
  transformRef.current = transform;

  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = subscribeToCacheUpdates((key, newData) => {
      if (key === cacheKey || key.startsWith(`${cacheKey}_`)) {
        const transformedData = transformRef.current 
          ? transformRef.current(newData) 
          : (newData as T);
        
        setData(transformedData);
        setLastUpdate(new Date());
        setUpdateCount((c) => c + 1);
        setIsStale(false);
      }
    });

    return unsubscribe;
  }, [cacheKey, enabled]);

  const markAsStale = useCallback(() => {
    setIsStale(true);
  }, []);

  return {
    data,
    lastUpdate,
    updateCount,
    isStale,
    markAsStale,
  };
}

type MultiCacheSubscriptionOptions = {
  cacheKeys: string[];
  enabled?: boolean;
};

type MultiCacheSubscriptionResult = {
  updates: Map<string, { data: unknown; timestamp: Date }>;
  lastUpdate: Date | null;
  totalUpdateCount: number;
};

export function useMultiCacheSubscription({
  cacheKeys,
  enabled = true,
}: MultiCacheSubscriptionOptions): MultiCacheSubscriptionResult {
  const [updates, setUpdates] = useState<Map<string, { data: unknown; timestamp: Date }>>(new Map());
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [totalUpdateCount, setTotalUpdateCount] = useState(0);

  // 使用穩定的字串來避免陣列順序變化導致的重新訂閱
  const cacheKeysString = [...cacheKeys].sort().join(",");

  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = subscribeToCacheUpdates((key, data) => {
      const keyList = cacheKeysString.split(",");
      const matchingKey = keyList.find(
        (ck) => key === ck || key.startsWith(`${ck}_`)
      );
      
      if (matchingKey) {
        const now = new Date();
        setUpdates((prev) => {
          const next = new Map(prev);
          next.set(key, { data, timestamp: now });
          return next;
        });
        setLastUpdate(now);
        setTotalUpdateCount((c) => c + 1);
      }
    });

    return unsubscribe;
  }, [cacheKeysString, enabled]);

  return {
    updates,
    lastUpdate,
    totalUpdateCount,
  };
}

type UseCachedDataOptions<T> = {
  fetchFn: () => Promise<T>;
  cacheKey: string;
  dependencies?: unknown[];
  staleTime?: number;
  enabled?: boolean;
};

type UseCachedDataResult<T> = {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  isStale: boolean;
  isFetching: boolean;
  refetch: () => Promise<void>;
  lastFetchTime: Date | null;
};

export function useCachedData<T>({
  fetchFn,
  cacheKey,
  dependencies = [],
  staleTime = 5 * 60 * 1000,
  enabled = true,
}: UseCachedDataOptions<T>): UseCachedDataResult<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null);
  
  // 使用 ref 儲存最新的 fetchFn 來避免閉包陳舊問題
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;
  
  // 追蹤請求序號避免 race condition
  const requestIdRef = useRef(0);
  
  const isStale = lastFetchTime 
    ? Date.now() - lastFetchTime.getTime() > staleTime 
    : true;

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    
    const currentRequestId = ++requestIdRef.current;
    
    setIsFetching(true);
    setError(null);
    
    try {
      const result = await fetchFnRef.current();
      // 只處理最新的請求結果
      if (currentRequestId === requestIdRef.current) {
        setData(result);
        setLastFetchTime(new Date());
      }
    } catch (e) {
      if (currentRequestId === requestIdRef.current) {
        setError(e instanceof Error ? e.message : "載入失敗");
      }
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setLoading(false);
        setIsFetching(false);
      }
    }
  }, [enabled]);

  // 初始載入
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, enabled]);

  // 監聽快取更新
  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = subscribeToCacheUpdates((key, newData) => {
      if (key === cacheKey || key.startsWith(`${cacheKey}_`)) {
        setData(newData as T);
        setLastFetchTime(new Date());
      }
    });

    return unsubscribe;
  }, [cacheKey, enabled]);

  const refetch = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  return {
    data,
    loading,
    error,
    isStale,
    isFetching,
    refetch,
    lastFetchTime,
  };
}
