'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import styles from './academic.module.css';

export const GRADES_FEEDBACK_TAB = 'feedback';
export const GRADES_SEMESTER_HREF = '/grades';
export const GRADES_FEEDBACK_HREF = '/grades?tab=feedback';

export function isGradesFeedbackTab(tab: string | null | undefined): boolean {
  return tab === GRADES_FEEDBACK_TAB;
}

export function GradesTabs({ active }: { active: 'semester' | 'feedback' }) {
  const search = useCampusNavigationSearch(useSearchParams());
  return (
    <nav className={styles.navigation} aria-label="成績分段">
      <Link
        href={campusServiceHref(GRADES_SEMESTER_HREF, search)}
        aria-current={active === 'semester' ? 'page' : undefined}
      >
        學期成績
      </Link>
      <Link
        href={campusServiceHref(GRADES_FEEDBACK_HREF, search)}
        aria-current={active === 'feedback' ? 'page' : undefined}
      >
        課堂回饋
      </Link>
    </nav>
  );
}
