"use client";

import { useEffect, useMemo, useState } from "react";
import { resolveSchool } from "@campus/shared/src/schools";
import { mockMenus } from "@campus/shared/src/mockData";
import { SiteShell } from "@/components/SiteShell";
import { useAuth } from "@/components/AuthGuard";
import { useToast } from "@/components/ui";
import { fetchMenus, rateMenuItem, type MenuItem } from "@/lib/firebase";
import { useSchoolCollectionData } from "@/lib/useSchoolCollectionData";

type SortBy = "default" | "price-asc" | "price-desc" | "rating";

export default function CafeteriaPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const school = resolveSchool({ school: props.searchParams?.school, schoolId: props.searchParams?.schoolId });
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCafeteria, setSelectedCafeteria] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortBy>("default");
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 200]);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [favoriteMenus, setFavoriteMenus] = useState<Set<string>>(new Set());
  const [submittingRatingId, setSubmittingRatingId] = useState<string | null>(null);
  const { user } = useAuth();
  const toast = useToast();
  const { data: menus, loading, sourceMode } = useSchoolCollectionData<MenuItem>(
    school.id,
    fetchMenus,
    mockMenus
  );
  const usingDemo = sourceMode === "demo";

  const cafeterias = useMemo(() => ["all", ...new Set(menus.map((m) => m.cafeteria))], [menus]);

  useEffect(() => {
    const maxPrice = Math.max(200, ...menus.map((menu) => menu.price ?? 0));
    setPriceRange([0, maxPrice]);
  }, [menus, school.id]);

  const filteredMenus = useMemo(() => {
    return menus
      .filter((m) => {
        const matchesSearch =
          !searchQuery ||
          m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.cafeteria.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.description?.toLowerCase().includes(searchQuery.toLowerCase());
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
            return (ratings[b.id] ?? b.rating ?? 0) - (ratings[a.id] ?? a.rating ?? 0);
          default:
            return 0;
        }
      });
  }, [menus, priceRange, ratings, searchQuery, selectedCafeteria, sortBy]);

  const handleRate = async (menuId: string, rating: number) => {
    setRatings((prev) => ({ ...prev, [menuId]: rating }));

    if (sourceMode !== "firebase" || !user) {
      if (sourceMode === "firebase" && !user) {
        toast.info("已暫存評分", "登入後可同步評分到雲端");
      } else {
        toast.success("已更新示範評分");
      }
      return;
    }

    setSubmittingRatingId(menuId);
    const result = await rateMenuItem(menuId, user.uid, rating);
    setSubmittingRatingId(null);

    if (!result.success) {
      setRatings((prev) => {
        const next = { ...prev };
        delete next[menuId];
        return next;
      });
      toast.error("評分失敗", result.error?.replace(/^Error:\s*/, "") ?? "請稍後再試");
      return;
    }

    toast.success("評分已送出");
  };

  const toggleFavoriteMenu = (menuId: string) => {
    setFavoriteMenus((prev) => {
      const next = new Set(prev);
      if (next.has(menuId)) {
        next.delete(menuId);
        toast.info("已取消收藏");
      } else {
        next.add(menuId);
        toast.success("已加入收藏");
      }
      return next;
    });
  };

  const copyMenuInfo = async (menu: MenuItem) => {
    const summary = [
      menu.name,
      `餐廳：${menu.cafeteria}`,
      menu.availableOn ? `供應日期：${menu.availableOn}` : null,
      menu.price ? `價格：$${menu.price}` : null,
      menu.description ?? null,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await navigator.clipboard.writeText(summary);
      toast.success("已複製餐點資訊");
    } catch (error) {
      console.error("Failed to copy menu info:", error);
      toast.error("複製失敗", "請確認瀏覽器允許剪貼簿權限");
    }
  };

  const avgPrice = menus.length
    ? Math.round(menus.reduce((sum, m) => sum + (m.price ?? 0), 0) / menus.length)
    : 0;

  const RatingStars = ({ rating, onRate, menuId }: { rating: number; onRate: (id: string, r: number) => void; menuId: string }) => (
    <div style={{ display: "flex", gap: 4 }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => void onRate(menuId, star)}
          disabled={submittingRatingId === menuId}
          style={{
            background: "none",
            border: "none",
            cursor: submittingRatingId === menuId ? "wait" : "pointer",
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

  if (loading) {
    return (
      <SiteShell
        schoolName={school.name}
        schoolCode={school.code}
        title="餐廳"
        subtitle={`今日菜單與價格資訊 · ${school.name}`}
      >
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🍽️</div>
          <div style={{ color: "var(--muted)" }}>載入菜單資料中...</div>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title="餐廳"
      subtitle={`今日菜單與價格資訊 · ${school.name}`}
    >
      {/* Stats Overview */}
      <div className="card" style={{ marginBottom: 20, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <span className="pill subtle">{usingDemo ? "示範資料" : "Firebase 資料"}</span>
        </div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "var(--brand)" }}>{menus.length}</div>
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
            const rating = ratings[m.id] ?? Math.round(m.rating ?? 0);
            const isPopular = m.price && m.price > 80;
            const isAffordable = m.price && m.price <= 50;
            const isFavorite = favoriteMenus.has(m.id);

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
                      {m.vegetarian && <span className="pill" style={{ fontSize: 11, padding: "4px 10px", background: "rgba(16,185,129,0.14)", color: "#10B981" }}>素食</span>}
                      {m.soldOut && <span className="pill" style={{ fontSize: 11, padding: "4px 10px", background: "rgba(239,68,68,0.14)", color: "#EF4444" }}>已售完</span>}
                    </div>
                    <RatingStars rating={rating} onRate={handleRate} menuId={m.id} />
                    {m.description && (
                      <p style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.6, color: "var(--muted)" }}>
                        {m.description}
                      </p>
                    )}
                    {(m.calories || m.category || m.rating) && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                        {m.category && <span className="pill subtle" style={{ fontSize: 11, padding: "4px 10px" }}>{m.category}</span>}
                        {m.calories ? <span className="pill subtle" style={{ fontSize: 11, padding: "4px 10px" }}>{m.calories} kcal</span> : null}
                        {m.rating ? <span className="pill subtle" style={{ fontSize: 11, padding: "4px 10px" }}>平均 {m.rating.toFixed(1)} 分</span> : null}
                      </div>
                    )}
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
                    onClick={() => toggleFavoriteMenu(m.id)}
                    style={{ flex: 1, fontSize: 13, padding: "10px" }}
                  >
                    {isFavorite ? "⭐ 已收藏" : "⭐ 收藏"}
                  </button>
                  <button 
                    className="btn" 
                    onClick={() => void copyMenuInfo(m)}
                    style={{ flex: 1, fontSize: 13, padding: "10px" }}
                  >
                    📋 複製資訊
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
