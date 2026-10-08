'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/AuthGuard';
import styles from '../community.module.css';

export function CommunityAccess({ children }: { children: ReactNode }) {
  const { user, loading, error } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnUrl = `${pathname}${searchParams?.size ? `?${searchParams}` : ''}`;
  if (loading) return <p role="status">正在確認登入狀態…</p>;
  if (error)
    return (
      <section className={styles.status} role="alert">
        <h2>暫時無法確認登入狀態</h2>
        <p>請重新整理頁面後再試。</p>
      </section>
    );
  if (!user)
    return (
      <section className={styles.status}>
        <h2>登入後加入校園交流</h2>
        <p>閱讀貼文、參與看板與讀書會，需要先確認你的校園帳號。</p>
        <Link className="btn primary" href={`/login?returnUrl=${encodeURIComponent(returnUrl)}`}>
          登入帳號
        </Link>
      </section>
    );
  return (
    <div className={styles.content} key={`${user.uid}:${pathname}`}>
      {children}
    </div>
  );
}
