'use client';

import Link from 'next/link';
import styles from './academic.module.css';

export const GRADES_FEEDBACK_TAB = 'feedback';
export const GRADES_SEMESTER_HREF = '/grades';
export const GRADES_FEEDBACK_HREF = '/grades?tab=feedback';

export function isGradesFeedbackTab(tab: string | null | undefined): boolean {
  return tab === GRADES_FEEDBACK_TAB;
}

export function GradesTabs({ active }: { active: 'semester' | 'feedback' }) {
  return (
    <nav className={styles.navigation} aria-label="成績分段">
      <Link
        href={GRADES_SEMESTER_HREF}
        aria-current={active === 'semester' ? 'page' : undefined}
      >
        學期成績
      </Link>
      <Link
        href={GRADES_FEEDBACK_HREF}
        aria-current={active === 'feedback' ? 'page' : undefined}
      >
        課堂回饋
      </Link>
    </nav>
  );
}
