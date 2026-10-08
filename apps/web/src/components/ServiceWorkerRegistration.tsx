'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.error('無法啟用離線頁面。', error);
    });
  }, []);
  return null;
}
