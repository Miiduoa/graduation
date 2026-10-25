import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AccountEntry } from './AccountEntry';
import styles from './accountEntry.module.css';

export const metadata: Metadata = {
  title: '登入',
  description: '請用學校核發的帳號登入。',
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
