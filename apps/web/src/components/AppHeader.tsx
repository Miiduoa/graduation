'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useAuth } from './AuthGuard';
import { CampusServiceMenu } from './CampusServiceMenu';
import styles from '@/app/home.module.css';

function Header() {
  const pathname = usePathname();
  const params = useSearchParams();
  const { user, signOutUser } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const context = new URLSearchParams();
  for (const key of ['school', 'schoolId']) {
    const value = params?.get(key);
    if (value) context.set(key, value);
  }
  const href = (path: string) => `${path}${context.size ? `?${context}` : ''}`;
  const currentPage = `${pathname || '/'}${params?.size ? `?${params}` : ''}`;
  const loginHref =
    pathname === '/login' ? '/login' : `/login?returnUrl=${encodeURIComponent(currentPage)}`;
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
            href={user ? `${href('/')}#courses` : '/login'}
            aria-current={pathname?.startsWith('/course/') ? 'page' : undefined}
          >
            課程
          </Link>
          <Link href={href('/map')} aria-current={pathname === '/map' ? 'page' : undefined}>
            校園
          </Link>
          <CampusServiceMenu />
        </nav>
        <div className={styles.account}>
          {user ? (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (busy) return;
                setBusy(true);
                setError('');
                try {
                  await signOutUser();
                } catch {
                  setError('登出失敗，請稍後重試。');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '登出中…' : '登出'}
            </button>
          ) : (
            <Link href={loginHref}>登入</Link>
          )}
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
