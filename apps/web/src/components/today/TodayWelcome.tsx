import Link from 'next/link';
import { CampusIcon, type CampusIconName } from '@/components/CampusIcon';
import { buildCampusNavigationSearch, campusServiceHref } from '@/lib/campusNavigation';
import { loginHref } from '@/lib/navigation';
import styles from './TodayWelcome.module.css';

const shortcuts: ReadonlyArray<{
  href: string;
  label: string;
  detail: string;
  icon: CampusIconName;
}> = [
  { href: '/map', label: '找教室', detail: '校園地圖', icon: 'map' },
  { href: '/bus', label: '查公車', detail: '路線與到站時間', icon: 'bus' },
  { href: '/cafeteria', label: '找餐廳', detail: '菜單與營業資訊', icon: 'cafeteria' },
  { href: '/library', label: '查館藏', detail: '借閱與續借入口', icon: 'library' },
];

export function TodayWelcome({
  importHref,
  timetableHref,
  hasTimetable = false,
}: {
  importHref: string;
  timetableHref: string;
  hasTimetable?: boolean;
}) {
  const params = new URL(timetableHref, 'https://campus.local').searchParams;
  const campusSearch = buildCampusNavigationSearch(params);

  return (
    <section className={styles.welcome} aria-labelledby="today-welcome-title">
      <div className={styles.intro}>
        <span className={styles.label}>
          <CampusIcon name="timetable" size={18} />
          你的校園日常
        </span>
        <h2 id="today-welcome-title">{hasTimetable ? '課表準備好了。' : '先把課表放進來。'}</h2>
        <p className={styles.description}>
          {hasTimetable
            ? '接著看看這週的上課時間與教室。需要出門、找書或吃飯，校園服務也都在這裡。'
            : '匯入截圖或檔案，也可以手動新增課程。把上課時間和教室整理好，今天的安排就清楚了。'}
        </p>
        <div className={styles.actions}>
          <Link href={hasTimetable ? timetableHref : importHref} className={styles.primary}>
            <CampusIcon name={hasTimetable ? 'timetable' : 'import'} size={18} />
            {hasTimetable ? '查看這週課表' : '匯入我的課表'}
          </Link>
          <Link href={hasTimetable ? importHref : timetableHref} className={styles.secondary}>
            {hasTimetable ? '更新匯入紀錄' : '手動建立課表'} <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <p className={styles.signIn}>
          已加入平台課程？{' '}
          <Link href={loginHref(campusServiceHref('/', campusSearch))}>登入看課程待辦</Link>
        </p>
      </div>
      <nav className={styles.shortcuts} aria-label="常用校園服務">
        <div className={styles.shortcutHeading}>
          <h3>現在就能用</h3>
          <span>免登入</span>
        </div>
        <div className={styles.shortcutGrid}>
          {shortcuts.map((item) => (
            <Link
              key={item.href}
              href={campusServiceHref(item.href, campusSearch)}
              className={styles.shortcut}
            >
              <CampusIcon name={item.icon} size={22} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
              <span className={styles.arrow} aria-hidden="true">
                ↗
              </span>
            </Link>
          ))}
        </div>
      </nav>
    </section>
  );
}
