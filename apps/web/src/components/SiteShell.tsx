'use client';

import { Suspense } from 'react';
import { AppHeader } from './AppHeader';
import { OfflineBanner } from './OfflineBanner';
import { PWAInstallBanner } from './PWAInstallBanner';
import { UpdateBanner } from './UpdateBanner';
import { SiteFooter } from './SiteFooter';
import styles from '@/app/home.module.css';
import notices from './SystemNotice.module.css';

export function SiteShell(props: {
  header?: React.ReactNode;
  title?: string;
  subtitle?: string;
  schoolName?: string;
  schoolCode?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#page-content">
        跳到主要內容
      </a>
      <OfflineBanner />
      {props.header ?? <AppHeader />}
      <div className={notices.notices}>
        <UpdateBanner />
        <PWAInstallBanner />
      </div>
      <main id="page-content" className={styles.main} tabIndex={-1}>
        {props.title && (
          <div className={styles.heading}>
            <div>
              {props.schoolName && <p className={styles.eyebrow}>{props.schoolName}</p>}
              <h1>{props.title}</h1>
              {props.subtitle && <p className={styles.intro}>{props.subtitle}</p>}
            </div>
          </div>
        )}
        <Suspense fallback={<p role="status">載入中…</p>}>{props.children}</Suspense>
        <SiteFooter />
      </main>
    </div>
  );
}
