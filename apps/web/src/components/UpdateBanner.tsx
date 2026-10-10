'use client';

import { useState, useEffect, useRef } from 'react';
import { activateServiceWorkerUpdate } from '@/lib/serviceWorkerUpdates';
import { Button } from './ui/Button';
import styles from './SystemNotice.module.css';

export function UpdateBanner() {
  const [showUpdate, setShowUpdate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const mounted = useRef(false);
  const updating = useRef(false);

  useEffect(() => {
    mounted.current = true;
    if (!('serviceWorker' in navigator)) return;
    const check = async () => {
      try {
        const current = await navigator.serviceWorker.getRegistration();
        if (mounted.current && current?.waiting) {
          registration.current = current;
          setShowUpdate(true);
        }
      } catch {
        // An unavailable worker must not prevent the current page from working.
      }
    };
    window.addEventListener('swUpdate', check);
    void check();
    return () => {
      mounted.current = false;
      window.removeEventListener('swUpdate', check);
    };
  }, []);

  async function handleRefresh() {
    if (!registration.current || updating.current) return;
    updating.current = true;
    setBusy(true);
    setError('');
    try {
      await activateServiceWorkerUpdate(registration.current);
      if (mounted.current) window.location.reload();
    } catch {
      if (mounted.current) setError('更新尚未完成，頁面已保留。請確認網路後再試。');
    } finally {
      updating.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (!showUpdate) return null;

  return (
    <section className={styles.notice} aria-label="版本更新">
      <div className={styles.content}>
        <h2 className={styles.title}>有新版本可用</h2>
        <p className={styles.description}>儲存正在編輯的內容後，再重新載入。</p>
      </div>
      <div className={styles.actions}>
        <Button type="button" variant="primary" loading={busy} onClick={() => void handleRefresh()}>
          {busy ? '正在更新…' : '更新並重新載入'}
        </Button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export default UpdateBanner;
