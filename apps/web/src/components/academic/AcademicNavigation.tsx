'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import { CampusIcon } from '@/components/CampusIcon';
import styles from './AcademicNavigation.module.css';

const SECTIONS = [
  { path: '/timetable', label: '課表' },
  { path: '/school-courses', label: 'WOW Class 課程' },
  { path: '/school-lms', label: '作業與教材' },
  { path: '/grades', label: '成績' },
  { path: '/credit-planner', label: '學分規劃' },
  { path: '/calendar', label: '行事曆' },
] as const;

function AcademicLinks({ pathname }: { pathname: string }) {
  const params = useSearchParams();
  const campusSearch = useCampusNavigationSearch(params);
  const term = params?.get('term');
  const validTerm = term === 'manual' || (term && /^\d{2,4}\|[^|]{1,30}$/u.test(term));
  const timetablePath =
    term && validTerm ? `/timetable?${new URLSearchParams({ term })}` : '/timetable';
  const requestedKind = params?.get('kind');
  const importKind =
    pathname === '/calendar'
      ? 'events'
      : pathname === '/grades' || pathname === '/credit-planner'
        ? 'grades'
        : pathname === '/import' && ['timetable', 'grades', 'events'].includes(requestedKind || '')
          ? requestedKind
          : 'timetable';

  return (
    <nav className={styles.navigation} aria-label="課務導覽">
      <ul className={styles.sections}>
        {SECTIONS.map(({ path, label }) => (
          <li key={path}>
            <Link
              href={campusServiceHref(path === '/timetable' ? timetablePath : path, campusSearch)}
              className={styles.section}
              aria-current={pathname === path ? 'page' : undefined}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href={campusServiceHref(`/import?kind=${importKind}`, campusSearch)}
        className={styles.importAction}
        aria-current={pathname === '/import' ? 'page' : undefined}
      >
        <CampusIcon name="import" size={17} />
        匯入資料
      </Link>
    </nav>
  );
}

export function AcademicNavigation() {
  const currentPath = usePathname();
  const pathname = currentPath === '/credit-planner/review' ? '/credit-planner'
    : currentPath?.startsWith('/school-lms/') ? '/school-lms'
    : currentPath;
  if (
    !pathname ||
    (pathname !== '/import' && !SECTIONS.some((section) => section.path === pathname))
  )
    return null;
  return <AcademicLinks pathname={pathname} />;
}
