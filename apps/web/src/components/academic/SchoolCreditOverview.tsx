'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PU_CREDIT_OVERVIEW_FIELDS, PU_CREDIT_OVERVIEW_LABELS, PU_CREDIT_OVERVIEW_NOTE,
  PU_CREDIT_REVIEW_URL, type PuCreditOverviewSnapshot,
} from '@campus/shared/src/puCreditOverview';
import { AcademicConnectionError } from '@/lib/academicClient';
import { loadSchoolCreditOverview } from '@/lib/schoolCreditOverview';
import { useSignInOptions } from '@/lib/signInOptions';
import styles from './SchoolCreditOverview.module.css';

type State = {
  scope: string;
  user: { uid: string };
  snapshot?: PuCreditOverviewSnapshot;
  loading: boolean;
  error?: unknown;
};

function amount(value: number | null) { return value === null ? '未提供' : `${value} 學分`; }

export function SchoolCreditOverview({ user, schoolId }: { user: { uid: string }; schoolId: string }) {
  const uid = user.uid;
  const scope = JSON.stringify([uid, schoolId]);
  const [state, setState] = useState<State | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const options = useSignInOptions();
  const read = useCallback(async () => {
    if (!uid || schoolId !== 'pu' || pending.current) return;
    const current = ++generation.current;
    pending.current = true;
    setState((previous) => ({
      scope, user, loading: true,
      ...(previous?.scope === scope && previous.user === user && previous.snapshot ? { snapshot: previous.snapshot } : {}),
    }));
    try {
      const snapshot = await loadSchoolCreditOverview(uid, schoolId);
      if (snapshot.ownerUid !== uid || snapshot.schoolId !== schoolId) throw new AcademicConnectionError('unavailable');
      if (generation.current !== current) return;
      setState({ scope, user, loading: false, snapshot });
    } catch (error) {
      if (generation.current !== current) return;
      const transient = error instanceof AcademicConnectionError && error.reason === 'unavailable';
      setState((previous) => ({
        scope, user, loading: false, error,
        ...(transient && previous?.scope === scope && previous.user === user && previous.snapshot ? { snapshot: previous.snapshot } : {}),
      }));
    } finally {
      if (generation.current === current) pending.current = false;
    }
  }, [uid, user, schoolId, scope]);

  useEffect(() => {
    pending.current = false;
    void read();
    return () => { generation.current += 1; pending.current = false; };
  }, [read]);

  if (!uid || schoolId !== 'pu') return null;
  const visible = state?.scope === scope && state.user === user ? state : null;
  const snapshot = visible?.snapshot;
  const loading = !visible || visible.loading;
  const reason = visible?.error instanceof AcademicConnectionError ? visible.error.reason : 'unavailable';
  const reconnect = reason === 'reconnect' || reason === 'permission';
  const timestamp = snapshot && new Date(snapshot.fetchedAt).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <section className={styles.panel} aria-label="校方學分試算總覽" aria-busy={loading}>
      <header className={styles.header}>
        <div>
          <p className={styles.source}>靜宜 e 校園・學分試算表</p>
          <h2>校方回報的學分累計</h2>
          <p className={styles.description}>直接讀取試算總覽，與下方成績推算及個人規劃分開呈現。</p>
        </div>
        <button className="btn" disabled={loading} onClick={() => void read()}>
          {loading ? '讀取中…' : '更新學分累計'}
        </button>
      </header>
      {Boolean(visible?.error) && <p className={styles.notice} role="status">
        {snapshot ? `本次更新未完成，目前顯示 ${timestamp} 取得的資料。`
          : reconnect ? '校務連線已到期或無法確認本人身分，重新連線後可讀取學分累計。'
            : '這次未能取得可確認的學分累計。可以重試，或先開啟校方試算表核對。'}
      </p>}
      {!snapshot && loading && <p className={styles.description} role="status">正在讀取校方學分試算表…</p>}
      {snapshot && <>
        <div className={styles.metrics}>
          {(['subtotal', 'totalRequired'] as const).map((field) => <div key={field}>
            <span>{PU_CREDIT_OVERVIEW_LABELS[field]}</span>
            <strong>{amount(snapshot.overview.totals[field])}</strong>
          </div>)}
        </div>
        <dl className={styles.breakdown}>
          {PU_CREDIT_OVERVIEW_FIELDS.filter((field) => field !== 'subtotal' && field !== 'totalRequired')
            .map((field) => <div key={field}>
              <dt>{PU_CREDIT_OVERVIEW_LABELS[field]}</dt><dd>{amount(snapshot.overview.totals[field])}</dd>
            </div>)}
        </dl>
        <p className={styles.timestamp}>
          {timestamp} 讀取 · 本次取得 {8 - snapshot.overview.coverage.missingFields.length}／8 個累計欄位
          {snapshot.overview.coverage.status === 'partial' ? '，未取得的欄位保留未知。' : '。'}
        </p>
      </>}
      <p className={styles.note}>{PU_CREDIT_OVERVIEW_NOTE}</p>
      <div className={styles.actions}>
        {!snapshot && Boolean(visible?.error) && reconnect && options.studentId && <Link className="btn primary"
          href={`/login?reconnect=school&returnUrl=${encodeURIComponent('/credit-planner?school=pu')}`}>
          重新連線學校帳號
        </Link>}
        <a href={PU_CREDIT_REVIEW_URL} target="_blank" rel="noopener noreferrer">前往校方學分試算表 ↗</a>
      </div>
    </section>
  );
}
