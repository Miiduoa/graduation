'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { TransitExplorer } from '@/components/TransitExplorer';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';

export function BusContext({ availabilityNotice }: { availabilityNotice?: ReactNode }) {
  const search = useSearchParams();
  const selection = useOptionalSelectedSchool();
  const browse = useCampusBrowseContext({
    school: search.get('school') ?? undefined,
    schoolId: search.get('schoolId') ?? undefined,
    campus: search.get('campus') ?? undefined,
  });
  const schoolId = browse.status === 'ready' ? browse.schoolId : null;
  const schoolName = browse.status === 'ready' ? browse.schoolName : '';
  const schoolSearch = browse.schoolSearch;
  return (
    <SiteShell schoolName={schoolId ? schoolName : undefined}>
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
          {browse.status === 'error' && selection?.onRetryCatalog ? (
            <button className="btn" type="button" onClick={selection.onRetryCatalog}>
              重新讀取
            </button>
          ) : null}
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
