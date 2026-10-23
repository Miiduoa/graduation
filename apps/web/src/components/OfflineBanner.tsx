'use client';

import { useState, useEffect } from 'react';
import styles from './SystemNotice.module.css';

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    setIsOffline(!navigator.onLine);
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className={styles.offline} role="status">
      <span>目前沒有網路連線，恢復連線後再試。</span>
    </div>
  );
}

export default OfflineBanner;
