'use client';

import { useState, useEffect } from 'react';

export function UpdateBanner() {
  const [showUpdate, setShowUpdate] = useState(false);

  useEffect(() => {
    // Listen for service worker update
    const handleUpdate = () => {
      setShowUpdate(true);
    };

    window.addEventListener('swUpdate', handleUpdate);

    return () => {
      window.removeEventListener('swUpdate', handleUpdate);
    };
  }, []);

  const handleRefresh = () => {
    // Skip waiting and reload
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((registration) => {
        if (registration?.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    }

    window.location.reload();
  };

  if (!showUpdate) return null;

  return (
    <div className="updateBanner">
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 2, color: 'var(--text)' }}>有新版本可用</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          儲存正在編輯的內容後，再重新載入。
        </div>
      </div>

      <button
        onClick={handleRefresh}
        style={{
          background: 'var(--brand)',
          color: 'var(--on-brand)',
          border: 'none',
          padding: '10px 16px',
          borderRadius: 'var(--radius-sm)',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        重新載入
      </button>
    </div>
  );
}

export default UpdateBanner;
