"use client";

import { SiteShell } from "@/components/SiteShell";
import { resolveSchool } from "@campus/shared/src/schools";
import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";

type SearchCategory = "all" | "announcements" | "events" | "places" | "courses" | "people";

type SearchResult = {
  id: string;
  type: "announcement" | "event" | "place" | "course" | "person";
  title: string;
  subtitle: string;
  icon: string;
  href: string;
  tags?: string[];
  highlight?: string;
};

const MOCK_RESULTS: SearchResult[] = [
  { id: "1", type: "announcement", title: "期中考週圖書館延長開放", subtitle: "2025-03-15 · 學務處", icon: "📢", href: "/announcements", tags: ["學術", "圖書館"] },
  { id: "2", type: "announcement", title: "校慶運動會報名開始", subtitle: "2025-03-10 · 體育室", icon: "📢", href: "/announcements", tags: ["活動", "運動"] },
  { id: "3", type: "event", title: "程式設計競賽", subtitle: "2025-04-01 14:00 · 資訊大樓 301", icon: "🎉", href: "/clubs", tags: ["競賽", "程式"] },
  { id: "4", type: "event", title: "校園音樂節", subtitle: "2025-05-20 18:00 · 大禮堂", icon: "🎉", href: "/clubs", tags: ["音樂", "藝文"] },
  { id: "5", type: "place", title: "總圖書館", subtitle: "校園核心區 · 開放中", icon: "📍", href: "/map", tags: ["學習", "閱讀"] },
  { id: "6", type: "place", title: "學生餐廳", subtitle: "生活區 · 營業中", icon: "📍", href: "/cafeteria", tags: ["餐飲", "美食"] },
  { id: "7", type: "course", title: "資料結構", subtitle: "CS201 · 王教授 · 3學分", icon: "📚", href: "/timetable", tags: ["必修", "資工"] },
  { id: "8", type: "course", title: "人工智慧概論", subtitle: "CS402 · 周教授 · 3學分", icon: "📚", href: "/timetable", tags: ["選修", "AI"] },
  { id: "9", type: "person", title: "王大明 教授", subtitle: "資訊工程學系 · 副教授", icon: "👤", href: "#", tags: ["教師", "資工"] },
  { id: "10", type: "person", title: "李小華", subtitle: "資工系 大三 · 學生會幹部", icon: "👤", href: "#", tags: ["學生", "學生會"] },
];

const RECENT_SEARCHES = ["圖書館", "餐廳", "課程", "王教授", "活動"];
const HOT_SEARCHES = ["期中考", "校慶", "獎學金", "宿舍", "停車"];

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

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filteredResults = useMemo(() => {
    if (!query.trim()) return [];
    
    const lowerQuery = query.toLowerCase();
    return MOCK_RESULTS.filter((result) => {
      const matchesQuery = 
        result.title.toLowerCase().includes(lowerQuery) ||
        result.subtitle.toLowerCase().includes(lowerQuery) ||
        result.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery));
      
      const matchesCategory = category === "all" || 
        (category === "announcements" && result.type === "announcement") ||
        (category === "events" && result.type === "event") ||
        (category === "places" && result.type === "place") ||
        (category === "courses" && result.type === "course") ||
        (category === "people" && result.type === "person");
      
      return matchesQuery && matchesCategory;
    });
  }, [query, category]);

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
    { key: "courses", label: "課程", icon: "📚", count: filteredResults.filter((r) => r.type === "course").length },
    { key: "people", label: "人物", icon: "👤", count: filteredResults.filter((r) => r.type === "person").length },
  ];

  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text;
    const regex = new RegExp(`(${query})`, "gi");
    const parts = text.split(regex);
    return parts.map((part, i) => 
      regex.test(part) ? <mark key={i} style={{ background: "#FEF08A", padding: "0 2px", borderRadius: 2 }}>{part}</mark> : part
    );
  };

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title="🔍 搜尋"
      subtitle="搜尋公告、活動、地點、課程和更多"
    >
      {/* Search Input */}
      <div className="card" style={{ marginBottom: 24, position: "relative" }}>
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          gap: 12,
          padding: "4px 4px 4px 16px",
          background: "var(--panel2)",
          borderRadius: 12,
          border: "2px solid",
          borderColor: showSuggestions ? "var(--brand)" : "transparent",
          transition: "border-color 0.2s",
        }}>
          <span style={{ fontSize: 20, color: "var(--muted)" }}>🔍</span>
          <input
            ref={inputRef}
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
            placeholder="搜尋公告、活動、地點、課程..."
            style={{
              flex: 1,
              padding: "14px 0",
              border: "none",
              background: "transparent",
              color: "var(--text)",
              fontSize: 16,
              outline: "none",
            }}
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              style={{
                padding: 8,
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 18,
                color: "var(--muted)",
              }}
            >
              ✕
            </button>
          )}
          <button 
            className="btn primary" 
            onClick={() => handleSearch(query)}
            style={{ fontSize: 14, padding: "10px 20px" }}
          >
            搜尋
          </button>
        </div>

        {/* Suggestions Dropdown */}
        {showSuggestions && filteredResults.length > 0 && (
          <div style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 8,
            background: "var(--panel)",
            borderRadius: 12,
            boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
            zIndex: 100,
            maxHeight: 400,
            overflow: "auto",
          }}>
            {filteredResults.slice(0, 5).map((result) => (
              <Link
                key={result.id}
                href={result.href + q}
                onClick={() => setShowSuggestions(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: 16,
                  borderBottom: "1px solid var(--border)",
                  textDecoration: "none",
                  color: "var(--text)",
                  transition: "background 0.2s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--panel2)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ fontSize: 24 }}>{result.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{highlightMatch(result.title, query)}</div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{result.subtitle}</div>
                </div>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>→</span>
              </Link>
            ))}
            {filteredResults.length > 5 && (
              <button
                onClick={() => {
                  handleSearch(query);
                }}
                style={{
                  width: "100%",
                  padding: 16,
                  background: "none",
                  border: "none",
                  color: "var(--brand)",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                查看全部 {filteredResults.length} 個結果 →
              </button>
            )}
          </div>
        )}
      </div>

      {/* No Query State */}
      {!query && (
        <>
          {/* Recent Searches */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "space-between",
              marginBottom: 16,
            }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>🕐 最近搜尋</h2>
              <button style={{ 
                background: "none", 
                border: "none", 
                color: "var(--brand)", 
                cursor: "pointer",
                fontSize: 13,
              }}>
                清除
              </button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {RECENT_SEARCHES.map((search) => (
                <button
                  key={search}
                  className="pill"
                  onClick={() => handleSearch(search)}
                  style={{ cursor: "pointer", background: "var(--panel2)" }}
                >
                  {search}
                </button>
              ))}
            </div>
          </div>

          {/* Hot Searches */}
          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 700 }}>🔥 熱門搜尋</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {HOT_SEARCHES.map((search, idx) => (
                <button
                  key={search}
                  className="pill"
                  onClick={() => handleSearch(search)}
                  style={{ 
                    cursor: "pointer", 
                    background: idx < 3 ? "rgba(239,68,68,0.1)" : "var(--panel2)",
                    color: idx < 3 ? "#EF4444" : "var(--text)",
                  }}
                >
                  <span style={{ 
                    marginRight: 6, 
                    fontWeight: 700,
                    color: idx < 3 ? "#EF4444" : "var(--muted)",
                  }}>
                    {idx + 1}
                  </span>
                  {search}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Links */}
          <div className="card">
            <h2 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 700 }}>⚡ 快速前往</h2>
            <div style={{ 
              display: "grid", 
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", 
              gap: 12 
            }}>
              {[
                { icon: "📢", label: "公告", href: `/announcements${q}` },
                { icon: "🎉", label: "活動", href: `/clubs${q}` },
                { icon: "📍", label: "地圖", href: `/map${q}` },
                { icon: "🍽️", label: "餐廳", href: `/cafeteria${q}` },
                { icon: "📚", label: "圖書館", href: `/library${q}` },
                { icon: "📅", label: "課表", href: `/timetable${q}` },
              ].map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="btn"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                    padding: 16,
                    textDecoration: "none",
                  }}
                >
                  <span style={{ fontSize: 24 }}>{link.icon}</span>
                  <span style={{ fontSize: 13 }}>{link.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Search Results */}
      {query && (
        <>
          {/* Category Tabs */}
          <div className="card" style={{ marginBottom: 24, padding: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {categories.map((cat) => (
                <button
                  key={cat.key}
                  className={`btn ${category === cat.key ? "primary" : ""}`}
                  onClick={() => setCategory(cat.key)}
                  style={{ fontSize: 13 }}
                >
                  {cat.icon} {cat.label}
                  {cat.count !== undefined && cat.count > 0 && (
                    <span style={{ 
                      marginLeft: 6, 
                      padding: "2px 6px", 
                      background: category === cat.key ? "rgba(255,255,255,0.2)" : "var(--panel2)",
                      borderRadius: 999,
                      fontSize: 11,
                    }}>
                      {cat.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Results */}
          <div className="card">
            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "space-between",
              marginBottom: 20,
            }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                {isSearching ? "⏳ 搜尋中..." : `找到 ${filteredResults.length} 個結果`}
              </h2>
              <select
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--panel2)",
                  color: "var(--text)",
                  fontSize: 13,
                }}
              >
                <option>相關性</option>
                <option>最新</option>
                <option>最舊</option>
              </select>
            </div>

            {filteredResults.length === 0 ? (
              <div style={{ 
                textAlign: "center", 
                padding: 60, 
                color: "var(--muted)",
              }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
                  找不到「{query}」的相關結果
                </div>
                <div style={{ fontSize: 14, marginBottom: 24 }}>
                  請嘗試其他關鍵字或調整搜尋條件
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                  <button className="btn" onClick={() => setQuery("")}>
                    清除搜尋
                  </button>
                  <button className="btn" onClick={() => setCategory("all")}>
                    顯示全部類別
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {filteredResults.map((result) => (
                  <Link
                    key={result.id}
                    href={result.href + q}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 16,
                      padding: 16,
                      background: "var(--panel2)",
                      borderRadius: 12,
                      textDecoration: "none",
                      color: "var(--text)",
                      transition: "transform 0.2s, box-shadow 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateX(4px)";
                      e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "translateX(0)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <div style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      background: "var(--panel)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 24,
                      flexShrink: 0,
                    }}>
                      {result.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
                        {highlightMatch(result.title, query)}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>
                        {result.subtitle}
                      </div>
                      {result.tags && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {result.tags.map((tag) => (
                            <span 
                              key={tag} 
                              className="pill"
                              style={{ fontSize: 11, padding: "2px 8px" }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span style={{ color: "var(--muted)", fontSize: 14 }}>→</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </SiteShell>
  );
}
