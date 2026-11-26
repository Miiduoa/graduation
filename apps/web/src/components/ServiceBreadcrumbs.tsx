'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { visibleCampusServices } from '@/lib/campusServices';
import {
  campusServiceHref,
  campusServiceMatches,
  useCampusNavigationSearch,
} from '@/lib/campusNavigation';
import { PRIMARY_DESTINATIONS, primaryNavigationSection } from '@/lib/primaryNavigation';
import { teacherCourseWorkspacePath } from '@/lib/campusNavigationLinks';
import { useSchoolLmsReadonlyEnabled } from './SchoolLmsReadonlyProvider';
import { backToDirectoryIfAdjacent, useDirectoryVisit } from './DirectoryVisit';
import { isCurrentTabNavigationClick } from '@/lib/currentTabNavigation';
import styles from './ServiceBreadcrumbs.module.css';

/** A stable way back to the section, including when a detail page was opened from a link. */
export function ServiceBreadcrumbs({ title }: { title?: string }) {
  const pathname = usePathname();
  const visit = useDirectoryVisit();
  const params = useSearchParams();
  const context = useCampusNavigationSearch(params);
  const schoolLmsEnabled = useSchoolLmsReadonlyEnabled();
  const exploration = visit?.origin?.source === 'explore' ? visit.origin : null;
  const section = PRIMARY_DESTINATIONS.find(
    (item) => item.id === primaryNavigationSection(pathname),
  ) ?? (exploration ? PRIMARY_DESTINATIONS.find((item) => item.id === 'life') : undefined);
  if (!pathname || !section || (!exploration && (section.href === pathname || section.id === 'today'))) return null;

  const origin = exploration ?? (visit?.origin?.journey === section.id ? visit.origin : null);
  const services = visibleCampusServices(schoolLmsEnabled);
  const service = services
    .filter((item) => campusServiceMatches(item.href, pathname, params))
    .sort((first, second) => second.href.length - first.href.length)[0];
  const parentHref = service?.parentHref ?? service?.href;
  const workspacePath = teacherCourseWorkspacePath(pathname);
  const schoolCoursePath = pathname.match(/^(\/course\/[^/]+)(?:\/|$)/u)?.[1];
  const schoolGroups =
    section.id === 'study' &&
    (pathname === '/groups' || pathname.startsWith('/groups/'));
  // Catalog grouping does not change a course's account or data source.
  // School workspaces must return to their own course/group, not Google Classroom.
  const parent = workspacePath
    ? { href: workspacePath, name: '課程工作台' }
    : schoolCoursePath
      ? { href: schoolCoursePath, name: '課程內容' }
      : schoolGroups
        ? services.find((item) => item.href === '/groups')
        : services.find((item) => item.href === parentHref);
  const parentPath = parent?.href.split(/[?#]/, 1)[0];
  // Tabs of one page are siblings, not a hierarchy (feedback must not lead into school-only grades).
  const parentIsCurrent = parentPath === pathname;
  const showParent = parent && parent.href !== section.href && !parentIsCurrent;
  const currentLabel = title || service?.name;
  if (!currentLabel) return null;

  return (
    <nav className={styles.breadcrumbs} aria-label="目前位置">
      <ol>
        <li>
          <Link
            href={origin?.returnHref ?? campusServiceHref(section.href, context)}
            replace={origin ? true : undefined}
            onClick={(event) => {
              if (!origin || !isCurrentTabNavigationClick(event, event.currentTarget)) return;
              // Use Back when the browser confirms the immediately preceding entry.
              // Otherwise the link itself is a known directory URL with its filters.
              if (backToDirectoryIfAdjacent(origin)) {
                event.preventDefault();
              } else {
                visit?.beginReturn();
              }
            }}
          >
            {origin?.source === 'explore' ? '返回探索' : origin
              ? `返回${origin.returnHref.split('?')[0] === '/life' ? '生活' : section.label}目錄` : section.label}
          </Link>
        </li>
        {showParent && parent.name !== currentLabel ? (
          <li>
            <span aria-hidden="true">/</span>
            <Link href={campusServiceHref(parent.href, context)}>{parent.name}</Link>
          </li>
        ) : null}
        <li>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{currentLabel}</span>
        </li>
      </ol>
    </nav>
  );
}
