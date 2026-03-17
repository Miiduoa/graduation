"use client";

import { useMemo, useState } from "react";
import { resolveSchool } from "@campus/shared/src/schools";
import { mockMenus } from "@campus/shared/src/mockData";
import { SiteShell } from "@/components/SiteShell";

type SortBy = "default" | "price-asc" | "price-desc" | "rating";

export default function CafeteriaPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const school = resolveSchool({ school: props.searchParams?.school, schoolId: props.searchParams?.schoolId });
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCafeteria, setSelectedCafeteria] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortBy>("default");
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 200]);
  const [ratings, setRatings] = useState<Record<string, number>>({});

  const cafeterias = ["all", ...new Set(mockMenus.map((m) => m.cafeteria))];

  const filteredMenus = useMemo(() => {
    return mockMenus
      .filter((m) => {
        const matchesSearch =
          !searchQuery ||
          m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.cafeteria.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCafeteria = selectedCafeteria === "all" || m.cafeteria === selectedCafeteria;
        const price = m.price ?? 0;
        const matchesPrice = price >= priceRange[0] && price <= priceRange[1];
        return matchesSearch && matchesCafeteria && matchesPrice;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case "price-asc":
            return (a.price ?? 0) - (b.price ?? 0);
          case "price-desc":
            return (b.price ?? 0) - (a.price ?? 0);
          case "rating":
            return (ratings[b.id] ?? 0) - (ratings[a.id] ?? 0);
          default:
            return 0;
        }
      });
  }, [priceRange, ratings, searchQuery, selectedCafeteria, sortBy]);

  const handleRate = (menuId: string, rating: number) => {
    setRatings((prev) => ({ ...prev, [menuId]: rating }));
  };

  const avgPrice = Math.round(mockMenus.reduce((sum, m) => sum + (m.price ?? 0), 0) / mockMenus.length);

  const RatingStars = ({ rating, onRate, menuId }: { rating: number; onRate: (id: string, r: number) => void; menuId: string }) => (
    <div style={{ display: "flex", gap: 4 }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => onRate(menuId, star)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 18,
            padding: 0,
            color: star <= rating ? "#F59E0B" : "var(--muted)",
            transition: "transform 0.1s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.2)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
        >
          ★
        </button>
      ))}
    </div>
  );

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title="餐廳"
      subtitle={`今日菜單與價格資訊 · ${school.name}`}
    >
      {/* Stats Overview */}
      <div className="card" style={{ marginBottom: 20, padding: 16 }}>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "var(--brand)" }}>{mockMenus.length}</div>
            <div className="kv">菜單品項</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#10B981" }}>{cafeterias.length - 1}</div>
            <div className="kv">餐廳數量</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#F59E0B" }}>${avgPrice}</div>
            <div className="kv">平均價格</div>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <input
            type="text"
            className="input"
            placeholder="搜尋菜名或餐廳..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ flex: "1 1 250px" }}
          />

          <select
            className="input"
            value={selectedCafeteria}
            onChange={(e) => setSelectedCafeteria(e.target.value)}
            style={{ flex: "0 0 150px" }}
          >
            {cafeterias.map((c) => (
              <option key={c} value={c}>
                {c === "all" ? "全部餐廳" : c}
              </option>
            ))}
          </select>

          <select
            className="input"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            style={{ flex: "0 0 130px" }}
          >
            <option value="default">預設排序</option>
            <option value="price-asc">價格低→高</option>
            <option value="price-desc">價格高→低</option>
            <option value="rating">評分高→低</option>
          </select>
        </div>

        {/* Price Range Filter */}
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>💰 價格範圍:</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="number"
                className="input"
                value={priceRange[0]}
                onChange={(e) => setPriceRange([Number(e.target.value), priceRange[1]])}
                style={{ width: 80, padding: "8px 12px" }}
                min={0}
              />
              <span>~</span>
              <input
                type="number"
                className="input"
                value={priceRange[1]}
                onChange={(e) => setPriceRange([priceRange[0], Number(e.target.value)])}
                style={{ width: 80, padding: "8px 12px" }}
                min={0}
              />
            </div>
            <button 
              className="btn" 
              onClick={() => setPriceRange([0, 200])}
              style={{ padding: "8px 12px", fontSize: 12 }}
            >
              重置
            </button>
          </div>
        </div>
      </div>

      {/* Menu Grid */}
      {filteredMenus.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🍽️</div>
          <div style={{ color: "var(--muted)" }}>找不到符合的菜單</div>
        </div>
      ) : (
        <div 
          className="list"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
        >
          {filteredMenus.map((m) => {
            const rating = ratings[m.id] ?? 0;
            const isPopular = m.price && m.price > 80;
            const isAffordable = m.price && m.price <= 50;

            return (
              <div key={m.id} className="card">
                {/* Food Image Placeholder */}
                <div style={{ 
                  height: 100, 
                  background: "linear-gradient(135deg, rgba(245, 158, 11, 0.2), var(--panel2))",
                  borderRadius: 12,
                  marginBottom: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 36,
                  position: "relative",
                }}>
                  🍱
                  {isPopular && (
                    <span style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      padding: "3px 8px",
                      background: "rgba(239, 68, 68, 0.9)",
                      borderRadius: 6,
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#fff",
                    }}>
                      人氣
                    </span>
                  )}
                  {isAffordable && (
                    <span style={{
                      position: "absolute",
                      top: 8,
                      left: 8,
                      padding: "3px 8px",
                      background: "rgba(16, 185, 129, 0.9)",
                      borderRadius: 6,
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#fff",
                    }}>
                      平價
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ margin: "0 0 8px 0", fontSize: 16, fontWeight: 700, letterSpacing: -0.3 }}>
                      {m.name}
                    </h3>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      <span className="pill" style={{ fontSize: 11, padding: "4px 10px" }}>{m.cafeteria}</span>
                      <span className="pill subtle" style={{ fontSize: 11, padding: "4px 10px" }}>{m.availableOn}</span>
                    </div>
                    <RatingStars rating={rating} onRate={handleRate} menuId={m.id} />
                  </div>
                  {m.price && (
                    <div style={{ 
                      fontSize: 22, 
                      fontWeight: 800, 
                      color: "var(--brand)",
                      background: "var(--accent-soft)",
                      padding: "6px 12px",
                      borderRadius: 10,
                    }}>
                      ${m.price}
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                  <button 
                    className="btn" 
                    style={{ flex: 1, fontSize: 13, padding: "10px" }}
                  >
                    📝 評論
                  </button>
                  <button 
                    className="btn" 
                    style={{ flex: 1, fontSize: 13, padding: "10px" }}
                  >
                    🛒 點餐
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
