"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { mockMenus } from "@campus/shared/src/mockData";
import { SiteShell } from "@/components/SiteShell";
import {
  fetchCafeterias,
  fetchMenus,
  subscribeCafeterias,
  subscribeMenus,
  type Cafeteria,
  type MenuItem,
} from "@/lib/firebase";
import { resolveSchoolPageContext } from "@/lib/pageContext";
import { useSchoolCollectionData } from "@/lib/useSchoolCollectionData";

const ALL_CAFETERIAS_KEY = "all";

const DEMO_MENUS: MenuItem[] = mockMenus.map((menu) => ({
  ...menu,
  available: true,
  soldOut: false,
}));

const DEMO_CAFETERIAS: Cafeteria[] = Array.from(
  new Map(
    DEMO_MENUS.map((menu) => [
      menu.cafeteria,
      {
        id: `demo-${menu.cafeteria}`,
        name: menu.cafeteria,
      } satisfies Cafeteria,
    ])
  ).values()
).sort((a, b) => a.name.localeCompare(b.name, "zh-TW"));

function getCafeteriaKey(input: {
  id?: string | null;
  cafeteriaId?: string | null;
  cafeteria?: string | null;
  name?: string | null;
}) {
  return input.id || input.cafeteriaId || input.name || input.cafeteria || "";
}

function toSearchText(parts: Array<string | null | undefined>) {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function formatLastUpdated(value?: string) {
  if (!value) {
    return "等待同步";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "等待同步";
  }

  return date.toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getMenuIcon(category?: string) {
  if (!category) return "🍽️";
  if (category.includes("飯") || category.includes("便當") || category.includes("主餐")) return "🍱";
  if (category.includes("麵")) return "🍜";
  if (category.includes("素")) return "🥗";
  if (category.includes("飲")) return "🥤";
  if (category.includes("點心") || category.includes("輕食")) return "🥪";
  return "🍽️";
}

function getCafeteriaStatus(cafeteria: Cafeteria) {
  if (cafeteria.orderingEnabled && cafeteria.pilotStatus === "live") {
    return {
      label: "營運中",
      color: "var(--success)",
      background: "var(--success-soft)",
    };
  }

  if (cafeteria.orderingEnabled && cafeteria.pilotStatus === "pilot") {
    return {
      label: "試營運",
      color: "var(--warning)",
      background: "var(--warning-soft)",
    };
  }

  return {
    label: "資訊展示",
    color: "var(--muted)",
    background: "var(--panel)",
  };
}

export default function CafeteriaPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const { schoolId, schoolName } = resolveSchoolPageContext(props.searchParams);
  const [selectedCafeteria, setSelectedCafeteria] = useState(ALL_CAFETERIAS_KEY);
  const [search, setSearch] = useState("");

  const {
    data: cafeteriaRows,
    loading: cafeteriaLoading,
    sourceMode: cafeteriaSourceMode,
  } = useSchoolCollectionData<Cafeteria>(schoolId, fetchCafeterias, DEMO_CAFETERIAS, {
    subscribeLive: subscribeCafeterias,
  });

  const {
    data: menuRows,
    loading: menuLoading,
    sourceMode: menuSourceMode,
  } = useSchoolCollectionData<MenuItem>(schoolId, fetchMenus, DEMO_MENUS, {
    subscribeLive: subscribeMenus,
  });

  const loading = cafeteriaLoading || menuLoading;

  const cafeterias = useMemo(() => {
    const merged = new Map<string, Cafeteria>();

    cafeteriaRows.forEach((cafeteria) => {
      const key = getCafeteriaKey(cafeteria);
      if (!key) return;
      merged.set(key, {
        ...cafeteria,
        id: cafeteria.id || key,
        name: cafeteria.name || "未命名餐廳",
      });
    });

    menuRows.forEach((menu) => {
      const key = getCafeteriaKey(menu);
      if (!key || merged.has(key)) return;

      merged.set(key, {
        id: menu.cafeteriaId || key,
        name: menu.cafeteria || "未命名餐廳",
      });
    });

    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name, "zh-TW"));
  }, [cafeteriaRows, menuRows]);

  const menusByCafeteria = useMemo(() => {
    const grouped = new Map<string, MenuItem[]>();

    menuRows.forEach((menu) => {
      const key = getCafeteriaKey(menu);
      if (!key) return;

      const bucket = grouped.get(key) ?? [];
      bucket.push(menu);
      grouped.set(key, bucket);
    });

    grouped.forEach((items, key) => {
      grouped.set(
        key,
        [...items].sort((a, b) => {
          const aTime = new Date(a.updatedAt ?? a.availableOn ?? a.createdAt ?? "").getTime() || 0;
          const bTime = new Date(b.updatedAt ?? b.availableOn ?? b.createdAt ?? "").getTime() || 0;
          if (bTime !== aTime) {
            return bTime - aTime;
          }
          return a.name.localeCompare(b.name, "zh-TW");
        })
      );
    });

    return grouped;
  }, [menuRows]);

  const sections = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return cafeterias
      .map((cafeteria) => {
        const key = getCafeteriaKey(cafeteria);
        const allItems = menusByCafeteria.get(key) ?? [];
        const cafeteriaMatches =
          needle.length === 0 ||
          toSearchText([cafeteria.name, cafeteria.location, cafeteria.openingHours]).includes(needle);
        const items =
          needle.length === 0 || cafeteriaMatches
            ? allItems
            : allItems.filter((item) =>
                toSearchText([item.name, item.category, item.description, item.cafeteria]).includes(needle)
              );

        if (selectedCafeteria !== ALL_CAFETERIAS_KEY && key !== selectedCafeteria) {
          return null;
        }

        if (needle.length > 0 && !cafeteriaMatches && items.length === 0) {
          return null;
        }

        return {
          key,
          cafeteria,
          items,
          totalCount: allItems.length,
          availableCount: allItems.filter((item) => item.available !== false && item.soldOut !== true).length,
        };
      })
      .filter((section): section is NonNullable<typeof section> => section !== null);
  }, [cafeterias, menusByCafeteria, search, selectedCafeteria]);

  const stats = useMemo(() => {
    const liveOrdering = cafeterias.filter(
      (cafeteria) => cafeteria.orderingEnabled && cafeteria.pilotStatus !== "inactive"
    ).length;
    const availableMenus = menuRows.filter(
      (menu) => menu.available !== false && menu.soldOut !== true
    ).length;
    const soldOutMenus = menuRows.filter(
      (menu) => menu.available === false || menu.soldOut === true
    ).length;

    return {
      cafeterias: cafeterias.length,
      menuItems: menuRows.length,
      liveOrdering,
      availableMenus,
      soldOutMenus,
    };
  }, [cafeterias, menuRows]);

  const lastUpdatedAt = useMemo(() => {
    const timestamps = [
      ...cafeterias.map((cafeteria) => cafeteria.updatedAt ?? cafeteria.createdAt),
      ...menuRows.map((menu) => menu.updatedAt ?? menu.availableOn ?? menu.createdAt),
    ]
      .map((value) => (value ? new Date(value).getTime() : 0))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (timestamps.length === 0) {
      return undefined;
    }

    return new Date(Math.max(...timestamps)).toISOString();
  }, [cafeterias, menuRows]);

  const sourceLabel =
    cafeteriaSourceMode === "firebase" && menuSourceMode === "firebase"
      ? "即時資料"
      : cafeteriaSourceMode === "demo" && menuSourceMode === "demo"
        ? "示範資料"
        : "部分示範資料";

  return (
    <SiteShell title="餐廳" subtitle="即時同步目前校內餐廳與菜單" schoolName={schoolName}>
      <div className="pageStack">
        <div className="toolbarPanel" style={{ alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className={`pill${sourceLabel === "即時資料" ? " brand" : " subtle"}`}>{sourceLabel}</span>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>
                最後同步：{formatLastUpdated(lastUpdatedAt)}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
              餐廳新增、下架或菜單異動會直接反映在這裡。
            </p>
          </div>
          {loading ? <span className="pill subtle">同步中…</span> : null}
        </div>

        <div className="metricGrid">
          <div className="metricCard" style={{ "--tone": "var(--brand)" } as CSSProperties}>
            <div className="metricIcon">🏫</div>
            <div className="metricValue">{stats.cafeterias}</div>
            <div className="metricLabel">校內餐廳</div>
          </div>
          <div className="metricCard" style={{ "--tone": "var(--success)" } as CSSProperties}>
            <div className="metricIcon">🍽️</div>
            <div className="metricValue">{stats.availableMenus}</div>
            <div className="metricLabel">供應中菜色</div>
          </div>
          <div className="metricCard" style={{ "--tone": "var(--warning)" } as CSSProperties}>
            <div className="metricIcon">🧾</div>
            <div className="metricValue">{stats.menuItems}</div>
            <div className="metricLabel">菜單總數</div>
          </div>
          <div className="metricCard" style={{ "--tone": "var(--info)" } as CSSProperties}>
            <div className="metricIcon">🛒</div>
            <div className="metricValue">{stats.liveOrdering}</div>
            <div className="metricLabel">可點餐餐廳</div>
          </div>
        </div>

        <div className="toolbarPanel">
          <div className="toolbarGrow">
            <div style={{ position: "relative" }}>
              <span
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: 16,
                  pointerEvents: "none",
                }}
              >
                🔍
              </span>
              <input
                className="input"
                type="search"
                placeholder="搜尋菜名、類別或餐廳…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                style={{ paddingLeft: 38, minHeight: 42 }}
              />
            </div>
          </div>
          <div className="toolbarActions" style={{ gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setSelectedCafeteria(ALL_CAFETERIAS_KEY)}
              className={`pill${selectedCafeteria === ALL_CAFETERIAS_KEY ? " brand" : " subtle"}`}
              style={{ cursor: "pointer", border: "none", background: undefined }}
            >
              全部餐廳
            </button>
            {cafeterias.map((cafeteria) => {
              const key = getCafeteriaKey(cafeteria);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedCafeteria(key)}
                  className={`pill${selectedCafeteria === key ? " brand" : " subtle"}`}
                  style={{ cursor: "pointer", border: "none", background: undefined }}
                >
                  {cafeteria.name}
                </button>
              );
            })}
          </div>
        </div>

        {sections.length === 0 ? (
          <div className="emptyState">
            <div className="emptyIcon">🍽️</div>
            <h3 className="emptyTitle">
              {search.trim() || selectedCafeteria !== ALL_CAFETERIAS_KEY ? "找不到符合的餐廳或菜單" : "目前沒有餐廳資料"}
            </h3>
            <p className="emptyBody">
              {search.trim() || selectedCafeteria !== ALL_CAFETERIAS_KEY
                ? "請調整搜尋關鍵字或切換其他餐廳。"
                : "餐廳與菜單同步完成後會自動顯示在這裡。"}
            </p>
          </div>
        ) : (
          sections.map(({ key, cafeteria, items, availableCount, totalCount }) => {
            const status = getCafeteriaStatus(cafeteria);

            return (
              <div key={key} className="sectionCard">
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 16,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <h3 style={{ margin: 0, fontSize: 22 }}>{cafeteria.name}</h3>
                      <span
                        className="pill"
                        style={{
                          background: status.background,
                          color: status.color,
                          border: "none",
                          boxShadow: "none",
                        }}
                      >
                        {status.label}
                      </span>
                      {cafeteria.brandKey ? <span className="pill subtle">{cafeteria.brandKey}</span> : null}
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", color: "var(--muted)", fontSize: 13 }}>
                      {cafeteria.location ? <span>📍 {cafeteria.location}</span> : null}
                      {cafeteria.openingHours ? <span>🕒 {cafeteria.openingHours}</span> : null}
                      {typeof cafeteria.currentOccupancy === "number" ? (
                        <span>👥 目前約 {cafeteria.currentOccupancy} 人</span>
                      ) : null}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", minWidth: 120 }}>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>供應中 / 菜單總數</div>
                    <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.04em" }}>
                      {availableCount} / {totalCount}
                    </div>
                    {typeof cafeteria.rating === "number" ? (
                      <div style={{ fontSize: 13, color: "var(--muted)" }}>
                        ★ {cafeteria.rating.toFixed(1)}
                        {typeof cafeteria.reviewCount === "number" ? ` · ${cafeteria.reviewCount} 則評價` : ""}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="insetGroup">
                  {items.length === 0 ? (
                    <div className="insetGroupRow" style={{ borderTop: "none" }}>
                      <div className="insetGroupRowIcon" style={{ fontSize: 22, background: "var(--panel)", borderRadius: 10 }}>
                        📭
                      </div>
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">目前尚未上架菜單</div>
                        <div className="insetGroupRowMeta">這間餐廳已在校內名單中，菜單同步後會即時顯示。</div>
                      </div>
                    </div>
                  ) : (
                    items.map((item, index) => (
                      <div
                        key={item.id}
                        className="insetGroupRow"
                        style={{
                          borderTop: index === 0 ? "none" : undefined,
                          opacity: item.available === false || item.soldOut === true ? 0.6 : 1,
                        }}
                      >
                        <div
                          className="insetGroupRowIcon"
                          style={{ fontSize: 22, background: "var(--panel)", borderRadius: 10 }}
                        >
                          {getMenuIcon(item.category)}
                        </div>
                        <div className="insetGroupRowContent">
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span className="insetGroupRowTitle">{item.name}</span>
                            {item.category ? <span className="pill subtle">{item.category}</span> : null}
                            <span
                              className="pill"
                              style={{
                                background:
                                  item.available === false || item.soldOut === true
                                    ? "var(--danger-soft)"
                                    : "var(--success-soft)",
                                color:
                                  item.available === false || item.soldOut === true
                                    ? "var(--danger)"
                                    : "var(--success)",
                                border: "none",
                                boxShadow: "none",
                              }}
                            >
                              {item.available === false || item.soldOut === true ? "已售完" : "供應中"}
                            </span>
                            {item.tags?.map((tag) => (
                              <span
                                key={tag}
                                className="pill"
                                style={{
                                  fontSize: 10,
                                  padding: "2px 7px",
                                  background: "var(--warning-soft)",
                                  color: "var(--warning)",
                                  border: "none",
                                  boxShadow: "none",
                                }}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          <div className="insetGroupRowMeta">
                            {typeof item.rating === "number" ? `★ ${item.rating.toFixed(1)} · ` : ""}
                            {typeof item.calories === "number" ? `${item.calories} kcal · ` : ""}
                            {item.updatedAt || item.availableOn
                              ? `更新於 ${formatLastUpdated(item.updatedAt ?? item.availableOn)}`
                              : "等待同步"}
                          </div>
                          {item.description ? (
                            <div style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>
                              {item.description}
                            </div>
                          ) : null}
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div
                            style={{
                              fontSize: 20,
                              fontWeight: 800,
                              color: "var(--brand)",
                              letterSpacing: "-0.04em",
                            }}
                          >
                            {typeof item.price === "number" ? `NT$${item.price}` : "未標價"}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })
        )}

        {stats.soldOutMenus > 0 ? (
          <div className="card" style={{ color: "var(--muted)", fontSize: 13 }}>
            目前共有 {stats.soldOutMenus} 項菜色標記為售完，若店家更新供應狀態，頁面會自動刷新。
          </div>
        ) : null}
      </div>
    </SiteShell>
  );
}
