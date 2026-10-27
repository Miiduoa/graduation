import Link from 'next/link';
import styles from './academic.module.css';

export function AcademicNavigation({ path, schoolSearch }: { path: string; schoolSearch: string }) {
  return (
    <nav className={styles.navigation} aria-label="我的課務">
      {([
        ['/timetable', '我的課表'],
        ['/school-courses', 'WOW Class 課程'],
        ['/grades', '成績紀錄'],
        ['/credit-planner', '學分規劃'],
      ] as const).map(([href, name]) => (
        <Link key={href} href={`${href}${schoolSearch}`} aria-current={path === href ? 'page' : undefined}>
          {name}
        </Link>
      ))}
    </nav>
  );
}
