import type { CampusEvent } from '@/lib/campusEvents';
import { campusEventSourceLabel, formatCampusEventDateTime } from './eventPresentation';
import styles from './EventRegistrationTicket.module.css';

const stubDateFormatter = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: 'numeric',
  day: '2-digit',
  weekday: 'long',
});

/** Present only after the current registration and pending-operation checks have succeeded. */
export function EventRegistrationTicket({ event }: { event: CampusEvent }) {
  const hasStart = Number.isFinite(Date.parse(event.startsAt));
  const date = hasStart
    ? Object.fromEntries(
        stubDateFormatter.formatToParts(new Date(event.startsAt)).map(({ type, value }) => [type, value]),
      )
    : null;

  return (
    <section className={styles.ticket} aria-label="報名票根">
      <div className={styles.paper}>
        <div className={styles.main}>
          <div className={styles.heading}>
            <p className={styles.label}>報名票根</p>
            <span className={styles.stamp}>已報名</span>
          </div>
          <h4 className={styles.title}>{event.title}</h4>
          <p className={styles.source}>{campusEventSourceLabel(event.source)}</p>
          <dl className={styles.metadata}>
            <div>
              <dt>開始時間</dt>
              <dd>
                {hasStart ? (
                  <time dateTime={event.startsAt}>{formatCampusEventDateTime(event.startsAt)}</time>
                ) : '時間待公告'}
              </dd>
            </div>
            {event.endsAt && (
              <div>
                <dt>結束時間</dt>
                <dd><time dateTime={event.endsAt}>{formatCampusEventDateTime(event.endsAt)}</time></dd>
              </div>
            )}
            <div>
              <dt>活動地點</dt>
              <dd>{event.location?.trim() || '地點待公告'}</dd>
            </div>
            {event.organizer?.trim() && (
              <div>
                <dt>主辦單位</dt>
                <dd>{event.organizer}</dd>
              </div>
            )}
          </dl>
          <p className={styles.note}>時間皆為臺灣時間（UTC+8）</p>
        </div>
        <div className={styles.stub} aria-hidden="true">
          <p className={styles.stubLabel}>活動日期</p>
          {date ? (
            <div className={styles.date}>
              <p className={styles.month}>{date.year} 年 {date.month} 月</p>
              <p className={styles.day}>{date.day}</p>
              <p className={styles.weekday}>{date.weekday}</p>
            </div>
          ) : <p className={styles.unscheduled}>時間待公告</p>}
          <p className={styles.brand}>nuni</p>
        </div>
      </div>
    </section>
  );
}
