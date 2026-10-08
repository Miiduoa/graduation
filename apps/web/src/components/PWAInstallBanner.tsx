'use client';

import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(display-mode: standalone)').matches;
  });
  const [isVisible, setIsVisible] = useState(() => {
    if (typeof window === 'undefined') return false;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone) return false;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (!isIOS) return false;
    return !localStorage.getItem('pwa-install-dismissed');
  });
  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

  useEffect(() => {
    if (isInstalled || isIOS) {
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);

      // Check if previously dismissed
      const dismissed = localStorage.getItem('pwa-install-dismissed');
      if (!dismissed) {
        setIsVisible(true);
      }
    };

    const appInstalledHandler = () => {
      setIsInstalled(true);
      setIsVisible(false);
    };

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', appInstalledHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', appInstalledHandler);
    };
  }, [isInstalled, isIOS]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      setIsVisible(false);
    }

    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setIsVisible(false);
    localStorage.setItem('pwa-install-dismissed', 'true');
  };

  if (!isVisible || isInstalled) return null;

  return (
    <div className="pwaInstallBanner">
      <div className="pwaInstallContent">
        <div style={{ flex: '1 1 200px' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>把 Campus One 加入主畫面</div>
          <div style={{ fontSize: 13, opacity: 0.9 }}>
            {isIOS ? (
              <>
                點擊 <span style={{ fontWeight: 600 }}>分享</span> 按鈕，然後選擇{' '}
                <span style={{ fontWeight: 600 }}>加入主畫面</span>
              </>
            ) : (
              '下次從主畫面直接開啟。課程與個人資料仍需網路連線。'
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {!isIOS && (
            <button
              onClick={handleInstall}
              style={{
                background: 'var(--brand)',
                color: 'var(--on-brand)',
                border: '1px solid transparent',
                padding: '10px 20px',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              安裝
            </button>
          )}
          <button
            onClick={handleDismiss}
            aria-label="關閉加入主畫面提示"
            style={{
              background: 'var(--surface)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              padding: '10px 16px',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

export default PWAInstallBanner;
