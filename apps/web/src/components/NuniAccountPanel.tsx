'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { useNuniSession } from '@/features/nuni/Session';
import { AccountIdentity } from './AccountIdentity';
import { AccountMemberships } from './AccountMemberships';
import styles from './NuniAccountPanel.module.css';

type MembershipRecovery = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (failure: unknown) => void;
  targetVersion: number;
  failure?: unknown;
};

/** Account-level information only. Teaching roles belong to individual courses. */
export function NuniAccountPanel() {
  const account = useNuniSession();
  if (account.pendingLogout)
    return (
      <section className={styles.panel} aria-label="Google 帳號" role="status">
        <h2>Google 帳號正在登出</h2>
        <p>{account.error || '正在結束這次登入，帳號資料已隱藏。'}</p>
        {!account.loading && (
          <button className="btn" onClick={() => void account.logout()}>
            重試登出 Google 帳號
          </button>
        )}
      </section>
    );
  if (account.loading && (!account.session || account.error))
    return (
      <section className={styles.panel} aria-label="Google 帳號" role="status">
        <h2>正在確認 Google 帳號…</h2>
      </section>
    );
  if (account.error)
    return (
      <section className={styles.panel} aria-label="Google 帳號" role="alert">
        <h2>暫時無法確認 Google 帳號</h2>
        <p>{account.error}</p>
        <button className="btn" onClick={() => void account.refresh()}>
          重新確認 Google 帳號
        </button>
      </section>
    );
  if (!account.session) return null;
  return (
    <ConfirmedAccountPanel
      key={JSON.stringify([account.session.platformAccountId, account.session.context])}
      session={account.session}
      loading={account.loading}
      refreshAccount={account.refresh}
    />
  );
}

function ConfirmedAccountPanel({
  session,
  loading,
  refreshAccount,
}: {
  session: NonNullable<ReturnType<typeof useNuniSession>['session']>;
  loading: boolean;
  refreshAccount: () => Promise<void>;
}) {
  const [confirmed, setConfirmed] = useState(!loading);
  const [readerVersion, setReaderVersion] = useState(0);
  const [recovery, setRecovery] = useState<'idle' | 'pending' | 'settled' | 'error'>('idle');
  const [readerSuppressed, setReaderSuppressed] = useState(false);
  const mounted = useRef(true);
  const recoveryOperation = useRef<MembershipRecovery | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const operation = recoveryOperation.current;
      recoveryOperation.current = null;
      operation?.reject(new Error('Account scope changed during membership recovery'));
    };
  }, []);
  useEffect(() => {
    const operation = recoveryOperation.current;
    if (!operation) return;
    if (recovery === 'error') {
      recoveryOperation.current = null;
      operation.reject(operation.failure);
    } else if (!loading && recovery === 'idle' && readerVersion === operation.targetVersion) {
      recoveryOperation.current = null;
      // Complete after the previous reader's cleanup, so it cannot start another read.
      operation.resolve();
    }
  }, [loading, readerVersion, recovery]);
  useEffect(() => {
    if (!loading) setConfirmed(true);
  }, [loading]);
  useEffect(() => {
    if (loading || recovery !== 'settled') return;
    setRecovery('idle');
    setReaderSuppressed(false);
    setReaderVersion((value) => value + 1);
  }, [loading, recovery]);
  function recoverMemberships() {
    if (recoveryOperation.current) return recoveryOperation.current.promise;
    if (loading || !mounted.current) {
      const unavailable = Promise.reject(new Error('Account verification is not ready'));
      void unavailable.catch(() => {});
      return unavailable;
    }
    let resolve!: () => void;
    let reject!: (failure: unknown) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const operation = { promise, resolve, reject, targetVersion: readerVersion + 1 };
    recoveryOperation.current = operation;
    // The legacy membership button does not await the returned promise.
    void promise.catch(() => {});
    setRecovery('pending');
    void (async () => {
      try {
        await refreshAccount();
        if (mounted.current && recoveryOperation.current === operation) setRecovery('settled');
      } catch (failure) {
        if (mounted.current && recoveryOperation.current === operation) {
          recoveryOperation.current.failure = failure;
          setReaderSuppressed(true);
          setRecovery('error');
        }
      }
    })();
    return promise;
  }
  function blockHiddenAction(event: SyntheticEvent) {
    if (!loading) return;
    event.preventDefault();
    event.stopPropagation();
  }
  return (
    <>
      {loading && (
        <section className={styles.panel} aria-label="Google 帳號" role="status">
          <h2>正在確認 Google 帳號…</h2>
        </section>
      )}
      {confirmed && (
        <section
          className={styles.panel}
          aria-label="Google 帳號"
          hidden={loading}
          inert={loading}
          style={loading ? { display: 'none' } : undefined}
          onSubmitCapture={blockHiddenAction}
          onClickCapture={blockHiddenAction}
        >
          {!loading && (
            <>
              <p className={styles.label}>我的帳號</p>
              <h2>Google 帳號已登入</h2>
              <p>你可以開啟已加入的課程。老師、協同教師或學生身分依各課程的成員資格決定。</p>
              <p>學校資格、課程成員與店家權限分別確認。校務課表與正式成績還沒接通。</p>
              <div className={styles.actions}>
                <Link className="btn primary" href="/classroom">
                  查看我的課程
                </Link>
                <Link className="btn" href="/classroom/account">
                  學校資格
                </Link>
                <Link className="btn" href="/merchant">
                  店家合作
                </Link>
              </div>
            </>
          )}
          {!loading && (
            <AccountIdentity context={session.context} accountId={session.platformAccountId} />
          )}
          {recovery === 'pending' && <p role="status">正在重新確認帳號…</p>}
          {recovery === 'error' && (
            <div>
              <p role="alert">目前無法重新確認帳號，請稍後再試。</p>
              <button className="btn" onClick={() => void recoverMemberships()}>
                重新確認帳號
              </button>
            </div>
          )}
          {!readerSuppressed && (
            <AccountMemberships
              key={readerVersion}
              context={session.context}
              paused={loading}
              refreshAccount={recoverMemberships}
            />
          )}
          {!loading && session.isPlatformOperator && (
            <div className={styles.permission}>
              <p>此帳號另有平台管理權限。</p>
              <Link href="/admin">前往平台管理 →</Link>
            </div>
          )}
        </section>
      )}
    </>
  );
}
