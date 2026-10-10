'use client';

import Link from 'next/link';
import { use } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import home from '@/app/home.module.css';
import styles from '@/app/servicePages.module.css';

export type CourseToolProps = {
  params: Promise<{ courseId: string }>;
  searchParams?: Promise<{ school?: string; schoolId?: string }>;
};

export function UnavailableCourseTool({ title, ...props }: CourseToolProps & { title: string }) {
  const { courseId } = use(props.params);
  const searchParams = props.searchParams ? use(props.searchParams) : undefined;
  const { schoolName, schoolSearch } = resolveSchoolPageContext(searchParams);
  return (
    <SiteShell title={title} schoolName={`${schoolName} · 教學工作台`}>
      <section className={styles.stateCard} aria-labelledby="course-tool-state">
        <h2 id="course-tool-state">{title}尚未開放</h2>
        <p>目前可以在課程工作台查看教材、發布與批改作業，或接續課堂點名。</p>
        <div className={styles.actions}>
          <Link
            className={home.primary}
            href={`/teacher/course/${encodeURIComponent(courseId)}${schoolSearch}`}
          >
            回課程工作台
          </Link>
        </div>
      </section>
    </SiteShell>
  );
}
