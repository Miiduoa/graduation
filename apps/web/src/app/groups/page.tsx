"use client";

import { useState } from "react";
import { SiteShell } from "@/components/SiteShell";
import { resolveSchoolPageContext } from "@/lib/pageContext";

interface Group {
  id: string;
  name: string;
  type: "course" | "club";
  members: number;
  unread: number;
  lastMessage: string;
  lastTime: string;
  color: string;
  icon: string;
}

const MOCK_GROUPS: Group[] = [
  { id: "1", name: "資料結構 – 王大明班", type: "course", members: 48, unread: 2, lastMessage: "下週考試範圍確認到第七章", lastTime: "5 分鐘前", color: "#5E6AD2", icon: "📘" },
  { id: "2", name: "作業系統討論區", type: "course", members: 76, unread: 0, lastMessage: "第三次作業延期到週五", lastTime: "1 小時前", color: "#007AFF", icon: "💻" },
  { id: "3", name: "程式設計社", type: "club", members: 120, unread: 5, lastMessage: "本週五舉辦黑客松活動！", lastTime: "3 小時前", color: "#34C759", icon: "👨‍💻" },
  { id: "4", name: "計算機網路 A班", type: "course", members: 35, unread: 0, lastMessage: "期末專題分組截止日 5/1", lastTime: "昨天", color: "#FF9500", icon: "🌐" },
  { id: "5", name: "攝影社", type: "club", members: 88, unread: 1, lastMessage: "三月份外拍活動照片上傳啦", lastTime: "昨天", color: "#BF5AF2", icon: "📷" },
  { id: "6", name: "微積分 – 吳俊傑班", type: "course", members: 95, unread: 0, lastMessage: "補充教材已上傳至平台", lastTime: "2 天前", color: "#FF3B30", icon: "📐" },
];

export default function GroupsPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const { school } = resolveSchoolPageContext(props.searchParams);
  const [filter, setFilter] = useState<"all" | "course" | "club">("all");
  const [search, setSearch] = useState("");

  const filtered = MOCK_GROUPS.filter(
    (g) =>
      (filter === "all" || g.type === filter) &&
      (!search || g.name.includes(search))
  );

  const totalUnread = MOCK_GROUPS.reduce((s, g) => s + g.unread, 0);

  return (
    <SiteShell title="群組" subtitle="課程討論與社團交流" schoolName={school || undefined}>
      <div className="pageStack">
        {/* ── Stats ── */}
        <div className="metricGrid">
          <div className="metricCard" style={{ "--tone": "var(--brand)" } as React.CSSProperties}>
            <div className="metricIcon">💬</div>
            <div className="metricValue">{MOCK_GROUPS.length}</div>
            <div className="metricLabel">已加入群組</div>
          </div>
          <div className="metricCard" style={{ "--tone": totalUnread > 0 ? "#FF3B30" : "#34C759" } as React.CSSProperties}>
            <div className="metricIcon">{totalUnread > 0 ? "🔴" : "✅"}</div>
            <div className="metricValue">{totalUnread}</div>
            <div className="metricLabel">未讀訊息</div>
          </div>
          <div className="metricCard" style={{ "--tone": "#007AFF" } as React.CSSProperties}>
            <div className="metricIcon">📚</div>
            <div className="metricValue">{MOCK_GROUPS.filter((g) => g.type === "course").length}</div>
            <div className="metricLabel">課程群組</div>
          </div>
        </div>

        {/* ── Search + Filter ── */}
        <div className="toolbarPanel">
          <div className="toolbarGrow">
            <input
              className="input"
              type="search"
              placeholder="搜尋群組…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minHeight: 42 }}
            />
          </div>
          <div className="segmentedGroup">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部</button>
            <button className={filter === "course" ? "active" : ""} onClick={() => setFilter("course")}>課程</button>
            <button className={filter === "club" ? "active" : ""} onClick={() => setFilter("club")}>社團</button>
          </div>
        </div>

        {/* ── Group List ── */}
        <div className="insetGroup">
          {filtered.map((g, i) => (
            <div key={g.id} className="insetGroupRow" style={{ borderTop: i === 0 ? "none" : undefined, cursor: "pointer", position: "relative" }}>
              <div
                className="insetGroupRowIcon"
                style={{
                  fontSize: 22,
                  background: `${g.color}14`,
                  color: g.color,
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  flexShrink: 0,
                }}
              >
                {g.icon}
              </div>
              <div className="insetGroupRowContent">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="insetGroupRowTitle">{g.name}</span>
                  <span
                    style={{
                      fontSize: 10,
                      padding: "2px 7px",
                      borderRadius: "999px",
                      background: g.type === "course" ? "var(--info-soft)" : "var(--success-soft)",
                      color: g.type === "course" ? "var(--info)" : "var(--success)",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {g.type === "course" ? "課程" : "社團"}
                  </span>
                </div>
                <div className="insetGroupRowMeta" style={{ display: "flex", gap: 6 }}>
                  <span>{g.lastMessage}</span>
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{g.lastTime}</span>
                {g.unread > 0 && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      background: "var(--danger)",
                      color: "#fff",
                      borderRadius: "999px",
                      padding: "2px 7px",
                      minWidth: 20,
                      textAlign: "center",
                    }}
                  >
                    {g.unread}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="emptyState">
            <div className="emptyIcon">💬</div>
            <h3 className="emptyTitle">找不到群組</h3>
            <p className="emptyBody">嘗試調整搜尋條件</p>
          </div>
        )}
      </div>
    </SiteShell>
  );
}
