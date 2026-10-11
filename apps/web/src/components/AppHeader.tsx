'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useAuth } from './AuthGuard';
import { CampusServiceMenu } from './CampusServiceMenu';
import styles from '@/app/home.module.css';
import { SchoolSelector } from './SchoolSelector';
import { useNuniSession } from '@/features/nuni/Session';
import { useLocationHash } from '@/lib/useLocationHash';
import headerStyles from './AppHeader.module.css';

function Header() {
  const pathname = usePathname();
  const params = useSearchParams();
  const hash = useLocationHash();
  const { user, loading, signOutUser } = useAuth();
  const nuni = useNuniSession();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const context = new URLSearchParams();
  for (const key of ['school', 'schoolId', 'campus']) {
    const value = params?.get(key);
    if (value) context.set(key, value);
  }
  const href = (path: string) => `${path}${context.size ? `?${context}` : ''}`;
  const currentPage = `${pathname || '/'}${params?.size ? `?${params}` : ''}${hash}`;
  const loginPage = ['/login', '/classroom/login', '/admin/login'].includes(pathname || '');
  const loginHref = `/login?returnUrl=${encodeURIComponent(currentPage)}`;
  const checking = loading || nuni.loading;
  const courseHref = nuni.session || !user ? href('/classroom') : `${href('/')}#courses`;
  return (
    <>
      <header className={styles.header}>
        <Link href={href('/')} className={styles.brand}>
          <span className={styles.mark} aria-hidden>
            C<span>1</span>
          </span>
          Campus One
        </Link>
        <nav aria-label="主要導覽" className={styles.nav}>
          <Link href={href('/')} aria-current={pathname === '/' ? 'page' : undefined}>
            今日
          </Link>
          <Link
            href={courseHref}
            aria-current={
              pathname === '/classroom' ||
              pathname?.startsWith('/classroom/course/') ||
              pathname?.startsWith('/course/') ||
              pathname?.startsWith('/teacher/course/')
                ? 'page'
                : undefined
            }
          >
            課程
          </Link>
          <Link href={href('/map')} aria-current={pathname === '/map' ? 'page' : undefined}>
            校園
          </Link>
          <CampusServiceMenu />
        </nav>
        <div className={`${styles.account} ${headerStyles.account}`}>
          <SchoolSelector compact />
          {!checking && nuni.session?.isPlatformOperator && <Link href="/admin">平台管理</Link>}
          {!checking && (user || nuni.session) && <Link href="/profile">我的帳號</Link>}
          {user || nuni.session || nuni.pendingLogout ? (
            <button
              type="button"
              disabled={busy || checking}
              onClick={async () => {
                if (busy) return;
                setBusy(true);
                setError('');
                try {
                  await Promise.all([
                    ...(user ? [signOutUser()] : []),
                    ...(nuni.session || nuni.pendingLogout ? [nuni.logout()] : []),
                  ]);
                } catch {
                  setError('登出失敗，請稍後重試。');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '登出中…' : nuni.pendingLogout ? '重試登出' : '登出'}
            </button>
          ) : checking ? (
            <span role="status">確認帳號中…</span>
          ) : !loginPage ? (
            <Link href={loginHref}>登入</Link>
          ) : null}
        </div>
      </header>
      {error && (
        <p role="alert" className={styles.notice}>
          {error}
        </p>
      )}
    </>
  );
}
export function AppHeader() {
  return (
    <Suspense
      fallback={
        <header className={styles.header}>
          <Link href="/" className={styles.brand}>
            Campus One
          </Link>
        </header>
      }
    >
      <Header />
    </Suspense>
  );
}
