'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { TransitExplorer } from '@/components/TransitExplorer';
import { fallbackBusSchool } from '@/lib/defaultBrowseSchool';
import { hasCampusNext } from '@/lib/transit';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';

export function BusContext({ availabilityNotice }: { availabilityNotice?: ReactNode }) {
  const search = useSearchParams();
  const browse = useCampusBrowseContext({
    school: search.get('school') ?? undefined,
    schoolId: search.get('schoolId') ?? undefined,
    campus: search.get('campus') ?? undefined,
  });
  const { schoolId, schoolName } = fallbackBusSchool(browse.schoolId, browse.schoolName, browse.status);
  const schoolSearch = browse.schoolId
    ? browse.schoolSearch
    : schoolId
      ? `?${new URLSearchParams({ schoolId, campus: schoolId }).toString()}`
      : browse.schoolSearch;
  return (
    <SiteShell title="公車與交通" subtitle={schoolId && hasCampusNext(schoolId) ? '校門口這四班現在幾分到。' : '找站牌、確認方向，再出發。'} schoolName={schoolName}>
      {availabilityNotice}
      {browse.status === 'loading' || browse.status === 'error' || !schoolId ? (
        <section className="card" role="status">
          <h2>
            {browse.status === 'loading'
              ? '正在確認所選校園…'
              : browse.status === 'error'
                ? '無法確認所選校園'
                : '請先選擇一所學校'}
          </h2>
          <p>選擇校園後才能查看對應的站牌資訊，不會載入其他學校的路線。</p>
        </section>
      ) : (
        <TransitExplorer
          key={schoolId}
          schoolId={schoolId}
          schoolName={schoolName}
          legacy={
            <p>
              <Link href={`/bus/registered${schoolSearch}`}>開啟已登錄的校園路線查詢 →</Link>
            </p>
          }
        />
      )}
    </SiteShell>
  );
}
