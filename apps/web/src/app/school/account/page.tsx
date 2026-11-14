'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { logoutSchoolAccount, readSchoolAccountSession, type SchoolAccountSession } from '../../auth/account/legacyLogin';
import styles from '../../auth/account/accountEntry.module.css';

type AccountState =
  | { status: 'loading' | 'signed-out' | 'ending' }
  | { status: 'active' | 'pending'; session: SchoolAccountSession }
  | { status: 'error'; message: string };

export default function SchoolAccountPage() {
  const [state, setState] = useState<AccountState>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    void readSchoolAccountSession(request.signal).then((session) => {
      if (!request.signal.aborted) setState(session ? { status: session.status, session } : { status: 'signed-out' });
    }).catch(() => {
      if (!request.signal.aborted) setState({ status: 'error', message: '目前無法確認校方帳號，請重新查詢。' });
    });
    return () => request.abort();
  }, [revision]);

  async function logout() {
    if (state.status !== 'active' && state.status !== 'pending') return;
    setState({ status: 'ending' });
    try {
      await logoutSchoolAccount(state.session);
      setState({ status: 'signed-out' });
    } catch {
      setState({ status: 'error', message: '尚未確認登出結果，請重新查詢帳號狀態。' });
    }
  }

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>校方帳號</h1>
      {state.status === 'active' && (
        <>
          <h2 className={styles.school}>已登入校方帳號</h2>
          <p className={styles.note}>在學校資訊選擇所屬學校，可查看官網與聯絡方式。承辦業務與授課權限請向校內負責單位確認。</p>
          <Link className="btn primary" href="/school-info">查看學校資訊與官網</Link>
          <button type="button" className="btn" onClick={() => void logout()}>登出或切換校方帳號</button>
        </>
      )}
      {state.status === 'pending' && (
        <>
          <p role="alert" className={styles.error}>上次登出尚未完成。請先完成登出，再切換校方帳號。</p>
          <button type="button" className="btn" onClick={() => void logout()}>重試登出校方帳號</button>
        </>
      )}
      {state.status === 'signed-out' && (
        <>
          <p className={styles.note}>目前未登入校方帳號。</p>
          <Link className="btn primary" href="/auth/account?method=school">使用校方帳號登入</Link>
        </>
      )}
      {state.status === 'error' && (
        <>
          <p className={styles.error} role="alert">{state.message}</p>
          <button type="button" className="btn" onClick={() => {
            setState({ status: 'loading' });
            setRevision((value) => value + 1);
          }}>重新查詢</button>
        </>
      )}
      {(state.status === 'loading' || state.status === 'ending') && (
        <p className={styles.note} role="status">{state.status === 'loading' ? '正在確認校方帳號…' : '正在登出校方帳號…'}</p>
      )}
    </main>
  );
}
