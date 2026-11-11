'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/AuthGuard';
import { useOptionalNuniSession } from '@/features/nuni/Session';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import { schoolLoginHref } from '@/lib/navigation';
import styles from '../community.module.css';

export function CommunityAccess({ children }: { children: ReactNode }) {
  const { user, loading, error } = useAuth();
  const platform = useOptionalNuniSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const campusSearch = useCampusNavigationSearch(searchParams);
  const publicHref = campusServiceHref('/social', campusSearch);
  const platformReady = Boolean(
    platform?.session && !platform.loading && !platform.error && !platform.pendingLogout,
  );
  const returnUrl = `${pathname}${searchParams?.size ? `?${searchParams}` : ''}`;
  if (loading)
    return (
      <section className={styles.status}>
        <p role="status">正在確認學校帳號…</p>
        <Link className="btn" href={publicHref}>前往公開交流</Link>
      </section>
    );
  if (error)
    return (
      <section className={styles.status} role="alert">
        <h2>暫時無法確認學校帳號</h2>
        <p>請重新整理頁面後再試。你也可以使用 Google 帳號參與公開交流。</p>
        <Link className="btn primary" href={publicHref}>前往公開交流</Link>
      </section>
    );
  if (!user)
    return (
      <section className={styles.status}>
        <h2>{platformReady ? '前往公開交流，接續校園話題' : '用 Google 帳號參與公開交流'}</h2>
        <p>
          {platformReady ? 'Google 帳號已登入。' : ''}你可以閱讀跨校公開貼文，也能在開放看板發表。
          校內看板與讀書會需要另外連線學校帳號。
        </p>
        <div className={styles.toolbar}>
          <Link className="btn primary" href={publicHref}>前往公開交流</Link>
          <Link className="btn" href={schoolLoginHref(returnUrl)}>連線學校帳號</Link>
        </div>
      </section>
    );
  return (
    <div className={styles.content} key={`${user.uid}:${pathname}`}>
      {children}
    </div>
  );
}
