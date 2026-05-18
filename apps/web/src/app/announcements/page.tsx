'use client';

import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { resolveSchool } from '@campus/shared/src/schools';
import { SiteShell } from '@/components/SiteShell';
import { useToast } from '@/components/ui';
import { fetchAnnouncements, type Announcement } from '@/lib/firebase';
import { useSchoolCollectionData } from '@/lib/useSchoolCollectionData';
import {
  DEMO_ANNOUNCEMENTS,
  getDemoCourseById,
  getDemoClubById,
  readPendingAnns,
  addPendingAnn,
  approvePendingAnn,
  type DemoAnnouncement,
  type DemoPendingAnn,
} from '@/lib/demoData';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useDemoRole, getCapabilities } from '@/lib/demoRole';
import { useRoleScopedState } from '@/lib/useRoleScopedState';
import { notifyDeptHeadNewAnn, notifyStudentsAnnApproved, notifySubmitterAnnApproved, rejectAnnouncementWithReason } from '@/lib/demoStore';
import type { DemoRole } from '@/lib/demoRole';

type FilterCategory = 'all' | 'academic' | 'event' | 'general';
type AnnouncementView = 'all' | 'important' | 'today' | 'mine' | 'pending';

/** 「新增公告」Modal 表單 */
function NewAnnModal({
  onClose,
  onSubmit,
  role,
}: {
  onClose: () => void;
  onSubmit: (title: string, body: string) => void;
  role: string;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const sourceLabel =
    role === 'teacher' ? '王大明老師' :
    role === 'department_head' ? '黃主任（系所辦公室）' :
    role === 'club_officer' ? '程式設計社' : '發布者';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 999,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg, #fff)',
          borderRadius: 16,
          padding: 28,
          width: '100%',
          maxWidth: 520,
          boxShadow: '0 24px 64px rgba(0,0,0,0.22)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800 }}>
          {role === 'teacher' ? '發布課程公告' : role === 'department_head' ? '發布系所公告' : '發布社團公告'}
        </h2>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: '#8E8E93' }}>
          發布後將進入待審核佇列，由系主任核准後正式對外公開。
        </p>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>公告標題 *</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="請輸入公告標題"
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>公告內容 *</label>
          <textarea
            className="input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="請輸入公告詳細內容..."
            rows={4}
            style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
          />
        </div>
        <div style={{ marginBottom: 20, fontSize: 13, color: '#8E8E93', background: 'var(--panel2, #F2F2F7)', padding: '10px 14px', borderRadius: 8 }}>
          📌 發布來源：<strong>{sourceLabel}</strong>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>取消</button>
          <button
            className="btn primary"
            disabled={!title.trim() || !body.trim()}
            onClick={() => {
              if (title.trim() && body.trim()) onSubmit(title.trim(), body.trim());
            }}
          >
            ✉️ 送出待審核
          </button>
        </div>
      </div>
    </div>
  );
}

function isImportantAnnouncement(a: Announcement, index: number): boolean {
  if (a.pinned) return true;
  const hay = `${a.title} ${a.body}`.toLowerCase();
  return (
    hay.includes('重要') ||
    hay.includes('緊急') ||
    hay.includes('停課') ||
    hay.includes('異動') ||
    index < 2
  );
}

// 把 DemoAnnouncement 轉成 Announcement 型別（兩者形狀已對齊）
const DEMO_FALLBACK: Announcement[] = DEMO_ANNOUNCEMENTS.map(
  (a: DemoAnnouncement): Announcement => ({
    id: a.id,
    title: a.title,
    body: a.body,
    publishedAt: a.publishedAt,
    source: a.source,
    category: a.category,
    pinned: a.pinned,
    relatedCourseId: a.relatedCourseId,
    relatedClubId: a.relatedClubId,
  }),
);

export default function AnnouncementsPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const school = resolveSchool({
    school: props.searchParams?.school,
    schoolId: props.searchParams?.schoolId,
  });
  const { schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [demoRole] = useDemoRole();
  const caps = getCapabilities(demoRole);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<FilterCategory>('all');
  const [activeView, setActiveView] = useState<AnnouncementView>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savedIdsArr, setSavedIdsArr] = useRoleScopedState<string[]>('saved-announcements', []);
  const savedIds = useMemo(() => new Set(savedIdsArr), [savedIdsArr]);
  const setSavedIds = (updater: (prev: Set<string>) => Set<string>) => {
    setSavedIdsArr((prev) => Array.from(updater(new Set(prev))));
  };
  // 待審公告（共用 localStorage，與 admin 頁同步）
  const [pendingQueue, setPendingQueue] = useState<DemoPendingAnn[]>([]);
  // 新增公告 Modal — ?compose=1 由 useEffect 讀取（SSR 安全）
  const [showModal, setShowModal] = useState(false);
  const { success, info } = useToast();

  // Mount 後檢查 ?compose=1
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('compose') === '1' && caps.canPublishAnnouncements) {
        setShowModal(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mount 後讀取 localStorage（SSR 安全）
  useEffect(() => {
    setPendingQueue(readPendingAnns());
    const handler = () => setPendingQueue(readPendingAnns());
    window.addEventListener('demoPendingAnnChange', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('demoPendingAnnChange', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  const {
    data: announcements,
    loading,
    sourceMode,
  } = useSchoolCollectionData<Announcement>(school.id, fetchAnnouncements, DEMO_FALLBACK);

  const usingDemo = sourceMode === 'demo';

  const categories = [
    { id: 'all' as const, label: '全部', icon: '📋' },
    { id: 'academic' as const, label: '學術', icon: '📚' },
    { id: 'event' as const, label: '活動', icon: '🎉' },
    { id: 'general' as const, label: '一般', icon: '📢' },
  ];

  // 訪客 / 校友：過濾掉「課程公告」與「待審」之類的內部公告，只看校園級別
  const visibleAnnouncements = useMemo(() => {
    if (demoRole === 'guest' || demoRole === 'alumni') {
      return announcements.filter((a) => !a.relatedCourseId); // 課程內部公告不給訪客看
    }
    return announcements;
  }, [announcements, demoRole]);

  // 對應「自己發的」的判斷：DemoData 來源（getCourseById.instructor 等）對應到角色
  const mineSourceMatches = (source: string | undefined): boolean => {
    if (!source) return false;
    if (demoRole === 'teacher') return source.includes('王大明') || source.includes('老師');
    if (demoRole === 'department_head') return source.includes('系所') || source.includes('系辦');
    if (demoRole === 'club_officer') return source.includes('社');
    return false;
  };

  const filteredAnnouncements = useMemo(() => {
    return visibleAnnouncements.filter((a, idx) => {
      const matchesSearch =
        !searchQuery ||
        a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.body.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === 'all' || a.category === selectedCategory;
      const matchesView =
        activeView === 'all'
          ? true
          : activeView === 'important'
            ? isImportantAnnouncement(a, idx)
            : activeView === 'mine'
              ? mineSourceMatches(a.source)
              : activeView === 'pending'
                ? false // 待審核視圖用 pendingQueue 獨立渲染，不從 visibleAnnouncements 過濾
                : (() => {
                    const published = new Date(a.publishedAt);
                    if (Number.isNaN(published.getTime())) return false;
                    const now = new Date();
                    return (
                      published.getFullYear() === now.getFullYear() &&
                      published.getMonth() === now.getMonth() &&
                      published.getDate() === now.getDate()
                    );
                  })();
      return matchesSearch && matchesCategory && matchesView;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAnnouncements, searchQuery, selectedCategory, activeView, demoRole]);

  const stats = useMemo(() => {
    const todayCount = announcements.filter((a) => {
      const date = new Date(a.publishedAt);
      if (Number.isNaN(date.getTime())) return false;
      const now = new Date();
      return (
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()
      );
    }).length;
    const importantCount = announcements.filter((a, idx) => isImportantAnnouncement(a, idx)).length;
    return {
      total: announcements.length,
      today: todayCount,
      important: importantCount,
      pending: pendingQueue.length,
    };
  }, [announcements, pendingQueue.length]);

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return '今天';
      if (diffDays === 1) return '昨天';
      if (diffDays < 7) return `${diffDays} 天前`;
      return date.toLocaleDateString('zh-TW', { month: 'long', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const getShareUrl = (announcementId: string) => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname}${window.location.search}#${announcementId}`;
  };

  const handleShare = async (event: MouseEvent<HTMLButtonElement>, announcement: Announcement) => {
    event.stopPropagation();
    const url = getShareUrl(announcement.id);

    try {
      if (navigator.share) {
        await navigator.share({
          title: announcement.title,
          text: announcement.body,
          url,
        });
        success('已開啟分享面板');
        return;
      }

      await navigator.clipboard.writeText(url);
      success('已複製公告連結');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      console.error('Failed to share announcement:', error);
      info('無法直接分享，請稍後再試');
    }
  };

  const handleCopyLink = async (event: MouseEvent<HTMLButtonElement>, announcementId: string) => {
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(getShareUrl(announcementId));
      success('已複製公告連結');
    } catch (error) {
      console.error('Failed to copy announcement link:', error);
      info('複製失敗，請確認瀏覽器權限');
    }
  };

  const toggleSaved = (event: MouseEvent<HTMLButtonElement>, announcementId: string) => {
    event.stopPropagation();
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(announcementId)) {
        next.delete(announcementId);
        info('已取消收藏');
      } else {
        next.add(announcementId);
        success('已加入收藏');
      }
      return next;
    });
  };

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title="公告"
      subtitle={`重要通知一眼看懂 · ${school.name}`}
    >
      <div className="announcementsPage">
        {/* Stats Bar */}
        <div className="statsBar">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 14,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              公告統計
            </h3>
            <span className="pill subtle">{usingDemo ? '示範資料' : '即時資料'}</span>
          </div>
          <div className="statsGrid">
            <div className="statItem">
              <span className="statValue total">{stats.total}</span>
              <span className="statLabel">總公告數</span>
            </div>
            <div className="statItem">
              <span className="statValue today">{stats.today}</span>
              <span className="statLabel">今日新增</span>
            </div>
            <div className="statItem">
              <span className="statValue important">{stats.important}</span>
              <span className="statLabel">重要公告</span>
            </div>
            {caps.canApproveAnnouncements && (
              <div className="statItem">
                <span className="statValue" style={{ color: stats.pending > 0 ? 'var(--warning)' : 'var(--success)' }}>
                  {stats.pending}
                </span>
                <span className="statLabel">待審核</span>
              </div>
            )}
          </div>
          <div style={{ marginTop: 14 }}>
            <div className="viewTabs">
              <button
                type="button"
                className={activeView === 'all' ? 'active' : ''}
                onClick={() => setActiveView('all')}
              >
                📋 全部
              </button>
              <button
                type="button"
                className={activeView === 'important' ? 'active' : ''}
                onClick={() => setActiveView('important')}
              >
                ⭐ 重要
              </button>
              <button
                type="button"
                className={activeView === 'today' ? 'active' : ''}
                onClick={() => setActiveView('today')}
              >
                🆕 今日
              </button>
              {caps.canPublishAnnouncements && (
                <button
                  type="button"
                  className={activeView === 'mine' ? 'active' : ''}
                  onClick={() => setActiveView('mine')}
                  title="我自己發的公告"
                >
                  ✍️ 自己發的
                </button>
              )}
              {caps.canApproveAnnouncements && (
                <button
                  type="button"
                  className={activeView === 'pending' ? 'active' : ''}
                  onClick={() => setActiveView('pending')}
                  title="待我審核的公告"
                >
                  ⏳ 待審核
                </button>
              )}
            </div>
          </div>

          {/* 發布權限：教師 / 系主任 / 管理員可以發布；系主任 / 管理員可審核 */}
          {(caps.canPublishAnnouncements || caps.canApproveAnnouncements) && (
            <div
              style={{
                marginTop: 14,
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                paddingTop: 14,
                borderTop: '1px solid var(--border)',
              }}
            >
              {caps.canPublishAnnouncements && (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => setShowModal(true)}
                  style={{ fontSize: 13 }}
                >
                  ＋{' '}
                  {demoRole === 'teacher'
                    ? '發布課程公告'
                    : demoRole === 'department_head'
                      ? '發布系所公告'
                      : demoRole === 'club_officer'
                        ? '發布社團公告'
                        : '發布公告'}
                </button>
              )}
              {caps.canApproveAnnouncements && (
                <a href={`/admin${q}`} className="btn" style={{ fontSize: 13 }}>
                  📥 公告審核佇列
                </a>
              )}
            </div>
          )}
        </div>

        {/* ── AI 公告摘要入口 ── */}
        {!loading && demoRole !== 'guest' && filteredAnnouncements.length > 0 && (
          <div
            className="card"
            style={{
              padding: '12px 16px',
              background: 'linear-gradient(135deg, rgba(88,86,214,0.10) 0%, rgba(90,200,250,0.07) 100%)',
              border: '1px solid rgba(88,86,214,0.22)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text)' }}>
              🤖 <strong>AI 摘要</strong>：今日共 {stats.today} 則新公告，{stats.important} 則重要。
              要我幫你整理重點嗎？
            </div>
            <Link
              href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('請幫我整理今天最重要的幾則公告，我需要注意哪些截止日和活動？')}`}
              className="btn"
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              問 AI →
            </Link>
          </div>
        )}

        {loading && (
          <div className="loadingCard">
            <div className="loadingSpinner" aria-hidden />
            <p className="emptyText">載入中...</p>
          </div>
        )}

        {!loading && (
          <>
            {/* Search & Filter */}
            <div className="searchRow">
              <div className="searchWrap">
                <span className="searchIcon" aria-hidden>
                  🔍
                </span>
                <input
                  type="search"
                  className="input"
                  placeholder="搜尋公告標題或內容..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="搜尋公告"
                />
              </div>
              <div className="categoryPills">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={selectedCategory === cat.id ? 'active' : ''}
                    onClick={() => setSelectedCategory(cat.id)}
                  >
                    <span aria-hidden>{cat.icon}</span>
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 待審核視圖（系主任 / 管理員專用）*/}
            {activeView === 'pending' && caps.canApproveAnnouncements && (
              <div className="list">
                {pendingQueue.length === 0 ? (
                  <div className="emptyCard">
                    <div className="emptyIcon" aria-hidden>🎉</div>
                    <p className="emptyText">公告佇列已清空，沒有待審項目</p>
                  </div>
                ) : (
                  pendingQueue.map((p) => (
                    <article key={p.id} className="annCard">
                      <div className="annCardHeader">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="annCardTags">
                            <span className="annTag important">待審核</span>
                            <span className="annTag source">{p.source}</span>
                          </div>
                          <h2 className="annCardTitle">{p.title}</h2>
                          {p.body && (
                            <div style={{ fontSize: 13, color: 'var(--text)', margin: '4px 0 2px', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                              {p.body.length > 200 ? `${p.body.slice(0, 200)}…` : p.body}
                            </div>
                          )}
                          <div className="annCardMeta">
                            <span>📅</span>
                            <span>提交於 {p.submittedAt}</span>
                          </div>
                        </div>
                      </div>
                      <div className="annCardActions" style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button
                          type="button"
                          className="btn primary"
                          style={{ fontSize: 13 }}
                          onClick={() => {
                            approvePendingAnn(p.id);
                            setPendingQueue(readPendingAnns());
                            notifyStudentsAnnApproved(p.title, p.source);
                            notifySubmitterAnnApproved({ title: p.title, submitterRole: p.submittedByRole as DemoRole, approvedBy: demoRole === 'admin' ? '系統管理員' : '系主任' });
                            success('✅ 已核准並發布公告，學生現在可以看到');
                          }}
                        >
                          ✓ 核准發布
                        </button>
                        <button
                          type="button"
                          className="btn"
                          style={{ fontSize: 13 }}
                          onClick={() => {
                            const reason = typeof window !== 'undefined'
                              ? window.prompt(`退回「${p.title}」的原因（提交者會收到通知）：`, '請補充截止日、地點等資訊後重新送審')
                              : '請補充細節後重新送審';
                            if (!reason) return;
                            rejectAnnouncementWithReason({
                              pendingId: p.id,
                              title: p.title,
                              reason,
                              submitterRole: p.submittedByRole as DemoRole,
                              reviewedByLabel: demoRole === 'admin' ? '系統管理員' : '系主任',
                            });
                            setPendingQueue(readPendingAnns());
                            info(`🔄 已退回「${p.title}」並通知原提交者`);
                          }}
                        >
                          退回修改
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            )}

            {/* Announcement List */}
            {activeView !== 'pending' && (
            <div className="list">
              {filteredAnnouncements.length === 0 ? (
                <div className="emptyCard">
                  <div className="emptyIcon" aria-hidden>
                    📋
                  </div>
                  <p className="emptyText">找不到符合的公告</p>
                  <p className="emptyText" style={{ marginTop: 8, fontSize: 14 }}>
                    試試調整篩選條件或關鍵字
                  </p>
                </div>
              ) : (
                filteredAnnouncements.map((a, idx) => {
                  const isExpanded = expandedId === a.id;
                  const isNew = idx < 3;
                  const isImportant = isImportantAnnouncement(a, idx);

                  return (
                    <article
                      key={a.id}
                      className={`annCard ${isExpanded ? 'expanded' : ''}`}
                      onClick={() => setExpandedId(isExpanded ? null : a.id)}
                    >
                      <div className="annCardHeader">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="annCardTags">
                            {isNew && <span className="annTag new">NEW</span>}
                            {isImportant && <span className="annTag important">重要</span>}
                            <span className="annTag source">{a.source || '校方公告'}</span>
                          </div>
                          <h2 className="annCardTitle">{a.title}</h2>
                          <div className="annCardMeta">
                            <span>📅</span>
                            <span>{formatDate(a.publishedAt)}</span>
                          </div>
                        </div>
                        <div className="annCardChevron" aria-hidden>
                          ▼
                        </div>
                      </div>

                      <p className="annCardBody">{a.body}</p>

                      {isExpanded && (
                        <div className="annCardActions">
                          <Link
                            href={`/announcements/${a.id}${q}`}
                            onClick={(event) => event.stopPropagation()}
                            style={{
                              background: 'var(--text)',
                              color: '#fff',
                              fontWeight: 700,
                            }}
                          >
                            📖 查看完整公告 →
                          </Link>
                          {/* 下一步：跳轉到關聯的課程 / 社團 */}
                          {a.relatedCourseId && getDemoCourseById(a.relatedCourseId) && (
                            <Link
                              href={`${(demoRole === 'teacher' || demoRole === 'ta' || demoRole === 'admin' || demoRole === 'department_head') ? '/teacher' : ''}/course/${a.relatedCourseId}${q}`}
                              onClick={(event) => event.stopPropagation()}
                              style={{
                                background: 'var(--brand)',
                                color: '#fff',
                                fontWeight: 700,
                              }}
                            >
                              📚 前往：{getDemoCourseById(a.relatedCourseId)?.name}
                            </Link>
                          )}
                          {a.relatedClubId && getDemoClubById(a.relatedClubId) && (
                            <Link
                              href={`/clubs${q}`}
                              onClick={(event) => event.stopPropagation()}
                              style={{
                                background: 'var(--success)',
                                color: '#fff',
                                fontWeight: 700,
                              }}
                            >
                              🎯 前往：{getDemoClubById(a.relatedClubId)?.name}
                            </Link>
                          )}
                          <button type="button" onClick={(event) => handleShare(event, a)}>
                            🔗 分享
                          </button>
                          <button type="button" onClick={(event) => handleCopyLink(event, a.id)}>
                            📋 複製連結
                          </button>
                          <button type="button" onClick={(event) => toggleSaved(event, a.id)}>
                            {savedIds.has(a.id) ? '⭐ 已收藏' : '⭐ 收藏'}
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </div>
            )}
          </>
        )}
      </div>

      {/* 新增公告 Modal */}
      {showModal && caps.canPublishAnnouncements && (
        <NewAnnModal
          role={demoRole}
          onClose={() => setShowModal(false)}
          onSubmit={(title, body) => {
            const sourceLabel =
              demoRole === 'teacher' ? '王大明老師' :
              demoRole === 'department_head' ? '黃主任（系所辦公室）' :
              demoRole === 'club_officer' ? '程式設計社' : '發布者';
            addPendingAnn({
              title,
              body,
              source: sourceLabel,
              submittedAt: '剛剛',
              submittedByRole: demoRole,
            });
            setPendingQueue(readPendingAnns());
            // 通知系主任有新公告待審核（系主任 / 管理員本人提交時不自我通知）
            if (demoRole !== 'department_head' && demoRole !== 'admin') {
              notifyDeptHeadNewAnn(title, sourceLabel);
            }
            setShowModal(false);
            success(`✅ 已送出「${title.slice(0, 20)}${title.length > 20 ? '…' : ''}」，待系主任審核後公開`);
          }}
        />
      )}
    </SiteShell>
  );
}
