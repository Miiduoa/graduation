import { useState, useEffect, useRef, useCallback } from "react";
import { useLatestValue } from "./useLatestValue";

/**
 * 節流 hook - 限制值更新頻率
 */
export function useThrottle<T>(value: T, interval: number = 300): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);
  const lastExecuted = useRef<number>(Date.now());

  useEffect(() => {
    const now = Date.now();
    const timeSinceLastExecution = now - lastExecuted.current;

    if (timeSinceLastExecution >= interval) {
      lastExecuted.current = now;
      setThrottledValue(value);
    } else {
      const timer = setTimeout(() => {
        lastExecuted.current = Date.now();
        setThrottledValue(value);
      }, interval - timeSinceLastExecution);

      return () => clearTimeout(timer);
    }
  }, [value, interval]);

  return throttledValue;
}

/**
 * 節流 callback hook - 限制函數調用頻率
 */
export function useThrottledCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  interval: number = 300
): T {
  const lastExecuted = useRef<number>(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useLatestValue(callback);
  const pendingArgsRef = useRef<Parameters<T> | null>(null);

  const throttledCallback = useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      const timeSinceLastExecution = now - lastExecuted.current;

      if (timeSinceLastExecution >= interval) {
        lastExecuted.current = now;
        callbackRef.current(...args);
      } else {
        pendingArgsRef.current = args;

        if (!timeoutRef.current) {
          timeoutRef.current = setTimeout(() => {
            lastExecuted.current = Date.now();
            if (pendingArgsRef.current) {
              callbackRef.current(...pendingArgsRef.current);
              pendingArgsRef.current = null;
            }
            timeoutRef.current = null;
          }, interval - timeSinceLastExecution);
        }
      }
    },
    [interval]
  ) as T;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return throttledCallback;
}

/**
 * 限制連續點擊的 hook
 */
export function usePreventDoubleClick<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number = 1000
): { execute: T; isBlocked: boolean } {
  const [isBlocked, setIsBlocked] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useLatestValue(callback);

  const execute = useCallback(
    (...args: Parameters<T>) => {
      if (isBlocked) return;

      setIsBlocked(true);
      callbackRef.current(...args);

      timeoutRef.current = setTimeout(() => {
        setIsBlocked(false);
        timeoutRef.current = null;
      }, delay);
    },
    [isBlocked, delay]
  ) as T;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { execute, isBlocked };
}
