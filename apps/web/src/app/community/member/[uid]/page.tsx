'use client';

import { useParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import { CommunityAccess } from '../../_components/CommunityAccess';
import { CreatorProfile } from '../../_components/CreatorProfile';

export default function MemberCreatorPage() {
  const params = useParams<{ uid: string }>();
  const memberUid = params?.uid;
  const { schoolId, schoolName, ready } = useBrowsingSchoolPageContext();
  return (
    <SiteShell title="校園個人頁" subtitle="看看這位同學公開分享的內容。" schoolName={ready ? schoolName : undefined}>
      {!ready ? <SchoolScopePlaceholder /> : !memberUid || memberUid.includes('/') ? (
        <p role="alert">無法開啟這個個人頁。</p>
      ) : (
        <CommunityAccess>
          <CreatorProfile schoolId={schoolId} schoolName={schoolName} memberUid={memberUid} />
        </CommunityAccess>
      )}
    </SiteShell>
  );
}
