'use client';

import { use } from 'react';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { PageLoadingCard } from '@/components/PageLoadingCard';

// 使用 dynamic import 並關閉 SSR（Leaflet 需要 browser API）
const MapClient = dynamic(() => import('./MapClient'), {
  ssr: false,
  loading: () => <PageLoadingCard message="地圖載入中..." />,
});

export default function MapPage(props: {
  searchParams?: Promise<{
    school?: string;
    schoolId?: string;
    campus?: string;
    route?: string | string[];
    focus?: string | string[];
  }>;
}) {
  const searchParams = props.searchParams ? use(props.searchParams) : undefined;
  const { schoolId, schoolName, schoolSearch: q } = resolveSchoolPageContext(searchParams);
  const route = Array.isArray(searchParams?.route) ? searchParams.route[0] : searchParams?.route;
  const focus = Array.isArray(searchParams?.focus) ? searchParams.focus[0] : searchParams?.focus;

  return (
    <SiteShell
      title="校園地圖"
      subtitle="找教室、查設施，規劃前往目的地的路線"
      schoolName={schoolName}
    >
      <MapClient school={schoolId} route={route} focus={focus} />

      <div
        style={{
          margin: '16px 0',
          padding: '14px 18px',
          borderRadius: 'var(--radius)',
          background: 'var(--accent-soft)',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand)', marginBottom: 3 }}>
            找校園地點
          </div>
          <div style={{ fontSize: 13, color: 'var(--text)' }}>
            找不到建築或設施？用地圖搜尋，或打開校園目錄。
          </div>
        </div>
        <Link
          href={`/search${q ? `${q}&` : '?'}q=${encodeURIComponent('地點')}`}
          className="btn"
          style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          詢問地點 →
        </Link>
      </div>
    </SiteShell>
  );
}
