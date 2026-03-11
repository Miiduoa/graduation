"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { resolveSchool } from "@campus/shared/src/schools";
import { mockPois } from "@campus/shared/src/mockData";
import { SiteShell } from "@/components/SiteShell";

type PoiCategory = "all" | "building" | "food" | "service" | "sports" | "parking";
type MapProvider = "leaflet" | "google" | "fallback";
type LatLng = { lat: number; lng: number };

interface LeafletMap {
  remove: () => void;
  setView: (coords: [number, number], zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

interface LeafletMarker {
  addTo: (map: LeafletMap) => LeafletMarker;
  on: (event: "click", handler: () => void) => LeafletMarker;
  bindPopup: (content: string) => LeafletMarker;
  remove: () => void;
  getLatLng: () => LatLng;
  openPopup: () => void;
}

interface LeafletGlobal {
  map: (
    element: HTMLElement,
    options: {
      center: [number, number];
      zoom: number;
      zoomControl: boolean;
      attributionControl: boolean;
    }
  ) => LeafletMap;
  tileLayer: (
    templateUrl: string,
    options: { attribution: string; maxZoom: number }
  ) => { addTo: (map: LeafletMap) => void };
  divIcon: (options: {
    className: string;
    html: string;
    iconSize: [number, number];
    iconAnchor: [number, number];
  }) => unknown;
  marker: (coords: [number, number], options?: { icon?: unknown }) => LeafletMarker;
}

const categories: { id: PoiCategory; label: string; icon: string; color: string }[] = [
  { id: "all", label: "全部", icon: "🗺️", color: "#8B5CF6" },
  { id: "building", label: "教學大樓", icon: "🏛️", color: "#3B82F6" },
  { id: "food", label: "餐飲", icon: "🍽️", color: "#F97316" },
  { id: "service", label: "服務設施", icon: "🏪", color: "#10B981" },
  { id: "sports", label: "運動場所", icon: "⚽", color: "#EF4444" },
  { id: "parking", label: "停車場", icon: "🅿️", color: "#6366F1" },
];

function getPoiCategory(name: string): PoiCategory {
  const nameLower = name.toLowerCase();
  if (nameLower.includes("餐") || nameLower.includes("食") || nameLower.includes("咖啡")) return "food";
  if (nameLower.includes("停車") || nameLower.includes("車")) return "parking";
  if (nameLower.includes("體育") || nameLower.includes("球") || nameLower.includes("泳")) return "sports";
  if (nameLower.includes("圖書") || nameLower.includes("服務") || nameLower.includes("行政")) return "service";
  return "building";
}

function getPoiIcon(category: PoiCategory): string {
  const icons: Record<PoiCategory, string> = {
    all: "📍",
    building: "🏛️",
    food: "🍽️",
    service: "🏪",
    sports: "⚽",
    parking: "🅿️",
  };
  return icons[category];
}

function getCategoryColor(category: PoiCategory): string {
  return categories.find((c) => c.id === category)?.color || "#8B5CF6";
}

declare global {
  interface Window {
    L?: LeafletGlobal;
    google?: unknown;
  }
}

export default function MapPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const school = resolveSchool({ school: props.searchParams?.school, schoolId: props.searchParams?.schoolId });
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<PoiCategory>("all");
  const [selectedPoi, setSelectedPoi] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [mapProvider, setMapProvider] = useState<MapProvider>("fallback");
  const [mapLoaded, setMapLoaded] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<LeafletMarker[]>([]);

  const filteredPois = useMemo(() => {
    return mockPois.filter((p) => {
      const category = getPoiCategory(p.name);
      const matchesCategory = selectedCategory === "all" || category === selectedCategory;
      const matchesSearch = !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, selectedCategory]);

  const toggleFavorite = (poiId: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(poiId)) {
        next.delete(poiId);
      } else {
        next.add(poiId);
      }
      return next;
    });
  };

  const getCrowdLevel = useCallback((poiId: string): { level: string; color: string } => {
    const hash = poiId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const levels = [
      { level: "不擁擠", color: "#10B981" },
      { level: "適中", color: "#F59E0B" },
      { level: "較擁擠", color: "#EF4444" },
    ];
    return levels[hash % levels.length];
  }, []);

  const centerLat = mockPois.length > 0 ? mockPois.reduce((sum, p) => sum + p.lat, 0) / mockPois.length : 25.0;
  const centerLng = mockPois.length > 0 ? mockPois.reduce((sum, p) => sum + p.lng, 0) / mockPois.length : 121.5;

  useEffect(() => {
    const loadLeaflet = async () => {
      if (typeof window === "undefined") return;
      
      try {
        if (!document.querySelector('link[href*="leaflet.css"]')) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
          document.head.appendChild(link);
        }

        if (!window.L) {
          const script = document.createElement("script");
          script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
          script.async = true;
          script.onload = () => {
            setMapProvider("leaflet");
            setMapLoaded(true);
          };
          script.onerror = () => {
            console.warn("Failed to load Leaflet, using fallback");
            setMapProvider("fallback");
            setMapLoaded(true);
          };
          document.head.appendChild(script);
        } else {
          setMapProvider("leaflet");
          setMapLoaded(true);
        }
      } catch (error) {
        console.error("Error loading map library:", error);
        setMapProvider("fallback");
        setMapLoaded(true);
      }
    };

    loadLeaflet();
  }, []);

  useEffect(() => {
    if (!mapLoaded || mapProvider !== "leaflet" || !mapContainerRef.current || !window.L) return;
    const leaflet = window.L;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
    }

    const map = leaflet.map(mapContainerRef.current, {
      center: [centerLat, centerLng],
      zoom: 16,
      zoomControl: true,
      attributionControl: true,
    });

    leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [mapLoaded, mapProvider, centerLat, centerLng]);

  useEffect(() => {
    if (!mapInstanceRef.current || !window.L) return;
    const leaflet = window.L;
    const map = mapInstanceRef.current;

    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    filteredPois.forEach(poi => {
      const category = getPoiCategory(poi.name);
      const color = getCategoryColor(category);
      const icon = getPoiIcon(category);
      
      const customIcon = leaflet.divIcon({
        className: "custom-map-marker",
        html: `
          <div style="
            width: 36px;
            height: 36px;
            background: ${selectedPoi === poi.id ? color : "white"};
            border: 3px solid ${color};
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            cursor: pointer;
            transition: all 0.2s ease;
          ">
            ${icon}
          </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      const marker = leaflet.marker([poi.lat, poi.lng], { icon: customIcon })
        .addTo(map)
        .on("click", () => {
          setSelectedPoi(poi.id);
        });

      const popupContent = `
        <div style="min-width: 200px; padding: 8px;">
          <div style="font-weight: 700; font-size: 15px; margin-bottom: 6px;">${poi.name}</div>
          <div style="display: flex; gap: 6px; margin-bottom: 8px;">
            <span style="
              background: ${color}20;
              color: ${color};
              padding: 2px 8px;
              border-radius: 4px;
              font-size: 11px;
              font-weight: 600;
	            ">${categories.find((c) => c.id === category)?.label}</span>
          </div>
          <div style="font-size: 12px; color: #666; margin-bottom: 8px;">
            📍 ${poi.lat.toFixed(5)}, ${poi.lng.toFixed(5)}
          </div>
          <div style="display: flex; gap: 8px;">
            <a href="https://www.google.com/maps/dir/?api=1&destination=${poi.lat},${poi.lng}" 
               target="_blank" 
               style="
                 flex: 1;
                 padding: 8px;
                 background: ${color};
                 color: white;
                 text-decoration: none;
                 border-radius: 6px;
                 text-align: center;
                 font-size: 12px;
                 font-weight: 600;
               ">
              🧭 導航
            </a>
          </div>
        </div>
      `;
      
      marker.bindPopup(popupContent);
      markersRef.current.push(marker);
    });

    if (userLocation) {
      const userIcon = leaflet.divIcon({
        className: "user-location-marker",
        html: `
          <div style="
            width: 20px;
            height: 20px;
            background: #3B82F6;
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 2px 8px rgba(59, 130, 246, 0.5);
          "></div>
        `,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      const userMarker = leaflet.marker([userLocation.lat, userLocation.lng], { icon: userIcon })
        .addTo(map)
        .bindPopup("📍 您的位置");
      
      markersRef.current.push(userMarker);
    }
  }, [filteredPois, selectedPoi, userLocation]);

  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      alert("您的瀏覽器不支援定位功能");
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation({ lat: latitude, lng: longitude });
        
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setView([latitude, longitude], 17);
        }
        setIsLocating(false);
      },
      (error) => {
        console.error("Geolocation error:", error);
        alert("無法取得您的位置，請確認已授權定位權限");
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleNavigateTo = (poi: typeof mockPois[0]) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${poi.lat},${poi.lng}`;
    window.open(url, "_blank");
  };

  const handleCenterOnPoi = (poi: typeof mockPois[0]) => {
    setSelectedPoi(poi.id);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([poi.lat, poi.lng], 18);
      
      const marker = markersRef.current.find(m => {
        const latlng = m.getLatLng();
        return Math.abs(latlng.lat - poi.lat) < 0.0001 && Math.abs(latlng.lng - poi.lng) < 0.0001;
      });
      if (marker) {
        marker.openPopup();
      }
    }
  };

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title="地圖"
      subtitle={`探索校園每個角落 · ${school.name}`}
    >
      {/* Interactive Map */}
      <div 
        className="card" 
        style={{ 
          marginBottom: 20, 
          padding: 0, 
          overflow: "hidden",
          height: 400,
          position: "relative",
          borderRadius: 16,
        }}
      >
        {mapProvider === "leaflet" && mapLoaded ? (
          <div 
            ref={mapContainerRef} 
            style={{ 
              width: "100%", 
              height: "100%",
              background: "var(--panel)",
            }} 
          />
        ) : (
          <div style={{
            position: "absolute",
            inset: 0,
            background: `
              linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, transparent 50%),
              linear-gradient(45deg, rgba(16, 185, 129, 0.1) 0%, transparent 50%),
              var(--panel)
            `,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            {!mapLoaded ? (
              <div style={{ textAlign: "center" }}>
                <div className="spinner" style={{ marginBottom: 16 }} />
                <div style={{ color: "var(--muted)" }}>載入地圖中...</div>
              </div>
            ) : (
              <>
                <div style={{ position: "absolute", inset: 20 }}>
                  {filteredPois.slice(0, 12).map((p, idx) => {
                    const category = getPoiCategory(p.name);
                    const normalizedLat = (p.lat - centerLat) / 0.01 * 30 + 50;
                    const normalizedLng = (p.lng - centerLng) / 0.01 * 30 + 50;
                    const posX = Math.max(5, Math.min(85, normalizedLng));
                    const posY = Math.max(5, Math.min(85, 100 - normalizedLat));
                    
                    return (
                      <div
                        key={p.id}
                        onClick={() => handleCenterOnPoi(p)}
                        style={{
                          position: "absolute",
                          left: `${posX}%`,
                          top: `${posY}%`,
                          background: selectedPoi === p.id ? getCategoryColor(category) : "var(--panel2)",
                          border: `3px solid ${getCategoryColor(category)}`,
                          borderRadius: "50%",
                          width: 40,
                          height: 40,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                          fontSize: 18,
                          boxShadow: selectedPoi === p.id 
                            ? `0 4px 12px ${getCategoryColor(category)}60` 
                            : "0 2px 8px rgba(0,0,0,0.3)",
                          transform: selectedPoi === p.id ? "scale(1.2)" : "scale(1)",
                          zIndex: selectedPoi === p.id ? 100 : idx,
                        }}
                        title={p.name}
                      >
                        {getPoiIcon(category)}
                      </div>
                    );
                  })}
                </div>
                <div style={{ 
                  position: "absolute", 
                  bottom: 60, 
                  left: "50%", 
                  transform: "translateX(-50%)",
                  textAlign: "center",
                  background: "rgba(10, 14, 26, 0.9)",
                  padding: "12px 20px",
                  borderRadius: 12,
                }}>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>
                    簡化地圖視圖 · 點擊地點查看詳情
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Map Controls */}
        <div style={{
          position: "absolute",
          top: 12,
          right: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 1000,
        }}>
          <button
            onClick={handleLocateMe}
            disabled={isLocating}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              border: "none",
              background: "var(--panel)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
              cursor: isLocating ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
            }}
            title="定位我的位置"
          >
            {isLocating ? "⏳" : "📍"}
          </button>
          {mapProvider === "leaflet" && mapLoaded && (
            <>
              <button
                onClick={() => mapInstanceRef.current?.zoomIn()}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  border: "none",
                  background: "var(--panel)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                  cursor: "pointer",
                  fontSize: 20,
                }}
                title="放大"
              >
                ➕
              </button>
              <button
                onClick={() => mapInstanceRef.current?.zoomOut()}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  border: "none",
                  background: "var(--panel)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                  cursor: "pointer",
                  fontSize: 20,
                }}
                title="縮小"
              >
                ➖
              </button>
            </>
          )}
        </div>

        {/* Legend */}
        <div style={{
          position: "absolute",
          bottom: 12,
          left: 12,
          background: "rgba(10, 14, 26, 0.9)",
          padding: "10px 14px",
          borderRadius: 12,
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          fontSize: 11,
          zIndex: 1000,
          maxWidth: "calc(100% - 80px)",
        }}>
          {categories.slice(1).map((cat) => (
            <div 
              key={cat.id} 
              style={{ 
                display: "flex", 
                alignItems: "center", 
                gap: 4,
                cursor: "pointer",
                opacity: selectedCategory === "all" || selectedCategory === cat.id ? 1 : 0.5,
              }}
              onClick={() => setSelectedCategory(selectedCategory === cat.id ? "all" : cat.id)}
            >
              <span style={{ 
                width: 10, 
                height: 10, 
                borderRadius: 5, 
                background: cat.color,
              }} />
              <span style={{ color: "var(--text)" }}>{cat.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Search & Filters */}
      <div style={{ marginBottom: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <input
          type="text"
          className="input"
          placeholder="搜尋地點名稱..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: "1 1 250px" }}
        />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {categories.map((cat) => (
            <button
              key={cat.id}
              className="btn"
              onClick={() => setSelectedCategory(cat.id)}
              style={{
                padding: "8px 12px",
                fontSize: 12,
                background: selectedCategory === cat.id ? "var(--accent-soft)" : "var(--panel)",
                borderColor: selectedCategory === cat.id ? "var(--brand)" : "var(--border)",
                color: selectedCategory === cat.id ? "var(--brand)" : "var(--text)",
              }}
            >
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="card" style={{ marginBottom: 20, padding: 14 }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--brand)" }}>{mockPois.length}</div>
            <div className="kv" style={{ fontSize: 11 }}>地點總數</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#10B981" }}>{filteredPois.length}</div>
            <div className="kv" style={{ fontSize: 11 }}>符合篩選</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#F59E0B" }}>{favorites.size}</div>
            <div className="kv" style={{ fontSize: 11 }}>收藏地點</div>
          </div>
        </div>
      </div>

      {/* POI List */}
      {filteredPois.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <div style={{ color: "var(--muted)" }}>找不到符合的地點</div>
        </div>
      ) : (
        <div 
          className="list"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}
        >
          {filteredPois.map((p) => {
            const category = getPoiCategory(p.name);
            const isFavorite = favorites.has(p.id);
            const isSelected = selectedPoi === p.id;
            const crowd = getCrowdLevel(p.id);

            return (
              <div 
                key={p.id} 
                className="card"
                onClick={() => setSelectedPoi(isSelected ? null : p.id)}
                style={{
                  cursor: "pointer",
                  borderColor: isSelected ? "var(--brand)" : "var(--border)",
                  boxShadow: isSelected ? "0 4px 20px rgba(139, 92, 246, 0.3)" : undefined,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ display: "flex", gap: 12, flex: 1 }}>
                    {/* POI Icon */}
                    <div style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      background: "var(--accent-soft)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 24,
                      flexShrink: 0,
                    }}>
                      {getPoiIcon(category)}
                    </div>

                    <div style={{ flex: 1 }}>
                      <h3 style={{ margin: "0 0 6px 0", fontSize: 16, fontWeight: 700, letterSpacing: -0.3 }}>
                        {p.name}
                      </h3>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                        <span className="pill" style={{ fontSize: 10, padding: "3px 8px" }}>
                          {categories.find((c) => c.id === category)?.label}
                        </span>
                        <span 
                          className="pill" 
                          style={{ 
                            fontSize: 10, 
                            padding: "3px 8px",
                            background: `${crowd.color}20`,
                            color: crowd.color,
                            border: `1px solid ${crowd.color}40`,
                          }}
                        >
                          {crowd.level}
                        </span>
                      </div>
                      <div className="kv" style={{ fontSize: 11 }}>
                        📍 {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                      </div>
                    </div>
                  </div>

                  {/* Favorite Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(p.id);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 20,
                      padding: 4,
                    }}
                  >
                    {isFavorite ? "⭐" : "☆"}
                  </button>
                </div>

                {/* Expanded Info */}
                {isSelected && (
                  <div style={{ 
                    marginTop: 16, 
                    paddingTop: 16, 
                    borderTop: "1px solid var(--border)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="btn"
                        style={{ flex: 1, fontSize: 12, padding: "10px" }}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleNavigateTo(p);
                        }}
                      >
                        🧭 導航
                      </button>
                      <button className="btn" style={{ flex: 1, fontSize: 12, padding: "10px" }}>
                        📷 照片
                      </button>
                      <button className="btn" style={{ flex: 1, fontSize: 12, padding: "10px" }}>
                        📝 評論
                      </button>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
                      點擊「導航」可開啟 Google Maps 進行路線規劃。
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SiteShell>
  );
}
