'use client';

import { useSchoolLmsReadonlyEnabled } from '@/components/SchoolLmsReadonlyProvider';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  ACADEMIC_LMS_SECTIONS,
  ACADEMIC_SECTIONS,
  academicNavigationPath,
} from '@/lib/academicSections';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import { CampusIcon } from '@/components/CampusIcon';
import styles from './AcademicNavigation.module.css';

function AcademicLinks({
  pathname,
  schoolLmsEnabled,
}: {
  pathname: string;
  schoolLmsEnabled: boolean;
}) {
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
  // 玩課雲課程清單可獨立開；玩課雲作業僅在唯讀旗標開啟時顯示，避免導向已 redirect 的死路。
  const sections = [
    ...ACADEMIC_SECTIONS,
    ACADEMIC_LMS_SECTIONS[0],
    ...(schoolLmsEnabled ? [ACADEMIC_LMS_SECTIONS[1]] : []),
  ];

  return (
    <nav className={styles.navigation} aria-label="課務導覽">
      <ul className={styles.sections}>
        {sections.map(({ path, label }) => (
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
  const schoolLmsEnabled = useSchoolLmsReadonlyEnabled();
  const pathname = academicNavigationPath(currentPath);
  if (!pathname) return null;
  return <AcademicLinks pathname={pathname} schoolLmsEnabled={schoolLmsEnabled} />;
}
