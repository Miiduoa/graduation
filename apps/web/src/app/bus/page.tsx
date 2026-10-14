'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { TransitExplorer } from '@/components/TransitExplorer';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';

function BusContext() {
  const search = useSearchParams();
  const { schoolId, schoolName, schoolSearch, status } = useCampusBrowseContext({
    school: search.get('school') ?? undefined,
    schoolId: search.get('schoolId') ?? undefined,
    campus: search.get('campus') ?? undefined,
  });
  return (
    <SiteShell title="公車與交通" subtitle="找站牌、確認方向，再出發。" schoolName={schoolName}>
      {status !== 'ready' || !schoolId ? (
        <section className="card" role="status">
          <h2>
            {status === 'loading'
              ? '正在確認所選校園…'
              : status === 'error'
                ? '無法確認所選校園'
                : '請先選擇一所學校'}
          </h2>
          <p>選擇校園後才能查看對應的站牌資訊，不會載入其他學校的路線。</p>
        </section>
      ) : (
        <TransitExplorer
          key={schoolId ?? 'all'}
          schoolId={schoolId}
          schoolName={schoolName || '不限校園'}
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

export default function BusPage() {
  return (
    <Suspense fallback={<SiteShell title="公車與交通"><p role="status">讀取校園交通資料…</p></SiteShell>}>
      <BusContext />
    </Suspense>
  );
}
