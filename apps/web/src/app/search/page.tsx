"use client";

import { SiteShell } from "@/components/SiteShell";
import { resolveSchool } from "@campus/shared/src/schools";
import { mockAnnouncements, mockClubEvents, mockMenus, mockPois } from "@campus/shared/src/mockData";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  fetchAnnouncements,
  fetchEvents,
  fetchMenus,
  fetchPois,
  isFirebaseConfigured,
  type Announcement,
  type ClubEvent,
  type MenuItem,
  type Poi,
} from "@/lib/firebase";

type SearchCategory = "all" | "announcements" | "events" | "places" | "menus" | "courses" | "people";
type SearchDataSource = "demo" | "firebase";

type SearchResult = {
  id: string;
  type: "announcement" | "event" | "place" | "menu" | "course" | "person";
  title: string;
  subtitle: string;
  icon: string;
  href: string;
  tags?: string[];
};

const STATIC_RESULTS: SearchResult[] = [
  { id: "7", type: "course", title: "資料結構", subtitle: "CS201 · 王教授 · 3學分", icon: "📚", href: "/timetable", tags: ["必修", "資工"] },
  { id: "8", type: "course", title: "人工智慧概論", subtitle: "CS402 · 周教授 · 3學分", icon: "📚", href: "/timetable", tags: ["選修", "AI"] },
  { id: "9", type: "person", title: "王大明 教授", subtitle: "資訊工程學系 · 副教授", icon: "👤", href: "#", tags: ["教師", "資工"] },
  { id: "10", type: "person", title: "李小華", subtitle: "資工系 大三 · 學生會幹部", icon: "👤", href: "#", tags: ["學生", "學生會"] },
];

const RECENT_SEARCHES = ["圖書館", "餐廳", "課程", "王教授", "活動"];
const HOT_SEARCHES = ["期中考", "校慶", "獎學金", "宿舍", "停車"];

const demoPois: Poi[] = mockPois.map((poi) => ({
  id: poi.id,
  name: poi.name,
  description: poi.description ?? "校園地點",
  category: poi.category,
  lat: poi.lat,
  lng: poi.lng,
}));

const demoMenus: MenuItem[] = mockMenus.map((menu) => ({
  id: menu.id,
  name: menu.name,
  cafeteria: menu.cafeteria,
  availableOn: menu.availableOn,
  price: menu.price,
}));

function formatShortDate(dateStr: string) {
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return parsed.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
}

function formatShortDateTime(dateStr: string) {
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return parsed.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildSearchResults(params: {
  announcements: Announcement[];
  events: ClubEvent[];
  pois: Poi[];
  menus: MenuItem[];
}): SearchResult[] {
  const announcementResults = params.announcements.map((announcement) => ({
    id: announcement.id,
    type: "announcement" as const,
    title: announcement.title,
    subtitle: `${formatShortDate(announcement.publishedAt)} · ${announcement.source ?? "校方公告"}`,
    icon: "📢",
    href: `/announcements#${announcement.id}`,
    tags: [announcement.category ?? "公告", announcement.pinned ? "置頂" : "最新"].filter(
      (tag): tag is string => Boolean(tag)
    ),
  }));

  const eventResults = params.events.map((event) => ({
    id: event.id,
    type: "event" as const,
    title: event.title,
    subtitle: `${formatShortDateTime(event.startsAt)} · ${event.location ?? "校園活動"}`,
    icon: "🎉",
    href: `/clubs#${event.id}`,
    tags: [event.category ?? "活動", event.organizer ?? "校園"].filter((tag): tag is string => Boolean(tag)),
  }));

  const placeResults = params.pois.map((poi) => ({
    id: poi.id,
    type: "place" as const,
    title: poi.name,
    subtitle: [poi.building, poi.description || "校園地點"].filter(Boolean).join(" · "),
    icon: "📍",
    href: `/map#${poi.id}`,
    tags: [poi.category ?? "地點", poi.accessible ? "無障礙" : undefined].filter(
      (tag): tag is string => Boolean(tag)
    ),
  }));

  const menuResults = params.menus.map((menu) => ({
    id: menu.id,
    type: "menu" as const,
    title: menu.name,
    subtitle: [menu.cafeteria, menu.price ? `$${menu.price}` : undefined, menu.availableOn].filter(Boolean).join(" · "),
    icon: "🍽️",
    href: `/cafeteria#${menu.id}`,
    tags: [menu.category ?? "餐點", menu.vegetarian ? "素食" : undefined].filter(
      (tag): tag is string => Boolean(tag)
    ),
  }));

  return [...announcementResults, ...eventResults, ...placeResults, ...menuResults, ...STATIC_RESULTS];
}

function withSchoolQuery(href: string, queryString: string) {
  if (href === "#") return href;
  const [base, hash] = href.split("#");
  return `${base}${queryString}${hash ? `#${hash}` : ""}`;
}

export default function SearchPage(props: { searchParams?: { school?: string; schoolId?: string; q?: string } }) {
  const school = resolveSchool({
    school: props.searchParams?.school,
    schoolId: props.searchParams?.schoolId,
  });
  const q = `?school=${encodeURIComponent(school.code)}&schoolId=${encodeURIComponent(school.id)}`;

  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(props.searchParams?.q || "");
  const [category, setCategory] = useState<SearchCategory>("all");
  const [isSearching, setIsSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [allResults, setAllResults] = useState<SearchResult[]>(STATIC_RESULTS);
  const [dataSource, setDataSource] = useState<SearchDataSource>(isFirebaseConfigured() ? "firebase" : "demo");
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let active = true;

    async function loadSearchData() {
      setLoadingData(true);

      if (!isFirebaseConfigured()) {
        if (!active) return;
        setAllResults(
          buildSearchResults({
            announcements: mockAnnouncements,
            events: mockClubEvents,
            pois: demoPois,
            menus: demoMenus,
          })
        );
        setDataSource("demo");
        setLoadingData(false);
        return;
      }

      try {
        const [announcements, events, pois, menus] = await Promise.all([
          fetchAnnouncements(school.id, 40),
          fetchEvents(school.id, 40),
          fetchPois(school.id, 80),
          fetchMenus(school.id, 80),
        ]);

        if (!active) return;
        setAllResults(buildSearchResults({ announcements, events, pois, menus }));
        setDataSource("firebase");
      } catch (error) {
        console.error("Failed to load search data:", error);
        if (!active) return;
        setAllResults(
          buildSearchResults({
            announcements: mockAnnouncements,
            events: mockClubEvents,
            pois: demoPois,
            menus: demoMenus,
          })
        );
        setDataSource("demo");
      } finally {
        if (active) {
          setLoadingData(false);
        }
      }
    }

    loadSearchData();

    return () => {
      active = false;
    };
  }, [school.id]);

  const filteredResults = useMemo(() => {
    if (!query.trim()) return [];

    const lowerQuery = query.toLowerCase();
    return allResults.filter((result) => {
      const matchesQuery =
        result.title.toLowerCase().includes(lowerQuery) ||
        result.subtitle.toLowerCase().includes(lowerQuery) ||
        result.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery));

      const matchesCategory =
        category === "all" ||
        (category === "announcements" && result.type === "announcement") ||
        (category === "events" && result.type === "event") ||
        (category === "places" && result.type === "place") ||
        (category === "menus" && result.type === "menu") ||
        (category === "courses" && result.type === "course") ||
        (category === "people" && result.type === "person");

      return matchesQuery && matchesCategory;
    });
  }, [allResults, category, query]);

  const handleSearch = (searchQuery: string) => {
    setQuery(searchQuery);
    setShowSuggestions(false);
    setIsSearching(true);
    setTimeout(() => setIsSearching(false), 300);
  };

  const categories: { key: SearchCategory; label: string; icon: string; count?: number }[] = [
    { key: "all", label: "全部", icon: "🔍", count: filteredResults.length },
    { key: "announcements", label: "公告", icon: "📢", count: filteredResults.filter((r) => r.type === "announcement").length },
    { key: "events", label: "活動", icon: "🎉", count: filteredResults.filter((r) => r.type === "event").length },
    { key: "places", label: "地點", icon: "📍", count: filteredResults.filter((r) => r.type === "place").length },
    { key: "menus", label: "餐點", icon: "🍽️", count: filteredResults.filter((r) => r.type === "menu").length },
    { key: "courses", label: "課程", icon: "📚", count: filteredResults.filter((r) => r.type === "course").length },
    { key: "people", label: "人物", icon: "👤", count: filteredResults.filter((r) => r.type === "person").length },
  ];

  const highlightMatch = (text: string, keyword: string) => {
    if (!keyword.trim()) return text;
    const regex = new RegExp(`(${keyword})`, "gi");
    const parts = text.split(regex);
    const lowerKeyword = keyword.toLowerCase();
    return parts.map((part, i) =>
      part.toLowerCase() === lowerKeyword ? (
        <mark key={i} className="searchMark">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title="搜尋"
      subtitle="用同一個入口搜尋公告、活動、地點、餐點、課程與人物。"
    >
      <div className="pageStack">
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <span className="pill subtle">{dataSource === "demo" ? "示範資料" : "Firebase 資料"}</span>
        </div>

        <div className="card searchComposer">
          <div className={`searchComposerCard${showSuggestions ? " active" : ""}`}>
            <span aria-hidden style={{ fontSize: 20, color: "var(--muted)" }}>
              🔍
            </span>
            <input
              ref={inputRef}
              className="searchComposerInput"
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowSuggestions(e.target.value.length > 0);
              }}
              onFocus={() => setShowSuggestions(query.length > 0)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSearch(query);
                }
                if (e.key === "Escape") {
                  setShowSuggestions(false);
                }
              }}
              placeholder="搜尋公告、活動、地點、餐點、課程..."
            />
            {query && (
              <button
                type="button"
                className="searchComposerClear"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
              >
                ✕
              </button>
            )}
            <button className="btn primary" onClick={() => handleSearch(query)}>
              搜尋
            </button>
          </div>

          {showSuggestions && filteredResults.length > 0 && (
            <div className="searchSuggestions">
              {filteredResults.slice(0, 5).map((result) => (
                <Link
                  key={result.id}
                  href={withSchoolQuery(result.href, q)}
                  className="searchSuggestionItem"
                  onClick={() => setShowSuggestions(false)}
                >
                  <span aria-hidden style={{ fontSize: 24 }}>
                    {result.icon}
                  </span>
                  <div className="surfaceContent">
                    <div className="surfaceTitle">{highlightMatch(result.title, query)}</div>
                    <p className="surfaceMeta">{result.subtitle}</p>
                  </div>
                  <span className="metricMeta">→</span>
                </Link>
              ))}
              {filteredResults.length > 5 && (
                <button
                  type="button"
                  className="btn"
                  style={{ width: "100%" }}
                  onClick={() => {
                    handleSearch(query);
                  }}
                >
                  查看全部 {filteredResults.length} 個結果
                </button>
              )}
            </div>
          )}
        </div>

        {!query && (
          <>
            <section className="card sectionCard">
              <div className="sectionHead">
                <div className="sectionCopy">
                  <p className="sectionEyebrow">History</p>
                  <h2 className="sectionTitle">最近搜尋</h2>
                  <p className="sectionText">保留最近常用關鍵字，重新進站時可以直接重搜。</p>
                </div>
                <button type="button" className="btn">
                  清除
                </button>
              </div>

              <div className="toolbarActions">
                {RECENT_SEARCHES.map((search) => (
                  <button key={search} type="button" className="pill" onClick={() => handleSearch(search)}>
                    {search}
                  </button>
                ))}
              </div>
            </section>

            <section className="card sectionCard">
              <div className="sectionHead">
                <div className="sectionCopy">
                  <p className="sectionEyebrow">Trending</p>
                  <h2 className="sectionTitle">熱門搜尋</h2>
                  <p className="sectionText">把近期熱門題目集中成一列，避免每次都重新打字。</p>
                </div>
              </div>

              <div className="toolbarActions">
                {HOT_SEARCHES.map((search, idx) => (
                  <button
                    key={search}
                    type="button"
                    className="pill"
                    onClick={() => handleSearch(search)}
                    style={
                      idx < 3
                        ? {
                            background: "rgba(239, 109, 126, 0.16)",
                            color: "var(--danger)",
                          }
                        : undefined
                    }
                  >
                    <span style={{ color: idx < 3 ? "var(--danger)" : "var(--muted)", fontWeight: 700 }}>{idx + 1}</span>
                    {search}
                  </button>
                ))}
              </div>
            </section>

            <section className="card sectionCard">
              <div className="sectionHead">
                <div className="sectionCopy">
                  <p className="sectionEyebrow">Quick Access</p>
                  <h2 className="sectionTitle">快速前往</h2>
                  <p className="sectionText">常用模組統一成同樣的入口卡片，和其他頁面的層級保持一致。</p>
                </div>
              </div>

              <div className="tileGrid">
                {[
                  { icon: "📢", label: "公告", href: `/announcements${q}` },
                  { icon: "🎉", label: "活動", href: `/clubs${q}` },
                  { icon: "📍", label: "地圖", href: `/map${q}` },
                  { icon: "🍽️", label: "餐廳", href: `/cafeteria${q}` },
                  { icon: "📚", label: "圖書館", href: `/library${q}` },
                  { icon: "📅", label: "課表", href: `/timetable${q}` },
                ].map((link) => (
                  <Link key={link.label} href={link.href} className="tileLink">
                    <span className="tileIcon">{link.icon}</span>
                    <span className="tileLabel">{link.label}</span>
                  </Link>
                ))}
              </div>
            </section>
          </>
        )}

        {query && (
          <>
            {loadingData && (
              <div className="card" style={{ textAlign: "center", color: "var(--muted)" }}>
                正在同步搜尋索引...
              </div>
            )}

            <div className="card toolbarPanel">
              <div className="toolbarGrow segmentedGroup">
                {categories.map((cat) => (
                  <button
                    key={cat.key}
                    type="button"
                    className={`btn ${category === cat.key ? "primary" : ""}`}
                    onClick={() => setCategory(cat.key)}
                  >
                    {cat.icon} {cat.label}
                    {cat.count !== undefined && cat.count > 0 ? (
                      <span
                        className="statusBadge"
                        style={
                          category === cat.key
                            ? { background: "rgba(255,255,255,0.18)", color: "#fff" }
                            : ({ "--status-bg": "var(--panel2)", "--status-color": "var(--muted)" } as CSSProperties)
                        }
                      >
                        {cat.count}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            <section className="card sectionCard">
              <div className="sectionHead">
                <div className="sectionCopy">
                  <p className="sectionEyebrow">Results</p>
                  <h2 className="sectionTitle">{isSearching ? "搜尋中..." : `找到 ${filteredResults.length} 個結果`}</h2>
                  <p className="sectionText">搜尋結果已與公告、活動、地圖、餐廳頁共用同一套資料來源。</p>
                </div>
                <select className="input" style={{ maxWidth: 140 }}>
                  <option>相關性</option>
                  <option>最新</option>
                  <option>最舊</option>
                </select>
              </div>

              {filteredResults.length === 0 ? (
                <div className="emptyState">
                  <div className="emptyIcon">🔍</div>
                  <p className="emptyTitle">找不到「{query}」的相關結果</p>
                  <p className="emptyBody">請試試其他關鍵字，或先切回全部類別重新搜尋。</p>
                  <div className="toolbarActions" style={{ justifyContent: "center", marginTop: 20 }}>
                    <button type="button" className="btn" onClick={() => setQuery("")}>
                      清除搜尋
                    </button>
                    <button type="button" className="btn" onClick={() => setCategory("all")}>
                      顯示全部類別
                    </button>
                  </div>
                </div>
              ) : (
                <div className="surfaceList">
                  {filteredResults.map((result) => (
                    <Link key={result.id} href={withSchoolQuery(result.href, q)} className="surfaceItem">
                      <div className="surfaceAccent">{result.icon}</div>
                      <div className="surfaceContent">
                        <h3 className="surfaceTitle">{highlightMatch(result.title, query)}</h3>
                        <p className="surfaceMeta">{result.subtitle}</p>
                        {result.tags?.length ? (
                          <div className="surfaceTags">
                            {result.tags.map((tag) => (
                              <span key={tag} className="pill">
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <span className="metricMeta">→</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </SiteShell>
  );
}
