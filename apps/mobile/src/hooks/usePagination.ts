import { useState, useCallback, useRef, useEffect } from "react";
import { useLatestValue } from "./useLatestValue";

export type PaginationOptions = {
  initialPage?: number;
  pageSize?: number;
  totalItems?: number;
};

export type PaginationResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  goToPage: (page: number) => void;
  nextPage: () => void;
  previousPage: () => void;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  setPageSize: (size: number) => void;
};

/**
 * 分頁 hook - 支援傳統分頁和無限滾動
 */
export function usePagination<T>(
  fetchFn: (page: number, pageSize: number) => Promise<{ data: T[]; total: number }>,
  options: PaginationOptions = {}
): PaginationResult<T> {
  const { initialPage = 1, pageSize: initialPageSize = 20, totalItems: initialTotal } = options;

  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [totalItems, setTotalItems] = useState(initialTotal ?? 0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFnRef = useLatestValue(fetchFn);
  
  // 追蹤當前請求以便取消
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const hasNextPage = page < totalPages;
  const hasPreviousPage = page > 1;

  const fetchPage = useCallback(
    async (pageNum: number, append = false) => {
      // 取消之前的請求
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      
      const currentRequestId = ++requestIdRef.current;
      
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const result = await fetchFnRef.current(pageNum, pageSize);
        
        // 檢查這個請求是否仍然是最新的
        if (currentRequestId !== requestIdRef.current) {
          return;
        }
        
        if (append) {
          setItems((prev) => [...prev, ...result.data]);
        } else {
          setItems(result.data);
        }
        
        setTotalItems(result.total);
        setPage(pageNum);
      } catch (e) {
        // 忽略已取消的請求錯誤
        if (e instanceof Error && e.name === "AbortError") {
          return;
        }
        // 確保這是最新的請求
        if (currentRequestId === requestIdRef.current) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [pageSize]
  );
  
  // 清理函數
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    fetchPage(initialPage);
  }, [fetchPage, initialPage]);

  const goToPage = useCallback(
    (pageNum: number) => {
      if (pageNum >= 1 && pageNum <= totalPages && pageNum !== page) {
        fetchPage(pageNum);
      }
    },
    [fetchPage, page, totalPages]
  );

  const nextPage = useCallback(() => {
    if (hasNextPage) {
      goToPage(page + 1);
    }
  }, [goToPage, hasNextPage, page]);

  const previousPage = useCallback(() => {
    if (hasPreviousPage) {
      goToPage(page - 1);
    }
  }, [goToPage, hasPreviousPage, page]);

  const refresh = useCallback(async () => {
    setItems([]);
    await fetchPage(1);
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (hasNextPage && !loadingMore) {
      await fetchPage(page + 1, true);
    }
  }, [fetchPage, hasNextPage, loadingMore, page]);

  // 使用 ref 追蹤待處理的 pageSize 變更，避免競態條件
  const pendingPageSizeRef = useRef<number | null>(null);
  
  const setPageSize = useCallback(
    (size: number) => {
      if (size !== pageSize && size !== pendingPageSizeRef.current) {
        pendingPageSizeRef.current = size;
        setPageSizeState(size);
        setPage(1);
        setItems([]);
        // 不在這裡直接調用 fetchPage，而是透過 useEffect 監聽 pageSize 變化
      }
    },
    [pageSize]
  );
  
  // 監聽 pageSize 變化來觸發重新載入
  useEffect(() => {
    if (pendingPageSizeRef.current !== null) {
      pendingPageSizeRef.current = null;
      fetchPage(1);
    }
  }, [pageSize, fetchPage]);

  return {
    items,
    page,
    pageSize,
    totalPages,
    totalItems,
    hasNextPage,
    hasPreviousPage,
    loading,
    loadingMore,
    error,
    goToPage,
    nextPage,
    previousPage,
    refresh,
    loadMore,
    setPageSize,
  };
}

/**
 * 無限滾動 hook - 專為 FlatList 優化
 */
export function useInfiniteScroll<T>(
  fetchFn: (cursor?: string) => Promise<{ data: T[]; nextCursor?: string; hasMore: boolean }>,
  deps: React.DependencyList = []
): {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  onEndReached: () => void;
} {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);

  const fetchFnRef = useLatestValue(fetchFn);

  const isLoadingRef = useRef(false);
  const requestIdRef = useRef(0);
  const isMountedRef = useRef(true);

  const cursorRef = useRef<string | undefined>(cursor);
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);
  
  // 追蹤是否已卸載
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    
    const currentRequestId = ++requestIdRef.current;

    if (isRefresh) {
      setLoading(true);
      setCursor(undefined);
      cursorRef.current = undefined;
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      const currentCursor = isRefresh ? undefined : cursorRef.current;
      const result = await fetchFnRef.current(currentCursor);
      
      // 檢查是否是最新請求且元件仍掛載
      if (currentRequestId !== requestIdRef.current || !isMountedRef.current) {
        return;
      }
      
      if (isRefresh) {
        setItems(result.data);
      } else {
        setItems((prev) => [...prev, ...result.data]);
      }
      
      setCursor(result.nextCursor);
      cursorRef.current = result.nextCursor;
      setHasMore(result.hasMore);
    } catch (e) {
      // 只有在最新請求且元件仍掛載時才設置錯誤
      if (currentRequestId === requestIdRef.current && isMountedRef.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (currentRequestId === requestIdRef.current && isMountedRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
      isLoadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchData(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const refresh = useCallback(async () => {
    setItems([]);
    await fetchData(true);
  }, [fetchData]);

  const loadMore = useCallback(async () => {
    if (hasMore && !loadingMore && !loading) {
      await fetchData(false);
    }
  }, [fetchData, hasMore, loading, loadingMore]);

  const onEndReached = useCallback(() => {
    if (hasMore && !loadingMore && !loading) {
      fetchData(false);
    }
  }, [fetchData, hasMore, loading, loadingMore]);

  return {
    items,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
    onEndReached,
  };
}
