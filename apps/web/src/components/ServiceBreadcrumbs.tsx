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
import { useSchoolLmsReadonlyEnabled } from './SchoolLmsReadonlyProvider';
import styles from './ServiceBreadcrumbs.module.css';

/** A stable way back to the section, including when a detail page was opened from a link. */
export function ServiceBreadcrumbs({ title }: { title?: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const context = useCampusNavigationSearch(params);
  const schoolLmsEnabled = useSchoolLmsReadonlyEnabled();
  const section = PRIMARY_DESTINATIONS.find(
    (item) => item.id === primaryNavigationSection(pathname),
  );
  if (!pathname || !section || section.href === pathname || section.id === 'today') return null;

  const services = visibleCampusServices(schoolLmsEnabled);
  const service = services
    .filter((item) => campusServiceMatches(item.href, pathname, params))
    .sort((first, second) => second.href.length - first.href.length)[0];
  const parentHref = service?.parentHref ?? service?.href;
  const parent = services.find((item) => item.href === parentHref);
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
          <Link href={campusServiceHref(section.href, context)}>{section.label}</Link>
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
