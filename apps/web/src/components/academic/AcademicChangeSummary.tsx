'use client';

import { useEffect, useRef, useState } from 'react';
import {
  compareAcademicSnapshots,
  type AcademicChangeKind,
  type AcademicChangeReport,
  type AcademicChangeSnapshot,
} from '@/lib/academicChanges';
import type { AcademicRecordState } from '@/lib/useAcademicRecords';
import styles from './AcademicChangeSummary.module.css';

type View = { scope: string; snapshot: AcademicChangeSnapshot; report: AcademicChangeReport };
const RESET_ERRORS = new Set(['reconnect', 'permission', 'unconfigured']);
const TITLES = {
  added: '本次新增紀錄',
  changed: '資料變更',
  'not-returned': '本次未回傳',
  review: '需核對來源',
} as const;
const STATUS_COPY: Record<Exclude<AcademicChangeReport['status'], 'compared'>, string> = {
  baseline: '已建立本次檢視的比對基準；下次成功更新後會列出差異。',
  'scope-reset': '資料範圍已變更，重新建立比對基準，不沿用其他帳號或校園的資料。',
  'semester-reset': '課表學期已變更，重新建立比對基準，不把跨學期差異視為退選。',
  empty: '本次來源回傳空清單，無法判定原有紀錄是否移除；請到學校系統核對。',
  stale: '來源時間未前進，這次不產生新的變更通知。',
  limit: '資料筆數超過差異比對範圍，請以下方完整資料及學校系統為準。',
};
function time(value: string): string {
  if (!Number.isFinite(Date.parse(value))) return '時間未確認';
  return new Date(value).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/** 只留在這個頁面的記憶體。失敗絕不當成空白的成功結果。 */
export function AcademicChangeSummary<K extends AcademicChangeKind>({
  kind,
  state,
}: { kind: K; state: AcademicRecordState<K> | null }) {
  const baseline = useRef<{ scope: string; kind: K; snapshot: AcademicChangeSnapshot } | null>(null);
  const seen = useRef<{ scope: string; kind: K; snapshot: AcademicChangeSnapshot } | null>(null);
  const [view, setView] = useState<View | null>(null);
  useEffect(() => {
    if (!state) {
      baseline.current = null;
      seen.current = null;
      setView(null);
      return;
    }
    if (baseline.current?.scope !== state.scope || baseline.current?.kind !== kind) {
      baseline.current = null;
      seen.current = null;
    }
    if (state.status === 'error') {
      if (state.reason && RESET_ERRORS.has(state.reason)) baseline.current = null;
      seen.current = null;
      setView(null);
      return;
    }
    if (state.status !== 'ready' || !state.snapshot || state.refreshing) return;
    if (seen.current?.scope === state.scope && seen.current.kind === kind && seen.current.snapshot === state.snapshot) return;
    const report = compareAcademicSnapshots(kind, baseline.current?.snapshot ?? null, state.snapshot);
    const next = { scope: state.scope, kind, snapshot: state.snapshot };
    if (!['empty', 'stale', 'limit'].includes(report.status)) baseline.current = next;
    seen.current = next;
    setView({ ...next, report });
  }, [kind, state]);

  // 身分或請求狀態一變，在 effect 執行前就同步遮住畫面。
  if (!state || state.status !== 'ready' || state.refreshing || !view ||
    state.scope !== view.scope || state.snapshot !== view.snapshot) return null;
  return <Report key={`${kind}:${view.report.to}`} report={view.report} />;
}

function Report({ report }: { report: AcademicChangeReport }) {
  const [visible, setVisible] = useState(8);
  const changed = report.changes.filter((item) => item.type === 'changed').length;
  const added = report.changes.filter((item) => item.type === 'added').length;
  const review = report.changes.length - changed - added;
  return (
    <section className={styles.panel} aria-label="校務更新差異">
      <div className={styles.heading}>
        <h2>這次更新，哪些資料變了？</h2>
        <span className={styles.badge}>僅比較來源資料</span>
      </div>
      {report.status !== 'compared' ? <p className={styles.note}>{STATUS_COPY[report.status]}</p> : (
        <>
          <p className={styles.summary} aria-live="polite" aria-atomic="true">
            {report.changes.length ? `新增 ${added} 組 · 變更 ${changed} 組 · 待核對 ${review} 組` : '與上次成功讀取相比，沒有課程欄位變更。'}
          </p>
          <p className={styles.note}>兩次讀取時間：{time(report.from!)} → {time(report.to)}</p>
          {!!report.changes.length && (
            <ul className={styles.list}>
              {report.changes.slice(0, visible).map((item) => (
                <li key={item.key}>
                  <div className={styles.rowHeading}>
                    <strong>{item.title}</strong>
                    <span>{TITLES[item.type]}</span>
                  </div>
                  <p className={styles.note}>學期：{item.semester || '未提供'}</p>
                  {item.type === 'not-returned' && <p>本次回應沒有這筆資料，不代表已退選或成績已刪除。</p>}
                  {item.type === 'review' && <p>同名科目或多個上課時段無法唯一配對，請核對原始資料，不推定分數或時間變更。</p>}
                  {!!item.fields.length && <dl className={styles.fields}>
                    {item.fields.map((itemField) => <div key={itemField.label}>
                      <dt>{itemField.label}</dt>
                      <dd>{itemField.before ? <><span className={styles.before}>{itemField.before}</span><span aria-label="變更為"> → </span></> : null}{itemField.after}</dd>
                    </div>)}
                  </dl>}
                </li>
              ))}
            </ul>
          )}
          {report.changes.length > visible && <button className="btn" type="button" onClick={() => setVisible((value) => value + 20)}>
            顯示更多差異（還有 {report.changes.length - visible} 組）
          </button>}
        </>
      )}
      <p className={styles.note}>比對紀錄只保留在目前頁面；不更改學校資料，也不覆蓋你自行匯入的課表或成績。</p>
    </section>
  );
}
