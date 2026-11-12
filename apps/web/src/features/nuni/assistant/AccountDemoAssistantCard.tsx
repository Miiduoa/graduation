'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ACCOUNT_DEMO_ACTION_LABELS } from '@campus/shared/src/accountDemo';
import {
  accountDemoActionSummary,
  accountDemoActionDestination,
  executeAccountDemoAssistant,
  type AccountDemoAssistantProposal,
  type AccountDemoAssistantScope,
} from '@/lib/accountDemoAssistant';
import styles from './AssistantReply.module.css';

export function AccountDemoAssistantCard({ proposal, scope }: {
  proposal: AccountDemoAssistantProposal;
  scope: AccountDemoAssistantScope;
}) {
  const [status, setStatus] = useState<'proposed' | 'pending' | 'verified' | 'cancelled' | 'unknown'>('proposed');
  const [error, setError] = useState('');
  const lifetime = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const title = ACCOUNT_DEMO_ACTION_LABELS[proposal.action];
  const destination = accountDemoActionDestination(proposal.action, scope.schoolId);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  async function confirm() {
    if (lock.current || status !== 'proposed') return;
    lock.current = true;
    const operation = lifetime.current;
    const active = () => !!operation && !operation.signal.aborted;
    setStatus('pending');
    try {
      await executeAccountDemoAssistant(proposal, scope, undefined, active);
      if (active()) setStatus('verified');
    } catch (failure) {
      if (active()) {
        setStatus('unknown');
        setError(failure instanceof Error && !/^[A-Z_]+$/.test(failure.message)
          ? failure.message : '操作結果尚未核對，請開啟對應功能查看。');
      }
    } finally {
      lock.current = false;
    }
  }
  return (
    <article className={styles.card} aria-label="展示操作確認卡">
      <div className={styles.cardHeader}>
        <p className={styles.eyebrow}>本人帳號 · 展示情境</p>
        <h3>{title}</h3>
      </div>
      <p className={styles.note}>{accountDemoActionSummary(proposal.action)}</p>
      <p className={styles.note}>只更新本人的展示紀錄，不會扣款、向實際店家送單或對外通知。</p>
      {status === 'proposed' && <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={() => void confirm()}>確認展示操作</button>
        <button type="button" className={styles.secondary} onClick={() => setStatus('cancelled')}>取消</button>
      </div>}
      {status === 'pending' && <p className={styles.status} role="status">正在儲存並讀回核對…</p>}
      {status === 'cancelled' && <p className={styles.status}>已取消，沒有送出展示操作。</p>}
      {status === 'verified' && <div className={styles.receipt} aria-label="展示執行回執">
        <p className={`${styles.status} ${styles.statusOk}`}>已完成「{title}」，帳號展示紀錄已核對。</p>
        <Link className={styles.pageLink} href={destination.href}>開啟{destination.label}</Link>
      </div>}
      {status === 'unknown' && <div>
        <p className={styles.alert} role="alert">{error}</p>
        <Link className={styles.pageLink} href={destination.href}>開啟{destination.label}核對</Link>
      </div>}
    </article>
  );
}
