'use client';

import { useEffect, useId, useRef } from 'react';
import type { RevisionDraft } from '@/lib/assistantPlanRevisionDraft';
import styles from './AssistantPlanDraftRecovery.module.css';

type Props = {
  draft: RevisionDraft | null;
  restored: boolean;
  status: string;
  blocked: boolean;
  onRestore: () => void;
  onDiscard: () => void;
  onChange: (instruction: string) => void;
};

export function AssistantPlanDraftRecovery({ draft, restored, status, blocked, onRestore, onDiscard, onChange }: Props) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const previouslyRestored = useRef(restored);
  useEffect(() => {
    if (restored && !previouslyRestored.current) field.current?.focus();
    previouslyRestored.current = restored;
  }, [restored]);

  if (!draft) return status ? <p className={styles.notice} role="status">{status}</p> : null;
  const savedTime = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(draft.savedAt);

  return <section className={styles.panel} aria-labelledby={id + '-heading'}>
    <h2 id={id + '-heading'}>未送出的修訂草稿</h2>
    <p className={styles.hint}>
      <time dateTime={new Date(draft.savedAt).toISOString()}>暫存時間：{savedTime}（台灣時間）</time>
      {' · '}原提議 {draft.source.events.length} 項，已勾選保留 {draft.protectedIndices.length} 項。
    </p>
    <p className={styles.hint}>本分頁只暫存最近一份修訂草稿，30 分鐘內可恢復。恢復僅帶回修改內容，不會復活原確認卡，也不會送出任何操作。</p>
    {blocked && <p className={styles.notice}>仍有舊操作待核對，請先使用原確認卡的核對流程；草稿仍可在本分頁恢復、編輯或捨棄。</p>}
    {restored ? <>
      <label htmlFor={id + '-instruction'}>已恢復的修改條件</label>
      <textarea ref={field} id={id + '-instruction'} value={draft.instruction} maxLength={300} rows={3}
        aria-describedby={id + '-apply ' + id + '-count'} onChange={event => onChange(event.target.value)} />
      <p id={id + '-count'} className={styles.hint}>{draft.instruction.length}/300 字</p>
      <p id={id + '-apply'} className={styles.hint}>請先在下方取得新的有效行程提議，開啟「修改時間或條件」後，再手動套用草稿。保留選項只有在完整內容與順序相同時才會帶回，否則須重新選擇。</p>
      <details className={styles.snapshot}>
        <summary>查看原提議內容（僅供核對）</summary>
        <ol className={styles.events} aria-label="草稿的原提議內容">
          {draft.source.events.map((event, index) => <li key={index}>
            <h3>第 {index + 1} 項</h3>
            <dl>
              <div><dt>名稱</dt><dd>{event.title}</dd></div>
              <div><dt>開始日期</dt><dd>{event.date}</dd></div>
              <div><dt>{event.allDay ? '結束日期（不含當日）' : '結束日期'}</dt><dd>{event.endDate ?? '未另設'}</dd></div>
              <div><dt>全天</dt><dd>{event.allDay ? '是' : '否'}</dd></div>
              <div><dt>開始時間</dt><dd>{event.startTime ?? '未設定'}</dd></div>
              <div><dt>結束時間</dt><dd>{event.endTime ?? '未設定'}</dd></div>
            </dl>
          </li>)}
        </ol>
        <p className={styles.hint}>以上是草稿當時的提議內容，僅供核對；日期與時段均為台灣時間，不代表行程已建立。</p>
      </details>
    </> : null}
    <div className={styles.actions}>
      {!restored && <button type="button" className={styles.primary} onClick={onRestore}>恢復修訂草稿</button>}
      <button type="button" className={styles.secondary} onClick={onDiscard}>捨棄修訂草稿</button>
    </div>
    {status && <p className={styles.notice} role="status">{status}</p>}
  </section>;
}
