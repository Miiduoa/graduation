'use client';

import { useAuth } from '@/components/AuthGuard';
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

export default function MyCreatorPage() {
  const { schoolId, schoolName, ready } = useBrowsingSchoolPageContext();
  return (
    <SiteShell title="我的社群頁" subtitle="分享日常，整理你公開發表的內容。" schoolName={ready ? schoolName : undefined}>
      {ready ? (
        <CommunityAccess>
          <MyCreatorContent key={schoolId} schoolId={schoolId} schoolName={schoolName} />
        </CommunityAccess>
      ) : <SchoolScopePlaceholder />}
    </SiteShell>
  );
}
