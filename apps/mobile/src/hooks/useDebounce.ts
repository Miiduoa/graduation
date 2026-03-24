/* eslint-disable */
import { useState, useEffect, useRef, useCallback } from "react";
import { useLatestValue } from "./useLatestValue";

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
  const debouncedValue = useDebounce(value, delay);
  const isPending = !Object.is(debouncedValue, value);

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
  const trimmedValue = value.trim();
  const delayedValue = useDebounce(trimmedValue, delay);
  const debouncedValue = trimmedValue.length < minLength ? trimmedValue : delayedValue;
  const isSearching = trimmedValue.length >= minLength && debouncedValue !== trimmedValue;
  const isEmpty = debouncedValue.length === 0;
  const shouldSearch = debouncedValue.length >= minLength;

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
  const callbackRef = useLatestValue(callback);

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
  const callbackRef = useLatestValue(callback);
  const canCallRef = useRef(true);

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
