'use client';

import { useSchoolLmsReadonlyEnabled } from '@/components/SchoolLmsReadonlyProvider';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useLayoutEffect, useRef } from 'react';
import {
  ACADEMIC_LMS_SECTIONS,
  ACADEMIC_SECTIONS,
  academicNavigationPath,
} from '@/lib/academicSections';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import { CampusIcon } from '@/components/CampusIcon';
import styles from './AcademicNavigation.module.css';

function revealSection(list: HTMLUListElement, link: HTMLElement | null) {
  if (!link || !list.contains(link) || list.clientWidth === 0) return;
  // Leave room for the focus ring. Adjust only this strip: scrollIntoView can
  // also move the page and disturb a restored reading position.
  const gutter = 6;
  const listBounds = list.getBoundingClientRect();
  const linkBounds = link.getBoundingClientRect();
  const left = listBounds.left + list.clientLeft + gutter;
  const right = listBounds.left + list.clientLeft + list.clientWidth - gutter;
  const offset =
    linkBounds.width > right - left || linkBounds.left < left
      ? linkBounds.left - left
      : linkBounds.right > right
        ? linkBounds.right - right
        : 0;
  if (Math.abs(offset) < 1) return;
  list.scrollLeft = Math.max(
    0,
    Math.min(list.scrollWidth - list.clientWidth, list.scrollLeft + offset),
  );
}

function AcademicLinks({
  pathname,
  schoolLmsEnabled,
}: {
  pathname: string;
  schoolLmsEnabled: boolean;
}) {
  const sectionsRef = useRef<HTMLUListElement>(null);
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

  useLayoutEffect(() => {
    const list = sectionsRef.current;
    if (!list) return;
    const revealCurrent = () => {
      const focused = document.activeElement;
      revealSection(
        list,
        focused instanceof HTMLAnchorElement && list.contains(focused)
          ? focused
          : list.querySelector<HTMLAnchorElement>('[aria-current="page"]'),
      );
    };
    revealSection(list, list.querySelector<HTMLAnchorElement>('[aria-current="page"]'));
    // Observing the links also catches larger text and font changes that move
    // a later section without changing the strip's own width.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(revealCurrent);
    observer?.observe(list);
    list.querySelectorAll('a').forEach((link) => observer?.observe(link));
    window.addEventListener('resize', revealCurrent);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', revealCurrent);
    };
  }, [pathname, schoolLmsEnabled]);

  return (
    <nav className={styles.navigation} aria-label="課務導覽">
      <ul
        ref={sectionsRef}
        className={styles.sections}
        onFocusCapture={(event) => {
          if (event.target instanceof HTMLAnchorElement) {
            revealSection(event.currentTarget, event.target);
          }
        }}
      >
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
