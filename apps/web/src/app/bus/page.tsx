"use client";

import { useState, useEffect, useMemo, type CSSProperties } from "react";
import { SiteShell } from "@/components/SiteShell";
import { resolveSchoolPageContext } from "@/lib/pageContext";

type RouteDisplay = {
  id: string;
  name: string;
  color: string;
  stops: string[];
  interval: string;
  firstBus: string;
  lastBus: string;
};

type UpcomingBus = {
  route: string;
  stop: string;
  arrival: string;
  minutesAway: number;
  color: string;
};

const DEFAULT_ROUTES: RouteDisplay[] = [
  { id: "1", name: "校園環線", color: "#5E6AD2", stops: ["校門口", "體育館", "圖書館", "工學院", "宿舍", "校門口"], interval: "10–15 分", firstBus: "07:00", lastBus: "22:00" },
  { id: "2", name: "捷運接駁線", color: "#34C759", stops: ["校門口", "捷運站"], interval: "20 分", firstBus: "07:30", lastBus: "22:30" },
  { id: "3", name: "宿舍快線", color: "#FF9500", stops: ["校門口", "男宿", "女宿", "研究生宿舍"], interval: "15 分", firstBus: "08:00", lastBus: "23:00" },
  { id: "4", name: "夜間安心線", color: "#FF3B30", stops: ["圖書館", "女宿", "男宿", "校門口"], interval: "30 分", firstBus: "22:00", lastBus: "01:00" },
];

const DEFAULT_UPCOMING: UpcomingBus[] = [
  { route: "校園環線", stop: "校門口", arrival: "8 分鐘", minutesAway: 8, color: "#5E6AD2" },
  { route: "捷運接駁線", stop: "校門口", arrival: "12 分鐘", minutesAway: 12, color: "#34C759" },
  { route: "宿舍快線", stop: "校門口", arrival: "18 分鐘", minutesAway: 18, color: "#FF9500" },
  { route: "校園環線", stop: "校門口", arrival: "23 分鐘", minutesAway: 23, color: "#5E6AD2" },
];

export default function BusPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const { schoolName } = resolveSchoolPageContext(props.searchParams);
  const [selectedRoute, setSelectedRoute] = useState<string>("all");
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const timeStr = now.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  const nextBus = DEFAULT_UPCOMING[0];

  return (
    <SiteShell title="公車" subtitle="校園接駁即時資訊" schoolName={schoolName}>
      <div className="pageStack">
        {/* ── Next Bus Hero ── */}
        <div
          className="card"
          style={{
            background: `linear-gradient(135deg, ${nextBus.color} 0%, ${nextBus.color}AA 100%)`,
            border: "none",
            color: "#fff",
            boxShadow: `6px 6px 16px ${nextBus.color}40, -3px -3px 8px rgba(255,255,255,0.7)`,
            padding: "24px 28px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <p style={{ margin: "0 0 4px", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.75, fontWeight: 600 }}>
                下一班 · {timeStr}
              </p>
              <div style={{ fontSize: 64, fontWeight: 900, letterSpacing: "-0.06em", lineHeight: 1 }}>
                {nextBus.minutesAway}<span style={{ fontSize: 28, fontWeight: 700, marginLeft: 4 }}>分</span>
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 15, opacity: 0.88 }}>
                {nextBus.route} · {nextBus.stop}
              </p>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {DEFAULT_UPCOMING.slice(1, 3).map((b, i) => (
                <div key={i} style={{ textAlign: "center", background: "rgba(255,255,255,0.18)", padding: "12px 18px", borderRadius: "var(--radius-sm)", border: "1px solid rgba(255,255,255,0.25)" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.05em" }}>{b.minutesAway}<span style={{ fontSize: 14 }}>分</span></div>
                  <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{b.route.slice(0, 5)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Upcoming Buses ── */}
        <div className="sectionCard">
          <h3 className="sectionTitle">🚌 即將到站</h3>
          <div className="insetGroup">
            {DEFAULT_UPCOMING.map((b, i) => (
              <div key={i} className="insetGroupRow" style={{ borderTop: i === 0 ? "none" : undefined }}>
                <div className="insetGroupRowIcon" style={{ background: `${b.color}18`, fontSize: 20 }}>🚌</div>
                <div className="insetGroupRowContent">
                  <div className="insetGroupRowTitle">{b.route}</div>
                  <div className="insetGroupRowMeta">{b.stop}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: b.color, letterSpacing: "-0.04em" }}>
                    {b.minutesAway}<span style={{ fontSize: 12, fontWeight: 600 }}> 分</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>後到站</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Route Selector ── */}
        <div className="toolbarPanel">
          <div className="segmentedGroup" style={{ width: "100%" }}>
            <button className={selectedRoute === "all" ? "active" : ""} onClick={() => setSelectedRoute("all")}>全部路線</button>
            {DEFAULT_ROUTES.map((r) => (
              <button key={r.id} className={selectedRoute === r.id ? "active" : ""} onClick={() => setSelectedRoute(r.id)}>
                {r.name}
              </button>
            ))}
          </div>
        </div>

        {/* ── Routes ── */}
        <div className="pageStack">
          {DEFAULT_ROUTES
            .filter((r) => selectedRoute === "all" || r.id === selectedRoute)
            .map((route) => (
              <div key={route.id} className="card" style={{ borderLeft: `4px solid ${route.color}` }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 12, height: 12, borderRadius: "50%", background: route.color, flexShrink: 0 }} />
                      <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{route.name}</h3>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                      每 {route.interval} · {route.firstBus}–{route.lastBus}
                    </div>
                  </div>
                  <span className="pill" style={{ background: `${route.color}14`, color: route.color, borderColor: `${route.color}20` }}>
                    {route.interval}
                  </span>
                </div>

                {/* Stop timeline */}
                <div style={{ display: "flex", alignItems: "center", gap: 0, overflowX: "auto", padding: "4px 0" }}>
                  {route.stops.map((stop, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                        <div style={{
                          width: 10, height: 10, borderRadius: "50%",
                          background: route.color,
                          border: i === 0 ? "3px solid white" : "2px solid " + route.color,
                          boxShadow: "var(--shadow-sm)",
                        }} />
                        <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap", fontWeight: 600 }}>
                          {stop}
                        </span>
                      </div>
                      {i < route.stops.length - 1 && (
                        <div style={{ width: 28, height: 2, background: `${route.color}40`, flexShrink: 0, margin: "-8px 0 0" }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </div>
    </SiteShell>
  );
}
