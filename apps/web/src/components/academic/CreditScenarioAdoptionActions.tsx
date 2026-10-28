'use client';

import { useEffect, useRef, useState } from 'react';
import type { CreditPlan } from '@campus/shared/src/creditPlanner';
import {
  prepareCreditScenarioAdoption, prepareCreditScenarioUndo, creditScenarioChangeSummary,
  type ScenarioAdoption, type CreditScenarioWriter,
} from '@campus/shared/src/creditScenarioAdoption';
import styles from './CreditScenarioAdoptionActions.module.css';

export function CreditScenarioAdoptionActions({ plan, candidate, writer, blocked, onApplied }: {
  plan: CreditPlan; candidate: CreditPlan | null; writer?: CreditScenarioWriter;
  blocked?: string; onApplied: () => void;
}) {
  const [preview, setPreview] = useState<{ source: CreditPlan; value: ScenarioAdoption } | null>(null);
  const [receipt, setReceipt] = useState<{ applied: CreditPlan; value: ScenarioAdoption } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const live = useRef(true);
  const latest = useRef({ plan, candidate, blocked, writer });
  latest.current = { plan, candidate, blocked, writer };
  const title = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const hadPreview = useRef(false);
  useEffect(() => {
    if (preview) { title.current?.focus(); hadPreview.current = true; }
    else if (hadPreview.current) { trigger.current?.focus(); hadPreview.current = false; }
  }, [preview]);
  // Once a later edit is seen, an old undo receipt must never become valid again.
  useEffect(() => {
    if (receipt && plan !== receipt.applied) setReceipt(null);
  }, [plan, receipt]);
  if (!writer) return null;
  const stale = preview && (preview.source !== plan || !candidate ||
    JSON.stringify(preview.value.after) !== JSON.stringify(candidate));
  const changed = candidate && prepareCreditScenarioAdoption(plan, candidate).ok;

  function review() {
    if (!candidate || blocked || lock.current) return;
    const result = prepareCreditScenarioAdoption(plan, candidate);
    if (result.ok === false) { setMessage(result.message); return; }
    setPreview({ source: plan, value: result.value });
    setMessage('');
  }
  async function persist(undo: boolean) {
    if (lock.current || !live.current || latest.current.blocked || !latest.current.writer) return;
    const expected = latest.current.plan;
    const active = undo ? receipt?.value : preview?.value;
    if (!active || (undo ? receipt?.applied !== expected : preview?.source !== expected)) return;
    const next = undo ? prepareCreditScenarioUndo(expected, active) : active.after;
    if (!next || (!undo && JSON.stringify(latest.current.candidate) !== JSON.stringify(next))) {
      setMessage('比較內容已更改，請重新預覽。'); return;
    }
    lock.current = true; setBusy(true); setMessage('');
    try {
      const saved = await latest.current.writer(expected, next);
      if (!live.current) return;
      if (!saved) { setMessage('尚未完成儲存，請確認輸入與本機狀態後重試。'); return; }
      setPreview(null);
      setReceipt(undo ? null : { applied: saved, value: active });
      setMessage(undo ? '已復原這次採用，回到原本的修課安排。' : '已採用到這台裝置的個人規劃。');
      onApplied();
    } catch (error) {
      if (live.current) setMessage(error instanceof Error ? error.message : '儲存失敗，請重試。');
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }
  return <section className={styles.panel} aria-label="採用比較方案">
    {changed && !preview ? <button ref={trigger} type="button" disabled={Boolean(blocked) || busy}
      onClick={review}>預覽並採用此方案</button> : null}
    {blocked && (changed || receipt) ? <p className={styles.note}>{blocked}</p> : null}
    {preview ? <div className={styles.preview}>
      <h4 ref={title} tabIndex={-1}>確認修課安排差異</h4>
      <p>{creditScenarioChangeSummary(preview.value)}</p>
      <ul tabIndex={0} aria-label="修課安排差異明細">
        {preview.value.moved.map((course) => <li key={course.id}>{course.name}：第 {course.from} → 第 {course.to} 學期</li>)}
        {preview.value.removed.map((course) => <li key={course.id}>{course.name}：不再安排（{course.credits} 學分）</li>)}
      </ul>
      <p className={styles.note}>只更新此帳號、此校園的本機規劃，不會選課、退選或變更校方紀錄。有後續修改後，這次復原將失效。</p>
      {stale ? <p role="alert">原規劃或比較方案已變更，請取消後重新預覽。</p> : null}
      <div className={styles.actions}>
        <button type="button" disabled={busy || Boolean(blocked) || Boolean(stale)} onClick={() => void persist(false)}>
          {busy ? '正在儲存…' : '確認採用到個人規劃'}
        </button>
        <button type="button" disabled={busy} onClick={() => { setPreview(null); }}>取消採用</button>
      </div>
    </div> : null}
    {receipt && receipt.applied === plan ? <div className={styles.undo}>
      <p>這次採用已保存；目前尚未有其他規劃修改。</p>
      <button type="button" disabled={busy || Boolean(blocked)} onClick={() => void persist(true)}>復原這次採用</button>
    </div> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
