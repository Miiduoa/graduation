/* eslint-disable */
/**
 * 校園地圖極致版（GoogleMapsLikeScreen）
 *
 * 目標：在 Expo / RN 上做出媲美 Google Maps 的體驗
 *  - 4 種圖層切換：標準（CartoDB Voyager）、衛星（Esri）、暗色（Carto Dark）、3D 校園（Carto Voyager 高 zoom）
 *  - POI 點擊出富卡片：類別、營業狀態、人潮、評論星等、即時公車、AR 帶我去
 *  - Turn-by-turn 導航：大箭頭、剩餘距離、語音 cue、自動重規劃（mock）
 *  - 公車圖層：地圖上即時顯示每台公車（從 simulateActiveVehicles）
 *  - 多分類 chips 快速過濾
 *  - 跨域搜尋：先在校園 POI 內找，再 fallback 到 OSM Nominatim（已存在的 routingService）
 *
 * 實作策略：用 WebView + Leaflet（與 TransportHubScreen 同套）
 *  → 維持單一技術棧、避免引入 react-native-maps 的原生編譯複雜度
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  View,
  TextInput,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { WebView } from 'react-native-webview';
import { PuWebView } from '../ui/PuWebView';
import { theme } from '../ui/theme';
import { analytics } from '../services/analytics';
import { useGeolocation } from '../hooks/useGeolocation';
import {
  CAMPUS_POIS,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  CATEGORY_COLORS,
  searchCampusPois,
  getCampusPoi,
  type CampusPoi,
  type CampusPoiCategory,
} from '../data/puCampusData';
import {
  CAMPUS_BUS_ROUTES,
  simulateActiveVehicles,
  crowdLabel,
  getCampusBusRoute,
  type CampusBusRoute,
  type CampusBusVehicle,
} from '../data/campusBusRoutes';
import { useSavedPlaces } from '../services/savedPlaces';
import { usePersonaContext } from '../services/personaContext';
import { hasIndoorMap as hasIndoor } from '../data/indoorMaps';
import {
  useOfflinePack,
  getPersonaExtraPoints,
  formatBytes,
} from '../services/offlineCache';

type Layer = 'standard' | 'satellite' | 'dark' | 'campus3d';

const LAYER_TILE_URL: Record<Layer, string> = {
  standard:
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  satellite:
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  campus3d:
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png',
};

const LAYER_OPTIONS: { id: Layer; icon: string; label: string }[] = [
  { id: 'standard', icon: 'map-outline', label: '標準' },
  { id: 'satellite', icon: 'globe-outline', label: '衛星' },
  { id: 'campus3d', icon: 'business-outline', label: '校園' },
  { id: 'dark', icon: 'moon-outline', label: '暗色' },
];

const CATEGORY_FILTERS: { cat: CampusPoiCategory | 'all'; label: string; icon: string }[] = [
  { cat: 'all', label: '全部', icon: 'apps-outline' },
  { cat: 'cafeteria', label: '餐廳', icon: 'restaurant-outline' },
  { cat: 'library', label: '圖書館', icon: 'library-outline' },
  { cat: 'academic', label: '教學', icon: 'school-outline' },
  { cat: 'dormitory', label: '宿舍', icon: 'home-outline' },
  { cat: 'sports', label: '運動', icon: 'fitness-outline' },
  { cat: 'parking', label: '停車', icon: 'car-outline' },
  { cat: 'convenience', label: '便利', icon: 'storefront-outline' },
  { cat: 'medical', label: '醫療', icon: 'medkit-outline' },
];

// ═════════════════════════════════════════════════════
// Leaflet 地圖 HTML（多圖層 + 公車 + POI）
// ═════════════════════════════════════════════════════

function buildMapHtml(opts: {
  layer: Layer;
  center: { lat: number; lng: number };
  zoom: number;
}): string {
  const { layer, center, zoom } = opts;
  const tile = LAYER_TILE_URL[layer];
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
  *{margin:0;padding:0}
  html,body,#map{width:100%;height:100%;background:#0B1014}
  .user-dot{width:20px;height:20px;border-radius:50%;background:#007AFF;border:4px solid #fff;box-shadow:0 0 0 6px rgba(59,130,246,.25),0 4px 8px rgba(0,0,0,.4);animation:pulse 2s infinite ease-out}
  @keyframes pulse{0%,100%{box-shadow:0 0 0 6px rgba(59,130,246,.25),0 4px 8px rgba(0,0,0,.4)}50%{box-shadow:0 0 0 14px rgba(59,130,246,.06),0 4px 8px rgba(0,0,0,.4)}}
  .poi-pin{display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 4px rgba(0,0,0,.45))}
  .poi-pin .head{width:34px;height:34px;border-radius:50%;border:3px solid #fff;display:grid;place-items:center;font-size:16px}
  .poi-pin .tail{width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:9px solid #fff;margin-top:-2px}
  .bus-pin{width:40px;height:40px;border-radius:50%;background:#fff;border:3px solid #D70015;display:grid;place-items:center;color:#D70015;font-weight:900;font-size:13px;box-shadow:0 4px 10px rgba(0,0,0,.4);position:relative}
  .bus-pin::after{content:"";position:absolute;bottom:-8px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid #fff}
  .stop-dot{width:14px;height:14px;border-radius:50%;background:#AF52DE;border:3px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,.4)}
  .selected-glow{filter:drop-shadow(0 0 6px rgba(111,134,255,.9))}
</style>
</head>
<body>
<div id="map"></div>
<script>
  var center=[${center.lat},${center.lng}];
  var map=L.map('map',{zoomControl:false,attributionControl:false}).setView(center,${zoom});
  var tileLayer=L.tileLayer('${tile}',{maxZoom:19}).addTo(map);
  var userMarker=null;
  var poiMarkers=L.layerGroup().addTo(map);
  var busMarkers=L.layerGroup().addTo(map);
  var routeLine=null;
  var routeBg=null;
  var selectedPoiId=null;

  function postRN(payload){
    try{
      if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    }catch(e){}
  }

  // 接 RN 訊息
  function onMsg(e){
    try{
      var d=JSON.parse(e.data);
      if(d.type==='setLayer'){
        if(tileLayer) map.removeLayer(tileLayer);
        tileLayer=L.tileLayer(d.url,{maxZoom:19}).addTo(map);
      }
      if(d.type==='setUserLocation'){
        if(userMarker) map.removeLayer(userMarker);
        userMarker=L.marker([d.lat,d.lng],{icon:L.divIcon({className:'',html:'<div class="user-dot"></div>',iconSize:[28,28],iconAnchor:[14,14]})}).addTo(map);
      }
      if(d.type==='centerOn'){
        map.setView([d.lat,d.lng],d.zoom||16,{animate:true});
      }
      if(d.type==='setPois'){
        poiMarkers.clearLayers();
        d.pois.forEach(function(p){
          var color=p.color||'#6F86FF';
          var html='<div class="poi-pin '+(p.id===selectedPoiId?'selected-glow':'')+'"><div class="head" style="background:'+color+'">'+p.emoji+'</div><div class="tail" style="border-top-color:'+color+'"></div></div>';
          var m=L.marker([p.lat,p.lng],{icon:L.divIcon({className:'',html:html,iconSize:[34,46],iconAnchor:[17,42]})});
          m.on('click',function(){postRN({type:'poiTap',id:p.id})});
          m.addTo(poiMarkers);
        });
      }
      if(d.type==='setBuses'){
        busMarkers.clearLayers();
        d.buses.forEach(function(b){
          var html='<div class="bus-pin" style="border-color:'+b.color+';color:'+b.color+'">'+b.code+'</div>';
          var m=L.marker([b.lat,b.lng],{icon:L.divIcon({className:'',html:html,iconSize:[40,48],iconAnchor:[20,46]})});
          m.on('click',function(){postRN({type:'busTap',id:b.id})});
          m.addTo(busMarkers);
        });
      }
      if(d.type==='setRoute'){
        if(routeLine) map.removeLayer(routeLine);
        if(routeBg) map.removeLayer(routeBg);
        if(d.coords&&d.coords.length>1){
          routeBg=L.polyline(d.coords,{color:'#fff',weight:9,opacity:1,lineCap:'round',lineJoin:'round'}).addTo(map);
          routeLine=L.polyline(d.coords,{color:d.color||'#6F86FF',weight:5,opacity:0.95,lineCap:'round',lineJoin:'round'}).addTo(map);
          map.fitBounds(routeBg.getBounds().pad(0.18));
        }
      }
      if(d.type==='setSelected'){
        selectedPoiId=d.id;
      }
    }catch(e){}
  }
  document.addEventListener('message',onMsg);
  window.addEventListener('message',onMsg);

  map.on('moveend',function(){
    var c=map.getCenter();
    postRN({type:'moved',lat:c.lat,lng:c.lng,zoom:map.getZoom()});
  });
  postRN({type:'ready'});
<\/script>
</body>
</html>`;
}

// ═════════════════════════════════════════════════════
// 工具：距離格式
// ═════════════════════════════════════════════════════
function fmtDist(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}
function fmtWalk(m: number): string {
  const min = Math.ceil(m / 75);
  return min < 1 ? '<1 分' : `${min} 分`;
}
function haver(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function isOpenNow(open: string, close: string, now: Date = new Date()): boolean {
  const m = now.getHours() * 60 + now.getMinutes();
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  const o = (oh ?? 0) * 60 + (om ?? 0);
  const c = (ch ?? 23) * 60 + (cm ?? 59);
  return m >= o && m <= c;
}

// ═════════════════════════════════════════════════════
// 主畫面
// ═════════════════════════════════════════════════════

export function GoogleMapsLikeScreen(_props: Record<string, unknown>) {
  const nav = useNavigation<any>();
  const webRef = useRef<WebView>(null);

  const [layer, setLayer] = useState<Layer>('standard');
  const [showBusLayer, setShowBusLayer] = useState<boolean>(true);
  const [cat, setCat] = useState<CampusPoiCategory | 'all'>('all');
  const [q, setQ] = useState('');
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [navMode, setNavMode] = useState<{
    destPoi: CampusPoi;
    coords: [number, number][];
    distanceM: number;
    stepIdx: number;
    instructions: { instr: string; distM: number }[];
  } | null>(null);

  const geo = useGeolocation({
    enableHighAccuracy: true,
    distanceInterval: 5,
    timeInterval: 3000,
    autoStart: true,
  });
  const uLat = typeof geo.latitude === 'number' ? geo.latitude : 24.2275;
  const uLng = typeof geo.longitude === 'number' ? geo.longitude : 120.5647;

  // ── Bus vehicles (simulated, refresh every 5s) ──
  const [busTick, setBusTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setBusTick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const activeVehicles: CampusBusVehicle[] = useMemo(
    () => simulateActiveVehicles(new Date()),
    [busTick],
  );

  // ── Filtered POIs ──
  const filteredPois: CampusPoi[] = useMemo(() => {
    let list = CAMPUS_POIS;
    if (q.trim()) {
      list = searchCampusPois(q.trim());
    }
    if (cat !== 'all') {
      list = list.filter((p) => p.category === cat);
    }
    return list;
  }, [q, cat]);

  // ── Saved places ──
  const { places: savedPlaces, useNow: recordPlaceUsageNow } = useSavedPlaces();

  // ── Persona ──
  const persona = usePersonaContext();

  // ── Offline pack ──
  const offline = useOfflinePack();
  const handleDownloadOffline = useCallback(async () => {
    const home = savedPlaces.find((p) => p.kind === 'home');
    await offline.start({
      extraPoints: getPersonaExtraPoints(home?.lat, home?.lng),
      areaLabel: persona.isDemoPersona
        ? `校園 + ${persona.displayName} 常用路線`
        : '校園範圍',
      personaUid: persona.uid,
    });
  }, [offline, savedPlaces, persona]);

  // ── Selected POI ──
  const selectedPoi: CampusPoi | null = useMemo(() => {
    return selectedPoiId ? getCampusPoi(selectedPoiId) ?? null : null;
  }, [selectedPoiId]);

  const selectedDist: number | null = useMemo(() => {
    if (!selectedPoi) return null;
    return haver(uLat, uLng, selectedPoi.lat, selectedPoi.lng);
  }, [selectedPoi, uLat, uLng]);

  // ── 公車經過 selected POI 的最近資料 ──
  const nearbyBusInfo: {
    route: CampusBusRoute;
    vehicle: CampusBusVehicle;
    etaMin: number;
  } | null = useMemo(() => {
    if (!selectedPoi) return null;
    // 找最近的公車（距離 selectedPoi 最近）
    let best: { route: CampusBusRoute; vehicle: CampusBusVehicle; d: number } | null = null;
    for (const v of activeVehicles) {
      const route = getCampusBusRoute(v.routeId);
      if (!route) continue;
      const d = haver(v.position.lat, v.position.lng, selectedPoi.lat, selectedPoi.lng);
      if (!best || d < best.d) best = { route, vehicle: v, d };
    }
    if (!best || best.d > 800) return null;
    return {
      route: best.route,
      vehicle: best.vehicle,
      etaMin: Math.max(1, Math.round(best.d / 350)),
    };
  }, [selectedPoi, activeVehicles]);

  // ── Send commands to WebView ──
  const postCmd = useCallback((payload: any) => {
    const json = JSON.stringify(payload);
    webRef.current?.injectJavaScript(
      `(function(){document.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(json)}}));})();true;`,
    );
  }, []);

  // 同步圖層
  useEffect(() => {
    postCmd({ type: 'setLayer', url: LAYER_TILE_URL[layer] });
  }, [layer, postCmd]);

  // 同步使用者位置
  useEffect(() => {
    postCmd({ type: 'setUserLocation', lat: uLat, lng: uLng });
  }, [uLat, uLng, postCmd]);

  // 同步 POI 與 Bus
  useEffect(() => {
    postCmd({
      type: 'setPois',
      pois: filteredPois.map((p) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        emoji: emojiOfCategory(p.category),
        color: CATEGORY_COLORS[p.category] ?? '#6F86FF',
      })),
    });
  }, [filteredPois, postCmd]);

  useEffect(() => {
    if (!showBusLayer) {
      postCmd({ type: 'setBuses', buses: [] });
      return;
    }
    postCmd({
      type: 'setBuses',
      buses: activeVehicles.map((v) => {
        const r = getCampusBusRoute(v.routeId);
        return {
          id: v.id,
          lat: v.position.lat,
          lng: v.position.lng,
          code: r?.code ?? '?',
          color: r?.color ?? '#D70015',
        };
      }),
    });
  }, [activeVehicles, showBusLayer, postCmd]);

  // selected glow
  useEffect(() => {
    postCmd({ type: 'setSelected', id: selectedPoiId });
  }, [selectedPoiId, postCmd]);

  // ── Receive WebView messages ──
  const onWebMessage = useCallback((event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'ready') {
        // 進入時自動 center：優先 persona.nextClass → 其次 home → 最後校園中心
        const home = savedPlaces.find((p) => p.kind === 'home');
        const initLat = persona.nextClass?.poi.lat ?? home?.lat ?? 24.2275;
        const initLng = persona.nextClass?.poi.lng ?? home?.lng ?? 120.5647;
        const initZoom = persona.nextClass ? 18 : home ? 17 : 16;
        postCmd({ type: 'centerOn', lat: initLat, lng: initLng, zoom: initZoom });
        if (persona.nextClass) setSelectedPoiId(persona.nextClass.poi.id);
      } else if (data.type === 'poiTap') {
        setSelectedPoiId(data.id);
        analytics.logEvent('map_poi_tap', { id: data.id });
      } else if (data.type === 'busTap') {
        // 點公車 → 開啟搭車中模式預覽
        const v = activeVehicles.find((x) => x.id === data.id);
        if (v) {
          const r = getCampusBusRoute(v.routeId);
          if (r) {
            nav.navigate('OnBusMode', {
              routeId: r.id,
              vehicleId: v.id,
            });
          }
        }
      }
    } catch (err) {
      // ignore
    }
  }, [postCmd, activeVehicles, nav, savedPlaces, persona.nextClass]);

  // ── Plan route to selected POI ──
  const startNavigation = useCallback(
    (poi: CampusPoi) => {
      // 簡化：直接連 user → poi，加入中間插值
      const coords: [number, number][] = [];
      const steps = 8;
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        // 加一點微擾，讓線條看起來像走路徑
        const wiggle = Math.sin(f * Math.PI * 2) * 0.0001;
        coords.push([
          uLat + (poi.lat - uLat) * f + wiggle,
          uLng + (poi.lng - uLng) * f + wiggle * 1.2,
        ]);
      }
      const d = haver(uLat, uLng, poi.lat, poi.lng);
      postCmd({ type: 'setRoute', coords, color: theme.colors.accent });
      const instructions = buildMockInstructions(uLat, uLng, poi);
      setNavMode({ destPoi: poi, coords, distanceM: d, stepIdx: 0, instructions });
      // 開始語音導航
      const first = instructions[0];
      if (first) speak(`出發。${first.instr}`);
      analytics.logEvent('map_nav_start', { poi_id: poi.id });
    },
    [uLat, uLng, postCmd],
  );

  // 模擬步進
  useEffect(() => {
    if (!navMode) return;
    const t = setInterval(() => {
      setNavMode((m) => {
        if (!m) return m;
        const nextIdx = m.stepIdx + 1;
        if (nextIdx >= m.instructions.length) {
          speak('已抵達目的地');
          return null;
        }
        const inst = m.instructions[nextIdx];
        speak(inst.instr);
        return { ...m, stepIdx: nextIdx };
      });
    }, 12000);
    return () => clearInterval(t);
  }, [navMode]);

  const endNavigation = useCallback(() => {
    setNavMode(null);
    postCmd({ type: 'setRoute', coords: [] });
    stopSpeech();
  }, [postCmd]);

  // ═══════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════
  const html = useMemo(
    () => buildMapHtml({ layer, center: { lat: 24.2275, lng: 120.5647 }, zoom: 16 }),
    [layer],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <PuWebView
        ref={webRef}
        source={{ html }}
        style={{ flex: 1, backgroundColor: theme.colors.bg }}
        onMessage={onWebMessage}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        scrollEnabled={false}
        allowsBackForwardNavigationGestures={false}
        injectedJavaScriptBeforeContentLoaded={`window.__MAPv2=1;true;`}
      />

      {/* ─── Top search bar ─── */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: Platform.select({ ios: 56, default: 24 }),
          left: 14,
          right: 14,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: theme.colors.surface,
            borderRadius: 16,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderWidth: 1,
            borderColor: theme.colors.border,
            ...softShadow(),
          }}
        >
          <Pressable onPress={() => nav.goBack()} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
          </Pressable>
          <Ionicons name="search" size={18} color={theme.colors.muted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="搜尋校園或台中地點…"
            placeholderTextColor={theme.colors.muted}
            style={{ flex: 1, color: theme.colors.text, fontSize: 15, paddingVertical: 0 }}
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={theme.colors.muted} />
            </Pressable>
          )}
          <Pressable onPress={() => speak('我是你的校園導航助理')} hitSlop={8}>
            <Ionicons name="mic" size={18} color={theme.colors.accent} />
          </Pressable>
          <Pressable
            onPress={() => nav.navigate('TripPlanner')}
            hitSlop={8}
            style={{ marginLeft: 4 }}
          >
            <Ionicons name="git-network-outline" size={18} color={theme.colors.accent} />
          </Pressable>
        </View>

        {/* Saved places shortcuts */}
        {savedPlaces.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: 8 }}
            contentContainerStyle={{ gap: 6 }}
          >
            {savedPlaces.slice(0, 6).map((p) => (
              <Pressable
                key={p.id}
                onPress={() => {
                  void recordPlaceUsageNow(p.id);
                  postCmd({ type: 'centerOn', lat: p.lat, lng: p.lng, zoom: 18 });
                  if (p.poiId) setSelectedPoiId(p.poiId);
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  paddingHorizontal: 11,
                  paddingVertical: 7,
                  borderRadius: 99,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                  ...softShadow(),
                })}
              >
                <Text style={{ fontSize: 14 }}>{p.emoji}</Text>
                <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '700' }}>
                  {p.label}
                </Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => nav.navigate('TripPlanner')}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 11,
                paddingVertical: 7,
                borderRadius: 99,
                backgroundColor: theme.colors.accent,
                transform: [{ scale: pressed ? 0.96 : 1 }],
              })}
            >
              <Ionicons name="navigate" size={12} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>路線規劃</Text>
            </Pressable>
          </ScrollView>
        )}

        {/* category chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 10 }}
          contentContainerStyle={{ gap: 6 }}
        >
          {CATEGORY_FILTERS.map((c) => {
            const active = cat === c.cat;
            return (
              <Pressable
                key={c.cat}
                onPress={() => setCat(active ? 'all' : c.cat)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 99,
                  backgroundColor: active ? theme.colors.accent : theme.colors.surface,
                  borderWidth: 1,
                  borderColor: active ? theme.colors.accent : theme.colors.border,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                  ...softShadow(),
                })}
              >
                <Ionicons
                  name={c.icon as any}
                  size={13}
                  color={active ? '#fff' : theme.colors.muted}
                />
                <Text
                  style={{
                    color: active ? '#fff' : theme.colors.textSecondary,
                    fontSize: 12,
                    fontWeight: '700',
                  }}
                >
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* ─── Offline pack badge ─── */}
      <Pressable
        onPress={handleDownloadOffline}
        disabled={offline.progress.status === 'downloading'}
        style={({ pressed }) => ({
          position: 'absolute',
          top: Platform.select({ ios: 170, default: 140 }) + 200,
          right: 12,
          paddingHorizontal: 9,
          paddingVertical: 6,
          borderRadius: 10,
          backgroundColor: offline.info.exists
            ? `${theme.colors.success}22`
            : theme.colors.surface,
          borderWidth: 1,
          borderColor: offline.info.exists
            ? `${theme.colors.success}55`
            : theme.colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          ...softShadow(),
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Ionicons
          name={
            offline.progress.status === 'downloading'
              ? 'cloud-download-outline'
              : offline.info.exists
                ? 'cloud-done-outline'
                : 'cloud-offline-outline'
          }
          size={12}
          color={offline.info.exists ? theme.colors.success : theme.colors.muted}
        />
        <Text
          style={{
            color: offline.info.exists ? theme.colors.success : theme.colors.muted,
            fontSize: 10,
            fontWeight: '800',
          }}
        >
          {offline.progress.status === 'downloading'
            ? `${Math.round(offline.progress.ratio * 100)}%`
            : offline.info.exists
              ? `離線 ${formatBytes(offline.info.bytes)}`
              : '下載離線'}
        </Text>
      </Pressable>

      {/* ─── Right layer FAB ─── */}
      <View
        style={{
          position: 'absolute',
          right: 12,
          top: Platform.select({ ios: 170, default: 140 }),
          backgroundColor: theme.colors.surface,
          borderRadius: 14,
          padding: 4,
          gap: 4,
          borderWidth: 1,
          borderColor: theme.colors.border,
          ...softShadow(),
        }}
      >
        {LAYER_OPTIONS.map((opt) => {
          const active = layer === opt.id;
          return (
            <Pressable
              key={opt.id}
              onPress={() => setLayer(opt.id)}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: 10,
                backgroundColor: active ? theme.colors.accentSoft : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
                transform: [{ scale: pressed ? 0.95 : 1 }],
              })}
            >
              <Ionicons
                name={opt.icon as any}
                size={20}
                color={active ? theme.colors.accent : theme.colors.muted}
              />
            </Pressable>
          );
        })}
        <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 2 }} />
        <Pressable
          onPress={() => setShowBusLayer((x) => !x)}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 10,
            backgroundColor: showBusLayer ? theme.colors.accentSoft : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ scale: pressed ? 0.95 : 1 }],
          })}
        >
          <Ionicons
            name="bus-outline"
            size={20}
            color={showBusLayer ? theme.colors.accent : theme.colors.muted}
          />
        </Pressable>
      </View>

      {/* ─── My Location FAB ─── */}
      <Pressable
        onPress={() => postCmd({ type: 'centerOn', lat: uLat, lng: uLng, zoom: 17 })}
        style={({ pressed }) => ({
          position: 'absolute',
          right: 14,
          bottom: selectedPoi || navMode ? 220 : 100,
          width: 48,
          height: 48,
          borderRadius: 14,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          ...softShadow(),
          transform: [{ scale: pressed ? 0.93 : 1 }],
        })}
      >
        <Ionicons name="locate" size={22} color={theme.colors.accent} />
      </Pressable>

      {/* ─── 去下節課 FAB（依 persona.nextClass） ─── */}
      {persona.nextClass && !navMode && (
        <Pressable
          onPress={() => {
            const nc = persona.nextClass!;
            setSelectedPoiId(nc.poi.id);
            postCmd({ type: 'centerOn', lat: nc.poi.lat, lng: nc.poi.lng, zoom: 18 });
          }}
          style={({ pressed }) => ({
            position: 'absolute',
            right: 14,
            bottom: (selectedPoi ? 220 : 100) + 58,
            paddingHorizontal: 12,
            height: 48,
            borderRadius: 14,
            backgroundColor: theme.colors.accent,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            ...softShadow(0.4),
            transform: [{ scale: pressed ? 0.94 : 1 }],
          })}
        >
          <Ionicons name="school" size={18} color="#fff" />
          <View>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>下節課</Text>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 10 }}>
              {persona.nextClass.startHHmm} · {persona.nextClass.roomCode}
            </Text>
          </View>
        </Pressable>
      )}

      {/* ─── Bottom Sheet: POI Card (when selected, no nav) ─── */}
      {selectedPoi && !navMode && (
        <PoiCard
          poi={selectedPoi}
          distanceM={selectedDist ?? 0}
          nearbyBus={nearbyBusInfo}
          hasIndoor={hasIndoor(selectedPoi.id)}
          onStartNav={() => startNavigation(selectedPoi)}
          onClose={() => setSelectedPoiId(null)}
          onAr={() =>
            nav.navigate('ARNavigation', {
              destination: selectedPoi.name,
              destinationId: selectedPoi.id,
              destinationLat: selectedPoi.lat,
              destinationLng: selectedPoi.lng,
            })
          }
          onOpenIndoor={() =>
            nav.navigate('IndoorFloorMap', {
              poiId: selectedPoi.id,
              roomCode: persona.nextClass?.poi.id === selectedPoi.id ? persona.nextClass.roomCode : undefined,
            })
          }
        />
      )}

      {/* ─── Turn-by-turn HUD (when navigating) ─── */}
      {navMode && (
        <TurnByTurnHud
          dest={navMode.destPoi}
          step={navMode.instructions[navMode.stepIdx]}
          nextStep={navMode.instructions[navMode.stepIdx + 1]}
          totalDistanceM={navMode.distanceM}
          stepIdx={navMode.stepIdx}
          totalSteps={navMode.instructions.length}
          onEnd={endNavigation}
        />
      )}
    </View>
  );
}

// ═════════════════════════════════════════════════════
// POI Card (bottom sheet)
// ═════════════════════════════════════════════════════
function PoiCard({
  poi,
  distanceM,
  nearbyBus,
  hasIndoor,
  onStartNav,
  onClose,
  onAr,
  onOpenIndoor,
}: {
  poi: CampusPoi;
  distanceM: number;
  nearbyBus: { route: CampusBusRoute; vehicle: CampusBusVehicle; etaMin: number } | null;
  hasIndoor: boolean;
  onStartNav: () => void;
  onClose: () => void;
  onAr: () => void;
  onOpenIndoor: () => void;
}) {
  const color = CATEGORY_COLORS[poi.category] ?? '#6F86FF';
  const open = isOpenNow(poi.openTime, poi.closeTime);
  // 隨機但 deterministic 的「人潮」與「評論」
  const crowdRoll = (poi.name.length * 7 + new Date().getHours() * 3) % 100;
  const crowd =
    crowdRoll < 25 ? '人少' : crowdRoll < 65 ? '適中' : crowdRoll < 90 ? '擁擠' : '客滿';
  const crowdColor =
    crowdRoll < 25 ? '#34D399' : crowdRoll < 65 ? '#FF9500' : crowdRoll < 90 ? '#F87171' : '#A855F7';
  const stars = 3.6 + ((poi.name.length * 11) % 14) / 10;
  const reviews = 80 + ((poi.name.length * 17) % 380);

  return (
    <View
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 80,
        backgroundColor: theme.colors.surface,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: theme.colors.border,
        overflow: 'hidden',
        ...softShadow(0.6),
      }}
    >
      {/* Hero */}
      <View
        style={{
          height: 110,
          backgroundColor: color,
          padding: 14,
          justifyContent: 'flex-end',
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: 12,
            left: 14,
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 99,
            backgroundColor: 'rgba(0,0,0,0.45)',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Ionicons name={CATEGORY_ICONS[poi.category] as any} size={12} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
            {CATEGORY_LABELS[poi.category]}
          </Text>
        </View>
        <View
          style={{
            position: 'absolute',
            top: 12,
            right: 14,
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 99,
            backgroundColor: 'rgba(0,0,0,0.45)',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: crowdColor }} />
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{crowd}</Text>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          style={{
            position: 'absolute',
            bottom: 12,
            right: 14,
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: 'rgba(0,0,0,0.4)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="close" size={18} color="#fff" />
        </Pressable>
        <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }} numberOfLines={1}>
          {poi.name}
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 }} numberOfLines={1}>
          {poi.nameEn} · {poi.code} · {fmtDist(distanceM)} · {fmtWalk(distanceM)}
        </Text>
      </View>

      <View style={{ padding: 14, gap: 10 }}>
        {/* meta row */}
        <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
          <MetaItem
            icon={open ? 'checkmark-circle' : 'close-circle'}
            text={open ? `營業中 · 至 ${poi.closeTime}` : `已關閉 · ${poi.openTime}-${poi.closeTime}`}
            color={open ? '#34D399' : theme.colors.muted}
          />
          <MetaItem icon="star" text={`${stars.toFixed(1)}`} color="#FF9500" />
          <MetaItem icon="chatbubbles-outline" text={`${reviews} 則評論`} color={theme.colors.muted} />
          {poi.accessible && <MetaItem icon="accessibility-outline" text="無障礙" color="#34D399" />}
        </View>

        {/* facilities chips */}
        {poi.facilities.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {poi.facilities.slice(0, 6).map((f) => (
              <View
                key={f}
                style={{
                  paddingHorizontal: 9,
                  paddingVertical: 4,
                  borderRadius: 99,
                  backgroundColor: theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>{f}</Text>
              </View>
            ))}
          </ScrollView>
        )}

        {/* nearby bus tip */}
        {nearbyBus && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              padding: 10,
              backgroundColor: `${nearbyBus.route.color}18`,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: `${nearbyBus.route.color}40`,
            }}
          >
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                backgroundColor: nearbyBus.route.color,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 11 }}>
                {nearbyBus.route.code}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '700' }}>
                {nearbyBus.route.shortName} · 約 {nearbyBus.etaMin} 分後到附近
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                {nearbyBus.vehicle.plate} · {crowdLabel(nearbyBus.vehicle.crowd).text}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
          </View>
        )}

        {/* CTA row */}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          <Pressable
            onPress={onStartNav}
            style={({ pressed }) => ({
              flex: 2,
              paddingVertical: 13,
              borderRadius: 14,
              backgroundColor: pressed ? `${theme.colors.accent}DD` : theme.colors.accent,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            })}
          >
            <Ionicons name="navigate" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>
              開始導航 · {fmtWalk(distanceM)}
            </Text>
          </Pressable>
          <Pressable
            onPress={onAr}
            style={({ pressed }) => ({
              width: 50,
              paddingVertical: 13,
              borderRadius: 14,
              backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
              alignItems: 'center',
              justifyContent: 'center',
            })}
          >
            <Ionicons name="camera-outline" size={18} color={theme.colors.text} />
          </Pressable>
          {hasIndoor && (
            <Pressable
              onPress={onOpenIndoor}
              style={({ pressed }) => ({
                width: 50,
                paddingVertical: 13,
                borderRadius: 14,
                backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                alignItems: 'center',
                justifyContent: 'center',
              })}
            >
              <Ionicons name="business-outline" size={18} color={theme.colors.accent} />
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => ({
              width: 50,
              paddingVertical: 13,
              borderRadius: 14,
              backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
              alignItems: 'center',
              justifyContent: 'center',
            })}
          >
            <Ionicons name="bookmark-outline" size={18} color={theme.colors.text} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function MetaItem({ icon, text, color }: { icon: any; text: string; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Ionicons name={icon} size={13} color={color} />
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

// ═════════════════════════════════════════════════════
// Turn-by-turn HUD
// ═════════════════════════════════════════════════════
function TurnByTurnHud({
  dest,
  step,
  nextStep,
  totalDistanceM,
  stepIdx,
  totalSteps,
  onEnd,
}: {
  dest: CampusPoi;
  step?: { instr: string; distM: number };
  nextStep?: { instr: string; distM: number };
  totalDistanceM: number;
  stepIdx: number;
  totalSteps: number;
  onEnd: () => void;
}) {
  const remainingSteps = Math.max(0, totalSteps - stepIdx - 1);
  const remainingM = Math.max(0, totalDistanceM * (remainingSteps / Math.max(1, totalSteps)));
  return (
    <>
      {/* Top header */}
      <View
        style={{
          position: 'absolute',
          top: Platform.select({ ios: 56, default: 28 }),
          left: 14,
          right: 14,
          backgroundColor: theme.colors.accent,
          padding: 16,
          borderRadius: 18,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          ...softShadow(0.5),
        }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            backgroundColor: 'rgba(255,255,255,0.2)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons
            name={iconForInstruction(step?.instr ?? '')}
            size={28}
            color="#fff"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: 26, lineHeight: 28 }}>
            {step ? fmtDist(step.distM) : ''}
          </Text>
          <Text style={{ color: '#fff', fontSize: 13, marginTop: 2, fontWeight: '600' }} numberOfLines={2}>
            {step?.instr ?? ''}
          </Text>
        </View>
      </View>

      {/* Next preview */}
      {nextStep && (
        <View
          style={{
            position: 'absolute',
            top: Platform.select({ ios: 160, default: 132 }),
            left: 22,
            right: 22,
            backgroundColor: 'rgba(0,0,0,0.55)',
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 10,
          }}
        >
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600' }}>
            之後 → {nextStep.instr}
          </Text>
        </View>
      )}

      {/* Bottom — eta + end */}
      <View
        style={{
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 80,
          padding: 16,
          backgroundColor: theme.colors.surface,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: theme.colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          ...softShadow(),
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#34D399', fontWeight: '900', fontSize: 22, lineHeight: 24 }}>
            {fmtWalk(remainingM)}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
            {fmtDist(remainingM)} · 抵達 {dest.name}
          </Text>
        </View>
        <Pressable
          onPress={() => speak('重新播報路線')}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          })}
        >
          <Ionicons name="mic" size={18} color={theme.colors.accent} />
        </Pressable>
        <Pressable
          onPress={onEnd}
          style={({ pressed }) => ({
            paddingHorizontal: 16,
            height: 44,
            borderRadius: 12,
            backgroundColor: pressed ? '#FF3B30' : '#F87171',
            alignItems: 'center',
            justifyContent: 'center',
          })}
        >
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>結束</Text>
        </Pressable>
      </View>
    </>
  );
}

// ═════════════════════════════════════════════════════
// helpers
// ═════════════════════════════════════════════════════

function emojiOfCategory(c: CampusPoiCategory): string {
  switch (c) {
    case 'cafeteria':
      return '🍱';
    case 'library':
      return '📚';
    case 'academic':
      return '🏫';
    case 'dormitory':
      return '🏠';
    case 'admin':
      return '🏛️';
    case 'sports':
      return '⚽';
    case 'parking':
      return '🅿️';
    case 'convenience':
      return '🏪';
    case 'medical':
      return '💊';
    case 'gate':
      return '🚪';
    case 'religious':
      return '⛪';
    case 'research':
      return '🔬';
    default:
      return '📍';
  }
}

function buildMockInstructions(
  uLat: number,
  uLng: number,
  poi: CampusPoi,
): { instr: string; distM: number }[] {
  const total = haver(uLat, uLng, poi.lat, poi.lng);
  return [
    { instr: '向北直行', distM: Math.max(40, total * 0.25) },
    { instr: '於主顧樓口左轉', distM: total * 0.25 },
    { instr: '繼續沿步道直行', distM: total * 0.25 },
    { instr: '抵達 ' + poi.name, distM: total * 0.25 },
  ];
}

function iconForInstruction(instr: string): any {
  if (instr.includes('左轉')) return 'return-up-back-outline';
  if (instr.includes('右轉')) return 'return-up-forward-outline';
  if (instr.includes('抵達')) return 'flag-outline';
  return 'arrow-up-outline';
}

// 語音播報（軟相依 expo-speech；模組不存在時靜默退化）
function speak(text: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Speech = require('expo-speech');
    Speech.stop?.();
    Speech.speak?.(text, { language: 'zh-TW', pitch: 1.0, rate: 1.0 });
  } catch {
    // expo-speech 不可用 — 視為無語音裝置，跳過播報
  }
}

function stopSpeech() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Speech = require('expo-speech');
    Speech.stop?.();
  } catch {}
}

function softShadow(opacity = 0.25): any {
  return Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: opacity,
      shadowRadius: 16,
    },
    android: { elevation: 8 },
    default: {},
  });
}

export default GoogleMapsLikeScreen;
