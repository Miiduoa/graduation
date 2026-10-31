'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  readCorrectionBookmark, clearCorrectionBookmark, clearInvalidCorrectionBookmark,
  type CorrectionBookmarkScope,
} from '@/lib/attendanceCorrectionBookmark';
import type { CorrectionReceiptResult } from '@/lib/attendanceCorrectionReceipt';
import styles from './attendance-correction-resume.module.css';

const LABELS = { present: '出席', late: '遲到', absent: '缺席', excused: '請假', unconfirmed: '尚無紀錄', unavailable: '待核實' };
const SERVER = { kind: 'loading' } as const;
const subscribe = () => () => {};
const serverSnapshot = () => SERVER;
type Props = {
  scope: CorrectionBookmarkScope;
  currentActor: () => string | null;
  children: ReactNode;
};

export function AttendanceCorrectionResume(props: Props) {
  return <ResumeEntry key={JSON.stringify(props.scope)} {...props} />;
}

function ResumeEntry({ scope, currentActor, children }: Props) {
  // Snapshot only on entry: a live editor must not be replaced by its own new bookmark.
  const [initial] = useState(() => readCorrectionBookmark(scope));
  const entry = useSyncExternalStore<typeof initial | typeof SERVER>(subscribe, () => initial, serverSnapshot);
  const [dismissed, setDismissed] = useState(false);
  const [result, setResult] = useState<CorrectionReceiptResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const mounted = useRef(true);
  const checking = useRef(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { if (result && !busy) resultHeading.current?.focus(); }, [result, busy]);

  async function check() {
    if (checking.current || entry.kind !== 'pending') return;
    checking.current = true;
    setBusy(true); setError(''); setResult(null); setAcknowledged(false);
    try {
      if (currentActor() !== scope.actorUid) throw new Error('account-changed');
      const { loadSavedCorrectionReceipt } = await import('@/lib/attendanceCorrectionReceipt');
      if (!mounted.current || currentActor() !== scope.actorUid) return;
      const response = await loadSavedCorrectionReceipt(entry.bookmark);
      if (mounted.current && currentActor() === scope.actorUid) setResult(response);
    } catch {
      if (mounted.current && currentActor() === scope.actorUid) {
        setError('暫時無法核對收據，可能是連線或授課資格已變更。提醒仍保留，不會自動重送。');
      }
    } finally {
      checking.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function dismiss() {
    if (checking.current || currentActor() !== scope.actorUid ||
        (result?.kind !== 'saved' && !acknowledged)) return;
    const removed = entry.kind === 'pending'
      ? clearCorrectionBookmark(scope, entry.bookmark.requestId)
      : clearInvalidCorrectionBookmark(scope);
    if (!removed) {
      setError('提醒已變更或儲存空間無法使用，請重新整理再核對；沒有改動出席紀錄。');
      return;
    }
    setDismissed(true);
  }
  if (entry.kind === 'loading') return <p role="status">正在檢查此分頁的待確認操作…</p>;
  if (dismissed || entry.kind === 'empty') return <>{children}</>;
  if (entry.kind === 'unavailable') return <>
    <p role="status" className={styles.notice}>此瀏覽器未開放分頁儲存；結果待確認時請先留在本頁處理。</p>
    {children}
  </>;
  return <section className={styles.card} aria-label="恢復更正結果查核" aria-busy={busy}>
    <div className={styles.heading}>
      <span className={styles.eyebrow}>出席更正 · 結果查核</span>
      <h4 ref={resultHeading} tabIndex={-1}>
        {result?.kind === 'saved' ? '已找到原更正收據' : '先確認上次的更正結果'}
      </h4>
      <p>重新整理不代表操作失敗。這裡只讀取伺服器收據，不重新送出更正。</p>
    </div>
    {entry.kind === 'invalid' ? <p role="alert" className={styles.warning}>
      此分頁的提醒格式不完整，無法指定原收據。請先核對名冊與更正歷程，這不是保存成功或失敗的證明。
    </p> : <>
      <p className={styles.meta}>此分頁記錄於 {new Date(entry.bookmark.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</p>
      <button type="button" className={styles.primary} disabled={busy} onClick={() => void check()}>
        {busy ? '正在唯讀查核…' : result ? '重新查核收據' : '查核原更正收據'}
      </button>
    </>}
    {result?.kind === 'saved' && <div className={styles.result} role="status">
      <strong>原操作已保存：{LABELS[result.status]}</strong>
      <span>核定時間 {new Date(result.savedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</span>
      {result.current ? <>
        <span>{result.current.row.displayName} · {result.current.row.studentId || '未提供學號'}</span>
        <strong>目前課堂狀態：{LABELS[result.current.row.status]}</strong>
        {result.changedSinceSave && <p>之後已有其他更正，以目前課堂狀態為準；本次查核沒有覆寫任何紀錄。</p>}
      </> : <p>原操作已保存，但目前出席狀態無法核實。請回到名冊重新確認。</p>}
    </div>}
    {result?.kind === 'not-found' && <p role="status" className={styles.warning}>
      目前尚未找到這筆收據，不代表操作失敗。原請求可能仍在處理，請再查核或確認名冊與更正歷程。
    </p>}
    {error && <p role="alert" className={styles.warning}>{error}</p>}
    {result?.kind === 'saved' ? <button type="button" className={styles.secondary} disabled={busy} onClick={dismiss}>
      已確認，返回名冊
    </button> : (result?.kind === 'not-found' || entry.kind === 'invalid') && <div className={styles.release}>
      <label><input type="checkbox" checked={acknowledged} disabled={busy}
        onChange={(event) => setAcknowledged(event.target.checked)} />
        我已另行核對名冊與更正歷程，了解移除提醒不會取消或回復原操作。
      </label>
      <button type="button" className={styles.secondary} disabled={busy || !acknowledged} onClick={dismiss}>
        移除本頁提醒，返回名冊
      </button>
    </div>}
    <p className={styles.footnote}>只保留操作識別碼與時間，不保留學生姓名、學號、原因或登入憑證。提醒限此瀏覽器分頁，不是離線佇列或跨裝置備份。</p>
  </section>;
}
