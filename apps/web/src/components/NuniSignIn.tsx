'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { browserRequest, useNuniSession } from '@/features/nuni/Session';
import { platformDestination } from '@/lib/accountDestination';
import styles from '@/app/servicePages.module.css';

export function NuniSignIn({ returnUrl, issue = false }: { returnUrl?: string; issue?: boolean }) {
  const auth = useNuniSession();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);
  const destination = platformDestination(returnUrl);
  useEffect(() => {
    if (auth.session || auth.pendingLogout || auth.loading) return;
    let active = true;
    void browserRequest('sign-in-options')
      .then((value) => {
        if (active)
          setAvailable(
            !!value && typeof value === 'object' && 'google' in value && value.google === true,
          );
      })
      .catch(() => {
        if (active) setAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [auth.session, auth.pendingLogout, auth.loading, attempt]);

  return (
    <section className={styles.loginHelp} aria-labelledby="platform-sign-in-title">
      <h2 id="platform-sign-in-title">課程與跨校交流</h2>
      <p>使用你的 Nuni 帳號，繼續課程、作業與公開看板。</p>
      {issue && <p role="alert">這次登入沒有完成，請重新登入。</p>}
      {auth.loading ? (
        <p role="status">正在確認帳號…</p>
      ) : auth.pendingLogout ? (
        <div role="alert">
          <p>上一次登出尚未完成。請先結束登入，再選擇帳號。</p>
          <button className="btn" onClick={() => void auth.logout()}>
            重試登出
          </button>
        </div>
      ) : auth.session ? (
        <>
          <p>你已登入 Nuni 帳號。</p>
          <Link className="btn primary" href={destination}>
            繼續使用
          </Link>
        </>
      ) : available ? (
        <form
          action={`/auth/platform/start?returnUrl=${encodeURIComponent(destination)}`}
          method="post"
        >
          <button className="btn primary" type="submit">
            使用 Google 帳號登入
          </button>
        </form>
      ) : available === null ? (
        <p role="status">正在確認登入服務…</p>
      ) : (
        <div role="status">
          <p>目前無法使用帳號登入，請稍後再試。</p>
          <button
            className="btn"
            onClick={() => {
              setAvailable(null);
              setAttempt((value) => value + 1);
            }}
          >
            重新確認
          </button>
        </div>
      )}
      <p>課程身分依每門課的成員資格決定；校務資料需要學校另行確認。</p>
      <p>
        <Link href="/privacy">隱私政策</Link> · <Link href="/terms">服務條款</Link>
      </p>
    </section>
  );
}
