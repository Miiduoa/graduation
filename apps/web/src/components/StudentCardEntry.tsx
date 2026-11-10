'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import styles from './StudentCardEntry.module.css';

export function StudentCardEntry() {
  const search = useCampusNavigationSearch(useSearchParams());
  return (
    <Link href={campusServiceHref('/student-card', search)} className={styles.entry}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="2" y="5" width="20" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="8" cy="10" r="1.5" fill="currentColor" />
        <path
          d="M5.5 15c0-3 5-3 5 0M14 10h4M14 14h4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span>數位學生證</span>
      <span className={styles.action}>
        開啟卡片 <span aria-hidden="true">↗</span>
      </span>
    </Link>
  );
}
