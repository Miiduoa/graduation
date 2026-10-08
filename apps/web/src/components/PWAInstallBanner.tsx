'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from './ui/Button';
import styles from './SystemNotice.module.css';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'pwa-install-dismissed';

function wasDismissed() {
  try {
    return Boolean(localStorage.getItem(DISMISSED_KEY));
  } catch {
    return false;
  }
}

export function PWAInstallBanner() {
  // Browser-only preferences are read after hydration, including on iOS.
  const [isIOS, setIsIOS] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [canPrompt, setCanPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const prompt = useRef<BeforeInstallPromptEvent | null>(null);
  const mounted = useRef(false);
  const requesting = useRef(false);
  const dismissed = useRef(false);

  useEffect(() => {
    mounted.current = true;
    dismissed.current = wasDismissed();
    const standalone = () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setIsIOS(ios);
    setIsVisible(ios && !standalone() && !dismissed.current);

    const handlePrompt = (event: Event) => {
      event.preventDefault();
      prompt.current = event as BeforeInstallPromptEvent;
      setCanPrompt(true);
      setError('');
      if (!standalone() && !dismissed.current) setIsVisible(true);
    };
    const handleInstalled = () => {
      prompt.current = null;
      setCanPrompt(false);
      setIsVisible(false);
    };
    const handleDismissed = (event: StorageEvent) => {
      if (event.key === DISMISSED_KEY && event.newValue) {
        dismissed.current = true;
        setIsVisible(false);
      }
    };
    window.addEventListener('beforeinstallprompt', handlePrompt);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('storage', handleDismissed);
    return () => {
      mounted.current = false;
      window.removeEventListener('beforeinstallprompt', handlePrompt);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('storage', handleDismissed);
    };
  }, []);

  async function handleInstall() {
    const event = prompt.current;
    if (!event || requesting.current) return;
    requesting.current = true;
    prompt.current = null;
    setBusy(true);
    setError('');
    try {
      await event.prompt();
      await event.userChoice;
      if (mounted.current) setIsVisible(false);
    } catch {
      if (mounted.current) setError('無法開啟安裝視窗。你可以稍後從瀏覽器選單加入主畫面。');
    } finally {
      requesting.current = false;
      if (mounted.current) {
        setBusy(false);
        setCanPrompt(Boolean(prompt.current));
      }
    }
  }

  function handleDismiss() {
    dismissed.current = true;
    setIsVisible(false);
    try {
      localStorage.setItem(DISMISSED_KEY, 'true');
    } catch {
      // Dismissal still works for this page when browser storage is unavailable.
    }
  }

  if (!isVisible) return null;

  return (
    <section className={styles.notice} aria-label="加入主畫面">
      <div className={styles.content}>
        <h2 className={styles.title}>把 Campus One 加入主畫面</h2>
        <p className={styles.description}>
          {isIOS
            ? '在瀏覽器選單選擇「分享」，再選「加入主畫面」。'
            : '下次從主畫面直接開啟。課程與個人資料仍需網路連線。'}
        </p>
      </div>
      <div className={styles.actions}>
        {canPrompt && (
          <Button
            type="button"
            variant="primary"
            loading={busy}
            onClick={() => void handleInstall()}
          >
            {busy ? '開啟安裝視窗…' : '加入主畫面'}
          </Button>
        )}
        <Button type="button" disabled={busy} onClick={handleDismiss}>
          暫時不用
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

export default PWAInstallBanner;
