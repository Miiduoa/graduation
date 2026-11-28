import Link from 'next/link';
import { formatClock } from '@campus/shared/src/pickNextAction';
import styles from './StudentToday.module.css';

export type TodayClassCalendarConflictItem = {
  classTitle: string;
  eventTitle: string;
  startAt: number;
  endAt: number;
  href: string;
};

export function TodayClassCalendarConflict({ conflict }: { conflict: TodayClassCalendarConflictItem }) {
  return (
    <section className={styles.conflict} aria-labelledby="today-conflict-title" data-testid="today-conflict">
      <h2 id="today-conflict-title" className={styles.sectionTitle}>
        nuni 發現今天有時間重疊
      </h2>
      <p>
        課程「{conflict.classTitle}」與個人行程「{conflict.eventTitle}」重疊：
        {formatClock(conflict.startAt)}–{formatClock(conflict.endAt)}（台北時間）
      </p>
      <p className={styles.conflictSource}>來自你儲存的個人課表與行事曆</p>
      <Link className={styles.conflictLink} prefetch={false} href={conflict.href}>
        查看這筆行程
      </Link>
    </section>
  );
}
