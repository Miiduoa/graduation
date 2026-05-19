/**
 * apps/mobile/src/state/demoStore.tsx —
 * React hook + provider 把 services/demoStore.ts 包成 React 使用者介面。
 *
 * 使用方式：
 *   <DemoStoreProvider>{children}</DemoStoreProvider>
 *   ... const store = useDemoStore();
 *
 * Provider 啟動時會做一次 hydrate（從 AsyncStorage 讀回 snapshot）；
 * 之後任何 producer 函式（requestLeave 等）寫入後會經 subscriber
 * 觸發整個 tree re-render。
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  hydrateDemoStore,
  getDemoStore,
  subscribeDemoStore,
  type DemoStore,
} from '../services/demoStore';

const DemoStoreContext = createContext<DemoStore | null>(null);

export function DemoStoreProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<DemoStore>(() => getDemoStore());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    void hydrateDemoStore().then(() => {
      if (!mounted) return;
      setSnapshot(getDemoStore());
      setReady(true);
    });
    const unsubscribe = subscribeDemoStore(() => {
      if (mounted) setSnapshot(getDemoStore());
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return (
    <DemoStoreContext.Provider value={ready ? snapshot : snapshot}>
      {children}
    </DemoStoreContext.Provider>
  );
}

/** 取得最新 demoStore snapshot；任何 producer 寫入會觸發 re-render */
export function useDemoStore(): DemoStore {
  const ctx = useContext(DemoStoreContext);
  if (!ctx) {
    // 不在 Provider 內：fallback 直接讀記憶體 cache。
    // demo 期間有時 Provider 在更上層 mount 前就被 child 拉用，避免炸掉。
    return getDemoStore();
  }
  return ctx;
}
