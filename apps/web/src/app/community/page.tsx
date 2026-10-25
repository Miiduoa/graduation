'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CommunityAccess } from './_components/CommunityAccess';
import { FeedTab } from './_components/FeedTab';
import { BoardsTab } from './_components/BoardsTab';
import { RealtimeTab } from './_components/RealtimeTab';
import { StudyBuddyTab } from './_components/StudyBuddyTab';
import { SiteShell } from '@/components/SiteShell';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import styles from './community.module.css';

type TabKey = 'feed' | 'boards' | 'realtime' | 'buddy';

const TABS: { key: TabKey; label: string; desc: string }[] = [
  { key: 'feed', label: '校園動態', desc: '新鮮事、提問與分享' },
  { key: 'boards', label: '主題看板', desc: '系所、課程與興趣' },
  { key: 'realtime', label: '限時與打卡', desc: '此刻發生的事' },
  { key: 'buddy', label: '學習夥伴', desc: '一起讀書、交換經驗' },
];

function activeTabFor(value: string | null): TabKey {
  return TABS.find((tab) => tab.key === value)?.key ?? 'feed';
}

export default function CommunityPage() {
  const { schoolId, schoolName, schoolSearch, ready } = useBrowsingSchoolPageContext();
  return (
    <SiteShell
      title="校園交流"
      subtitle="問題有人回答，興趣有人分享，找人一起完成更多事。"
      schoolName={ready ? schoolName : undefined}
    >
      {ready ? (
        <CommunityAccess>
          <CommunityPageInner key={schoolId} schoolId={schoolId} schoolSearch={schoolSearch} />
        </CommunityAccess>
      ) : (
        <SchoolScopePlaceholder />
      )}
    </SiteShell>
  );
}

function CommunityPageInner({ schoolId, schoolSearch }: { schoolId: string; schoolSearch: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = activeTabFor(searchParams?.get('tab'));
  const selected = TABS.find((tab) => tab.key === activeTab)!;
  const newPostHref = `/community/post/new?schoolId=${encodeURIComponent(schoolId)}`;

  function switchTab(tab: TabKey) {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    next.set('tab', tab);
    router.replace(`/community?${next.toString()}`, { scroll: false });
  }

  return (
    <div className={styles.content}>
      <section className={styles.intro} aria-labelledby="community-intro-title">
        <div className={styles.introCopy}>
          <p className={styles.eyebrow}>CAMPUS / CONNECT</p>
          <h2 id="community-intro-title">從一個問題，找到同路人。</h2>
          <p>分享課堂與生活的大小事，或看看同學們正在討論什麼。</p>
        </div>
        <div className={styles.introActions}>
          <Link href={newPostHref} className={styles.primaryLink}>
            發表貼文
          </Link>
          <Link href="/community?tab=boards" className={styles.secondaryLink}>
            逛逛看板
          </Link>
        </div>
      </section>

      <nav className={styles.quickLinks} aria-label="延伸交流服務">
        <Link href="/dms">
          <strong>私人訊息</strong>
          <span>接續一對一對話</span>
        </Link>
        <Link href="/groups">
          <strong>課程與興趣群組</strong>
          <span>與成員一起協作</span>
        </Link>
        <Link href="/friends">
          <strong>尋找同學</strong>
          <span>管理好友與邀請</span>
        </Link>
        <Link href="/social">
          <strong>跨校公開交流</strong>
          <span>探索其他校園話題</span>
        </Link>
      </nav>

      <section className={styles.communitySection} aria-label="校內社群內容">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>DISCOVER</p>
            <h2>{selected.label}</h2>
            <p>{selected.desc}</p>
          </div>
          <span className={styles.scopeNote}>內容依目前選擇的學校顯示</span>
        </div>
        <nav className={styles.tabs} aria-label="校園交流分類">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              aria-pressed={activeTab === tab.key}
              onClick={() => switchTab(tab.key)}
              title={tab.desc}
            >
              <strong>{tab.label}</strong>
              <small>{tab.desc}</small>
            </button>
          ))}
        </nav>
        <div className={styles.tabContent}>
          {activeTab === 'feed' && <FeedTab schoolId={schoolId} schoolSearch={schoolSearch} />}
          {activeTab === 'boards' && <BoardsTab schoolId={schoolId} schoolSearch={schoolSearch} />}
          {activeTab === 'realtime' && <RealtimeTab schoolId={schoolId} />}
          {activeTab === 'buddy' && <StudyBuddyTab schoolId={schoolId} />}
        </div>
      </section>
    </div>
  );
}
