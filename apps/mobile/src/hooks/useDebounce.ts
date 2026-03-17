import { useState, useEffect, useRef, useCallback } from "react";

/**
 * 防抖 hook - 在指定延遲後更新值
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * 帶有 pending 狀態的防抖 hook
 * 可以知道是否正在等待防抖完成
 */
export function useDebounceWithPending<T>(
  value: T, 
  delay: number = 300
): { debouncedValue: T; isPending: boolean } {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const [isPending, setIsPending] = useState(false);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // 首次渲染不設定 pending
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // 值改變時標記為 pending
    setIsPending(true);

    const timer = setTimeout(() => {
      setDebouncedValue(value);
      setIsPending(false);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return { debouncedValue, isPending };
}

/**
 * 搜尋專用的防抖 hook
 * 包含 pending 狀態和空值處理
 */
export function useSearchDebounce(
  value: string,
  delay: number = 300,
  minLength: number = 0
): { 
  debouncedValue: string; 
  isSearching: boolean;
  isEmpty: boolean;
  shouldSearch: boolean;
} {
  const [debouncedValue, setDebouncedValue] = useState<string>(value);
  const [isSearching, setIsSearching] = useState(false);
  const prevValueRef = useRef(value);

  useEffect(() => {
    const trimmedValue = value.trim();
    const prevTrimmed = prevValueRef.current.trim();
    
    // 如果值沒有實質改變，不需要防抖
    if (trimmedValue === debouncedValue.trim()) {
      setIsSearching(false);
      return;
    }

    // 如果輸入太短，立即清空
    if (trimmedValue.length < minLength) {
      setDebouncedValue(trimmedValue);
      setIsSearching(false);
      return;
    }

    // 開始防抖
    setIsSearching(true);

    const timer = setTimeout(() => {
      setDebouncedValue(trimmedValue);
      setIsSearching(false);
    }, delay);

    prevValueRef.current = value;

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay, minLength, debouncedValue]);

  const isEmpty = debouncedValue.trim().length === 0;
  const shouldSearch = debouncedValue.trim().length >= minLength;

  return { debouncedValue, isSearching, isEmpty, shouldSearch };
}

/**
 * 防抖 callback hook - 確保函數在指定時間內只執行一次
 */
export function useDebouncedCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number = 300
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  
  callbackRef.current = callback;

  const debouncedCallback = useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args);
        timeoutRef.current = null;
      }, delay);
    },
    [delay]
  ) as T;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
}

/**
 * 即時防抖 hook - 立即執行後在延遲內忽略後續調用
 */
export function useLeadingDebounce<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number = 300
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  const canCallRef = useRef(true);
  
  callbackRef.current = callback;

  const debouncedCallback = useCallback(
    (...args: Parameters<T>) => {
      if (canCallRef.current) {
        callbackRef.current(...args);
        canCallRef.current = false;
        
        timeoutRef.current = setTimeout(() => {
          canCallRef.current = true;
          timeoutRef.current = null;
        }, delay);
      }
    },
    [delay]
  ) as T;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
}
