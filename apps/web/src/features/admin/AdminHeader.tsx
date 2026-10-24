'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useNuniSession } from '@/features/nuni/Session';
import styles from './AdminHeader.module.css';

export function AdminHeader() {
  const auth = useNuniSession();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await auth.logout();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className={styles.adminHeader}>
      <Link className={styles.adminBrand} href="/" aria-label="Campus One 首頁">
        <span className={styles.brandMark} aria-hidden="true">
          C₁
        </span>
        <span>Campus One</span>
        <span className={styles.headerContext}>平台管理</span>
      </Link>
      <div className={styles.headerActions}>
        <Link className={styles.homeLink} href="/">
          回校園
        </Link>
        {(auth.session || auth.pendingLogout) && (
          <Button disabled={signingOut || auth.loading} onClick={() => void signOut()}>
            {signingOut ? '登出中…' : auth.pendingLogout ? '重試登出' : '登出'}
          </Button>
        )}
      </div>
    </header>
  );
}
