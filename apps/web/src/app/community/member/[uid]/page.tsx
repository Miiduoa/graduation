'use client';

import { Suspense } from 'react';

import { useParams, useSearchParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import { CommunityAccess } from '../../_components/CommunityAccess';
import { CreatorProfile } from '../../_components/CreatorProfile';

function MemberCreatorPageContent() {
  const params = useParams<{ uid: string }>();
  const memberUid = params?.uid;
  const requestedSchoolId = useSearchParams()?.get('schoolId');
  const { schoolId, schoolName, ready } = useBrowsingSchoolPageContext();
  const mismatch = ready && requestedSchoolId && requestedSchoolId !== schoolId;
  return (
    <SiteShell title="校園個人頁" subtitle="看看這位同學公開分享的內容。" schoolName={ready ? schoolName : undefined}>
      {!ready ? <SchoolScopePlaceholder /> : mismatch ? (
        <p role="alert">這個個人頁屬於另一所校園，請先切換到連結中的學校。</p>
      ) : !memberUid || memberUid.includes('/') ? (
        <p role="alert">無法開啟這個個人頁。</p>
      ) : (
        <CommunityAccess>
          <CreatorProfile schoolId={schoolId} schoolName={schoolName} memberUid={memberUid} />
        </CommunityAccess>
      )}
    </SiteShell>
  );
}

export default function MemberCreatorPage() {
  return (
    <Suspense fallback={<SiteShell title="校園個人頁"><SchoolScopePlaceholder /></SiteShell>}>
      <MemberCreatorPageContent />
    </Suspense>
  );
}
