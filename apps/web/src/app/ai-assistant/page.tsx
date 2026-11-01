'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { SchoolAccountRequired } from '@/components/SchoolAccountRequired';
import { useAuth } from '@/components/AuthGuard';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { CloudNavigationTask } from './CloudNavigationTask';
import styles from './assistant.module.css';

function AssistantRoute() {
  const { user, loading, error } = useAuth();
  const search = useSearchParams();
  const campus = useCampusBrowseContext({
    campus: search.get('campus') ?? undefined,
    schoolId: search.get('schoolId') ?? undefined,
    school: search.get('school') ?? undefined,
  });
  const initialDraft = (search.get('q') || '').slice(0, 240);
  if (campus.status !== 'ready' || !campus.schoolId) {
    return (
      <p role="status">
        {campus.status === 'loading'
          ? '正在確認校園…'
          : campus.status === 'error'
            ? '無法載入校園資料，請稍後重試。'
            : '請先選擇一所學校，再使用校園助理。'}
      </p>
    );
  }
  if (loading) return <p role="status">正在確認登入狀態…</p>;
  if (error) return <p role="alert">無法確認登入狀態，請重新整理後再試。</p>;
  if (!user)
    return (
      <SchoolAccountRequired
        returnUrl={`/ai-assistant${search.size ? `?${search.toString()}` : ''}`}
        alternative="校園資訊可先從地圖、公車和公開公告查。"
      />
    );
  return (
    <>
      <CloudNavigationTask
        key={JSON.stringify([user.uid, campus.schoolId, initialDraft])}
        userId={user.uid}
        initialDraft={initialDraft}
        schoolId={campus.schoolId}
      />
      <nav className={styles.serviceLinks} aria-label="其他校園服務">
        <Link href={`/map${campus.schoolSearch}`}>校園地圖</Link>
        <Link href={`/school-info${campus.schoolSearch}`}>校園資訊</Link>
        <Link href={`/timetable${campus.schoolSearch}`}>我的課表</Link>
      </nav>
    </>
  );
}

export default function AssistantPage() {
  return (
    <SiteShell title="助理" subtitle="先確認資料，再規劃校園路線。">
      <Suspense fallback={<p role="status">載入中…</p>}>
        <AssistantRoute />
      </Suspense>
    </SiteShell>
  );
}
