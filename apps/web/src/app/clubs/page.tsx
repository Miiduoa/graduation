"use client";

import { useState, useEffect, useMemo } from "react";
import { resolveSchool } from "@campus/shared/src/schools";
import { mockClubEvents } from "@campus/shared/src/mockData";
import { SiteShell } from "@/components/SiteShell";
import { fetchEvents, isFirebaseConfigured, type ClubEvent } from "@/lib/firebase";

type ViewMode = "list" | "grid" | "calendar";
type EventStatus = "all" | "upcoming" | "ongoing" | "ended";

export default function ClubsPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const school = resolveSchool({ school: props.searchParams?.school, schoolId: props.searchParams?.schoolId });
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState<EventStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [registeredEvents, setRegisteredEvents] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        if (isFirebaseConfigured()) {
          const data = await fetchEvents(school.id);
          setEvents(data.length > 0 ? data : mockClubEvents);
        } else {
          setEvents(mockClubEvents);
        }
      } catch (error) {
        console.error("Failed to load events:", error);
        setEvents(mockClubEvents);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [school.id]);

  const getEventStatus = (startsAt: string, endsAt: string): "upcoming" | "ongoing" | "ended" => {
    const now = new Date();
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (now < start) return "upcoming";
    if (now > end) return "ended";
    return "ongoing";
  };

  const getStatusBadge = (status: "upcoming" | "ongoing" | "ended") => {
    const styles: Record<string, { bg: string; color: string; text: string }> = {
      upcoming: { bg: "rgba(59, 130, 246, 0.2)", color: "#3B82F6", text: "即將開始" },
      ongoing: { bg: "rgba(16, 185, 129, 0.2)", color: "#10B981", text: "進行中" },
      ended: { bg: "rgba(107, 114, 128, 0.2)", color: "#6B7280", text: "已結束" },
    };
    const s = styles[status];
    return (
      <span style={{ padding: "3px 10px", borderRadius: 8, background: s.bg, color: s.color, fontSize: 12, fontWeight: 600 }}>
        {s.text}
      </span>
    );
  };

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      const status = getEventStatus(e.startsAt, e.endsAt);
      const matchesStatus = statusFilter === "all" || status === statusFilter;
      const matchesSearch = !searchQuery ||
        e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (e.description && e.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (e.location && e.location.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesStatus && matchesSearch;
    });
  }, [events, statusFilter, searchQuery]);

  const handleRegister = (eventId: string) => {
    setRegisteredEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  const formatDateTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("zh-TW", { 
        month: "short", 
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  const upcomingCount = events.filter(e => getEventStatus(e.startsAt, e.endsAt) === "upcoming").length;
  const ongoingCount = events.filter(e => getEventStatus(e.startsAt, e.endsAt) === "ongoing").length;

  if (loading) {
    return (
      <SiteShell
        schoolName={school.name}
        schoolCode={school.code}
        title="活動"
        subtitle={`探索校園精彩活動 · ${school.name}`}
      >
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
          <div style={{ color: "var(--muted)" }}>載入活動資料中...</div>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title="活動"
      subtitle={`探索校園精彩活動 · ${school.name}`}
    >
      {/* Stats Overview */}
      <div className="card" style={{ marginBottom: 20, padding: 16 }}>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "var(--brand)" }}>{events.length}</div>
            <div className="kv">總活動數</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#3B82F6" }}>{upcomingCount}</div>
            <div className="kv">即將開始</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#10B981" }}>{ongoingCount}</div>
            <div className="kv">進行中</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#F59E0B" }}>{registeredEvents.size}</div>
            <div className="kv">已報名</div>
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <div style={{ marginBottom: 20, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text"
          className="input"
          placeholder="搜尋活動名稱、說明或地點..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: "1 1 300px" }}
        />
        
        <div style={{ display: "flex", gap: 8 }}>
          {(["all", "upcoming", "ongoing", "ended"] as const).map((s) => {
            const labels: Record<EventStatus, string> = { all: "全部", upcoming: "即將", ongoing: "進行中", ended: "已結束" };
            return (
              <button
                key={s}
                className="btn"
                onClick={() => setStatusFilter(s)}
                style={{
                  background: statusFilter === s ? "var(--accent-soft)" : "var(--panel)",
                  borderColor: statusFilter === s ? "var(--brand)" : "var(--border)",
                  color: statusFilter === s ? "var(--brand)" : "var(--text)",
                  padding: "8px 14px",
                  fontSize: 13,
                }}
              >
                {labels[s]}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 4, border: "1px solid var(--border)", borderRadius: 10, padding: 4 }}>
          {(["list", "grid"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                border: "none",
                background: viewMode === mode ? "var(--panel2)" : "transparent",
                color: viewMode === mode ? "var(--text)" : "var(--muted)",
                padding: "6px 12px",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              {mode === "list" ? "📋" : "⊞"}
            </button>
          ))}
        </div>
      </div>

      {/* Events List/Grid */}
      {filteredEvents.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎭</div>
          <div style={{ color: "var(--muted)" }}>找不到符合的活動</div>
        </div>
      ) : (
        <div 
          className="list"
          style={{
            gridTemplateColumns: viewMode === "grid" ? "repeat(auto-fill, minmax(300px, 1fr))" : "1fr",
          }}
        >
          {filteredEvents.map((e) => {
            const status = getEventStatus(e.startsAt, e.endsAt);
            const isRegistered = registeredEvents.has(e.id);
            const canRegister = status === "upcoming";

            return (
              <div key={e.id} className="card">
                {/* Event Image Placeholder */}
                <div style={{ 
                  height: 120, 
                  background: "linear-gradient(135deg, var(--accent-soft), var(--panel2))",
                  borderRadius: 12,
                  marginBottom: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 40,
                }}>
                  🎉
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    {getStatusBadge(status)}
                    {isRegistered && (
                      <span style={{ 
                        padding: "3px 10px", 
                        borderRadius: 8, 
                        background: "rgba(139, 92, 246, 0.2)", 
                        color: "var(--brand)",
                        fontSize: 12,
                        fontWeight: 600,
                      }}>
                        ✓ 已報名
                      </span>
                    )}
                  </div>
                  
                  <h3 style={{ margin: "0 0 10px 0", fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>
                    {e.title}
                  </h3>
                  
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, color: "var(--muted)", fontSize: 13 }}>
                    <div>📅 {formatDateTime(e.startsAt)} ~ {formatDateTime(e.endsAt)}</div>
                    {e.location && <div>📍 {e.location}</div>}
                  </div>
                </div>

                {e.description && (
                  <p style={{ 
                    margin: "0 0 16px 0", 
                    lineHeight: 1.6, 
                    color: "var(--text)",
                    fontSize: 14,
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}>
                    {e.description}
                  </p>
                )}

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button 
                    className="btn"
                    onClick={() => canRegister && handleRegister(e.id)}
                    disabled={!canRegister}
                    style={{
                      flex: 1,
                      background: isRegistered ? "var(--accent-soft)" : canRegister ? "var(--brand)" : "var(--panel)",
                      borderColor: isRegistered ? "var(--brand)" : canRegister ? "var(--brand)" : "var(--border)",
                      color: isRegistered ? "var(--brand)" : canRegister ? "#fff" : "var(--muted)",
                      opacity: canRegister ? 1 : 0.6,
                      cursor: canRegister ? "pointer" : "not-allowed",
                    }}
                  >
                    {isRegistered ? "取消報名" : status === "ended" ? "已結束" : status === "ongoing" ? "進行中" : "立即報名"}
                  </button>
                  <button className="btn" style={{ padding: "10px 14px" }}>
                    🔗
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SiteShell>
  );
}
