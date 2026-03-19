"use client";

import { useMemo, useState, type MouseEvent } from "react";
import { resolveSchool } from "@campus/shared/src/schools";
import { mockAnnouncements } from "@campus/shared/src/mockData";
import { SiteShell } from "@/components/SiteShell";
import { useToast } from "@/components/ui";
import { fetchAnnouncements, type Announcement } from "@/lib/firebase";
import { useSchoolCollectionData } from "@/lib/useSchoolCollectionData";

type FilterCategory = "all" | "academic" | "event" | "general";
type AnnouncementView = "all" | "important" | "today";

function isImportantAnnouncement(a: Announcement, index: number): boolean {
  if (a.pinned) return true;
  const hay = `${a.title} ${a.body}`.toLowerCase();
  return (
    hay.includes("重要") ||
    hay.includes("緊急") ||
    hay.includes("停課") ||
    hay.includes("異動") ||
    index < 2
  );
}

export default function AnnouncementsPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const school = resolveSchool({ school: props.searchParams?.school, schoolId: props.searchParams?.schoolId });
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<FilterCategory>("all");
  const [activeView, setActiveView] = useState<AnnouncementView>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const { success, info } = useToast();
  const { data: announcements, loading, sourceMode } = useSchoolCollectionData<Announcement>(
    school.id,
    fetchAnnouncements,
    mockAnnouncements
  );

  const usingDemo = sourceMode === "demo";

  const categories = [
    { id: "all" as const, label: "全部", icon: "📋" },
    { id: "academic" as const, label: "學術", icon: "📚" },
    { id: "event" as const, label: "活動", icon: "🎉" },
    { id: "general" as const, label: "一般", icon: "📢" },
  ];

  const filteredAnnouncements = useMemo(() => {
    return announcements.filter((a, idx) => {
      const matchesSearch = !searchQuery || 
        a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.body.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === "all" || a.category === selectedCategory;
      const matchesView =
        activeView === "all"
          ? true
          : activeView === "important"
            ? isImportantAnnouncement(a, idx)
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
  }, [announcements, searchQuery, selectedCategory, activeView]);

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
    };
  }, [announcements]);

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      if (diffDays === 0) return "今天";
      if (diffDays === 1) return "昨天";
      if (diffDays < 7) return `${diffDays} 天前`;
      return date.toLocaleDateString("zh-TW", { month: "long", day: "numeric" });
    } catch {
      return dateStr;
    }
  };

  const getShareUrl = (announcementId: string) => {
    if (typeof window === "undefined") return "";
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
        success("已開啟分享面板");
        return;
      }

      await navigator.clipboard.writeText(url);
      success("已複製公告連結");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      console.error("Failed to share announcement:", error);
      info("無法直接分享，請稍後再試");
    }
  };

  const handleCopyLink = async (event: MouseEvent<HTMLButtonElement>, announcementId: string) => {
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(getShareUrl(announcementId));
      success("已複製公告連結");
    } catch (error) {
      console.error("Failed to copy announcement link:", error);
      info("複製失敗，請確認瀏覽器權限");
    }
  };

  const toggleSaved = (event: MouseEvent<HTMLButtonElement>, announcementId: string) => {
    event.stopPropagation();
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(announcementId)) {
        next.delete(announcementId);
        info("已取消收藏");
      } else {
        next.add(announcementId);
        success("已加入收藏");
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text)" }}>公告統計</h3>
            <span className="pill subtle">{usingDemo ? "示範資料" : "即時資料"}</span>
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
          </div>
          <div style={{ marginTop: 14 }}>
            <div className="viewTabs">
              <button
                type="button"
                className={activeView === "all" ? "active" : ""}
                onClick={() => setActiveView("all")}
              >
                📋 全部
              </button>
              <button
                type="button"
                className={activeView === "important" ? "active" : ""}
                onClick={() => setActiveView("important")}
              >
                ⭐ 重要
              </button>
              <button
                type="button"
                className={activeView === "today" ? "active" : ""}
                onClick={() => setActiveView("today")}
              >
                🆕 今日
              </button>
            </div>
          </div>
        </div>

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
                <span className="searchIcon" aria-hidden>🔍</span>
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
                    className={selectedCategory === cat.id ? "active" : ""}
                    onClick={() => setSelectedCategory(cat.id)}
                  >
                    <span aria-hidden>{cat.icon}</span>
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Announcement List */}
            <div className="list">
              {filteredAnnouncements.length === 0 ? (
                <div className="emptyCard">
                  <div className="emptyIcon" aria-hidden>📋</div>
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
                      className={`annCard ${isExpanded ? "expanded" : ""}`}
                      onClick={() => setExpandedId(isExpanded ? null : a.id)}
                    >
                      <div className="annCardHeader">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="annCardTags">
                            {isNew && <span className="annTag new">NEW</span>}
                            {isImportant && <span className="annTag important">重要</span>}
                            <span className="annTag source">{a.source || "校方公告"}</span>
                          </div>
                          <h2 className="annCardTitle">{a.title}</h2>
                          <div className="annCardMeta">
                            <span>📅</span>
                            <span>{formatDate(a.publishedAt)}</span>
                          </div>
                        </div>
                        <div className="annCardChevron" aria-hidden>▼</div>
                      </div>

                      <p className="annCardBody">{a.body}</p>

                      {isExpanded && (
                        <div className="annCardActions">
                          <button type="button" onClick={(event) => handleShare(event, a)}>🔗 分享</button>
                          <button type="button" onClick={(event) => handleCopyLink(event, a.id)}>📋 複製連結</button>
                          <button type="button" onClick={(event) => toggleSaved(event, a.id)}>
                            {savedIds.has(a.id) ? "⭐ 已收藏" : "⭐ 收藏"}
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </SiteShell>
  );
}
