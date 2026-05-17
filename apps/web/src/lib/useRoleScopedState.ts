'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDemoRole, type DemoRole } from './demoRole';

/**
 * 跟著當前 demoRole 走的 state（持久化在 localStorage）。
 *
 * 用途：避免「以學生身份收藏的公告，切換到教師仍顯示已收藏」這類狀態洩漏。
 * key 會被序列化成 `demo:{key}:{role}`，每個角色獨立。
 *
 * 範例：
 *   const [saved, setSaved] = useRoleScopedState<string[]>('saved-announcements', []);
 */
export function useRoleScopedState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [role] = useDemoRole();
  const storageKey = `demo:${key}:${role}`;

  // 用 lazy init 同步讀，避免閃成 initial
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw == null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  // 當角色變動時，從新的 storageKey 重新讀
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw == null) {
        setValue(initial);
      } else {
        setValue(JSON.parse(raw) as T);
      }
    } catch {
      setValue(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const computed = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(computed));
        } catch {
          // ignore quota errors etc.
        }
        return computed;
      });
    },
    [storageKey],
  );

  return [value, update];
}

/**
 * 一次性清掉所有 demo 相關的 state（reset demo 用）。
 */
export function clearAllDemoState(): void {
  if (typeof window === 'undefined') return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k) continue;
    if (k.startsWith('demo:') || k === 'demoRole') {
      keysToRemove.push(k);
    }
  }
  keysToRemove.forEach((k) => window.localStorage.removeItem(k));
}

/** 取得目前 role 對應的 storage key（供 debug 使用）*/
export function getRoleScopedKey(key: string, role: DemoRole): string {
  return `demo:${key}:${role}`;
}
