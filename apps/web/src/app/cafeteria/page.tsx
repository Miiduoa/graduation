"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { SiteShell } from "@/components/SiteShell";
import { resolveSchoolPageContext } from "@/lib/pageContext";

type MealPeriod = "breakfast" | "lunch" | "dinner";

interface MenuItem {
  id: string;
  name: string;
  price: number;
  cafeteria: string;
  category: string;
  rating: number;
  calories?: number;
  tags?: string[];
  period: MealPeriod[];
}

const MOCK_MENUS: MenuItem[] = [
  { id: "1", name: "雞腿便當", price: 85, cafeteria: "第一餐廳", category: "便當", rating: 4.6, calories: 650, tags: ["熱門"], period: ["lunch", "dinner"] },
  { id: "2", name: "排骨飯", price: 75, cafeteria: "第一餐廳", category: "便當", rating: 4.2, calories: 580, tags: [], period: ["lunch"] },
  { id: "3", name: "魚排飯", price: 70, cafeteria: "第二餐廳", category: "便當", rating: 4.4, calories: 520, tags: ["推薦"], period: ["lunch", "dinner"] },
  { id: "4", name: "素食套餐", price: 60, cafeteria: "第二餐廳", category: "素食", rating: 4.1, calories: 420, tags: ["素食"], period: ["lunch"] },
  { id: "5", name: "牛肉麵", price: 90, cafeteria: "小吃部", category: "麵食", rating: 4.8, calories: 680, tags: ["熱門", "限量"], period: ["lunch", "dinner"] },
  { id: "6", name: "蔥油拌麵", price: 55, cafeteria: "小吃部", category: "麵食", rating: 4.3, calories: 400, tags: [], period: ["lunch"] },
  { id: "7", name: "總匯三明治", price: 45, cafeteria: "輕食吧", category: "輕食", rating: 4.0, calories: 350, tags: [], period: ["breakfast", "lunch"] },
  { id: "8", name: "豆漿油條", price: 30, cafeteria: "輕食吧", category: "輕食", rating: 4.5, calories: 280, tags: ["早餐"], period: ["breakfast"] },
];

const CAFETERIAS = ["全部", "第一餐廳", "第二餐廳", "小吃部", "輕食吧"];
const PERIODS: { key: MealPeriod; label: string; time: string }[] = [
  { key: "breakfast", label: "早餐", time: "07:00–09:30" },
  { key: "lunch", label: "午餐", time: "11:00–14:00" },
  { key: "dinner", label: "晚餐", time: "17:00–20:00" },
];

const nowPeriod = (): MealPeriod => {
  const h = new Date().getHours();
  if (h < 10) return "breakfast";
  if (h < 15) return "lunch";
  return "dinner";
};

export default function CafeteriaPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const { school } = resolveSchoolPageContext(props.searchParams);
  const [selectedCafeteria, setSelectedCafeteria] = useState("全部");
  const [period, setPeriod] = useState<MealPeriod>(nowPeriod());
  const [search, setSearch] = useState("");
  const [userRatings, setUserRatings] = useState<Record<string, number>>({});

  const filtered = useMemo(
    () =>
      MOCK_MENUS.filter(
        (m) =>
          (selectedCafeteria === "全部" || m.cafeteria === selectedCafeteria) &&
          m.period.includes(period) &&
          (!search || m.name.includes(search) || m.cafeteria.includes(search))
      ),
    [selectedCafeteria, period, search]
  );

  const byRestaurant = useMemo(() => {
    const map: Record<string, MenuItem[]> = {};
    for (const item of filtered) {
      if (!map[item.cafeteria]) map[item.cafeteria] = [];
      map[item.cafeteria].push(item);
    }
    return map;
  }, [filtered]);

  const currentPeriod = PERIODS.find((p) => p.key === period)!;

  return (
    <SiteShell title="餐廳" subtitle="今日菜單與時段總覽" schoolName={school || undefined}>
      <div className="pageStack">
        {/* ── Period Selector ── */}
        <div className="metricGrid">
          {PERIODS.map((p) => {
            const isActive = period === p.key;
            const now = new Date().getHours();
            const isCurrent = (p.key === "breakfast" && now < 10) || (p.key === "lunch" && now < 15 && now >= 10) || (p.key === "dinner" && now >= 15);
            return (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className="metricCard"
                style={{
                  cursor: "pointer",
                  border: isActive ? "1px solid var(--brand)" : "1px solid var(--border)",
                  background: isActive ? "var(--accent-soft)" : "var(--surface)",
                  boxShadow: isActive ? "var(--shadow-sm)" : "var(--shadow-sm)",
                  transition: "all 0.15s ease",
                  textAlign: "left",
                  "--tone": isActive ? "var(--brand)" : "var(--muted)",
                } as CSSProperties}
              >
                <div className="metricIcon">
                  {p.key === "breakfast" ? "🌅" : p.key === "lunch" ? "☀️" : "🌙"}
                </div>
                <div className="metricValue" style={{ fontSize: 18 }}>{p.label}</div>
                <div className="metricLabel">{p.time}</div>
                {isCurrent && <div className="metricMeta" style={{ color: "var(--success)", fontWeight: 700 }}>● 供應中</div>}
              </button>
            );
          })}
        </div>

        {/* ── Search + Filter ── */}
        <div className="toolbarPanel">
          <div className="toolbarGrow">
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 16, pointerEvents: "none" }}>🔍</span>
              <input
                className="input"
                type="search"
                placeholder="搜尋菜名或餐廳…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: 38, minHeight: 42 }}
              />
            </div>
          </div>
          <div className="toolbarActions" style={{ gap: 6, flexWrap: "wrap" }}>
            {CAFETERIAS.map((c) => (
              <button
                key={c}
                onClick={() => setSelectedCafeteria(c)}
                className={`pill${selectedCafeteria === c ? " brand" : " subtle"}`}
                style={{ cursor: "pointer", border: "none", background: undefined }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* ── Menu by Restaurant ── */}
        {Object.keys(byRestaurant).length === 0 ? (
          <div className="emptyState">
            <div className="emptyIcon">🍽</div>
            <h3 className="emptyTitle">目前無菜單資料</h3>
            <p className="emptyBody">此時段或餐廳暫無供應，請切換時段查看</p>
          </div>
        ) : (
          Object.entries(byRestaurant).map(([restaurant, items]) => (
            <div key={restaurant} className="sectionCard">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>
                  {restaurant}
                </h3>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{items.length} 項</span>
              </div>
              <div className="insetGroup">
                {items.map((item, i) => (
                  <div key={item.id} className="insetGroupRow" style={{ borderTop: i === 0 ? "none" : undefined }}>
                    <div
                      className="insetGroupRowIcon"
                      style={{ fontSize: 22, background: "var(--panel)", borderRadius: 10 }}
                    >
                      {item.category === "便當" ? "🍱" : item.category === "麵食" ? "🍜" : item.category === "素食" ? "🥗" : "🥪"}
                    </div>
                    <div className="insetGroupRowContent">
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="insetGroupRowTitle">{item.name}</span>
                        {item.tags?.map((t) => (
                          <span key={t} className="pill" style={{ fontSize: 10, padding: "2px 7px", background: "var(--warning-soft)", color: "var(--warning)", border: "none", boxShadow: "none" }}>
                            {t}
                          </span>
                        ))}
                      </div>
                      <div className="insetGroupRowMeta">
                        {"★".repeat(Math.round(item.rating))}{"☆".repeat(5 - Math.round(item.rating))}
                        {" "}{item.rating.toFixed(1)}
                        {item.calories ? ` · ${item.calories} kcal` : ""}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "var(--brand)", letterSpacing: "-0.04em" }}>
                        ${item.price}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </SiteShell>
  );
}
