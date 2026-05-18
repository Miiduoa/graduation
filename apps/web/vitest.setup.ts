import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

// jsdom 29 在 vitest 環境下未自帶 localStorage 完整實作（缺 removeItem）；
// 提供 in-memory polyfill，讓 demoStore / 任何用 localStorage 的 production
// 程式碼可以在測試直接呼叫。
if (typeof window !== 'undefined' && typeof window.localStorage?.removeItem !== 'function') {
  const memoryStore: Record<string, string> = {};
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem(key: string) {
        return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
      },
      setItem(key: string, value: string) {
        memoryStore[key] = String(value);
      },
      removeItem(key: string) {
        delete memoryStore[key];
      },
      clear() {
        for (const k of Object.keys(memoryStore)) delete memoryStore[k];
      },
      key(index: number) {
        return Object.keys(memoryStore)[index] ?? null;
      },
      get length() {
        return Object.keys(memoryStore).length;
      },
    },
  });
}

beforeEach(() => {
  // 每個測試的 localStorage 從乾淨狀態開始
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.clear();
    } catch { /* ignore */ }
  }
});

afterEach(() => {
  cleanup();
});
