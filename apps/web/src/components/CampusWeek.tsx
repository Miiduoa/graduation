import styles from '@/app/home.module.css';

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const taipeiOffset = 8 * 60 * 60 * 1000;

export function CampusWeek({ now }: { now: Date | null }) {
  if (!now) return <div className={styles.weekPlaceholder} aria-hidden="true" />;

  const today = new Date(now.getTime() + taipeiOffset);
  const todayKey = today.toISOString().slice(0, 10);
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));

  return (
    <div className={styles.week} role="group" aria-label="本週日期，台灣時間">
      {weekdays.map((label, index) => {
        const date = new Date(monday);
        date.setUTCDate(monday.getUTCDate() + index);
        const key = date.toISOString().slice(0, 10);
        const current = key === todayKey;
        return (
          <time
            key={key}
            dateTime={key}
            className={current ? styles.weekToday : styles.weekDay}
            aria-current={current ? 'date' : undefined}
            aria-label={`${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日，星期${label}${current ? '，今天' : ''}`}
          >
            <span aria-hidden="true">{label}</span>
            <strong aria-hidden="true">{date.getUTCDate()}</strong>
            <i aria-hidden="true" />
          </time>
        );
      })}
    </div>
  );
}
