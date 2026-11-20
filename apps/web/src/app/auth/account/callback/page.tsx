'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AccountLoginError, completeSchoolCallback } from '../legacyLogin';
import styles from '../accountEntry.module.css';

export default function SchoolAccountCallbackPage() {
  const started = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const callbackUrl = window.location.href;
    window.history.replaceState(window.history.state, '', window.location.pathname);
    void completeSchoolCallback(callbackUrl).catch((failure: unknown) => {
      setError(
        failure instanceof AccountLoginError && failure.code === 'ACCOUNT_CALLBACK_CANCELLED'
          ? '這次學校登入已取消。'
          : '這次學校登入未完成，請重新登入。',
      );
    });
  }, []);

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>{error ? '學校登入未完成' : '正在確認學校帳號'}</h1>
      {error ? (
        <>
          <p role="alert" className={styles.error}>
            {error}
          </p>
          <Link className="btn primary" href="/auth/account?method=school">
            重新登入學校帳號
          </Link>
        </>
      ) : (
        <p role="status" className={styles.note}>
          登入成功後會回到原本的頁面。
        </p>
      )}
    </main>
  );
}
