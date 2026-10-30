'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { GradesTabs, isGradesFeedbackTab } from '@/components/academic/GradesTabs';
import { PersonalImportSummary } from '@/components/imports/PersonalImportSummary';
import { StudentGradesPage } from '@/features/nuni/StudentGrades';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import styles from '@/components/academic/academic.module.css';

export default function GradesPage() {
  const searchParams = useSearchParams();
  const schoolSearch = useCampusNavigationSearch(searchParams);
  if (isGradesFeedbackTab(searchParams?.get('tab'))) {
    return <StudentGradesPage />;
  }
  return (
    <SiteShell title="成績" subtitle="整理個人成績紀錄，查看課堂回饋。">
      <GradesTabs active="semester" />
      <section className={styles.status} role="status">
        <h2>學校成績已不再同步</h2>
        <p>已匯入的個人成績仍會保留，你可以繼續查看、編輯或匯入資料。課堂作業與回饋請至課程空間查看。</p>
        <Link className="btn primary" href={campusServiceHref('/classroom', schoolSearch)}>
          前往課堂
        </Link>
      </section>
      <PersonalImportSummary kind="grades" />
    </SiteShell>
  );
}
