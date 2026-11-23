'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import {
  dismissInstallSuggestion,
  requestPwaInstallation,
  usePwaInstallation,
} from '@/lib/pwaInstallation';
import { Button } from './ui/Button';
import styles from './SystemNotice.module.css';

export function PWAInstallBanner() {
  return (
    <Suspense fallback={null}>
      <InstallSuggestion />
    </Suspense>
  );
}

function InstallSuggestion() {
  const pathname = usePathname();
  const campusSearch = useCampusNavigationSearch(useSearchParams());
  const installation = usePwaInstallation();
  // Keep the event available to Settings without interrupting a task, sign-in,
  // map or bus journey. Route changes apply immediately to this suggestion.
  if (
    pathname !== '/life' ||
    !installation.ready ||
    installation.installed ||
    installation.dismissed ||
    (!installation.isIOS &&
      !installation.canPrompt &&
      !installation.busy &&
      installation.result !== 'failed')
  )
    return null;

  return (
    <section className={styles.notice} aria-label="加入主畫面">
      <div className={styles.content}>
        <h2 className={styles.title}>下次，從主畫面打開 nuni</h2>
        <p className={styles.description}>課表、作業與校園服務，少找一次網址。</p>
      </div>
      <div className={styles.actions}>
        {installation.canPrompt || installation.busy ? (
          <Button
            type="button"
            variant="primary"
            loading={installation.busy}
            onClick={() => void requestPwaInstallation()}
          >
            加入主畫面
          </Button>
        ) : (
          <Link href={campusServiceHref('/settings?section=general', campusSearch)} className="btn">
            查看加入方式
          </Link>
        )}
        <Button type="button" disabled={installation.busy} onClick={dismissInstallSuggestion}>
          暫時不用
        </Button>
      </div>
      {installation.result === 'failed' && (
        <p className={styles.error} role="alert">
          無法開啟安裝視窗。你可以到設定查看手動加入方式。
        </p>
      )}
    </section>
  );
}

export default PWAInstallBanner;
