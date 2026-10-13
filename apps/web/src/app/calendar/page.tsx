'use client';

import Link from 'next/link';
import { useState } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { usePersonalImportScope, usePersonalImports } from '@/lib/usePersonalImports';
import styles from '@/components/imports/PersonalImport.module.css';

function PersonalAgenda() {
  const context = usePersonalImportScope();
  const ledger = usePersonalImports(context.scope, !context.loading);
  const [month, setMonth] = useState('');
  const events = ledger.records
    .filter(
      (row) =>
        row.kind === 'events' &&
        (!month ||
          row.date?.startsWith(month) ||
          (row.date &&
            row.date < `${month}-01` &&
            (row.allDay
              ? (row.endDate || '') > `${month}-01`
              : (row.endDate || '') >= `${month}-01`))),
    )
    .sort((a, b) =>
      `${a.date} ${a.startTime || ''}`.localeCompare(`${b.date} ${b.startTime || ''}`),
    );
  return (
    <div className={styles.root}>
      <nav className={styles.nav}>
        <Link href="/timetable">我的課表</Link>
        <Link href="/import?kind=events">匯入與編輯行程</Link>
      </nav>
      <section className={styles.panel}>
        <div className={styles.heading}>
          <h2>活動、考試與自己的安排</h2>
          <Link className="btn primary" href="/import?kind=events">
            從截圖或檔案匯入
          </Link>
        </div>
        <p className={styles.note}>
          這裡是 {context.schoolName}{' '}
          的個人行程，只儲存在這台裝置。匯入不等於完成報名，也不會替你設定系統提醒。
        </p>
        <label className={styles.field}>
          查看月份
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        {ledger.error && <p role="alert">{ledger.error}</p>}
        {context.loading || ledger.loading ? (
          <p role="status">正在讀取行程…</p>
        ) : !events.length ? (
          <p className={styles.empty}>
            這裡還沒有行程。把活動公告或考試時間帶進來，就能按日期查看。
          </p>
        ) : (
          <ul className={styles.saved}>
            {events.map((event) => (
              <li key={event.id}>
                <div>
                  <time dateTime={event.date}>
                    {event.date}
                    {event.endDate && event.endDate !== event.date
                      ? ` 至 ${event.endDate}${event.allDay ? '（不含結束日）' : ''}`
                      : ''}
                  </time>
                  <h3>{event.title}</h3>
                  <p>
                    {event.allDay ? '全天' : `${event.startTime}–${event.endTime}`} ·{' '}
                    {event.location || '地點未填'}
                  </p>
                  <small>自行匯入 · {event.source.name || '手動／貼上文字'}</small>
                </div>
                <Link className="btn" href="/import?kind=events">
                  編輯行程
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
export default function CalendarPage() {
  return (
    <SiteShell title="個人行事曆" subtitle="自己的活動與考試，依日期排好。">
      <PersonalAgenda />
    </SiteShell>
  );
}
