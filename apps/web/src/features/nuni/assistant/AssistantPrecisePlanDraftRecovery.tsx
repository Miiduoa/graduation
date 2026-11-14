'use client';

import { useEffect, useId, useRef } from 'react';
import type { PrecisePlanDraft } from '@/lib/assistantPrecisePlanDraft';
import styles from './AssistantPlanDraftRecovery.module.css';

type Props = {
  draft: PrecisePlanDraft | null;
  restored: boolean;
  status: string;
  blocked: boolean;
  onRestore: () => void;
  onDiscard: () => void;
};

function editedValue(value: string): string {
  return value.trim() ? value : '未填';
}

export function AssistantPrecisePlanDraftRecovery({ draft, restored, status, blocked, onRestore, onDiscard }: Props) {
  const id = useId();
  const summary = useRef<HTMLElement>(null);
  const previouslyRestored = useRef(restored);
  useEffect(() => {
    if (restored && !previouslyRestored.current) summary.current?.focus();
    previouslyRestored.current = restored;
  }, [restored]);

  if (!draft) return status ? <p className={styles.notice} role="status">{status}</p> : null;
  const savedTime = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(draft.savedAt);

  return <section className={styles.panel} aria-labelledby={id + '-heading'}>
    <h2 id={id + '-heading'}>未送出的時間草稿</h2>
    <p className={styles.hint}>
      <time dateTime={new Date(draft.savedAt).toISOString()}>暫存時間：{savedTime}（台灣時間）</time>
      {' · '}原提議 {draft.source.events.length} 項，已編輯 {draft.edits.length} 項。
    </p>
    <p className={styles.hint}>本分頁只暫存最近一份時間草稿，30 分鐘內可恢復。恢復只帶回內容，不會復活舊確認卡、送給模型或送出行程操作。</p>
    {blocked && <p className={styles.notice}>仍有舊操作待核對，請先使用原確認卡的核對流程；仍可恢復或捨棄草稿以供核對，目前不能套用或送出操作。</p>}
    {restored && <section ref={summary} tabIndex={-1} aria-labelledby={id + '-summary'}>
      <h3 id={id + '-summary'}>已恢復的時間草稿內容</h3>
      <p className={styles.hint}>最後編輯：第 {draft.selectedIndex + 1} 項。</p>
      <p className={styles.hint}>以下內容僅供核對。請在新的有效行程提議中開啟「精確調整時間」，再明確套用草稿。只有相同來源，或整份內容與順序都能可靠核對時，才可套用。</p>
      <p className={styles.hint}>若提議重排、內容變更，或新提議含完全相同的重複項目而無法可靠對應，請重新選擇行程與時間；不會按名稱猜測。</p>
      <h3>已編輯的時間欄位</h3>
      <ol className={styles.events} aria-label="草稿的時間修改欄位">
        {draft.edits.map(edit => <li key={edit.index}>
          <h3>第 {edit.index + 1} 項的時間欄位</h3>
          <dl>
            <div><dt>開始日期</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{editedValue(edit.date)}</dd></div>
            <div><dt>結束日期</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{editedValue(edit.endDate)}</dd></div>
            <div><dt>開始時間</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{editedValue(edit.startTime)}</dd></div>
            <div><dt>結束時間</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{editedValue(edit.endTime)}</dd></div>
          </dl>
        </li>)}
      </ol>
      <p className={styles.hint}>欄位照草稿原樣顯示，空白標為「未填」；未填或無效內容不代表可用時間，套用後仍須核對並通過預覽檢查。</p>
      <details className={styles.snapshot}>
        <summary>原提議內容（僅供核對）</summary>
        <ol className={styles.events} aria-label="時間草稿的原提議內容">
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
        <p className={styles.hint}>原提議的日期與時間均為台灣時間，以上內容不代表行程已建立。</p>
      </details>
    </section>}
    <div className={styles.actions}>
      {!restored && <button type="button" className={styles.primary} onClick={() => onRestore()}>恢復時間草稿</button>}
      <button type="button" className={styles.secondary} onClick={() => onDiscard()}>捨棄時間草稿</button>
    </div>
    {status && <p className={styles.notice} role="status">{status}</p>}
  </section>;
}
