import Link from 'next/link';
import { CampusIcon, type CampusIconName } from '@/components/CampusIcon';
import { buildCampusNavigationSearch, campusServiceHref } from '@/lib/campusNavigationLinks';
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
  needsSchool = false,
  unsigned = true,
  needsCourse = false,
  campusSearch: serviceSearch,
}: {
  importHref: string;
  timetableHref: string;
  hasTimetable?: boolean;
  needsSchool?: boolean;
  unsigned?: boolean;
  needsCourse?: boolean;
  /** Public services follow the browsing campus, independently of the personal timetable. */
  campusSearch?: string;
}) {
  const params = new URL(timetableHref, 'https://campus.local').searchParams;
  const campusSearch = serviceSearch ?? buildCampusNavigationSearch(params);
  const title = needsSchool
    ? '選擇課表所屬校園'
    : hasTimetable
      ? '本週課表'
      : '建立第一份課表';

  return (
    <section className={styles.welcome} aria-labelledby="today-welcome-title">
      <div className={styles.intro}>
        <h2 id="today-welcome-title">{title}</h2>
        <p className={styles.description}>
          {needsSchool
            ? '選擇學校後就能建立課表。校園服務也開放訪客使用。'
            : hasTimetable
              ? '查看本週的上課時間與教室。'
              : '匯入課表截圖或檔案，下次打開就能查看上課時間與教室。'}
        </p>
        <div className={styles.actions}>
          <Link
            href={needsSchool || hasTimetable ? timetableHref : importHref}
            className={styles.primary}
          >
            <CampusIcon name={needsSchool || hasTimetable ? 'timetable' : 'import'} size={18} />
            {needsSchool ? '選校園、整理課表' : hasTimetable ? '查看這週課表' : '匯入我的課表'}
          </Link>
          <Link
            href={
              needsSchool
                ? campusServiceHref('/life', campusSearch)
                : hasTimetable
                  ? importHref
                  : timetableHref
            }
            className={styles.secondary}
          >
            {needsSchool ? '先看生活服務' : hasTimetable ? '更新匯入紀錄' : '手動建立課表'}
          </Link>
        </div>
        {unsigned ? (
          <p className={styles.signIn}>
            <Link href={loginHref(campusServiceHref('/', campusSearch))}>登入查看作業與通知</Link>
          </p>
        ) : needsCourse ? (
          <div className={styles.courseEntry}>
            <p>有 nuni 課程嗎？加入後，作業期限也會出現在首頁與行事曆。</p>
            <div className={styles.courseActions}>
              <Link href={campusServiceHref('/classroom', campusSearch)}>加入 nuni 課程</Link>
              <Link href={campusServiceHref('/calendar', campusSearch)}>查看行事曆</Link>
            </div>
          </div>
        ) : null}
      </div>
      <TodayServiceShortcuts campusSearch={campusSearch} />
    </section>
  );
}

export function TodayServiceShortcuts({
  campusSearch,
  standalone = false,
}: {
  campusSearch: string;
  standalone?: boolean;
}) {
  const Heading = standalone ? 'h2' : 'h3';
  return (
    <nav
      className={styles.shortcuts + (standalone ? ' ' + styles.standalone : '')}
      aria-label="常用校園服務"
    >
      <div className={styles.shortcutHeading}>
        <Heading>校園服務</Heading>
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
          </Link>
        ))}
      </div>
    </nav>
  );
}
