"use client";

import { useState, type CSSProperties } from "react";
import { SiteShell } from "@/components/SiteShell";
import { resolveSchoolPageContext } from "@/lib/pageContext";

interface BorrowedBook {
  id: string;
  title: string;
  author: string;
  dueDate: string;
  daysLeft: number;
  renewCount: number;
}

interface Zone {
  name: string;
  total: number;
  occupied: number;
  quiet: boolean;
}

const DEFAULT_BORROWED: BorrowedBook[] = [
  { id: "1", title: "深入淺出設計模式", author: "Eric Freeman", dueDate: "2026-03-25", daysLeft: 7, renewCount: 0 },
  { id: "2", title: "Clean Code", author: "Robert C. Martin", dueDate: "2026-04-01", daysLeft: 14, renewCount: 1 },
  { id: "3", title: "人月神話", author: "Fred Brooks", dueDate: "2026-03-20", daysLeft: 2, renewCount: 2 },
];

const DEFAULT_ZONES: Zone[] = [
  { name: "一樓閱覽區", total: 80, occupied: 32, quiet: false },
  { name: "二樓安靜區", total: 60, occupied: 45, quiet: true },
  { name: "三樓討論室", total: 40, occupied: 28, quiet: false },
  { name: "四樓研究室", total: 30, occupied: 18, quiet: true },
];

type Tab = "borrow" | "seats" | "search";

export default function LibraryPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const { schoolName } = resolveSchoolPageContext(props.searchParams);
  const [activeTab, setActiveTab] = useState<Tab>("borrow");
  const [searchQuery, setSearchQuery] = useState("");

  const totalAvailable = DEFAULT_ZONES.reduce((sum, z) => sum + (z.total - z.occupied), 0);
  const urgentBooks = DEFAULT_BORROWED.filter((b) => b.daysLeft <= 3).length;

  return (
    <SiteShell title="圖書館" subtitle="借閱管理與座位資訊" schoolName={schoolName}>
      <div className="pageStack">
        {/* ── Stats ── */}
        <div className="metricGrid">
          <div className="metricCard" style={{ "--tone": "var(--brand)" } as CSSProperties}>
            <div className="metricIcon">📚</div>
            <div className="metricValue">{DEFAULT_BORROWED.length}</div>
            <div className="metricLabel">借閱中</div>
          </div>
          <div className="metricCard" style={{ "--tone": urgentBooks > 0 ? "var(--danger)" : "var(--success)" } as CSSProperties}>
            <div className="metricIcon">{urgentBooks > 0 ? "⚠️" : "✅"}</div>
            <div className="metricValue">{urgentBooks}</div>
            <div className="metricLabel">即將到期</div>
          </div>
          <div className="metricCard" style={{ "--tone": "#34C759" } as CSSProperties}>
            <div className="metricIcon">🪑</div>
            <div className="metricValue">{totalAvailable}</div>
            <div className="metricLabel">可用座位</div>
          </div>
          <div className="metricCard" style={{ "--tone": "#007AFF" } as CSSProperties}>
            <div className="metricIcon">🕐</div>
            <div className="metricValue">22:00</div>
            <div className="metricLabel">今日關閉</div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="segmentedGroup">
          {([
            { key: "borrow", label: "📚 我的借閱" },
            { key: "seats", label: "🪑 座位查詢" },
            { key: "search", label: "🔍 書目搜尋" },
          ] as { key: Tab; label: string }[]).map((t) => (
            <button
              key={t.key}
              className={activeTab === t.key ? "active" : ""}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Borrow Tab ── */}
        {activeTab === "borrow" && (
          <div className="pageStack">
            {urgentBooks > 0 && (
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--danger-soft)",
                  border: "1px solid rgba(255,59,48,0.18)",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 13,
                  color: "var(--danger)",
                  fontWeight: 600,
                }}
              >
                ⚠️ 您有 {urgentBooks} 本書籍即將到期（3 天內），請盡快歸還或續借
              </div>
            )}
            <div className="insetGroup">
              {DEFAULT_BORROWED.map((book, i) => {
                const isUrgent = book.daysLeft <= 3;
                const isExpiring = book.daysLeft <= 7;
                return (
                  <div key={book.id} className="insetGroupRow" style={{ borderTop: i === 0 ? "none" : undefined }}>
                    <div
                      className="insetGroupRowIcon"
                      style={{
                        background: isUrgent ? "var(--danger-soft)" : isExpiring ? "var(--warning-soft)" : "var(--accent-soft)",
                        fontSize: 20,
                      }}
                    >
                      📖
                    </div>
                    <div className="insetGroupRowContent">
                      <div className="insetGroupRowTitle">{book.title}</div>
                      <div className="insetGroupRowMeta">
                        {book.author} · 到期：{book.dueDate} · 已續借 {book.renewCount} 次
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div
                        style={{
                          fontSize: 16,
                          fontWeight: 800,
                          color: isUrgent ? "var(--danger)" : isExpiring ? "var(--warning)" : "var(--success)",
                          letterSpacing: "-0.03em",
                        }}
                      >
                        {book.daysLeft} 天
                      </div>
                      {book.renewCount < 3 && (
                        <button
                          style={{
                            fontSize: 11,
                            color: "var(--brand)",
                            fontWeight: 600,
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: 0,
                            marginTop: 2,
                          }}
                        >
                          續借
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Seats Tab ── */}
        {activeTab === "seats" && (
          <div className="pageStack">
            <div className="grid-2">
              {DEFAULT_ZONES.map((zone) => {
                const pct = (zone.occupied / zone.total) * 100;
                const avail = zone.total - zone.occupied;
                const color = pct > 80 ? "var(--danger)" : pct > 60 ? "var(--warning)" : "var(--success)";
                return (
                  <div key={zone.name} className="card">
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700 }}>{zone.name}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                          {zone.quiet ? "🔇 安靜區域" : "💬 可交談"}
                        </div>
                      </div>
                      <span className="pill" style={{ background: `${color.includes("success") ? "var(--success-soft)" : color.includes("warning") ? "var(--warning-soft)" : "var(--danger-soft)"}`, color, border: "none", boxShadow: "none", fontSize: 11 }}>
                        {avail} 席
                      </span>
                    </div>
                    <div className="progressMeta">
                      <span style={{ fontSize: 12 }}>{zone.occupied}/{zone.total} 已使用</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color }}>{Math.round(pct)}%</span>
                    </div>
                    <div className="progressTrack">
                      <div
                        className="progressFill"
                        style={
                          {
                            "--progress-width": `${pct}%`,
                            "--progress": `linear-gradient(90deg, ${color}, ${color})`,
                          } as CSSProperties
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Search Tab ── */}
        {activeTab === "search" && (
          <div className="pageStack">
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 17, pointerEvents: "none", opacity: 0.5 }}>🔍</span>
              <input
                className="input"
                type="search"
                placeholder="輸入書名、作者或 ISBN…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: 42 }}
              />
            </div>
            <div className="emptyState" style={{ background: "var(--panel)" }}>
              <div className="emptyIcon">📖</div>
              <h3 className="emptyTitle">{searchQuery ? "搜尋結果" : "輸入關鍵字開始搜尋"}</h3>
              <p className="emptyBody">支援書名、作者、ISBN 搜尋館藏資料</p>
            </div>
          </div>
        )}
      </div>
    </SiteShell>
  );
}
