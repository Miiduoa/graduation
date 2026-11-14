'use client';

import { Suspense } from 'react';

import { useAuth } from '@/components/AuthGuard';
import { useSearchParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import { CommunityAccess } from '../_components/CommunityAccess';
import { CreatorProfile } from '../_components/CreatorProfile';

function MyCreatorContent({
  schoolId,
  schoolName,
}: {
  schoolId: string;
  schoolName: string;
}) {
  const { user } = useAuth();
  if (!user) return null;
  return <CreatorProfile schoolId={schoolId} schoolName={schoolName} memberUid={user.uid} />;
}

function MyCreatorPageContent() {
  const { schoolId, schoolName, ready } = useBrowsingSchoolPageContext();
  const requestedSchoolId = useSearchParams()?.get('schoolId');
  const mismatch = ready && requestedSchoolId && requestedSchoolId !== schoolId;
  return (
    <SiteShell title="我的社群頁" subtitle="分享日常，整理你公開發表的內容。" schoolName={ready ? schoolName : undefined}>
      {ready && mismatch ? (
        <p role="alert">這個社群頁的校園連結與目前選擇的學校不同，請先切換學校。</p>
      ) : ready ? (
        <CommunityAccess>
          <MyCreatorContent key={schoolId} schoolId={schoolId} schoolName={schoolName} />
        </CommunityAccess>
      ) : <SchoolScopePlaceholder />}
    </SiteShell>
  );
}

export default function MyCreatorPage() {
  return (
    <Suspense fallback={<SiteShell title="我的社群頁"><SchoolScopePlaceholder /></SiteShell>}>
      <MyCreatorPageContent />
    </Suspense>
  );
}
