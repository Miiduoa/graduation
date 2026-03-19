"use client";

import { useEffect, useState, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import { fetchPois, addFavorite, removeFavorite, checkFavorite, getAuth, isFirebaseConfigured, type Poi } from "@/lib/firebase";
import { onAuthStateChanged, type User } from "firebase/auth";

interface Location {
  id: string;
  name: string;
  category: string;
  description?: string;
  open?: boolean;
  hours?: string;
  distance?: string;
  lat: number;
  lng: number;
}

const DEMO_LOCATIONS: Location[] = [
  { id: "1", name: "工程館", category: "教學", description: "資工、電機系主要教學大樓", open: true, hours: "07:00–22:00", lat: 25.0175, lng: 121.5398 },
  { id: "2", name: "圖書館", category: "學習", description: "館藏豐富，提供自習空間", open: true, hours: "08:00–22:00", lat: 25.0168, lng: 121.5389 },
  { id: "3", name: "第一餐廳", category: "餐廳", description: "校內主要自助餐廳", open: true, hours: "07:00–19:00", lat: 25.0162, lng: 121.5401 },
  { id: "4", name: "體育館", category: "運動", description: "籃球、羽球場及健身房", open: false, hours: "08:00–21:00", lat: 25.0180, lng: 121.5380 },
  { id: "5", name: "校門公車站", category: "交通", description: "多條公車路線停靠點", open: true, hours: "全天", lat: 25.0155, lng: 121.5395 },
  { id: "6", name: "行政大樓", category: "行政", description: "教務處、學務處等行政單位", open: true, hours: "08:30–17:00", lat: 25.0172, lng: 121.5372 },
  { id: "7", name: "學生宿舍", category: "住宿", description: "大一至大四住宿棟", open: true, hours: "全天", lat: 25.0185, lng: 121.5410 },
  { id: "8", name: "健康中心", category: "醫療", description: "校內醫療諮詢與急救服務", open: true, hours: "08:00–17:00", lat: 25.0165, lng: 121.5385 },
];

const CATEGORY_COLORS: Record<string, string> = {
  教學: "#5E6AD2", 學習: "#34C759", 餐廳: "#FF9500",
  運動: "#007AFF", 交通: "#32ADE6", 行政: "#BF5AF2",
  住宿: "#FF6B35", 醫療: "#FF3B30",
};

function poiToLocation(p: Poi, idx: number): Location {
  return {
    id: p.id,
    name: p.name,
    category: p.category ?? "校園",
    description: (p as any).description,
    open: (p as any).isOpen,
    hours: (p as any).hours,
    lat: (p as any).lat ?? 25.0170 + (idx * 0.001),
    lng: (p as any).lng ?? 121.5390 + (idx * 0.001),
  };
}

export default function MapClient({ school }: { school: string }) {
  const mapRef = useRef<LeafletMap | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [locations, setLocations] = useState<Location[]>(DEMO_LOCATIONS);
  const [selected, setSelected] = useState<Location | null>(null);
  const [category, setCategory] = useState("全部");
  const [search, setSearch] = useState("");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [user, setUser] = useState<User | null>(null);
  const [usingDemo, setUsingDemo] = useState(true);

  const categories = ["全部", ...Array.from(new Set(locations.map((l) => l.category)))];

  const filtered = locations.filter(
    (l) =>
      (category === "全部" || l.category === category) &&
      (!search || l.name.includes(search) || l.description?.includes(search))
  );

  // 監聽 Firebase Auth
  useEffect(() => {
    const auth = getAuth();
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  // 載入 POI 資料
  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    async function load() {
      try {
        const pois = await fetchPois(school, 50);
        const locs = pois.filter((p) => (p as any).lat && (p as any).lng);
        if (locs.length > 0) {
          setLocations(locs.map(poiToLocation));
          setUsingDemo(false);
        }
      } catch {}
    }
    load();
  }, [school]);

  // 載入收藏狀態
  useEffect(() => {
    if (!user || !isFirebaseConfigured()) return;
    async function loadFavs() {
      const checks = await Promise.all(locations.map((l) => checkFavorite(user!.uid, "poi", l.id)));
      const favIds = new Set<string>();
      locations.forEach((l, i) => { if (checks[i]) favIds.add(l.id); });
      setSavedIds(favIds);
    }
    loadFavs();
  }, [user, locations]);

  // 初始化 Leaflet 地圖
  useEffect(() => {
    if (typeof window === "undefined" || !mapContainerRef.current) return;
    if (mapRef.current) return; // 已初始化

    import("leaflet").then((L) => {
      if (!mapContainerRef.current || mapRef.current) return;

      // 修正 Leaflet 預設 icon 路徑問題
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
        iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
      });

      const center = locations.length > 0 ? [locations[0].lat, locations[0].lng] as [number, number] : [25.017, 121.539] as [number, number];
      const map = L.map(mapContainerRef.current).setView(center, 17);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
      updateMarkers(L, map);
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []); // eslint-disable-line

  // 更新 Markers
  function updateMarkers(L: typeof import("leaflet"), map: LeafletMap) {
    map.eachLayer((layer) => {
      if ((layer as any)._isMarker) map.removeLayer(layer);
    });

    filtered.forEach((loc) => {
      const color = CATEGORY_COLORS[loc.category] ?? "#5E6AD2";
      const iconHtml = `<div style="background:${color};width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>`;
      const icon = L.divIcon({ html: iconHtml, className: "", iconSize: [28, 28], iconAnchor: [14, 28] });
      const marker = L.marker([loc.lat, loc.lng], { icon });
      (marker as any)._isMarker = true;
      marker.on("click", () => setSelected(loc));
      marker.bindTooltip(loc.name, { permanent: false, direction: "top", offset: [0, -28] });
      marker.addTo(map);
    });
  }

  // 重新渲染 markers 當 filtered 變化
  useEffect(() => {
    if (!mapRef.current) return;
    import("leaflet").then((L) => {
      if (mapRef.current) updateMarkers(L, mapRef.current);
    });
  }, [filtered.length, category, search]); // eslint-disable-line

  // 點擊列表項目時移動地圖
  const handleSelectLocation = (loc: Location) => {
    setSelected(loc);
    if (mapRef.current) {
      mapRef.current.setView([loc.lat, loc.lng], 18, { animate: true });
    }
  };

  const toggleFavorite = async (id: string) => {
    const newSaved = new Set(savedIds);
    if (newSaved.has(id)) {
      newSaved.delete(id);
      if (user && isFirebaseConfigured()) await removeFavorite(user.uid, "poi", id);
    } else {
      newSaved.add(id);
      if (user && isFirebaseConfigured()) await addFavorite(user.uid, "poi", id, selected?.name);
    }
    setSavedIds(newSaved);
  };

  const color = selected ? (CATEGORY_COLORS[selected.category] ?? "#5E6AD2") : "#5E6AD2";

  return (
    <div className="pageStack">
      {usingDemo && (
        <div className="card" style={{ padding: "10px 16px", background: "var(--warning-soft)", borderColor: "var(--warning)", fontSize: 13, color: "var(--text)" }}>
          ⚠️ 目前顯示示範校園地點。設定 Firebase 並加入含 lat/lng 的 POI 資料後即可顯示實際地圖。
        </div>
      )}

      {/* ── Leaflet 地圖 ── */}
      <div className="card" style={{ padding: 0, overflow: "hidden", borderRadius: "var(--radius)" }}>
        <div ref={mapContainerRef} style={{ height: 360, width: "100%", zIndex: 1 }} />
      </div>

      {/* ── Selected POI Card ── */}
      {selected && (
        <div className="card" style={{ borderTop: `3px solid ${color}`, padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: "999px", background: `${color}14`, color, fontWeight: 700 }}>{selected.category}</span>
              <h3 style={{ margin: "6px 0 4px", fontSize: 18, fontWeight: 800 }}>{selected.name}</h3>
              {selected.description && <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>{selected.description}</p>}
              {selected.hours && (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: selected.open ? "var(--success)" : "var(--danger)" }}>
                  {selected.open ? "🟢 開放中" : "🔴 已關閉"} · {selected.hours}
                </p>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => toggleFavorite(selected.id)}
                style={{ background: savedIds.has(selected.id) ? "var(--danger-soft)" : "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 12px", cursor: "pointer", fontSize: 18 }}
              >
                {savedIds.has(selected.id) ? "❤️" : "🤍"}
              </button>
              <button
                onClick={() => setSelected(null)}
                style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 12px", cursor: "pointer", fontSize: 14, color: "var(--muted)" }}
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Search + Filter ── */}
      <div className="toolbarPanel">
        <div className="toolbarGrow">
          <input
            className="input"
            type="search"
            placeholder="搜尋地點…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minHeight: 42 }}
          />
        </div>
        <div className="segmentedGroup" style={{ flexWrap: "wrap" }}>
          {categories.map((c) => (
            <button key={c} className={category === c ? "active" : ""} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* ── Location List ── */}
      <div className="sectionCard">
        <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600, padding: "0 4px" }}>
          地點列表 · {filtered.length} 個
        </div>
        <div className="insetGroup">
          {filtered.map((loc, i) => {
            const locColor = CATEGORY_COLORS[loc.category] ?? "#5E6AD2";
            const isSelected = selected?.id === loc.id;
            return (
              <div
                key={loc.id}
                className="insetGroupRow"
                style={{ borderTop: i === 0 ? "none" : undefined, cursor: "pointer", background: isSelected ? `${locColor}08` : undefined }}
                onClick={() => handleSelectLocation(loc)}
              >
                <div
                  className="insetGroupRowIcon"
                  style={{ background: `${locColor}14`, color: locColor, fontSize: 18, width: 38, height: 38, borderRadius: 10, border: `1px solid ${locColor}30` }}
                >
                  {loc.category === "教學" ? "🏫" : loc.category === "學習" ? "📚" : loc.category === "餐廳" ? "🍱" : loc.category === "運動" ? "⚽" : loc.category === "交通" ? "🚌" : loc.category === "行政" ? "🏛️" : loc.category === "住宿" ? "🏠" : loc.category === "醫療" ? "🏥" : "📍"}
                </div>
                <div className="insetGroupRowContent">
                  <div className="insetGroupRowTitle">{loc.name}</div>
                  <div className="insetGroupRowMeta">
                    {loc.category}
                    {loc.open !== undefined && (
                      <span style={{ marginLeft: 8, color: loc.open ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>
                        {loc.open ? "開放中" : "已關閉"}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(loc.id); }}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, padding: "0 4px", flexShrink: 0 }}
                >
                  {savedIds.has(loc.id) ? "❤️" : "🤍"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
