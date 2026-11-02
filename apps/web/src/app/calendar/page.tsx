'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { PersonalCalendar } from '@/components/calendar/PersonalCalendar';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import styles from './calendarScope.module.css';

const DESTINATIONS = [
  { href: '/events', label: '校園活動', description: '公開活動與講座' },
  { href: '/calendar', label: '個人行程', description: '自己新增或匯入的活動與考試' },
  { href: '/timetable', label: '我的課表', description: '每週上課時間與教室' },
] as const;

function CalendarScopeNavigation() {
  const params = useSearchParams();
  const schoolSearch = useCampusNavigationSearch(params);

  return (
    <nav className={styles.navigation} aria-label="行事曆與課表">
      <ul className={styles.destinations}>
        {DESTINATIONS.map(({ href, label, description }) => (
          <li key={href}>
            {href === '/calendar' ? (
              <span className={styles.destination} aria-current="page">
                <span className={styles.label}>{label}</span>
                <span className={styles.description}>{description}</span>
              </span>
            ) : (
              <Link
                href={campusServiceHref(href, schoolSearch)}
                className={styles.destination}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className={styles.label}>{label}</span>
                <span className={styles.description}>{description}</span>
                <span className={styles.description}>另開分頁</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function CalendarPage() {
  return (
    <SiteShell
      title="個人行事曆"
      subtitle="手動新增或匯入的活動與考試。上課時間請到「我的課表」查看。"
    >
      <CalendarScopeNavigation />
      <PersonalCalendar />
    </SiteShell>
  );
}
