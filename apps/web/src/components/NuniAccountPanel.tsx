'use client';

import Link from 'next/link';
import { useNuniSession } from '@/features/nuni/Session';
import { AccountMemberships } from './AccountMemberships';
import styles from './NuniAccountPanel.module.css';

/** Account-level information only. Teaching roles belong to individual courses. */
export function NuniAccountPanel() {
  const account = useNuniSession();
  if (account.pendingLogout)
    return (
      <section className={styles.panel} aria-label="Campus One 帳號" role="status">
        <h2>Campus One 帳號正在登出</h2>
        <p>{account.error || '正在結束這次登入，帳號資料已隱藏。'}</p>
        {!account.loading && (
          <button className="btn" onClick={() => void account.logout()}>
            重試登出 Campus One 帳號
          </button>
        )}
      </section>
    );
  if (account.loading)
    return (
      <section className={styles.panel} aria-label="Campus One 帳號" role="status">
        <h2>正在確認 Campus One 帳號…</h2>
      </section>
    );
  if (account.error)
    return (
      <section className={styles.panel} aria-label="Campus One 帳號" role="alert">
        <h2>暫時無法確認 Campus One 帳號</h2>
        <p>{account.error}</p>
        <button className="btn" onClick={() => void account.refresh()}>
          重新確認 Campus One 帳號
        </button>
      </section>
    );
  if (!account.session) return null;
  return (
    <section className={styles.panel} aria-label="Campus One 帳號">
      <p className={styles.label}>我的帳號</p>
      <h2>Campus One 帳號已登入</h2>
      <p>你可以開啟已加入的課程。老師、協同教師或學生身分依各課程的成員資格決定。</p>
      <p>學校資格、課程成員與店家權限分別確認；校務課表與正式成績需要另外連線學校帳號。</p>
      <div className={styles.actions}>
        <Link className="btn primary" href="/classroom">
          查看我的課程
        </Link>
        <Link className="btn" href="/classroom/account">
          Campus One 帳號
        </Link>
        <Link className="btn" href="/merchant">
          店家合作
        </Link>
      </div>
      <AccountMemberships
        key={`${account.session.platformAccountId}:${account.session.context}`}
        context={account.session.context}
        refreshAccount={account.refresh}
      />
      {account.session.isPlatformOperator && (
        <div className={styles.permission}>
          <p>此帳號另有平台管理權限。</p>
          <Link href="/admin">前往平台管理 →</Link>
        </div>
      )}
    </section>
  );
}
