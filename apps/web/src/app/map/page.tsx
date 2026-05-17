'use client';

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

export default function MapPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const { schoolId, schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);

  return (
    <SiteShell title="校園地圖" subtitle="互動地圖 · 探索校園各設施" schoolName={schoolName}>
      <MapClient school={schoolId} />

      {/* ── AI 校園導航入口 ── */}
      <div
        style={{
          margin: '16px 0',
          padding: '14px 18px',
          borderRadius: 'var(--radius)',
          background: 'linear-gradient(135deg, rgba(52,199,89,0.10) 0%, rgba(52,199,89,0.04) 100%)',
          border: '1px solid rgba(52,199,89,0.28)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1F7A2E', marginBottom: 3 }}>🤖 AI 校園導航</div>
          <div style={{ fontSize: 13, color: 'var(--text)' }}>
            不確定哪棟樓在哪？讓 AI 幫你找到目的地的最快路線。
          </div>
        </div>
        <Link
          href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('工程館 302 要怎麼從校門口走過去？大概要幾分鐘？中途有什麼地標可以參考？')}`}
          className="btn"
          style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          問 AI →
        </Link>
      </div>
    </SiteShell>
  );
}
