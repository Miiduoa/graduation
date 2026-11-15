'use client';

import { useId } from 'react';
import { comparePlanRevision, type PlanComparisonEvent, type PlanComparisonField, type PlanModification } from './planComparison';
import styles from './AssistantPlanComparison.module.css';

const MATCH_BASIS: Record<PlanModification['basis'], string> = {
  title: '依兩份提議中唯一相同的名稱對照。',
  schedule: '依兩份提議中唯一相同的日期與時段對照。',
  both: '依兩份提議中唯一相同的名稱、日期與時段對照。',
};

const FIELD_LABELS: Record<PlanComparisonField, string> = {
  title: '名稱', date: '開始日期', endDate: '結束日期', allDay: '全天安排',
  startTime: '開始時間', endTime: '結束時間',
};

function eventWhen(event: PlanComparisonEvent): string {
  if (event.allDay) return `${event.date} 起 · 全天（至 ${event.endDate}，不含結束日）`;
  return `${event.date} ${event.startTime} – ${event.endDate} ${event.endTime}（台灣時間）`;
}

function fieldValue(field: PlanComparisonField, event: PlanComparisonEvent): string {
  switch (field) {
    case 'allDay': return event.allDay ? '全天' : '指定時段';
    case 'startTime': return event.allDay ? '不適用（全天）' : `${event.date} ${event.startTime}（台灣時間）`;
    case 'endTime': return event.allDay ? '不適用（全天）' : `${event.endDate} ${event.endTime}（台灣時間）`;
    case 'endDate': return event.endDate + (event.allDay ? '（不含結束日）' : '');
    case 'date': return event.date;
    case 'title': return event.title;
  }
}

function EventList({ label, events }: { label: string; events: PlanComparisonEvent[] }) {
  return <ol aria-label={label} className={styles.events}>
    {events.map((event, index) => <li key={index}>
      <strong>{event.title}</strong>
      <span>{eventWhen(event)}</span>
    </li>)}
  </ol>;
}

export function AssistantPlanComparison({ before, after }: { before: unknown; after: unknown }) {
  const headingId = useId();
  const comparison = comparePlanRevision(before, after);
  const available = comparison.kind === 'available' ? comparison : null;
  const ambiguous = !!available && (available.ambiguous.before.length > 0 || available.ambiguous.after.length > 0);
  const same = !!available && !available.modified.length && !available.added.length && !available.removed.length && !ambiguous;
  return <section className={styles.panel} aria-labelledby={headingId}>
    <h3 id={headingId}>這次提議改了什麼</h3>
    <p className={styles.note}>以下只比較前後兩份提議；行程是否已寫入，請查看確認卡的執行結果。</p>
    {!available ? <div className={styles.notice}>
      <p>目前無法比較這兩份提議，請查看各自的確認卡。</p>
      {comparison.kind === 'unavailable' && <p>{comparison.message}</p>}
    </div> : <>
      {same && <p className={styles.summary}>{available.unchanged > 0 ? '兩份提議的安排內容相同。' : '沒有行程可比較。'}</p>}
      {available.unchanged > 0 && <p className={styles.summary}>內容未變更：{available.unchanged} 項。</p>}
      {available.orderChanged && <p className={styles.note}>顯示順序與原提議不同，請依新版確認卡的順序核對。</p>}
      {available.modified.length > 0 && <div className={styles.group}>
        <h4>內容有變更：{available.modified.length} 項</h4>
        <ul aria-label="內容變更的提議" className={styles.changes}>
          {available.modified.map((change, index) => <li key={index} aria-label={change.after.title}>
            <p className={styles.eventTitle}>{change.after.title}</p>
            <p className={styles.note}>{MATCH_BASIS[change.basis]}</p>
            <dl className={styles.fields}>
              {change.fields.map(({ field }) => <div key={field} className={styles.field}>
                <dt>{FIELD_LABELS[field]}</dt>
                <dd>
                  <div><span className={styles.valueLabel}>原提議：</span><span>{fieldValue(field, change.before)}</span></div>
                  <div><span className={styles.valueLabel}>新提議：</span><span>{fieldValue(field, change.after)}</span></div>
                </dd>
              </div>)}
            </dl>
          </li>)}
        </ul>
      </div>}
      {available.added.length > 0 && <div className={styles.group}>
        <h4>新提議新增</h4>
        <EventList label="新提議新增" events={available.added} />
      </div>}
      {available.removed.length > 0 && <div className={styles.group}>
        <h4>新提議不再列入</h4>
        <p className={styles.note}>只表示新版提議未列入這些項目，不代表刪除既有行程。</p>
        <EventList label="新提議不再列入" events={available.removed} />
      </div>}
      {ambiguous && <div className={styles.group}>
        <h4>無法可靠逐筆對照</h4>
        <p className={styles.note}>以下項目無法確定如何一一對應，請分別核對原提議與新提議。</p>
        <div className={styles.separate}>
          <div><p className={styles.eventTitle}>原提議</p>
            <EventList label="原提議行程" events={available.ambiguous.before} /></div>
          <div><p className={styles.eventTitle}>新提議</p>
            <EventList label="新提議行程" events={available.ambiguous.after} /></div>
        </div>
      </div>}
    </>}
  </section>;
}
