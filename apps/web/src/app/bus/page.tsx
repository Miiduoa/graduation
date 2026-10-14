'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { TransitExplorer } from '@/components/TransitExplorer';
import { usePublicSchoolContext } from '@/lib/usePublicSchoolContext';
import { PublicCampusStatus } from '@/components/PublicCampusStatus';

function BusContext() {
  const search = useSearchParams();
  const { schoolId, schoolName, status } = usePublicSchoolContext({
    school: search.get('school') ?? undefined,
    schoolId: search.get('schoolId') ?? undefined,
    campus: search.get('campus') ?? undefined,
  });
  if (status !== 'ready') {
    return <SiteShell title="公車與交通"><PublicCampusStatus status={status} service="公車站牌" /></SiteShell>;
  }
  return (
    <SiteShell title="公車與交通" subtitle="找站牌、確認方向，再出發。" schoolName={schoolName}>
      <TransitExplorer
        key={schoolId}
        schoolId={schoolId}
        schoolName={schoolName}
        legacy={
          <p>
            <Link href="/bus/registered">開啟已登錄的校園路線查詢 →</Link>
          </p>
        }
      />
    </SiteShell>
  );
}

export default function BusPage() {
  return (
    <Suspense fallback={<SiteShell title="公車與交通"><p role="status">讀取校園交通資料…</p></SiteShell>}>
      <BusContext />
    </Suspense>
  );
}
