"use client";

import { useState, useEffect, useMemo } from "react";
import { resolveSchool } from "@campus/shared/src/schools";
import { mockAnnouncements } from "@campus/shared/src/mockData";
import { SiteShell } from "@/components/SiteShell";
import { fetchAnnouncements, isFirebaseConfigured, type Announcement } from "@/lib/firebase";

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
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        if (isFirebaseConfigured()) {
          const data = await fetchAnnouncements(school.id);
          setAnnouncements(data.length > 0 ? data : mockAnnouncements);
        } else {
          setAnnouncements(mockAnnouncements);
        }
      } catch (error) {
        console.error("Failed to load announcements:", error);
        setAnnouncements(mockAnnouncements);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [school.id]);

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
          <div className="viewTabs">
            <button
              type="button"
              className={activeView === "all" ? "active" : ""}
              onClick={() => setActiveView("all")}
            >
              全部
            </button>
            <button
              type="button"
              className={activeView === "important" ? "active" : ""}
              onClick={() => setActiveView("important")}
            >
              重要優先
            </button>
            <button
              type="button"
              className={activeView === "today" ? "active" : ""}
              onClick={() => setActiveView("today")}
            >
              今天發布
            </button>
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
                          <button type="button">🔗 分享</button>
                          <button type="button">🔔 設定提醒</button>
                          <button type="button">⭐ 收藏</button>
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
