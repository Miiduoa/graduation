"use client";

import { useState } from "react";
import { SiteShell } from "@/components/SiteShell";
import { resolveSchoolPageContext } from "@/lib/pageContext";

interface Location {
  id: string;
  name: string;
  category: string;
  description: string;
  distance: string;
  open: boolean;
  hours: string;
  icon: string;
}

const LOCATIONS: Location[] = [
  { id: "1", name: "工程館", category: "教學", description: "資工、電機系館，含電腦教室與實驗室", distance: "2 分鐘", open: true, hours: "07:00–22:00", icon: "🏛" },
  { id: "2", name: "圖書館", category: "學習", description: "全館 4 層，含靜讀區與討論室", distance: "5 分鐘", open: true, hours: "08:00–22:00", icon: "📚" },
  { id: "3", name: "第一餐廳", category: "餐廳", description: "主餐廳，含便當、麵食、素食等", distance: "3 分鐘", open: true, hours: "07:00–20:00", icon: "🍱" },
  { id: "4", name: "體育館", category: "運動", description: "羽球、桌球、籃球場地預約", distance: "8 分鐘", open: false, hours: "09:00–21:00", icon: "🏃" },
  { id: "5", name: "行政大樓", category: "行政", description: "教務處、學務處、總務處", distance: "4 分鐘", open: true, hours: "09:00–17:00", icon: "🏢" },
  { id: "6", name: "學生宿舍", category: "住宿", description: "男生宿舍一至四棟", distance: "6 分鐘", open: true, hours: "全天", icon: "🏠" },
  { id: "7", name: "校門口", category: "交通", description: "公車站、校園入口", distance: "10 分鐘", open: true, hours: "全天", icon: "🚌" },
  { id: "8", name: "健康中心", category: "醫療", description: "學生健康諮詢與急救", distance: "5 分鐘", open: true, hours: "09:00–17:00", icon: "🏥" },
];

const CATEGORIES = ["全部", "教學", "學習", "餐廳", "運動", "交通", "行政", "住宿", "醫療"];

export default function MapPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const { school } = resolveSchoolPageContext(props.searchParams);
  const [category, setCategory] = useState("全部");
  const [search, setSearch] = useState("");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set(["1", "2"]));

  const filtered = LOCATIONS.filter(
    (l) =>
      (category === "全部" || l.category === category) &&
      (!search || l.name.includes(search) || l.description.includes(search))
  );

  return (
    <SiteShell title="地圖" subtitle="校園位置與建築資訊" schoolName={school || undefined}>
      <div className="pageStack">
        {/* ── Map Placeholder ── */}
        <div
          className="card"
          style={{
            height: 220,
            background: "linear-gradient(135deg, var(--panel) 0%, var(--panel2) 100%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-inset)",
          }}
        >
          <div style={{ fontSize: 48 }}>🗺</div>
          <p style={{ fontSize: 14, color: "var(--muted)", margin: 0, fontWeight: 600 }}>
            互動地圖
          </p>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
            整合地圖功能開發中
          </p>
        </div>

        {/* ── Search + Filter ── */}
        <div className="toolbarPanel">
          <div className="toolbarGrow">
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", fontSize: 16, opacity: 0.5 }}>🔍</span>
              <input
                className="input"
                type="search"
                placeholder="搜尋建築或地點…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: 38, minHeight: 42 }}
              />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`pill${category === c ? " brand" : " subtle"}`}
              style={{ cursor: "pointer", border: "none" }}
            >
              {c}
            </button>
          ))}
        </div>

        {/* ── Location List ── */}
        <div className="insetGroup">
          {filtered.map((loc, i) => (
            <div
              key={loc.id}
              className="insetGroupRow"
              style={{ borderTop: i === 0 ? "none" : undefined, cursor: "pointer" }}
            >
              <div
                className="insetGroupRowIcon"
                style={{
                  fontSize: 22,
                  background: loc.open ? "var(--success-soft)" : "var(--panel)",
                  borderRadius: 10,
                }}
              >
                {loc.icon}
              </div>
              <div className="insetGroupRowContent">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="insetGroupRowTitle">{loc.name}</span>
                  <span
                    style={{
                      fontSize: 10,
                      padding: "2px 7px",
                      borderRadius: "999px",
                      background: loc.open ? "var(--success-soft)" : "var(--danger-soft)",
                      color: loc.open ? "var(--success)" : "var(--danger)",
                      fontWeight: 700,
                    }}
                  >
                    {loc.open ? "開放中" : "已關閉"}
                  </span>
                </div>
                <div className="insetGroupRowMeta">{loc.description} · {loc.hours}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: "var(--brand)", fontWeight: 600 }}>
                  🚶 {loc.distance}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSavedIds((prev) => {
                      const next = new Set(prev);
                      next.has(loc.id) ? next.delete(loc.id) : next.add(loc.id);
                      return next;
                    });
                  }}
                  style={{ fontSize: 16, background: "none", border: "none", cursor: "pointer" }}
                >
                  {savedIds.has(loc.id) ? "⭐" : "☆"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SiteShell>
  );
}
