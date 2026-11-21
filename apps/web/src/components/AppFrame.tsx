'use client';

import type { ReactNode } from 'react';
import { AppHeader } from './AppHeader';
import { OfflineBanner } from './OfflineBanner';
import { PWAInstallBanner } from './PWAInstallBanner';
import { UpdateBanner } from './UpdateBanner';
import styles from '@/app/home.module.css';
import notices from './SystemNotice.module.css';

/** Shared application structure, including the home screen's custom header. */
export function AppFrame({
  children,
  header,
  contentId = 'page-content',
  pageClassName,
  mainClassName,
}: {
  children: ReactNode;
  header?: ReactNode;
  contentId?: string;
  pageClassName?: string;
  mainClassName?: string;
}) {
  return (
    <div className={[styles.page, pageClassName].filter(Boolean).join(' ')}>
      <a className={styles.skip} href={`#${contentId}`}>
        跳到主要內容
      </a>
      <OfflineBanner />
      {header ?? <AppHeader />}
      <div className={notices.notices}>
        <UpdateBanner />
        <PWAInstallBanner />
      </div>
      <main id={contentId} className={mainClassName ?? styles.main} tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
