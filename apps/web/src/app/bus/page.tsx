"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { SiteShell } from "@/components/SiteShell";
import { resolveSchool } from "@campus/shared/src/schools";
import { fetchBusRoutes, isFirebaseConfigured } from "@/lib/firebase";

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
  color: string;
};

const DEFAULT_ROUTES: RouteDisplay[] = [
  {
    id: "1",
    name: "校園環線",
    color: "#8B5CF6",
    stops: ["校門口", "體育館", "圖書館", "工學院", "學生宿舍", "校門口"],
    interval: "10-15 分鐘",
    firstBus: "07:00",
    lastBus: "22:00",
  },
  {
    id: "2",
    name: "捷運接駁線",
    color: "#10B981",
    stops: ["校門口", "捷運站"],
    interval: "15-20 分鐘",
    firstBus: "06:30",
    lastBus: "23:00",
  },
  {
    id: "3",
    name: "火車站接駁線",
    color: "#3B82F6",
    stops: ["校門口", "火車站"],
    interval: "20-30 分鐘",
    firstBus: "07:00",
    lastBus: "21:30",
  },
];

function generateMockArrivals(routes: RouteDisplay[]): UpcomingBus[] {
  const arrivals: UpcomingBus[] = [];
  routes.forEach((route) => {
    const randomStopIdx = Math.floor(Math.random() * (route.stops.length - 1));
    arrivals.push({
      route: route.name,
      stop: route.stops[randomStopIdx],
      arrival: `${Math.floor(Math.random() * 15) + 1} 分鐘`,
      color: route.color,
    });
  });
  return arrivals.sort((a, b) => parseInt(a.arrival) - parseInt(b.arrival));
}

export default function BusPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const school = resolveSchool({
    school: props.searchParams?.school,
    schoolId: props.searchParams?.schoolId,
  });

  const [routes, setRoutes] = useState<RouteDisplay[]>(DEFAULT_ROUTES);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadData = useCallback(async () => {
    if (!isFirebaseConfigured()) {
      setRoutes(DEFAULT_ROUTES);
      setLoading(false);
      return;
    }

    try {
      const firebaseRoutes = await fetchBusRoutes(school.id);
      if (firebaseRoutes.length > 0) {
        const converted: RouteDisplay[] = firebaseRoutes.map((r, idx) => ({
          id: r.id,
          name: r.name,
          color: r.color || ["#8B5CF6", "#10B981", "#3B82F6", "#F59E0B"][idx % 4],
          stops: r.stops.map((s) => s.name),
          interval: "10-15 分鐘",
          firstBus: "07:00",
          lastBus: "22:00",
        }));
        setRoutes(converted);
      } else {
        setRoutes(DEFAULT_ROUTES);
      }
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Failed to load bus routes:", error);
      setRoutes(DEFAULT_ROUTES);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [school.id]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const upcomingBuses = useMemo(() => generateMockArrivals(routes), [routes]);

  const stops = useMemo(() => {
    const stopMap = new Map<string, Set<string>>();
    routes.forEach((route) => {
      route.stops.forEach((stop) => {
        if (!stopMap.has(stop)) {
          stopMap.set(stop, new Set());
        }
        stopMap.get(stop)!.add(route.name);
      });
    });
    return Array.from(stopMap.entries()).map(([name, routeSet], idx) => ({
      id: `${idx + 1}`,
      name,
      routes: Array.from(routeSet),
    }));
  }, [routes]);

  if (loading) {
    return (
      <SiteShell
        schoolName={school.name}
        schoolCode={school.code}
        title="🚌 校園公車"
        subtitle="即時動態 · 路線查詢 · 到站提醒"
      >
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⏳</div>
          <div style={{ color: "var(--muted)" }}>載入公車資訊中...</div>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title="🚌 校園公車"
      subtitle="即時動態 · 路線查詢 · 到站提醒"
    >
      {/* Upcoming Arrivals */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between",
          marginBottom: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>🕐 即將到站</h2>
            {lastUpdated && (
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                更新於 {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button 
              className="btn" 
              style={{ fontSize: 13 }}
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? "⏳" : "🔄"} 重新整理
            </button>
            <button className="btn" style={{ fontSize: 13 }}>
              📍 我的位置
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {upcomingBuses.map((bus, idx) => (
            <div 
              key={idx}
              style={{
                padding: 16,
                background: "var(--panel2)",
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                gap: 16,
                borderLeft: `4px solid ${bus.color}`,
              }}
            >
              <div style={{
                width: 50,
                height: 50,
                borderRadius: 12,
                background: `${bus.color}20`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
              }}>
                🚌
              </div>
              
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{bus.route}</div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  📍 {bus.stop}
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ 
                  fontSize: 24, 
                  fontWeight: 800, 
                  color: bus.arrival.includes("2") ? "#10B981" : "var(--text)",
                }}>
                  {bus.arrival}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>後到達</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Route List */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 16px 0", fontSize: 18, fontWeight: 700 }}>🗺️ 路線資訊</h2>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {routes.map((route) => (
            <div 
              key={route.id}
              style={{
                padding: 16,
                background: "var(--panel2)",
                borderRadius: 12,
                borderLeft: `4px solid ${route.color}`,
              }}
            >
              <div style={{ 
                display: "flex", 
                alignItems: "center", 
                justifyContent: "space-between",
                marginBottom: 12,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    background: route.color,
                  }} />
                  <span style={{ fontWeight: 700, fontSize: 16 }}>{route.name}</span>
                </div>
                <span className="pill">{route.interval}</span>
              </div>
              
              <div style={{ 
                display: "flex", 
                alignItems: "center", 
                gap: 8,
                marginBottom: 12,
                flexWrap: "wrap",
              }}>
                {route.stops.map((stop, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ 
                      padding: "4px 10px", 
                      background: "var(--bg)", 
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 500,
                    }}>
                      {stop}
                    </span>
                    {idx < route.stops.length - 1 && (
                      <span style={{ color: "var(--muted)" }}>→</span>
                    )}
                  </div>
                ))}
              </div>
              
              <div style={{ 
                display: "flex", 
                gap: 16, 
                fontSize: 12, 
                color: "var(--muted)" 
              }}>
                <span>首班 {route.firstBus}</span>
                <span>末班 {route.lastBus}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stop List */}
      <div className="card">
        <h2 style={{ margin: "0 0 16px 0", fontSize: 18, fontWeight: 700 }}>📍 站點列表</h2>
        
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", 
          gap: 12 
        }}>
          {stops.map((stop) => (
            <div 
              key={stop.id}
              className="card"
              style={{
                padding: 16,
                cursor: "pointer",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{stop.name}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {stop.routes.map((route) => {
                  const routeInfo = routes.find((r) => r.name === route);
                  return (
                    <span 
                      key={route}
                      style={{
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: `${routeInfo?.color}20`,
                        color: routeInfo?.color,
                      }}
                    >
                      {route}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SiteShell>
  );
}
