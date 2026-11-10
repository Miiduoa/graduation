import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AccountEntry } from './AccountEntry';
import styles from './accountEntry.module.css';

export const metadata: Metadata = {
  title: '登入',
  description: '學生、教師、店家與管理人員的註冊及登入入口。',
};

function LoadingEntry() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={styles.title}>登入</h1>
        <p className={styles.note} role="status">
          正在載入登入…
        </p>
      </main>
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<LoadingEntry />}>
      <AccountEntry />
    </Suspense>
  );
}
