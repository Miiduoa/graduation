'use client';

import { useEffect, useId, useRef } from 'react';
import type { ShiftPlanDraft } from '@/lib/assistantShiftPlanDraft';
import { planSelectionEventTime } from './planSelection';
import styles from './AssistantPlanDraftRecovery.module.css';

type Props = {
  draft: ShiftPlanDraft | null;
  restored: boolean;
  status: string;
  blocked: boolean;
  onRestore: () => void;
  onDiscard: () => void;
};

export function AssistantShiftPlanDraftRecovery({ draft, restored, status, blocked, onRestore, onDiscard }: Props) {
  const id = useId(), summary = useRef<HTMLElement>(null);
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
    <h2 id={id + '-heading'}>未送出的平移草稿</h2>
    <p className={styles.hint}>
      <time dateTime={new Date(draft.savedAt).toISOString()}>暫存時間：{savedTime}（台灣時間）</time>
      {' · '}原提議 {draft.source.events.length} 項，當時選取 {draft.selectedIndices.length} 項、保留原樣 {draft.protectedIndices.length} 項。
    </p>
    <p className={styles.hint}>本分頁只暫存最近一份平移草稿，30 分鐘內可恢復，與其他模式的草稿分開保存。恢復只帶回內容，不會授權、復活確認卡、送給模型或送出行程操作。</p>
    {blocked && <p className={styles.notice}>仍有舊操作待核對，請先使用原確認卡的核對流程；仍可恢復或捨棄草稿以供核對，目前不能套用或預覽。</p>}
    {restored && <section ref={summary} tabIndex={-1} aria-labelledby={id + '-content'}>
      <h3 id={id + '-content'}>已恢復的平移草稿內容</h3>
      <dl aria-label="平移草稿設定">
        <div><dt>調整方向</dt><dd>{draft.direction === 'later' ? '延後' : '提前'}</dd></div>
        <div><dt>調整分鐘數</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{draft.minutes.trim() ? draft.minutes : '未填'}</dd></div>
      </dl>
      <p className={styles.hint}>分鐘照草稿原值顯示；空白或無效內容仍須修正後才能預覽。</p>
      <h3>草稿當時選取的項目</h3>
      {draft.selectedIndices.length ? <ol className={styles.events} aria-label="草稿原選取項目">
        {draft.selectedIndices.map(index => <li key={index}>
          <strong>第 {index + 1} 項 · {draft.source.events[index].title}</strong>
          <p>{planSelectionEventTime(draft.source.events[index])}</p>
        </li>)}
      </ol> : <p className={styles.hint}>草稿當時沒有選取項目。</p>}
      <h3>草稿當時保留原樣的項目</h3>
      {draft.protectedIndices.length ? <ol className={styles.events} aria-label="草稿原保留項目">
        {draft.protectedIndices.map(index => <li key={index}>
          <strong>第 {index + 1} 項 · {draft.source.events[index].title}</strong>
          <p>{planSelectionEventTime(draft.source.events[index])}</p>
        </li>)}
      </ol> : <p className={styles.hint}>草稿當時沒有保留原樣項目。</p>}
      <p className={styles.hint}>請先取得有效行程提議，再開啟「整組調整時間」明確套用草稿。只有相同來源、完整順序與保留設定都能核對時，才會帶回選取項目；否則只帶回方向與分鐘，須重新勾選。草稿不會改變目前的保留原樣設定。</p>
      <details className={styles.snapshot}>
        <summary>原提議內容（僅供核對）</summary>
        <ol className={styles.events} aria-label="平移草稿的原提議內容">
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
        <p className={styles.hint}>以上是草稿當時的原提議，不代表行程已建立；日期與時段均為台灣時間。</p>
      </details>
    </section>}
    <div className={styles.actions}>
      {!restored && <button type="button" className={styles.primary} onClick={() => onRestore()}>恢復平移草稿</button>}
      <button type="button" className={styles.secondary} onClick={() => onDiscard()}>捨棄平移草稿</button>
    </div>
    {status && <p className={styles.notice} role="status">{status}</p>}
  </section>;
}
