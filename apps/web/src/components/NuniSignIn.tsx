'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { browserRequest, useNuniSession } from '@/features/nuni/Session';
import { platformDestination } from '@/lib/accountDestination';
import styles from '@/app/servicePages.module.css';

export function NuniSignIn({
  returnUrl,
  issue = false,
  disabled = false,
  onStart,
}: {
  returnUrl?: string;
  issue?: boolean;
  disabled?: boolean;
  onStart?: () => boolean;
}) {
  const auth = useNuniSession();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);
  const submitting = useRef(false);
  const [starting, setStarting] = useState(false);
  const destination = platformDestination(returnUrl);
  const taskPath = destination.split(/[?#]/)[0];
  const purpose = taskPath.startsWith('/merchant')
    ? '登入後繼續店家申請、查看審核進度與授權門市。'
    : taskPath === '/admin'
      ? '登入後確認管理權限，再回到管理台。'
      : taskPath.startsWith('/classroom/course/')
        ? '登入後回到這門課，繼續查看或繳交作業。'
        : '使用 Campus One 帳號，繼續課程、作業與公開看板。';
  useEffect(() => {
    const restore = () => {
      submitting.current = false;
      setStarting(false);
    };
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, []);
  useEffect(() => {
    if (auth.session || auth.pendingLogout || auth.loading || auth.error) return;
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
  }, [auth.session, auth.pendingLogout, auth.loading, auth.error, attempt]);

  return (
    <section className={styles.loginHelp} aria-labelledby="platform-sign-in-title">
      <h2 id="platform-sign-in-title">登入或建立 Campus One 帳號</h2>
      <p>{purpose}</p>
      <p>
        第一次使用？透過 Google 繼續即可建立帳號，不必另外設定密碼。之後請使用同一個 Google
        帳號登入。
      </p>
      {issue && <p role="alert">這次登入沒有完成，請重新登入。</p>}
      {auth.loading ? (
        <p role="status">正在確認帳號…</p>
      ) : auth.pendingLogout ? (
        <div role="alert">
          <p>上一次登出尚未完成。請先結束登入，再選擇帳號。</p>
          <button className="btn" disabled={disabled} onClick={() => void auth.logout()}>
            重試登出
          </button>
        </div>
      ) : auth.error ? (
        <div role="alert">
          <p>{auth.error}</p>
          <button className="btn" disabled={disabled} onClick={() => void auth.refresh()}>
            重新確認帳號
          </button>
        </div>
      ) : auth.session ? (
        <>
          <p>你已登入 Campus One 帳號。</p>
          <Link className="btn primary" href={destination}>
            繼續使用
          </Link>
          <button className="btn" disabled={disabled} onClick={() => void auth.logout()}>
            登出並切換帳號
          </button>
        </>
      ) : available ? (
        <form
          action={`/auth/platform/start?returnUrl=${encodeURIComponent(destination)}`}
          method="post"
          aria-busy={starting}
          onSubmit={(event) => {
            if (disabled || submitting.current || onStart?.() === false) {
              event.preventDefault();
              return;
            }
            submitting.current = true;
            setStarting(true);
          }}
        >
          <button className="btn primary" type="submit" disabled={disabled || starting}>
            {starting ? '正在前往 Google…' : '使用 Google 帳號繼續'}
          </button>
        </form>
      ) : available === null ? (
        <p role="status">正在確認登入服務…</p>
      ) : (
        <div role="status">
          <p>目前無法使用帳號登入，請稍後再試。</p>
          <button
            className="btn"
            disabled={disabled}
            onClick={() => {
              setAvailable(null);
              setAttempt((value) => value + 1);
            }}
          >
            重新確認
          </button>
        </div>
      )}
      <p>
        學生、教師與店家共用這個帳號入口。店家身分須另行申請及審核；課程身分依每門課的成員資格決定。Google
        登入不會自動取得校籍或管理權限。
      </p>
      <p>
        <Link href="/privacy">隱私政策</Link> · <Link href="/terms">服務條款</Link>
      </p>
    </section>
  );
}
