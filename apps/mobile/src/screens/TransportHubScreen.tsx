/* eslint-disable */
/**
 * 交通導航中心 — 媲美 Google Maps
 *
 * 功能：
 *   1. 搜尋目的地（OSM Nominatim 免費地理編碼）
 *   2. 多模式路線規劃（步行 / 騎車 / 開車 / 大眾運輸）
 *   3. 互動式地圖 + 路線 Polyline 繪製
 *   4. GPS 即時追蹤、導航時鏡頭跟隨
 *   5. AI 智慧改道 + 擁擠偵測
 *   6. 即時公車/台鐵/高鐵/YouBike 查詢
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ScrollView,
  Text,
  View,
  Pressable,
  TextInput,
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PuWebView } from '../ui/PuWebView';
import { Screen, Card, Pill, Button } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import {
  searchPlaces,
  reverseGeocode,
  planRoutes,
  checkForBetterRoute,
  calculateLiveETA,
  formatDistance,
  formatDuration,
  PU_LOCATION,
  type SearchResult,
  type RouteOption,
  type LatLng,
} from '../services/routingService';
import { linkingOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';
import {
  searchBusRoutes,
  getBusStopsOfRoute,
  getBusEstimates,
  getTrainSchedule,
  getHSRSchedule,
  getNearbyBikesWithAvailability,
  PU_COMMON_BUS_ROUTES,
  PU_NEARBY_TRAIN_STATIONS,
  HSR_TAICHUNG_STATION_ID,
  type TDXBusRoute,
  type TDXBusStopOfRoute,
  type TDXBusEstimate,
  type TDXTrainTimetable,
  type TDXHSRTimetable,
  type BikeStationWithAvailability,
} from '../services/tdxApi';
import { useGeolocation } from '../hooks/useGeolocation';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT = SCREEN_HEIGHT * 0.32;

// ─── Leaflet 互動地圖 HTML ──────────────────────────────

/**
 * 產生含 Leaflet.js 的地圖 HTML
 * 支援：路線 Polyline、起終點 Marker、使用者位置藍點、動態更新
 */
function buildLeafletHtml(opts: {
  center: LatLng;
  zoom: number;
  origin?: LatLng;
  destination?: LatLng;
  routeGeometry?: [number, number][];
  routeColor?: string;
  transitSegments?: { coords: [number, number][]; color: string; dash?: boolean }[];
  userLocation?: LatLng;
  isDark?: boolean;
}): string {
  const {
    center,
    zoom,
    origin,
    destination,
    routeGeometry,
    routeColor = '#5856D6',
    transitSegments,
    userLocation,
    isDark,
  } = opts;

  const tileUrl = isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileAttr = isDark
    ? '&copy; <a href="https://carto.com/">CARTO</a>'
    : '&copy; <a href="https://openstreetmap.org">OSM</a>';

  // 將路線座標轉為 Leaflet 格式 [lat, lng]
  const routeLatLngs = (routeGeometry ?? []).map(([lng, lat]) => `[${lat},${lng}]`).join(',');

  // 大眾運輸各段
  const transitCode = (transitSegments ?? [])
    .map((seg, i) => {
      const coords = seg.coords.map(([lng, lat]) => `[${lat},${lng}]`).join(',');
      return `L.polyline([${coords}],{color:"${seg.color}",weight:${seg.dash ? 3 : 6},opacity:0.9${seg.dash ? ',dashArray:"8 6"' : ''}}).addTo(map);`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
*{margin:0;padding:0}
html,body,#map{width:100%;height:100%}
.user-dot{width:16px;height:16px;border-radius:50%;background:#4285f4;border:3px solid #fff;box-shadow:0 0 8px rgba(66,133,244,.6)}
.origin-dot{width:14px;height:14px;border-radius:50%;background:#5856D6;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)}
.dest-pin{font-size:28px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.3))}
</style>
</head>
<body>
<div id="map"></div>
<script>
var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([${center.lat},${center.lng}],${zoom});
L.tileLayer('${tileUrl}',{maxZoom:19,attribution:'${tileAttr}'}).addTo(map);

${origin ? `L.marker([${origin.lat},${origin.lng}],{icon:L.divIcon({className:'',html:'<div class="origin-dot"></div>',iconSize:[20,20],iconAnchor:[10,10]})}).addTo(map);` : ''}

${destination ? `L.marker([${destination.lat},${destination.lng}],{icon:L.divIcon({className:'',html:'<div class="dest-pin">📍</div>',iconSize:[28,28],iconAnchor:[14,28]})}).addTo(map);` : ''}

${
  routeLatLngs
    ? `
var routeLine=L.polyline([${routeLatLngs}],{color:'#fff',weight:8,opacity:1,lineCap:'round',lineJoin:'round'}).addTo(map);
L.polyline([${routeLatLngs}],{color:'${routeColor}',weight:5,opacity:0.9,lineCap:'round',lineJoin:'round'}).addTo(map);
map.fitBounds(routeLine.getBounds().pad(0.12));
`
    : ''
}

${transitCode}

${userLocation ? `var userMarker=L.marker([${userLocation.lat},${userLocation.lng}],{icon:L.divIcon({className:'',html:'<div class="user-dot"></div>',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(map);` : ''}

// RN → WebView 訊息接收：更新使用者位置 / 路線
document.addEventListener('message',function(e){
  try{
    var d=JSON.parse(e.data);
    if(d.type==='updateLocation'&&userMarker){
      userMarker.setLatLng([d.lat,d.lng]);
      if(d.follow) map.panTo([d.lat,d.lng],{animate:true,duration:0.5});
    }
    if(d.type==='updateRoute'){
      map.eachLayer(function(l){if(l instanceof L.Polyline)map.removeLayer(l)});
      if(d.coords&&d.coords.length>1){
        var bg=L.polyline(d.coords,{color:'#fff',weight:8,opacity:1,lineCap:'round',lineJoin:'round'}).addTo(map);
        L.polyline(d.coords,{color:d.color||'#5856D6',weight:5,opacity:0.9,lineCap:'round',lineJoin:'round'}).addTo(map);
        map.fitBounds(bg.getBounds().pad(0.12));
      }
    }
  }catch(ex){}
});
window.addEventListener('message',function(e){document.dispatchEvent(new MessageEvent('message',{data:e.data}))});
<\/script>
</body>
</html>`;
}

/** 打開外部地圖 App 進行導航 */
function openExternalMap(from: LatLng, to: LatLng, destName: string, mode: string = 'walking') {
  const scheme = Platform.select({
    ios: `maps://app?saddr=${from.lat},${from.lng}&daddr=${to.lat},${to.lng}&dirflg=${mode === 'transit' ? 'r' : mode === 'cycling' ? 'b' : 'w'}`,
    default: `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${mode === 'cycling' ? 'bicycling' : mode}`,
  });
  const fallback = `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${mode === 'cycling' ? 'bicycling' : mode}`;
  void linkingOpenWithPuTronClassGate(scheme).then((ok) => {
    if (!ok && scheme !== fallback) void linkingOpenWithPuTronClassGate(fallback);
  });
}

// ─── Mode 圖示/顏色 ────────────────────────────────────

const MODE_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  driving: { icon: 'car-outline', color: '#AF52DE', label: '開車' },
  cycling: { icon: 'bicycle-outline', color: '#FF9500', label: '騎車' },
  walking: { icon: 'walk-outline', color: '#34C759', label: '步行' },
  transit: { icon: 'bus-outline', color: '#5856D6', label: '大眾運輸' },
};

const CONGESTION_COLORS = {
  smooth: '#34C759',
  moderate: '#FF9500',
  heavy: '#f43f5e',
};

// ─── Quick Access Tab ──────────────────────────────────

type QuickTab = 'none' | 'bus' | 'train' | 'hsr' | 'bike';

// ─── Main Component ─────────────────────────────────────

export function TransportHubScreen(props: any) {
  // GPS 定位
  const geo = useGeolocation({ enableHighAccuracy: true, autoStart: false });
  const [locationReady, setLocationReady] = useState(false);

  // 搜尋狀態
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  // 導航狀態
  const [origin, setOrigin] = useState<LatLng>(PU_LOCATION);
  const [originName, setOriginName] = useState('定位中...');
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [destName, setDestName] = useState('');
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  // 即時導航模式
  const [navMode, setNavMode] = useState(false);
  const [liveETA, setLiveETA] = useState('');
  const [congestionLevel, setCongestionLevel] = useState<'smooth' | 'moderate' | 'heavy'>('smooth');
  const [rerouteMsg, setRerouteMsg] = useState<string | null>(null);
  const navIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 快速查詢 Tab
  const [quickTab, setQuickTab] = useState<QuickTab>('none');

  // 台灣邊界（經緯度範圍）— 超出範圍視為無效定位
  const isInTaiwan = useCallback((lat: number, lng: number) => {
    return lat >= 21.8 && lat <= 25.4 && lng >= 119.3 && lng <= 122.1;
  }, []);

  // 取得使用者位置
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pos = await geo.getCurrentPosition();
      if (cancelled) return;
      if (pos?.latitude && pos?.longitude && isInTaiwan(pos.latitude, pos.longitude)) {
        const userLoc: LatLng = { lat: pos.latitude, lng: pos.longitude };
        setOrigin(userLoc);
        setLocationReady(true);
        try {
          const name = await reverseGeocode(pos.latitude, pos.longitude);
          if (!cancelled) setOriginName(name.split(',').slice(0, 2).join(', '));
        } catch {
          if (!cancelled) setOriginName('目前位置');
        }
      } else {
        // 定位失敗或不在台灣 → fallback 靜宜大學
        console.log(
          `[Nav] GPS not in Taiwan (${pos?.latitude},${pos?.longitude}), using PU default`,
        );
        setOrigin(PU_LOCATION);
        setOriginName('靜宜大學（預設位置）');
        setLocationReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // GPS 更新時同步 origin（限台灣範圍）
  useEffect(() => {
    if (geo.latitude && geo.longitude && locationReady && isInTaiwan(geo.latitude, geo.longitude)) {
      setOrigin({ lat: geo.latitude, lng: geo.longitude });
    }
  }, [geo.latitude, geo.longitude, locationReady]);

  // 搜尋目的地
  const handleSearch = useCallback(async () => {
    const q = searchText.trim();
    if (!q) return;
    setSearching(true);
    setShowResults(true);
    try {
      const results = await searchPlaces(q, origin);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchText, origin]);

  // 選擇目的地 → 規劃路線
  const selectDestination = useCallback(
    async (result: SearchResult) => {
      const dest: LatLng = { lat: result.lat, lng: result.lng };
      setDestination(dest);
      setDestName(result.shortName || result.displayName.split(',')[0]);
      setSearchText(result.shortName || result.displayName.split(',')[0]);
      setShowResults(false);
      setPlanning(true);
      setPlanError(false);
      setRoutes([]);
      setSelectedRoute(null);
      setShowSteps(false);
      setQuickTab('none');
      setNavMode(false);

      try {
        console.log(
          `[Nav] Planning route: origin=(${origin.lat},${origin.lng}) → dest=(${dest.lat},${dest.lng})`,
        );
        const routeOptions = await planRoutes(origin, dest);
        console.log(`[Nav] Got ${routeOptions.length} route options`);
        setRoutes(routeOptions);
        if (routeOptions.length > 0) {
          setSelectedRoute(routeOptions[0].id);
        } else {
          setPlanError(true);
        }
      } catch (err) {
        console.warn('Route planning failed:', err);
        setPlanError(true);
      } finally {
        setPlanning(false);
      }
    },
    [origin],
  );

  // 清除導航
  const clearNavigation = useCallback(() => {
    setDestination(null);
    setDestName('');
    setSearchText('');
    setRoutes([]);
    setSelectedRoute(null);
    setShowSteps(false);
    setShowResults(false);
    setNavMode(false);
    setPlanError(false);
    setRerouteMsg(null);
    if (navIntervalRef.current) {
      clearInterval(navIntervalRef.current);
      navIntervalRef.current = null;
    }
  }, []);

  // 當前選中的路線
  const activeRoute = useMemo(() => {
    return routes.find((r) => r.id === selectedRoute) ?? null;
  }, [routes, selectedRoute]);

  // ─── 智慧導航模式 ─────────────────────────────
  const startNavigation = useCallback(() => {
    if (!activeRoute || !destination) return;
    setNavMode(true);
    setShowSteps(true);
    setRerouteMsg(null);

    // 啟動 GPS 追蹤
    geo.startWatching();

    // 定期檢查路線 + 更新 ETA
    navIntervalRef.current = setInterval(async () => {
      const currentPos =
        geo.latitude && geo.longitude ? { lat: geo.latitude, lng: geo.longitude } : origin;

      // 更新即時 ETA
      if (activeRoute) {
        const eta = calculateLiveETA(currentPos, destination, activeRoute, geo.speed);
        setLiveETA(eta.etaText);
        setCongestionLevel(eta.congestionLevel);
      }

      // AI 智慧改道檢查
      if (activeRoute) {
        const result = await checkForBetterRoute(currentPos, destination, activeRoute);
        if (result.shouldReroute && result.newRoute) {
          setRerouteMsg(result.reason);
          // 自動套用新路線
          setRoutes((prev) => {
            const filtered = prev.filter((r) => r.id !== activeRoute.id);
            return [result.newRoute!, ...filtered];
          });
          setSelectedRoute(result.newRoute.id);
        }
      }
    }, 10000); // 每 10 秒

    return () => {
      if (navIntervalRef.current) clearInterval(navIntervalRef.current);
    };
  }, [activeRoute, destination, origin, geo]);

  const stopNavigation = useCallback(() => {
    setNavMode(false);
    setRerouteMsg(null);
    geo.stopWatching();
    if (navIntervalRef.current) {
      clearInterval(navIntervalRef.current);
      navIntervalRef.current = null;
    }
  }, [geo]);

  // 離開頁面時清理
  useEffect(() => {
    return () => {
      if (navIntervalRef.current) clearInterval(navIntervalRef.current);
      geo.stopWatching();
    };
  }, []);

  // WebView ref — 用於發送訊息更新地圖
  const webRef = useRef<React.ComponentRef<typeof PuWebView>>(null);

  // 路線顏色
  const routeColor = useMemo(() => {
    if (!activeRoute) return '#5856D6';
    if (navMode) {
      if (congestionLevel === 'heavy') return CONGESTION_COLORS.heavy;
      if (congestionLevel === 'moderate') return CONGESTION_COLORS.moderate;
    }
    return MODE_CONFIG[activeRoute.mode]?.color ?? '#5856D6';
  }, [activeRoute, navMode, congestionLevel]);

  // 大眾運輸各段資訊
  const transitSegments = useMemo(() => {
    if (!activeRoute?.transitDetails) return undefined;
    return activeRoute.transitDetails
      .filter((td) => td.coordinates && td.coordinates.length >= 2)
      .map((td) => ({
        coords: td.coordinates!,
        color: td.type === 'bus' ? '#5856D6' : td.type === 'train' ? '#AF52DE' : '#34C759',
        dash: td.type === 'walk',
      }));
  }, [activeRoute]);

  // 產生 Leaflet HTML
  const mapHtml = useMemo(() => {
    const userLoc =
      geo.latitude && geo.longitude ? { lat: geo.latitude, lng: geo.longitude } : undefined;
    return buildLeafletHtml({
      center: origin,
      zoom: destination ? 13 : 15,
      origin,
      destination: destination ?? undefined,
      routeGeometry: activeRoute?.routeGeometry,
      routeColor,
      transitSegments,
      userLocation: userLoc,
      isDark: theme.mode === 'dark',
    });
  }, [
    origin,
    destination,
    activeRoute?.id,
    routeColor,
    transitSegments,
    geo.latitude,
    geo.longitude,
  ]);

  // 導航模式下傳送位置更新給 WebView
  useEffect(() => {
    if (navMode && geo.latitude && geo.longitude && webRef.current) {
      webRef.current.postMessage(
        JSON.stringify({
          type: 'updateLocation',
          lat: geo.latitude,
          lng: geo.longitude,
          follow: true,
        }),
      );
    }
  }, [navMode, geo.latitude, geo.longitude]);

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={{ flex: 1 }}>
          {/* ═══ 互動式地圖（Leaflet via WebView） ═══ */}
          <View style={{ height: MAP_HEIGHT, backgroundColor: theme.colors.surface2 }}>
            <PuWebView
              ref={webRef}
              originWhitelist={['*']}
              source={{ html: mapHtml }}
              style={{ flex: 1 }}
              scrollEnabled={false}
              bounces={false}
              javaScriptEnabled
              domStorageEnabled
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
            />

            {/* ── 定位按鈕 ── */}
            <Pressable
              onPress={() => {
                if (webRef.current && geo.latitude && geo.longitude) {
                  webRef.current.postMessage(
                    JSON.stringify({
                      type: 'updateLocation',
                      lat: geo.latitude,
                      lng: geo.longitude,
                      follow: true,
                    }),
                  );
                }
              }}
              style={({ pressed }) => ({
                position: 'absolute',
                bottom: 10,
                right: 60,
                width: 38,
                height: 38,
                borderRadius: 19,
                backgroundColor: theme.colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: theme.colors.border,
                shadowColor: '#000',
                shadowOpacity: 0.15,
                shadowRadius: 4,
                shadowOffset: { width: 0, height: 2 },
                elevation: 3,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="locate" size={18} color={theme.colors.accent} />
            </Pressable>

            {/* 即時導航 HUD */}
            {navMode && activeRoute && (
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  backgroundColor: CONGESTION_COLORS[congestionLevel] + 'E8',
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <View>
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 22 }}>
                    {liveETA || formatDuration(activeRoute.totalDuration)}
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11 }}>
                    {congestionLevel === 'heavy'
                      ? '路況壅塞'
                      : congestionLevel === 'moderate'
                        ? '路況尚可'
                        : '路況順暢'}{' '}
                    · {formatDistance(activeRoute.totalDistance)}
                  </Text>
                </View>
                <Pressable
                  onPress={stopNavigation}
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.25)',
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 20,
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>結束導航</Text>
                </Pressable>
              </View>
            )}

            {/* 改道建議 Banner */}
            {rerouteMsg && (
              <View
                style={{
                  position: 'absolute',
                  bottom: 50,
                  left: 12,
                  right: 12,
                  backgroundColor: '#5856D6F0',
                  borderRadius: theme.radius.lg,
                  padding: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <Ionicons name="flash" size={20} color="#fff" />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                    AI 智慧改道
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11 }}>
                    {rerouteMsg}
                  </Text>
                </View>
                <Pressable onPress={() => setRerouteMsg(null)}>
                  <Ionicons name="close-circle" size={20} color="rgba(255,255,255,0.7)" />
                </Pressable>
              </View>
            )}

            {/* 開啟外部地圖 / 開始導航 按鈕 */}
            {destination && activeRoute && !navMode && (
              <View
                style={{
                  position: 'absolute',
                  bottom: 10,
                  right: 12,
                  flexDirection: 'row',
                  gap: 8,
                }}
              >
                <Pressable
                  onPress={startNavigation}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    backgroundColor: '#34C759',
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: theme.radius.xl,
                    opacity: pressed ? 0.8 : 1,
                    shadowColor: '#000',
                    shadowOpacity: 0.2,
                    shadowRadius: 6,
                    shadowOffset: { width: 0, height: 2 },
                    elevation: 4,
                  })}
                >
                  <Ionicons name="navigate" size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>開始導航</Text>
                </Pressable>
                <Pressable
                  onPress={() => openExternalMap(origin, destination, destName, activeRoute.mode)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    backgroundColor: theme.colors.accent,
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: theme.radius.xl,
                    opacity: pressed ? 0.8 : 1,
                    shadowColor: '#000',
                    shadowOpacity: 0.2,
                    shadowRadius: 6,
                    shadowOffset: { width: 0, height: 2 },
                    elevation: 4,
                  })}
                >
                  <Ionicons name="open-outline" size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>外部地圖</Text>
                </Pressable>
              </View>
            )}

            {/* 搜尋框浮在地圖上方 */}
            <View
              style={{
                position: 'absolute',
                top: 8,
                left: 12,
                right: 12,
                zIndex: 10,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radius.xl,
                  paddingHorizontal: 14,
                  paddingVertical: 2,
                  gap: 8,
                  shadowColor: '#000',
                  shadowOpacity: 0.15,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 2 },
                  elevation: 4,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                {destination ? (
                  <Pressable onPress={clearNavigation}>
                    <Ionicons name="arrow-back" size={20} color={theme.colors.text} />
                  </Pressable>
                ) : (
                  <Ionicons name="search-outline" size={20} color={theme.colors.muted} />
                )}
                <TextInput
                  value={searchText}
                  onChangeText={(t) => {
                    setSearchText(t);
                    if (!t.trim()) setShowResults(false);
                  }}
                  placeholder="搜尋目的地..."
                  placeholderTextColor={theme.colors.muted}
                  onSubmitEditing={handleSearch}
                  returnKeyType="search"
                  style={{
                    flex: 1,
                    color: theme.colors.text,
                    fontSize: 15,
                    paddingVertical: 10,
                  }}
                />
                {searchText.length > 0 && (
                  <Pressable
                    onPress={() => {
                      setSearchText('');
                      setShowResults(false);
                    }}
                  >
                    <Ionicons name="close-circle" size={18} color={theme.colors.muted} />
                  </Pressable>
                )}
              </View>

              {/* 搜尋結果下拉 */}
              {showResults && (
                <View
                  style={{
                    marginTop: 4,
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radius.lg,
                    maxHeight: 260,
                    shadowColor: '#000',
                    shadowOpacity: 0.15,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 2 },
                    elevation: 4,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    overflow: 'hidden',
                  }}
                >
                  {searching ? (
                    <View style={{ padding: 16, alignItems: 'center' }}>
                      <ActivityIndicator color={theme.colors.accent} />
                      <Text style={{ color: theme.colors.muted, marginTop: 6, fontSize: 12 }}>
                        搜尋中...
                      </Text>
                    </View>
                  ) : searchResults.length === 0 ? (
                    <View style={{ padding: 16, alignItems: 'center' }}>
                      <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                        找不到結果，請嘗試其他關鍵字
                      </Text>
                    </View>
                  ) : (
                    <ScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
                      {searchResults.map((result) => (
                        <Pressable
                          key={result.placeId}
                          onPress={() => selectDestination(result)}
                          style={({ pressed }) => ({
                            flexDirection: 'row',
                            alignItems: 'center',
                            padding: 12,
                            gap: 10,
                            borderBottomWidth: 1,
                            borderBottomColor: theme.colors.surface2,
                            backgroundColor: pressed ? theme.colors.surface2 : 'transparent',
                          })}
                        >
                          <Ionicons name="location-outline" size={18} color={theme.colors.accent} />
                          <View style={{ flex: 1 }}>
                            <Text
                              style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600' }}
                              numberOfLines={1}
                            >
                              {result.shortName}
                            </Text>
                            <Text
                              style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}
                              numberOfLines={1}
                            >
                              {result.displayName}
                            </Text>
                          </View>
                        </Pressable>
                      ))}
                    </ScrollView>
                  )}
                </View>
              )}
            </View>
          </View>

          {/* ═══ 下方面板 ═══ */}
          <ScrollView
            style={{ flex: 1, backgroundColor: theme.colors.bg }}
            contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── 路線規劃中 ── */}
            {planning && (
              <View style={{ padding: 20, alignItems: 'center', gap: 8 }}>
                <ActivityIndicator color={theme.colors.accent} size="large" />
                <Text style={{ color: theme.colors.text, fontWeight: '700' }}>規劃路線中...</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                  同時計算開車、騎車、步行、大眾運輸方案
                </Text>
              </View>
            )}

            {/* ── 路線規劃失敗 ── */}
            {planError && !planning && routes.length === 0 && destination && (
              <View style={{ padding: 20, alignItems: 'center', gap: 10 }}>
                <Ionicons name="alert-circle-outline" size={40} color={theme.colors.warning} />
                <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 15 }}>
                  無法規劃路線
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, textAlign: 'center' }}>
                  找不到從目前位置到 {destName} 的路線{'\n'}請確認目的地或嘗試其他地點
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button
                    text="重新規劃"
                    kind="primary"
                    onPress={() => {
                      setPlanError(false);
                      selectDestination({
                        placeId: '',
                        displayName: destName,
                        shortName: destName,
                        lat: destination.lat,
                        lng: destination.lng,
                        type: '',
                        importance: 0,
                      });
                    }}
                  />
                  <Button text="返回" kind="outline" onPress={clearNavigation} />
                </View>
              </View>
            )}

            {/* ── 路線方案列表 ── */}
            {routes.length > 0 && !planning && (
              <View style={{ padding: 12, gap: 8 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 4,
                  }}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 16 }}>
                    路線方案
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>到 {destName}</Text>
                </View>

                {routes.map((route) => {
                  const isActive = selectedRoute === route.id;
                  const config = MODE_CONFIG[route.mode] ?? MODE_CONFIG.walking;

                  return (
                    <Pressable
                      key={route.id}
                      onPress={() => {
                        setSelectedRoute(route.id);
                        setShowSteps(false);
                      }}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        padding: 14,
                        borderRadius: theme.radius.lg,
                        backgroundColor: isActive ? `${config.color}12` : theme.colors.surface,
                        borderWidth: 2,
                        borderColor: isActive ? config.color : theme.colors.border,
                        opacity: pressed ? 0.8 : 1,
                        gap: 12,
                      })}
                    >
                      {/* 模式圖示 */}
                      <View
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 22,
                          backgroundColor: isActive ? config.color : theme.colors.surface2,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Ionicons
                          name={config.icon as any}
                          size={22}
                          color={isActive ? '#fff' : theme.colors.muted}
                        />
                      </View>

                      {/* 路線資訊 */}
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text
                            style={{ color: theme.colors.text, fontWeight: '800', fontSize: 18 }}
                          >
                            {formatDuration(route.totalDuration)}
                          </Text>
                          <Pill text={config.label} kind={isActive ? 'accent' : 'default'} />
                          {route.congestionScore !== undefined && route.congestionScore > 0.2 && (
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 3,
                                backgroundColor:
                                  route.congestionScore > 0.5 ? '#f43f5e20' : '#FF950020',
                                paddingHorizontal: 6,
                                paddingVertical: 2,
                                borderRadius: 4,
                              }}
                            >
                              <View
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: 3,
                                  backgroundColor:
                                    route.congestionScore > 0.5 ? '#f43f5e' : '#FF9500',
                                }}
                              />
                              <Text
                                style={{
                                  color: route.congestionScore > 0.5 ? '#f43f5e' : '#FF9500',
                                  fontSize: 10,
                                  fontWeight: '700',
                                }}
                              >
                                {route.congestionScore > 0.5 ? '壅塞' : '略塞'}
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 3 }}>
                          {route.summary}
                        </Text>

                        {/* 大眾運輸顯示轉乘資訊 */}
                        {route.transitDetails && route.transitDetails.length > 0 && (
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 4,
                              marginTop: 6,
                              flexWrap: 'wrap',
                            }}
                          >
                            {route.transitDetails.map((td, i) => (
                              <React.Fragment key={i}>
                                {i > 0 && (
                                  <Ionicons
                                    name="chevron-forward"
                                    size={12}
                                    color={theme.colors.muted}
                                  />
                                )}
                                {td.type === 'walk' ? (
                                  <View
                                    style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
                                  >
                                    <Ionicons
                                      name="walk-outline"
                                      size={14}
                                      color={theme.colors.muted}
                                    />
                                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                                      {formatDistance(td.walkDistance ?? 0)}
                                    </Text>
                                  </View>
                                ) : td.type === 'bus' ? (
                                  <View
                                    style={{
                                      flexDirection: 'row',
                                      alignItems: 'center',
                                      gap: 4,
                                      backgroundColor: '#5856D620',
                                      paddingHorizontal: 6,
                                      paddingVertical: 2,
                                      borderRadius: 4,
                                    }}
                                  >
                                    <Ionicons name="bus" size={12} color="#5856D6" />
                                    <Text
                                      style={{ color: '#5856D6', fontSize: 11, fontWeight: '700' }}
                                    >
                                      {td.routeName}
                                    </Text>
                                    {td.estimateMinutes !== undefined && (
                                      <Text style={{ color: '#5856D6', fontSize: 10 }}>
                                        ({td.estimateMinutes}分到)
                                      </Text>
                                    )}
                                  </View>
                                ) : null}
                              </React.Fragment>
                            ))}
                          </View>
                        )}
                      </View>

                      {/* 展開箭頭 */}
                      <Ionicons
                        name={isActive ? 'chevron-down' : 'chevron-forward'}
                        size={18}
                        color={theme.colors.muted}
                      />
                    </Pressable>
                  );
                })}

                {/* 導航操作列 */}
                {activeRoute && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable
                      onPress={() => setShowSteps(!showSteps)}
                      style={({ pressed }) => ({
                        flex: 1,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        paddingVertical: 10,
                        gap: 6,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Ionicons
                        name={showSteps ? 'chevron-up' : 'list-outline'}
                        size={16}
                        color={theme.colors.accent}
                      />
                      <Text style={{ color: theme.colors.accent, fontWeight: '700', fontSize: 13 }}>
                        {showSteps ? '收合步驟' : '導航步驟'}
                      </Text>
                    </Pressable>
                    {!navMode && (
                      <Pressable
                        onPress={startNavigation}
                        style={({ pressed }) => ({
                          flex: 1,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          paddingVertical: 10,
                          gap: 6,
                          backgroundColor: '#34C759',
                          borderRadius: theme.radius.lg,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Ionicons name="navigate" size={16} color="#fff" />
                        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                          AI 智慧導航
                        </Text>
                      </Pressable>
                    )}
                  </View>
                )}

                {/* 逐步導航指示 */}
                {showSteps && activeRoute && (
                  <View
                    style={{
                      backgroundColor: theme.colors.surface,
                      borderRadius: theme.radius.lg,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      overflow: 'hidden',
                    }}
                  >
                    {activeRoute.steps.map((step, i) => {
                      const isFirst = i === 0;
                      const isLast = i === activeRoute.steps.length - 1;
                      const stepIcon =
                        step.maneuver === 'depart'
                          ? 'radio-button-on'
                          : step.maneuver === 'arrive'
                            ? 'flag'
                            : step.maneuver === 'notification'
                              ? 'bus'
                              : step.instruction.includes('左')
                                ? 'arrow-back'
                                : step.instruction.includes('右')
                                  ? 'arrow-forward'
                                  : 'arrow-up';

                      return (
                        <View
                          key={i}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'flex-start',
                            padding: 12,
                            gap: 12,
                            borderBottomWidth: isLast ? 0 : 1,
                            borderBottomColor: theme.colors.surface2,
                          }}
                        >
                          {/* 圖示 + 連接線 */}
                          <View style={{ alignItems: 'center', width: 28 }}>
                            <View
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 14,
                                backgroundColor:
                                  isFirst || isLast
                                    ? theme.colors.accent
                                    : step.maneuver === 'notification'
                                      ? '#5856D6'
                                      : theme.colors.surface2,
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <Ionicons
                                name={stepIcon as any}
                                size={14}
                                color={
                                  isFirst || isLast || step.maneuver === 'notification'
                                    ? '#fff'
                                    : theme.colors.text
                                }
                              />
                            </View>
                          </View>

                          {/* 指示文字 */}
                          <View style={{ flex: 1 }}>
                            <Text
                              style={{
                                color: theme.colors.text,
                                fontSize: 13,
                                fontWeight: '600',
                                lineHeight: 19,
                              }}
                            >
                              {step.instruction}
                            </Text>
                            {step.distance > 0 && (
                              <Text
                                style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}
                              >
                                {formatDistance(step.distance)} · 約 {formatDuration(step.duration)}
                              </Text>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            {/* ── 未搜尋時顯示快速入口 ── */}
            {!destination && !planning && (
              <View style={{ padding: 12, gap: 12 }}>
                {/* 出發地提示 */}
                <Pressable
                  onPress={async () => {
                    setOriginName('重新定位中...');
                    const pos = await geo.getCurrentPosition();
                    if (
                      pos?.latitude &&
                      pos?.longitude &&
                      isInTaiwan(pos.latitude, pos.longitude)
                    ) {
                      setOrigin({ lat: pos.latitude, lng: pos.longitude });
                      try {
                        const name = await reverseGeocode(pos.latitude, pos.longitude);
                        setOriginName(name.split(',').slice(0, 2).join(', '));
                      } catch {
                        setOriginName('目前位置');
                      }
                    } else {
                      setOriginName('靜宜大學（預設位置）');
                      setOrigin(PU_LOCATION);
                    }
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    padding: 12,
                    borderRadius: theme.radius.lg,
                    backgroundColor: theme.colors.surface,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  {geo.loading ? (
                    <ActivityIndicator size="small" color="#5856D6" />
                  ) : (
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: geo.latitude ? '#34C759' : '#FF9500',
                      }}
                    />
                  )}
                  <Text
                    style={{ color: theme.colors.text, fontSize: 13, flex: 1 }}
                    numberOfLines={1}
                  >
                    {originName}
                  </Text>
                  <Ionicons name="locate-outline" size={18} color={theme.colors.accent} />
                </Pressable>

                {/* 快速查詢 Tabs */}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {[
                    { id: 'bus' as QuickTab, icon: 'bus-outline', label: '公車' },
                    { id: 'train' as QuickTab, icon: 'train-outline', label: '台鐵' },
                    { id: 'hsr' as QuickTab, icon: 'rocket-outline', label: '高鐵' },
                    { id: 'bike' as QuickTab, icon: 'bicycle-outline', label: 'YouBike' },
                  ].map((tab) => {
                    const isActive = quickTab === tab.id;
                    return (
                      <Pressable
                        key={tab.id}
                        onPress={() => setQuickTab(isActive ? 'none' : tab.id)}
                        style={({ pressed }) => ({
                          flex: 1,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 5,
                          paddingVertical: 10,
                          borderRadius: theme.radius.lg,
                          backgroundColor: isActive ? theme.colors.accent : theme.colors.surface,
                          borderWidth: 1,
                          borderColor: isActive ? theme.colors.accent : theme.colors.border,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Ionicons
                          name={tab.icon as any}
                          size={15}
                          color={isActive ? '#fff' : theme.colors.muted}
                        />
                        <Text
                          style={{
                            color: isActive ? '#fff' : theme.colors.text,
                            fontSize: 12,
                            fontWeight: isActive ? '700' : '500',
                          }}
                        >
                          {tab.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* 快速查詢內容 */}
                {quickTab === 'bus' && <QuickBusPanel />}
                {quickTab === 'train' && <QuickTrainPanel />}
                {quickTab === 'hsr' && <QuickHSRPanel />}
                {quickTab === 'bike' && <QuickBikePanel />}

                {/* 常搜地點 */}
                {quickTab === 'none' && (
                  <Card title="常用目的地" subtitle="點選直接規劃路線">
                    <View style={{ gap: 6 }}>
                      {[
                        { name: '台中車站', lat: 24.137, lng: 120.686 },
                        { name: '高鐵台中站', lat: 24.1118, lng: 120.6153 },
                        { name: '沙鹿火車站', lat: 24.2335, lng: 120.5665 },
                        { name: '東海大學', lat: 24.179, lng: 120.603 },
                        { name: '台中秋紅谷', lat: 24.1628, lng: 120.6402 },
                        { name: '逢甲夜市', lat: 24.1787, lng: 120.6457 },
                        { name: '台中國家歌劇院', lat: 24.1631, lng: 120.6405 },
                        { name: '清水休息站', lat: 24.2702, lng: 120.5632 },
                      ].map((place) => (
                        <Pressable
                          key={place.name}
                          onPress={() =>
                            selectDestination({
                              placeId: place.name,
                              displayName: place.name,
                              shortName: place.name,
                              lat: place.lat,
                              lng: place.lng,
                              type: 'place',
                              importance: 1,
                            })
                          }
                          style={({ pressed }) => ({
                            flexDirection: 'row',
                            alignItems: 'center',
                            padding: 10,
                            borderRadius: theme.radius.md,
                            backgroundColor: theme.colors.surface2,
                            opacity: pressed ? 0.7 : 1,
                            gap: 10,
                          })}
                        >
                          <Ionicons name="location" size={16} color={theme.colors.accent} />
                          <Text style={{ color: theme.colors.text, fontSize: 13, flex: 1 }}>
                            {place.name}
                          </Text>
                          <Ionicons name="navigate-outline" size={14} color={theme.colors.muted} />
                        </Pressable>
                      ))}
                    </View>
                  </Card>
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ═══════════════════════════════════════════════════════
// 快速查詢面板
// ═══════════════════════════════════════════════════════

function QuickBusPanel() {
  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState<TDXBusRoute[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [stops, setStops] = useState<TDXBusStopOfRoute[]>([]);
  const [estimates, setEstimates] = useState<TDXBusEstimate[]>([]);
  const [loadingStops, setLoadingStops] = useState(false);
  const [direction, setDirection] = useState(0);

  const handleSearch = useCallback(async () => {
    if (!searchText.trim()) return;
    setSearching(true);
    try {
      setResults(await searchBusRoutes(searchText.trim()));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchText]);

  const selectRoute = useCallback(async (routeId: string) => {
    setSelectedRoute(routeId);
    setLoadingStops(true);
    try {
      const [s, e] = await Promise.all([getBusStopsOfRoute(routeId), getBusEstimates(routeId)]);
      setStops(s);
      setEstimates(e);
      setDirection(0);
    } catch {
      setStops([]);
      setEstimates([]);
    } finally {
      setLoadingStops(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedRoute) return;
    const iv = setInterval(async () => {
      try {
        setEstimates(await getBusEstimates(selectedRoute));
      } catch {}
    }, 30000);
    return () => clearInterval(iv);
  }, [selectedRoute]);

  const currentStops = useMemo(
    () => stops.find((s) => s.Direction === direction)?.Stops ?? [],
    [stops, direction],
  );
  const etaMap = useMemo(() => {
    const m = new Map<string, TDXBusEstimate>();
    estimates.filter((e) => e.Direction === direction).forEach((e) => m.set(e.StopUID, e));
    return m;
  }, [estimates, direction]);

  return (
    <Card title="公車即時到站">
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            borderRadius: theme.radius.lg,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
            paddingHorizontal: 10,
            minHeight: 40,
          }}
        >
          <Ionicons name="search-outline" size={16} color={theme.colors.muted} />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="路線號碼（如 300）"
            placeholderTextColor={theme.colors.muted}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            style={{ flex: 1, color: theme.colors.text, fontSize: 13 }}
          />
        </View>
        <Button text="搜" kind="primary" onPress={handleSearch} disabled={searching} />
      </View>

      {/* 常用路線 */}
      {!selectedRoute && results.length === 0 && (
        <View style={{ gap: 4 }}>
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginBottom: 4 }}>
            靜宜周邊常用路線
          </Text>
          {PU_COMMON_BUS_ROUTES.slice(0, 6).map((r) => (
            <Pressable
              key={r.id}
              onPress={() => selectRoute(r.id)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                padding: 8,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
                opacity: pressed ? 0.7 : 1,
                marginBottom: 2,
              })}
            >
              <View
                style={{
                  width: 40,
                  height: 24,
                  borderRadius: 4,
                  backgroundColor: '#5856D6',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 8,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 11 }}>{r.name}</Text>
              </View>
              <Text style={{ color: theme.colors.text, fontSize: 11, flex: 1 }} numberOfLines={1}>
                {r.desc}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* 搜尋結果 */}
      {results.length > 0 && !selectedRoute && (
        <View style={{ gap: 4 }}>
          {results.slice(0, 8).map((r) => (
            <Pressable
              key={r.RouteUID}
              onPress={() => selectRoute(r.RouteID)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                padding: 8,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <View
                style={{
                  width: 40,
                  height: 24,
                  borderRadius: 4,
                  backgroundColor: theme.colors.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 8,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 11 }}>
                  {r.RouteName.Zh_tw}
                </Text>
              </View>
              <Text style={{ color: theme.colors.text, fontSize: 11, flex: 1 }} numberOfLines={1}>
                {r.DepartureStopNameZh ?? ''} → {r.DestinationStopNameZh ?? ''}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* 站牌 + ETA */}
      {selectedRoute && (
        <>
          {stops.length > 1 && (
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
              {stops.map((d) => (
                <Pressable
                  key={d.Direction}
                  onPress={() => setDirection(d.Direction)}
                  style={{
                    flex: 1,
                    paddingVertical: 6,
                    borderRadius: theme.radius.md,
                    backgroundColor:
                      direction === d.Direction ? theme.colors.accent : theme.colors.surface2,
                    alignItems: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: direction === d.Direction ? '#fff' : theme.colors.text,
                      fontWeight: '600',
                      fontSize: 11,
                    }}
                  >
                    {d.Direction === 0 ? '去程' : '返程'}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {loadingStops ? (
            <ActivityIndicator color={theme.colors.accent} />
          ) : (
            <View style={{ gap: 1, maxHeight: 300 }}>
              {currentStops.map((stop, i) => {
                const eta = etaMap.get(stop.StopUID);
                const hasETA = eta && eta.StopStatus === 0 && eta.EstimateTime !== undefined;
                return (
                  <View
                    key={stop.StopUID}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 6,
                      paddingHorizontal: 4,
                      borderBottomWidth: i < currentStops.length - 1 ? 1 : 0,
                      borderBottomColor: theme.colors.surface2,
                    }}
                  >
                    <View
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 9,
                        backgroundColor: hasETA ? theme.colors.accent : theme.colors.surface2,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: 8,
                      }}
                    >
                      <Text
                        style={{
                          color: hasETA ? '#fff' : theme.colors.muted,
                          fontSize: 8,
                          fontWeight: '700',
                        }}
                      >
                        {stop.StopSequence}
                      </Text>
                    </View>
                    <Text style={{ flex: 1, color: theme.colors.text, fontSize: 12 }}>
                      {stop.StopName.Zh_tw}
                    </Text>
                    <Text
                      style={{
                        color: hasETA
                          ? (eta?.EstimateTime ?? 0) < 180
                            ? '#f43f5e'
                            : theme.colors.accent
                          : theme.colors.muted,
                        fontWeight: '700',
                        fontSize: 12,
                        minWidth: 50,
                        textAlign: 'right',
                      }}
                    >
                      {hasETA
                        ? eta!.EstimateTime! < 60
                          ? '即將到站'
                          : `${Math.ceil(eta!.EstimateTime! / 60)} 分`
                        : eta?.StopStatus === 3
                          ? '末班已過'
                          : '—'}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
          <Pressable
            onPress={() => {
              setSelectedRoute(null);
              setStops([]);
              setEstimates([]);
            }}
            style={{ marginTop: 8, alignItems: 'center' }}
          >
            <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '600' }}>
              ← 返回路線列表
            </Text>
          </Pressable>
        </>
      )}
    </Card>
  );
}

function QuickTrainPanel() {
  const [station, setStation] = useState(PU_NEARBY_TRAIN_STATIONS[0].id);
  const [data, setData] = useState<TDXTrainTimetable[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getTrainSchedule(station)
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [station]);

  const now = new Date();
  const nowStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const upcoming = useMemo(
    () =>
      data
        .filter((t) => {
          const s = t.StopTimes?.find((s) => s.StationID === station);
          return s && s.DepartureTime >= nowStr;
        })
        .sort((a, b) => {
          const at = a.StopTimes?.find((s) => s.StationID === station)?.DepartureTime ?? '';
          const bt = b.StopTimes?.find((s) => s.StationID === station)?.DepartureTime ?? '';
          return at.localeCompare(bt);
        })
        .slice(0, 12),
    [data, station, nowStr],
  );

  return (
    <Card title="台鐵時刻表">
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
        {PU_NEARBY_TRAIN_STATIONS.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => setStation(s.id)}
            style={{
              flex: 1,
              paddingVertical: 6,
              borderRadius: theme.radius.md,
              backgroundColor: station === s.id ? theme.colors.accent : theme.colors.surface2,
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                color: station === s.id ? '#fff' : theme.colors.text,
                fontWeight: '700',
                fontSize: 12,
              }}
            >
              {s.name}
            </Text>
            <Text
              style={{
                color: station === s.id ? 'rgba(255,255,255,0.7)' : theme.colors.muted,
                fontSize: 9,
              }}
            >
              {s.distance}
            </Text>
          </Pressable>
        ))}
      </View>
      {loading ? (
        <ActivityIndicator color={theme.colors.accent} />
      ) : upcoming.length === 0 ? (
        <Text style={{ color: theme.colors.muted, textAlign: 'center', padding: 12 }}>
          今日無更多班次
        </Text>
      ) : (
        <View style={{ gap: 2 }}>
          {upcoming.map((t) => {
            const s = t.StopTimes?.find((s) => s.StationID === station);
            if (!s) return null;
            return (
              <View
                key={t.DailyTrainInfo.TrainNo}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 6,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.surface2,
                }}
              >
                <Text
                  style={{ width: 44, color: theme.colors.text, fontSize: 12, fontWeight: '600' }}
                >
                  {t.DailyTrainInfo.TrainNo}
                </Text>
                <Text style={{ width: 50, color: theme.colors.muted, fontSize: 10 }}>
                  {t.DailyTrainInfo.TrainTypeName?.Zh_tw ?? ''}
                </Text>
                <Text
                  style={{ width: 44, color: theme.colors.accent, fontSize: 13, fontWeight: '700' }}
                >
                  {s.DepartureTime.substring(0, 5)}
                </Text>
                <Text
                  style={{ flex: 1, color: theme.colors.muted, fontSize: 11, textAlign: 'right' }}
                >
                  {t.DailyTrainInfo.EndingStationName?.Zh_tw ?? ''}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

function QuickHSRPanel() {
  const [data, setData] = useState<TDXHSRTimetable[]>([]);
  const [loading, setLoading] = useState(true);
  const [dir, setDir] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    getHSRSchedule()
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const nowStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const upcoming = useMemo(
    () =>
      data
        .filter((t) => {
          if (dir !== null && t.DailyTrainInfo.Direction !== dir) return false;
          const s = t.StopTimes?.find((s) => s.StationID === HSR_TAICHUNG_STATION_ID);
          return s && s.DepartureTime >= nowStr;
        })
        .sort((a, b) => {
          const as =
            a.StopTimes?.find((s) => s.StationID === HSR_TAICHUNG_STATION_ID)?.DepartureTime ?? '';
          const bs =
            b.StopTimes?.find((s) => s.StationID === HSR_TAICHUNG_STATION_ID)?.DepartureTime ?? '';
          return as.localeCompare(bs);
        })
        .slice(0, 12),
    [data, dir, nowStr],
  );

  return (
    <Card title="高鐵台中站">
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
        {[
          { v: null, l: '全部' },
          { v: 0, l: '南下' },
          { v: 1, l: '北上' },
        ].map((o) => (
          <Pressable
            key={String(o.v)}
            onPress={() => setDir(o.v)}
            style={{
              flex: 1,
              paddingVertical: 6,
              borderRadius: theme.radius.md,
              backgroundColor: dir === o.v ? theme.colors.accent : theme.colors.surface2,
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                color: dir === o.v ? '#fff' : theme.colors.text,
                fontWeight: '600',
                fontSize: 12,
              }}
            >
              {o.l}
            </Text>
          </Pressable>
        ))}
      </View>
      {loading ? (
        <ActivityIndicator color={theme.colors.accent} />
      ) : upcoming.length === 0 ? (
        <Text style={{ color: theme.colors.muted, textAlign: 'center', padding: 12 }}>
          今日無更多班次
        </Text>
      ) : (
        <View style={{ gap: 2 }}>
          {upcoming.map((t) => {
            const s = t.StopTimes?.find((s) => s.StationID === HSR_TAICHUNG_STATION_ID);
            if (!s) return null;
            const isSouth = t.DailyTrainInfo.Direction === 0;
            return (
              <View
                key={t.DailyTrainInfo.TrainNo}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 6,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.surface2,
                }}
              >
                <Text
                  style={{ width: 40, color: theme.colors.text, fontSize: 12, fontWeight: '600' }}
                >
                  {t.DailyTrainInfo.TrainNo}
                </Text>
                <View style={{ width: 36, alignItems: 'center' }}>
                  <Text
                    style={{
                      color: isSouth ? '#5856D6' : '#FF9500',
                      fontSize: 10,
                      fontWeight: '700',
                    }}
                  >
                    {isSouth ? '南下' : '北上'}
                  </Text>
                </View>
                <Text
                  style={{ width: 44, color: theme.colors.accent, fontSize: 13, fontWeight: '700' }}
                >
                  {s.DepartureTime.substring(0, 5)}
                </Text>
                <Text
                  style={{ flex: 1, color: theme.colors.muted, fontSize: 11, textAlign: 'right' }}
                >
                  {t.DailyTrainInfo.EndingStationName?.Zh_tw ?? ''}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

function QuickBikePanel() {
  const [stations, setStations] = useState<BikeStationWithAvailability[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getNearbyBikesWithAvailability()
      .then(setStations)
      .catch(() => setStations([]))
      .finally(() => setLoading(false));
  }, []);

  const total = stations.reduce((s, st) => s + st.availableRent, 0);

  return (
    <Card title="YouBike 站點" subtitle="靜宜 2km 內">
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        <View
          style={{
            flex: 1,
            padding: 10,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.accentSoft,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: theme.colors.accent, fontWeight: '900', fontSize: 20 }}>
            {total}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 10 }}>可借車輛</Text>
        </View>
        <View
          style={{
            flex: 1,
            padding: 10,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.surface2,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: theme.colors.text, fontWeight: '900', fontSize: 20 }}>
            {stations.length}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 10 }}>站點數</Text>
        </View>
      </View>
      {loading ? (
        <ActivityIndicator color={theme.colors.accent} />
      ) : (
        <View style={{ gap: 4 }}>
          {stations.slice(0, 10).map((st) => (
            <View
              key={st.StationUID}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 6,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.surface2,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: st.availableRent === 0 ? '#f43f5e20' : theme.colors.accentSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 8,
                }}
              >
                <Text
                  style={{
                    color: st.availableRent === 0 ? '#f43f5e' : theme.colors.accent,
                    fontWeight: '900',
                    fontSize: 13,
                  }}
                >
                  {st.availableRent}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{ color: theme.colors.text, fontSize: 12, fontWeight: '600' }}
                  numberOfLines={1}
                >
                  {st.StationName.Zh_tw}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
                  可借 {st.availableRent} · 可還 {st.availableReturn}
                  {st.hasElectric ? ` · 電輔 ${st.electricBikes}` : ''}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}
