'use client';

/**
 * 校園社群 — Web 版（與 mobile/CommunityScreen 對齊）
 *
 * 結構：頂部分頁切換（動態/看板/即時/學伴），路由 ?tab=feed|boards|realtime|buddy
 * 子畫面：發文、Story、貼文詳情、看板詳情走獨立子路由（/community/post/new 等）
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { FeedTab } from './_components/FeedTab';
import { BoardsTab } from './_components/BoardsTab';
import { RealtimeTab } from './_components/RealtimeTab';
import { StudyBuddyTab } from './_components/StudyBuddyTab';

type TabKey = 'feed' | 'boards' | 'realtime' | 'buddy';

const TABS: { key: TabKey; label: string; icon: string; desc: string }[] = [
  { key: 'feed', label: '動態', icon: '✨', desc: '校園所有公開貼文' },
  { key: 'boards', label: '看板', icon: '🗂', desc: '系所、課程、主題、匿名板' },
  { key: 'realtime', label: '即時', icon: '⚡', desc: '24h Story + 同點打卡' },
  { key: 'buddy', label: '學伴', icon: '👥', desc: '課程評價、讀書會' },
];

export default function CommunityPage(props: {
  searchParams?: Promise<{ school?: string; schoolId?: string; tab?: string }>;
}) {
  return (
    <SiteShell title="校園社群" subtitle="動態 · 看板 · 即時 · 學伴">
      <CommunityPageInner />
    </SiteShell>
  );
}

function CommunityPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');
  const initial: TabKey =
    tabParam === 'boards' || tabParam === 'realtime' || tabParam === 'buddy'
      ? (tabParam as TabKey)
      : 'feed';

  const [activeTab, setActiveTab] = useState<TabKey>(initial);
  const { schoolId, schoolSearch } = useMemo(() => resolveSchoolPageContext({}), []);

  useEffect(() => {
    if (tabParam && (tabParam === 'feed' || tabParam === 'boards' || tabParam === 'realtime' || tabParam === 'buddy')) {
      setActiveTab(tabParam as TabKey);
    }
  }, [tabParam]);

  const switchTab = (k: TabKey) => {
    setActiveTab(k);
    const sp = new URLSearchParams(searchParams?.toString() ?? '');
    sp.set('tab', k);
    router.replace(`/community?${sp.toString()}`, { scroll: false });
  };

  return (
    <div style={{ paddingBottom: 32 }}>
      <div
        role="tablist"
        aria-label="校園社群分頁"
        style={{
          display: 'flex',
          gap: 6,
          padding: 4,
          background: 'var(--panel2, #F2F2F7)',
          borderRadius: 999,
          marginBottom: 18,
          border: '1px solid var(--border)',
          maxWidth: 640,
        }}
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => switchTab(tab.key)}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '8px 12px',
                borderRadius: 999,
                border: 'none',
                cursor: 'pointer',
                fontWeight: active ? 700 : 600,
                fontSize: 13,
                color: active ? '#fff' : 'var(--muted)',
                background: active ? 'var(--brand, #5856D6)' : 'transparent',
                transition: 'all 0.18s',
              }}
              title={tab.desc}
            >
              <span aria-hidden style={{ fontSize: 14 }}>
                {tab.icon}
              </span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div>
        {activeTab === 'feed' && <FeedTab schoolId={schoolId} schoolSearch={schoolSearch} />}
        {activeTab === 'boards' && <BoardsTab schoolId={schoolId} schoolSearch={schoolSearch} />}
        {activeTab === 'realtime' && <RealtimeTab schoolId={schoolId} />}
        {activeTab === 'buddy' && <StudyBuddyTab schoolId={schoolId} />}
      </div>
    </div>
  );
}
