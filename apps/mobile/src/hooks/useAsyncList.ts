import React from "react";

export type UseAsyncListOptions = {
  keepPreviousData?: boolean;
  retryCount?: number;
  retryDelay?: number;
  onRefreshError?: (error: string) => void;
  onLoadError?: (error: string) => void;
};

export type UseAsyncListResult<T> = {
  items: T[];
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastRefreshError: string | null;
  reload: () => void;
  refresh: () => Promise<void>;
};

const DEFAULT_OPTIONS: UseAsyncListOptions = {
  keepPreviousData: false,
  retryCount: 0,
  retryDelay: 1000,
};

async function fetchWithRetry<T>(
  load: () => Promise<T>,
  retryCount: number,
  retryDelay: number,
  signal?: AbortSignal
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    if (signal?.aborted) {
      throw new Error("Aborted");
    }
    
    try {
      return await load();
    } catch (e) {
      lastError = e;
      
      if (attempt < retryCount) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
      }
    }
  }
  
  throw lastError;
}

export function useAsyncList<T>(
  load: () => Promise<T[]>, 
  deps: React.DependencyList,
  options: UseAsyncListOptions = {}
): UseAsyncListResult<T> {
  const { keepPreviousData, retryCount, retryDelay, onRefreshError, onLoadError } = { ...DEFAULT_OPTIONS, ...options };
  
  const [items, setItems] = React.useState<T[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastRefreshError, setLastRefreshError] = React.useState<string | null>(null);

  const [reloadTick, setReloadTick] = React.useState(0);
  
  const loadRef = React.useRef(load);
  loadRef.current = load;
  
  const onRefreshErrorRef = React.useRef(onRefreshError);
  onRefreshErrorRef.current = onRefreshError;
  
  const onLoadErrorRef = React.useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;
  
  const abortControllerRef = React.useRef<AbortController | null>(null);

  const reload = React.useCallback(() => {
    setReloadTick((x) => x + 1);
  }, []);

  const refreshAbortRef = React.useRef<AbortController | null>(null);

  const refresh = React.useCallback(async () => {
    // 同時取消主要載入和刷新請求，避免 race condition
    abortControllerRef.current?.abort();
    refreshAbortRef.current?.abort();
    
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    
    setRefreshing(true);
    setLastRefreshError(null);
    
    try {
      const rows = await loadRef.current();
      if (!controller.signal.aborted) {
        setItems(rows);
        setError(null);
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof Error && e.message === "Aborted") return;
      const errorMsg = e instanceof Error ? e.message : String(e);
      setLastRefreshError(errorMsg);
      onRefreshErrorRef.current?.(errorMsg);
    } finally {
      if (!controller.signal.aborted) {
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, []);

  React.useEffect(() => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    let cancelled = false;
    
    setLoading(true);
    setError(null);
    
    if (!keepPreviousData) {
      setItems([]);
    }

    fetchWithRetry(
      () => loadRef.current(),
      retryCount ?? 0,
      retryDelay ?? 1000,
      controller.signal
    )
      .then((rows) => {
        if (!cancelled && !controller.signal.aborted) {
          setItems(rows);
        }
      })
      .catch((e) => {
        if (cancelled || controller.signal.aborted) return;
        if (e instanceof Error && e.message === "Aborted") return;
        
        if (!keepPreviousData) {
          setItems([]);
        }
        const errorMsg = e instanceof Error ? e.message : String(e);
        setError(errorMsg);
        onLoadErrorRef.current?.(errorMsg);
      })
      .finally(() => {
        if (!cancelled && !controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
      refreshAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadTick]);

  return { items, setItems, loading, refreshing, error, lastRefreshError, reload, refresh };
}
