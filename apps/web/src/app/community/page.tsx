'use client';

/**
 * 校園社群 — Web 版（與 mobile/CommunityScreen 對齊）
 *
 * 結構：頂部分頁切換（動態/看板/即時/學伴），路由 ?tab=feed|boards|realtime|buddy
 * 子畫面：發文、Story、貼文詳情、看板詳情走獨立子路由（/community/post/new 等）
 */

import { useMemo } from 'react';
import styles from './community.module.css';
import { useRouter, useSearchParams } from 'next/navigation';
import { CommunityAccess } from './_components/CommunityAccess';
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
  { key: 'realtime', label: '即時', icon: '⚡', desc: '限時動態與地點打卡' },
  { key: 'buddy', label: '學伴', icon: '👥', desc: '課程評價、讀書會' },
];

export default function CommunityPage() {
  const { schoolName } = resolveSchoolPageContext({});
  return (
    <SiteShell
      title="校園交流"
      subtitle="分享校園消息，找到一起上課與讀書的同學。"
      schoolName={schoolName}
    >
      <CommunityAccess>
        <CommunityPageInner />
      </CommunityAccess>
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

  const activeTab = initial;
  const { schoolId, schoolSearch } = useMemo(() => resolveSchoolPageContext({}), []);

  const switchTab = (k: TabKey) => {
    const sp = new URLSearchParams(searchParams?.toString() ?? '');
    sp.set('tab', k);
    router.replace(`/community?${sp.toString()}`, { scroll: false });
  };

  return (
    <div style={{ paddingBottom: 32 }}>
      <nav className={styles.tabs} aria-label="校園交流分類">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-pressed={activeTab === tab.key}
            onClick={() => switchTab(tab.key)}
            title={tab.desc}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div>
        {activeTab === 'feed' && <FeedTab schoolId={schoolId} schoolSearch={schoolSearch} />}
        {activeTab === 'boards' && <BoardsTab schoolId={schoolId} schoolSearch={schoolSearch} />}
        {activeTab === 'realtime' && <RealtimeTab schoolId={schoolId} />}
        {activeTab === 'buddy' && <StudyBuddyTab schoolId={schoolId} />}
      </div>
    </div>
  );
}
