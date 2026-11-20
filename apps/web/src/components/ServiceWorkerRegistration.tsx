'use client';

import { useEffect } from 'react';
import { observeServiceWorkerUpdates } from '@/lib/serviceWorkerUpdates';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    let disposed = false;
    let stopObserving: (() => void) | undefined;
    void navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        if (disposed) return;
        stopObserving = observeServiceWorkerUpdates(registration, (ready) => {
          window.dispatchEvent(new CustomEvent('swUpdate', { detail: ready }));
        });
      })
      .catch((error: unknown) => {
        console.error('無法啟用離線頁面。', error);
      });
    return () => {
      disposed = true;
      stopObserving?.();
    };
  }, []);
  return null;
}
