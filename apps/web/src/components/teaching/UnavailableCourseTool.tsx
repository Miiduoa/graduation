'use client';

import Link from 'next/link';
import { use } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';

export type CourseToolProps = {
  params: Promise<{ courseId: string }>;
  searchParams?: Promise<{ school?: string; schoolId?: string }>;
};

export function UnavailableCourseTool({ title, ...props }: CourseToolProps & { title: string }) {
  const { courseId } = use(props.params);
  const searchParams = props.searchParams ? use(props.searchParams) : undefined;
  const { schoolName, schoolSearch } = resolveSchoolPageContext(searchParams);
  return (
    <SiteShell title={title} schoolName={schoolName}>
      <section className="card" style={{ padding: 24 }}>
        <h2>這項教學工具尚未開放</h2>
        <p className="sectionText">目前可以在課程工作台查看教材、作業與成績，並進行課堂點名。</p>
        <Link
          className="btn primary"
          href={`/teacher/course/${encodeURIComponent(courseId)}${schoolSearch}`}
        >
          返回課程工作台
        </Link>
      </section>
    </SiteShell>
  );
}
