"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SiteShell } from "@/components/SiteShell";
import { resolveSchoolPageContext } from "@/lib/pageContext";

interface SearchResult {
  id: string;
  type: "announcement" | "course" | "location" | "club";
  title: string;
  subtitle: string;
  href: string;
  icon: string;
}

const TYPE_LABELS = {
  announcement: "公告",
  course: "課程",
  location: "地點",
  club: "社團",
};

const MOCK_RESULTS: SearchResult[] = [
  { id: "1", type: "announcement", title: "期末考試時間表公布", subtitle: "6/17–6/23 期末考試", href: "/announcements", icon: "📢" },
  { id: "2", type: "course", title: "資料結構", subtitle: "王大明 · 工程館 302 · 週一 08:10", href: "/timetable", icon: "📘" },
  { id: "3", type: "location", title: "圖書館", subtitle: "二樓安靜區有 15 席可用", href: "/library", icon: "📚" },
  { id: "4", type: "club", title: "程式設計社", subtitle: "本週五黑客松活動", href: "/clubs", icon: "💻" },
];

const QUICK_LINKS = [
  { label: "課表", href: "/timetable", icon: "📅" },
  { label: "成績", href: "/grades", icon: "📊" },
  { label: "公告", href: "/announcements", icon: "📢" },
  { label: "地圖", href: "/map", icon: "🗺" },
  { label: "圖書館", href: "/library", icon: "📚" },
  { label: "餐廳", href: "/cafeteria", icon: "🍱" },
];

export default function SearchPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(() => {
      setResults(
        MOCK_RESULTS.filter(
          (r) =>
            r.title.toLowerCase().includes(query.toLowerCase()) ||
            r.subtitle.toLowerCase().includes(query.toLowerCase())
        )
      );
      setIsSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <SiteShell schoolName={schoolName}>
      <div className="pageStack" style={{ maxWidth: 680, margin: "0 auto" }}>
        {/* ── Search Bar ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 6px 6px 16px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid",
            borderColor: query ? "var(--brand)" : "var(--border)",
            background: "var(--surface)",
            boxShadow: query
              ? "var(--shadow-inset), 0 0 0 3px var(--focus-ring)"
              : "var(--shadow-inset)",
            transition: "border-color 0.2s ease, box-shadow 0.2s ease",
          }}
        >
          <span style={{ fontSize: 18, opacity: 0.5, flexShrink: 0 }}>🔍</span>
          <input
            autoFocus
            type="search"
            placeholder="搜尋課程、公告、地點、社團…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              fontSize: 16,
              color: "var(--text)",
              outline: "none",
              padding: "12px 0",
              fontFamily: "inherit",
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 18, padding: "4px 8px" }}
            >
              ✕
            </button>
          )}
        </div>

        {/* ── Quick Links (when no query) ── */}
        {!query && (
          <div className="sectionCard">
            <h3 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              快速導覽
            </h3>
            <div className="tileGrid">
              {QUICK_LINKS.map((l) => (
                <Link key={l.href} href={`${l.href}${q}`} className="tileLink">
                  <span className="tileIcon">{l.icon}</span>
                  <span className="tileLabel">{l.label}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ── Results ── */}
        {query && (
          <div>
            {isSearching ? (
              <div className="pageStack">
                {[1, 2, 3].map((i) => (
                  <div key={i} style={{ display: "flex", gap: 12, padding: "14px 16px", background: "var(--surface)", borderRadius: "var(--radius-sm)" }}>
                    <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0 }} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                      <div className="skeleton" style={{ height: 14, width: "70%" }} />
                      <div className="skeleton" style={{ height: 12, width: "50%" }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : results.length === 0 ? (
              <div className="emptyState">
                <div className="emptyIcon">🔍</div>
                <h3 className="emptyTitle">找不到「{query}」的結果</h3>
                <p className="emptyBody">嘗試不同的關鍵字或縮短搜尋詞</p>
              </div>
            ) : (
              <div className="insetGroup">
                {results.map((r, i) => (
                  <Link
                    key={r.id}
                    href={`${r.href}${q}`}
                    className="insetGroupRow"
                    style={{ borderTop: i === 0 ? "none" : undefined }}
                  >
                    <div className="insetGroupRowIcon" style={{ fontSize: 20, background: "var(--panel)", borderRadius: 10 }}>
                      {r.icon}
                    </div>
                    <div className="insetGroupRowContent">
                      <div className="insetGroupRowTitle">{r.title}</div>
                      <div className="insetGroupRowMeta">{r.subtitle}</div>
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: "999px",
                        background: "var(--panel2)",
                        color: "var(--muted)",
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {TYPE_LABELS[r.type]}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </SiteShell>
  );
}
