/* eslint-disable */
/**
 * 校園公車 V2 — 極致版
 *
 * 整合：
 *   1. 頂部互動 Leaflet 地圖：即時公車軌跡 + 路線 + 站點
 *   2. AI 搭車建議卡片：依使用者位置、目的地、天氣推薦下一班
 *   3. 即將到站列表：點擊一鍵設提醒，並可進入「搭車中」模式
 *   4. 路線/時刻表/常用三個分頁
 *
 * 既有 BusScheduleScreen 保留，這支是新版主要入口（在 MapStack 註冊為 'Bus'）。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import type { WebView } from 'react-native-webview';
import * as Notifications from 'expo-notifications';
import { PuWebView } from '../ui/PuWebView';
import { Screen, SegmentedControl } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { analytics } from '../services/analytics';
import { scheduleLocalNotification, cancelNotification } from '../services/notifications';
import { useGeolocation } from '../hooks/useGeolocation';
import { useAsyncStorage } from '../hooks/useStorage';
import {
  CAMPUS_BUS_ROUTES,
  ROUTE_CATEGORY_LABELS,
  crowdLabel,
  getCampusBusRoute,
  recommendBus,
  simulateActiveVehicles,
  haversineMeters,
  type CampusBusRoute,
  type CampusBusVehicle,
  type AiBusRecommendation,
} from '../data/campusBusRoutes';
import { usePersonaContext } from '../services/personaContext';
import { useLiveBusEstimates, LiveStatusBadge } from '../services/tdxLive';

// ═════════════════════════════════════════════════════
// Leaflet HTML — 公車即時地圖
// ═════════════════════════════════════════════════════

function buildBusMapHtml(): string {
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
*{margin:0;padding:0}html,body,#map{width:100%;height:100%;background:#0B1014}
.leaflet-tile-pane{filter:invert(0.92) hue-rotate(180deg) brightness(0.95) contrast(0.95)}
.bus-pin{width:42px;height:42px;border-radius:50%;background:#fff;display:grid;place-items:center;font-weight:900;font-size:13px;box-shadow:0 4px 10px rgba(0,0,0,.45);position:relative;border:3px solid var(--c)}
.bus-pin::after{content:"";position:absolute;bottom:-8px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid #fff}
.stop-dot{width:14px;height:14px;border-radius:50%;background:#fff;border:3px solid var(--c);box-shadow:0 2px 4px rgba(0,0,0,.4)}
.user-dot{width:20px;height:20px;border-radius:50%;background:#007AFF;border:4px solid #fff;box-shadow:0 0 0 6px rgba(59,130,246,.25),0 4px 8px rgba(0,0,0,.4)}
</style></head><body>
<div id="map"></div>
<script>
var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([24.2275,120.5647],15);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{maxZoom:19}).addTo(map);
var routeLines=L.layerGroup().addTo(map);
var stopMarkers=L.layerGroup().addTo(map);
var busMarkers=L.layerGroup().addTo(map);
var userMarker=null;
function postRN(p){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(p))}catch(e){}}
function onMsg(e){
  try{
    var d=JSON.parse(e.data);
    if(d.type==='setRoutes'){
      routeLines.clearLayers();
      stopMarkers.clearLayers();
      d.routes.forEach(function(r){
        if(r.polyline&&r.polyline.length>1){
          L.polyline(r.polyline,{color:'#fff',weight:7,opacity:0.6,lineCap:'round'}).addTo(routeLines);
          L.polyline(r.polyline,{color:r.color,weight:4,opacity:0.9,lineCap:'round'}).addTo(routeLines);
        }
        if(d.showStops!==false&&r.stops){
          r.stops.forEach(function(s){
            var html='<div class="stop-dot" style="--c:'+r.color+'"></div>';
            var m=L.marker([s.lat,s.lng],{icon:L.divIcon({className:'',html:html,iconSize:[14,14],iconAnchor:[7,7]})});
            m.bindTooltip(s.name,{permanent:false,direction:'top',className:'stop-tip'});
            m.addTo(stopMarkers);
          });
        }
      });
    }
    if(d.type==='setBuses'){
      busMarkers.clearLayers();
      d.buses.forEach(function(b){
        var html='<div class="bus-pin" style="--c:'+b.color+';color:'+b.color+'">'+b.code+'</div>';
        var m=L.marker([b.lat,b.lng],{icon:L.divIcon({className:'',html:html,iconSize:[42,50],iconAnchor:[21,48]})});
        m.bindTooltip(b.plate+' · 下一站 '+b.next,{direction:'top'});
        m.on('click',function(){postRN({type:'busTap',id:b.id})});
        m.addTo(busMarkers);
      });
    }
    if(d.type==='setUser'){
      if(userMarker) map.removeLayer(userMarker);
      userMarker=L.marker([d.lat,d.lng],{icon:L.divIcon({className:'',html:'<div class="user-dot"></div>',iconSize:[28,28],iconAnchor:[14,14]})}).addTo(map);
    }
    if(d.type==='center'){map.setView([d.lat,d.lng],d.zoom||15,{animate:true})}
    if(d.type==='fit'&&d.bounds){map.fitBounds(d.bounds,{padding:[40,40]})}
  }catch(e){}
}
document.addEventListener('message',onMsg);
window.addEventListener('message',onMsg);
postRN({type:'ready'});
<\/script>
</body></html>`;
}

// ═════════════════════════════════════════════════════
// 主畫面
// ═════════════════════════════════════════════════════

type ViewMode = 'map' | 'routes' | 'schedule' | 'favorites';

type BusReminder = {
  id: string;
  routeId: string;
  routeName: string;
  vehicleId: string;
  plate: string;
  stopName: string;
  etaMin: number;
  notificationId: string;
  scheduledFor: string;
};

export function BusV2Screen(_props: Record<string, unknown>) {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const params = (route.params ?? {}) as { initialRouteId?: string };
  const webRef = useRef<WebView>(null);

  // ── Persona（要在 selectedRouteId 之前 init，因為要用它初始化預設選中路線） ──
  const persona = usePersonaContext();
  const personaDefaultRouteId =
    params.initialRouteId ??
    persona.subscribedRoutes[0]?.id ??
    CAMPUS_BUS_ROUTES[0].id;

  const [view, setView] = useState<ViewMode>('map');
  const [selectedRouteId, setSelectedRouteId] = useState<string>(personaDefaultRouteId);
  const [refreshing, setRefreshing] = useState(false);

  // 當 persona 切換登入帳號 → 跟著切預設選中路線
  useEffect(() => {
    setSelectedRouteId(personaDefaultRouteId);
  }, [personaDefaultRouteId]);

  // GPS
  const geo = useGeolocation({ enableHighAccuracy: true, distanceInterval: 8, autoStart: true });
  const uLat = typeof geo.latitude === 'number' ? geo.latitude : 24.22612;
  const uLng = typeof geo.longitude === 'number' ? geo.longitude : 120.5645;

  // 模擬車輛即時資料
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const allVehicles = useMemo(() => simulateActiveVehicles(new Date()), [tick]);

  // Favorites
  const [favorites, setFavorites] = useAsyncStorage<string[]>('bus_v2_favorite_routes', {
    defaultValue: ['campus-a', 'city-300'],
  });

  // Reminders
  const [reminders, setReminders] = useAsyncStorage<BusReminder[]>('bus_v2_reminders', {
    defaultValue: [],
  });

  // 目的地：用「下一節課」推算；若沒有則退回任垣樓
  const destPoiId = persona.nextClass?.poi.id ?? 'pu-renyuan';
  const destPoi = persona.nextClass?.poi ?? null;

  // ── AI 推薦 ──
  const aiRecs: AiBusRecommendation[] = useMemo(() => {
    return recommendBus({
      userLat: uLat,
      userLng: uLng,
      destinationPoiId: destPoiId,
      destinationLat: destPoi?.lat,
      destinationLng: destPoi?.lng,
      isRaining: false,
    });
  }, [uLat, uLng, destPoiId, destPoi?.lat, destPoi?.lng]);

  const topAiRec: AiBusRecommendation | null = aiRecs[0] ?? null;

  // 個人化的 AI 推薦理由
  const aiReason = useMemo(() => {
    if (!topAiRec) return '';
    if (!persona.nextClass) return topAiRec.reason;
    return `${persona.displayName}，你 ${persona.nextClass.startHHmm} 的「${persona.nextClass.courseName}」在 ${destPoi?.name}（${persona.nextClass.roomCode}）· ${topAiRec.reason}`;
  }, [topAiRec, persona.displayName, persona.nextClass, destPoi?.name]);

  // ── 對 WebView 下指令 ──
  const postCmd = useCallback((p: any) => {
    const j = JSON.stringify(p);
    webRef.current?.injectJavaScript(
      `(function(){document.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(j)}}))})();true;`,
    );
  }, []);

  // 將路線繪到地圖（只繪選中或全部）
  useEffect(() => {
    const routes = selectedRouteId
      ? CAMPUS_BUS_ROUTES.filter((r) => r.id === selectedRouteId)
      : CAMPUS_BUS_ROUTES;
    postCmd({
      type: 'setRoutes',
      showStops: true,
      routes: routes.map((r) => ({
        id: r.id,
        color: r.color,
        polyline: r.polyline.map((p) => [p.lat, p.lng]),
        stops: r.stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng })),
      })),
    });
  }, [selectedRouteId, postCmd]);

  // 把車輛位置 push 進地圖
  useEffect(() => {
    const visible = selectedRouteId
      ? allVehicles.filter((v) => v.routeId === selectedRouteId)
      : allVehicles;
    postCmd({
      type: 'setBuses',
      buses: visible.map((v) => {
        const r = getCampusBusRoute(v.routeId);
        const nextStop = r?.stops.find((s) => s.id === v.nextStopId);
        return {
          id: v.id,
          lat: v.position.lat,
          lng: v.position.lng,
          code: r?.code ?? '?',
          color: r?.color ?? '#D70015',
          plate: v.plate,
          next: nextStop?.name ?? '-',
        };
      }),
    });
  }, [allVehicles, selectedRouteId, postCmd]);

  useEffect(() => {
    postCmd({ type: 'setUser', lat: uLat, lng: uLng });
  }, [uLat, uLng, postCmd]);

  /**
   * 算「下車站」：給定一條路線，找離 destPoi（下節課地點）最近的站
   * 沒有 destPoi 就用該路線終點站
   */
  const pickAlightStopForRoute = useCallback(
    (route: CampusBusRoute): string => {
      if (!destPoi) return route.stops[route.stops.length - 1].id;
      let best: { id: string; d: number } | null = null;
      for (const s of route.stops) {
        const d = haversineMeters(destPoi.lat, destPoi.lng, s.lat, s.lng);
        if (!best || d < best.d) best = { id: s.id, d };
      }
      return best?.id ?? route.stops[route.stops.length - 1].id;
    },
    [destPoi],
  );

  // 將路線排序：persona 訂閱的優先在前
  const orderedRoutes = useMemo(() => {
    const subIds = new Set(persona.subscribedRoutes.map((r) => r.id));
    return [
      ...CAMPUS_BUS_ROUTES.filter((r) => subIds.has(r.id)),
      ...CAMPUS_BUS_ROUTES.filter((r) => !subIds.has(r.id)),
    ];
  }, [persona.subscribedRoutes]);

  // ── TDX 即時資料（針對 persona 訂閱路線） ──
  const liveBusRouteIds = useMemo(
    () => persona.subscribedRoutes.map((r) => r.id),
    [persona.subscribedRoutes],
  );
  const liveBusData = useLiveBusEstimates(liveBusRouteIds);

  // ── WebView 訊息 ──
  const onWebMessage = useCallback((event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'ready') {
        postCmd({ type: 'center', lat: 24.2275, lng: 120.5647, zoom: 16 });
      } else if (data.type === 'busTap') {
        const v = allVehicles.find((x) => x.id === data.id);
        if (!v) return;
        const r = getCampusBusRoute(v.routeId);
        if (!r) return;
        Alert.alert(
          `${r.shortName} · ${v.plate}`,
          `下一站：${r.stops.find((s) => s.id === v.nextStopId)?.name ?? '-'}\n約 ${v.etaToNextStopMin} 分鐘\n${crowdLabel(v.crowd).text}`,
          [
            { text: '取消', style: 'cancel' },
            {
              text: '我在這台車',
              onPress: () =>
                nav.navigate('OnBusMode', {
                  routeId: r.id,
                  vehicleId: v.id,
                  alightStopId: pickAlightStopForRoute(r),
                }),
            },
          ],
        );
      }
    } catch {}
  }, [postCmd, allVehicles, nav, pickAlightStopForRoute]);

  // ── Focus analytics ──
  useFocusEffect(
    useCallback(() => {
      analytics.logScreenView('BusV2');
    }, []),
  );

  // ── 設提醒 ──
  const setReminder = useCallback(
    async (vehicle: CampusBusVehicle, route: CampusBusRoute) => {
      const nextStop = route.stops.find((s) => s.id === vehicle.nextStopId);
      if (!nextStop) return;
      const triggerSeconds = Math.max(vehicle.etaToNextStopMin * 60 - 60, 5);
      try {
        const notificationId = await scheduleLocalNotification(
          `${route.shortName} 即將到站`,
          `${vehicle.plate} 即將抵達 ${nextStop.name}，準備上車！`,
          { type: 'bus', routeId: route.id, stopId: nextStop.id },
          {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: triggerSeconds,
            repeats: false,
          },
        );
        const reminder: BusReminder = {
          id: `${route.id}-${vehicle.id}-${Date.now()}`,
          routeId: route.id,
          routeName: route.shortName,
          vehicleId: vehicle.id,
          plate: vehicle.plate,
          stopName: nextStop.name,
          etaMin: vehicle.etaToNextStopMin,
          notificationId,
          scheduledFor: new Date(Date.now() + triggerSeconds * 1000).toISOString(),
        };
        await setReminders([...(reminders ?? []), reminder]);
        Alert.alert('已設定提醒', `${route.shortName} 即將到 ${nextStop.name} 前 1 分鐘通知你`);
        analytics.logEvent('busv2_reminder_set', { route_id: route.id });
      } catch (err) {
        Alert.alert('提醒失敗', '請檢查通知權限');
      }
    },
    [reminders, setReminders],
  );

  const removeReminder = useCallback(
    async (rem: BusReminder) => {
      try {
        await cancelNotification(rem.notificationId);
      } catch {}
      await setReminders((reminders ?? []).filter((r) => r.id !== rem.id));
    },
    [reminders, setReminders],
  );

  // ── 取「即將到站」資料（依距離 user 最近、ETA 最小） ──
  const upcomingArrivals = useMemo(() => {
    return allVehicles
      .map((v) => {
        const r = getCampusBusRoute(v.routeId);
        const distToUser = haversineMeters(uLat, uLng, v.position.lat, v.position.lng);
        return { v, r, distToUser };
      })
      .filter((x) => x.r != null && x.distToUser < 2000)
      .sort((a, b) => a.v.etaToNextStopMin - b.v.etaToNextStopMin)
      .slice(0, 6);
  }, [allVehicles, uLat, uLng]);

  // ── Render ──
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {/* Persona greeting bar */}
      {persona.isDemoPersona && (
        <PersonaGreeting
          name={persona.displayName}
          role={persona.role}
          nextClass={persona.nextClass}
          onPressNextClass={() => {
            if (persona.nextClass) {
              nav.navigate('TripPlanner', {
                toPoiId: persona.nextClass.poi.id,
                toName: persona.nextClass.poi.name,
              });
            }
          }}
        />
      )}

      {/* Tab segment */}
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 }}>
        <SegmentedControl
          options={[
            { key: 'map', label: '即時地圖' },
            { key: 'routes', label: '路線' },
            { key: 'schedule', label: '時刻' },
            { key: 'favorites', label: '常用' },
          ]}
          selected={view}
          onChange={(v) => setView(v as ViewMode)}
        />
      </View>

      {view === 'map' && (
        <View style={{ flex: 1 }}>
          {/* Embedded Leaflet map */}
          <View
            style={{
              height: 320,
              marginHorizontal: 12,
              borderRadius: 18,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <PuWebView
              ref={webRef}
              source={{ html: buildBusMapHtml() }}
              style={{ flex: 1, backgroundColor: theme.colors.bg }}
              onMessage={onWebMessage}
              javaScriptEnabled
              domStorageEnabled
              scrollEnabled={false}
              allowsBackForwardNavigationGestures={false}
            />

            {/* Route filter pills (overlaid on map) — persona 訂閱優先 */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ position: 'absolute', left: 0, right: 0, bottom: 8 }}
              contentContainerStyle={{ gap: 6, paddingHorizontal: 10 }}
            >
              {orderedRoutes.map((r) => {
                const active = r.id === selectedRouteId;
                const isSubscribed = persona.subscribedRoutes.some((sr) => sr.id === r.id);
                return (
                  <Pressable
                    key={r.id}
                    onPress={() => setSelectedRouteId(r.id)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 99,
                      backgroundColor: active ? r.color : 'rgba(11,16,20,0.78)',
                      borderWidth: 1,
                      borderColor: active ? r.color : 'rgba(255,255,255,0.18)',
                      transform: [{ scale: pressed ? 0.97 : 1 }],
                    })}
                  >
                    {isSubscribed && (
                      <Ionicons name="star" size={9} color={active ? '#fff' : '#FBBF24'} />
                    )}
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: active ? '#fff' : r.color,
                      }}
                    />
                    <Text
                      style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}
                    >
                      {r.code}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Live status badge */}
            <View style={{ position: 'absolute', top: 10, left: 10 }}>
              <LiveStatusBadge
                status={liveBusData.status}
                onPress={liveBusData.refresh}
              />
            </View>

            {/* My location FAB */}
            <Pressable
              onPress={() => postCmd({ type: 'center', lat: uLat, lng: uLng, zoom: 16 })}
              style={({ pressed }) => ({
                position: 'absolute',
                top: 10,
                right: 10,
                width: 36,
                height: 36,
                borderRadius: 10,
                backgroundColor: 'rgba(11,16,20,0.8)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.18)',
                alignItems: 'center',
                justifyContent: 'center',
                transform: [{ scale: pressed ? 0.92 : 1 }],
              })}
            >
              <Ionicons name="locate" size={18} color="#fff" />
            </Pressable>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  setTick((x) => x + 1);
                  setTimeout(() => setRefreshing(false), 600);
                }}
                tintColor={theme.colors.accent}
              />
            }
          >
            {/* AI Recommend Card */}
            {topAiRec && (
              <AiRecommendCard
                rec={topAiRec}
                customReason={aiReason}
                titleOverride={
                  persona.nextClass
                    ? `${persona.nextClass.startHHmm} 上課前，建議搭 ${topAiRec.route.shortName} ${topAiRec.nextDepartureHHmm} 班`
                    : undefined
                }
                onSetReminder={() => {
                  const v = allVehicles.find((x) => x.routeId === topAiRec.route.id);
                  if (v) setReminder(v, topAiRec.route);
                }}
                onSeeOthers={() => {
                  setSelectedRouteId('');
                  setView('routes');
                }}
              />
            )}

            {/* Live stats row */}
            <View
              style={{
                flexDirection: 'row',
                gap: 8,
                marginHorizontal: 12,
                marginTop: 12,
              }}
            >
              <StatPill
                label="在線車輛"
                value={`${allVehicles.length} 台`}
                color="#34D399"
              />
              <StatPill
                label="最近班次"
                value={`${Math.max(1, upcomingArrivals[0]?.v.etaToNextStopMin ?? 5)} 分`}
                color="#FF9500"
              />
              <StatPill
                label="路線"
                value={`${CAMPUS_BUS_ROUTES.length} 條`}
                color={theme.colors.accent}
              />
            </View>

            {/* Upcoming arrivals */}
            <Text style={SECTION_H_STYLE}>即將到站 · 點公車進入「搭車中」</Text>
            <View style={{ gap: 8, paddingHorizontal: 12 }}>
              {upcomingArrivals.map(({ v, r, distToUser }) => {
                if (!r) return null;
                const nextStop = r.stops.find((s) => s.id === v.nextStopId);
                const crowd = crowdLabel(v.crowd);
                return (
                  <Pressable
                    key={v.id}
                    onPress={() =>
                      nav.navigate('OnBusMode', {
                        routeId: r.id,
                        vehicleId: v.id,
                        alightStopId: pickAlightStopForRoute(r),
                      })
                    }
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      padding: 12,
                      borderRadius: 14,
                      backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                    })}
                  >
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        backgroundColor: r.color,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>
                        {r.code}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
                        {r.shortName} · {v.plate}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                          下一站 {nextStop?.name}
                        </Text>
                        <View
                          style={{
                            paddingHorizontal: 6,
                            borderRadius: 6,
                            backgroundColor: `${crowd.color}25`,
                          }}
                        >
                          <Text style={{ color: crowd.color, fontSize: 10, fontWeight: '700' }}>
                            {crowd.text}
                          </Text>
                        </View>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text
                        style={{ color: r.color, fontWeight: '900', fontSize: 22, lineHeight: 24 }}
                      >
                        {v.etaToNextStopMin}
                      </Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 10 }}>分鐘</Text>
                    </View>
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation?.();
                        setReminder(v, r);
                      }}
                      hitSlop={8}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 10,
                        backgroundColor: theme.colors.surface2,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons
                        name="notifications-outline"
                        size={15}
                        color={theme.colors.accent}
                      />
                    </Pressable>
                  </Pressable>
                );
              })}
              {upcomingArrivals.length === 0 && (
                <Text
                  style={{
                    color: theme.colors.muted,
                    fontSize: 13,
                    textAlign: 'center',
                    paddingVertical: 20,
                  }}
                >
                  附近沒有公車正在運行
                </Text>
              )}
            </View>

            {/* Active reminders */}
            {(reminders ?? []).length > 0 && (
              <>
                <Text style={SECTION_H_STYLE}>我的提醒</Text>
                <View style={{ gap: 8, paddingHorizontal: 12 }}>
                  {(reminders ?? []).map((rem) => (
                    <View
                      key={rem.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        padding: 12,
                        borderRadius: 12,
                        backgroundColor: theme.colors.accentSoft,
                        borderWidth: 1,
                        borderColor: theme.colors.accent,
                      }}
                    >
                      <Ionicons name="alarm" size={18} color={theme.colors.accent} />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            color: theme.colors.text,
                            fontWeight: '700',
                            fontSize: 13,
                          }}
                        >
                          {rem.routeName} · {rem.plate}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                          {rem.stopName} · {rem.etaMin} 分鐘後
                        </Text>
                      </View>
                      <Pressable onPress={() => removeReminder(rem)} hitSlop={8}>
                        <Ionicons name="close-circle" size={20} color={theme.colors.muted} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        </View>
      )}

      {view === 'routes' && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING, gap: 8 }}
        >
          {(['campus', 'city', 'shuttle', 'long'] as const).map((cat) => {
            const rs = CAMPUS_BUS_ROUTES.filter((r) => r.category === cat);
            if (rs.length === 0) return null;
            return (
              <View key={cat} style={{ gap: 6 }}>
                <Text
                  style={{
                    color: theme.colors.muted,
                    fontSize: 11,
                    fontWeight: '700',
                    letterSpacing: 2,
                    textTransform: 'uppercase',
                    marginTop: 8,
                    marginLeft: 4,
                  }}
                >
                  {ROUTE_CATEGORY_LABELS[cat]}
                </Text>
                {rs.map((r) => (
                  <Pressable
                    key={r.id}
                    onPress={() => {
                      setSelectedRouteId(r.id);
                      setView('map');
                    }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      gap: 12,
                      padding: 14,
                      borderRadius: 14,
                      backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      borderLeftWidth: 4,
                      borderLeftColor: r.color,
                    })}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        backgroundColor: `${r.color}25`,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ color: r.color, fontWeight: '900', fontSize: 14 }}>
                        {r.code}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 14 }}>
                        {r.name}
                      </Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                        {r.description}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                        <TinyTag text={`${r.peakFrequencyMin}-${r.offPeakFrequencyMin} 分一班`} />
                        <TinyTag text={`${r.firstBusTime}-${r.lastBusTime}`} />
                        {r.studentFree && <TinyTag text="學生免費" color="#34D399" />}
                        {r.hasAccessibleBus && <TinyTag text="♿" color="#34D399" />}
                      </View>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={theme.colors.muted}
                      style={{ alignSelf: 'center' }}
                    />
                  </Pressable>
                ))}
              </View>
            );
          })}
        </ScrollView>
      )}

      {view === 'schedule' && (
        <ScheduleView selectedRouteId={selectedRouteId} onSelectRoute={setSelectedRouteId} />
      )}

      {view === 'favorites' && (
        <FavoritesView
          favorites={favorites ?? []}
          onToggle={async (id) => {
            const cur = favorites ?? [];
            await setFavorites(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
          }}
          onSelectRoute={(id) => {
            setSelectedRouteId(id);
            setView('map');
          }}
        />
      )}
    </View>
  );
}

// ═════════════════════════════════════════════════════
// AI 推薦卡片
// ═════════════════════════════════════════════════════
function AiRecommendCard({
  rec,
  onSetReminder,
  onSeeOthers,
  customReason,
  titleOverride,
}: {
  rec: AiBusRecommendation;
  onSetReminder: () => void;
  onSeeOthers: () => void;
  customReason?: string;
  titleOverride?: string;
}) {
  return (
    <View
      style={{
        marginHorizontal: 12,
        marginTop: 14,
        padding: 14,
        borderRadius: 18,
        backgroundColor: `${theme.colors.accent}1F`,
        borderWidth: 1,
        borderColor: `${theme.colors.accent}55`,
      }}
    >
      <View
        style={{
          alignSelf: 'flex-start',
          flexDirection: 'row',
          gap: 4,
          alignItems: 'center',
          paddingHorizontal: 9,
          paddingVertical: 3,
          borderRadius: 99,
          backgroundColor: theme.colors.accent,
          marginBottom: 8,
        }}
      >
        <Ionicons name="sparkles" size={11} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>AI 為你建議</Text>
      </View>
      <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '800', lineHeight: 21 }}>
        {titleOverride ?? `建議搭 ${rec.route.shortName} ${rec.nextDepartureHHmm} 班 → ${rec.alightStop.name}`}
      </Text>
      <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 6, lineHeight: 18 }}>
        {customReason ?? rec.reason} · 全程約 {rec.totalMin} 分
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <Pressable
          onPress={onSetReminder}
          style={({ pressed }) => ({
            flex: 1,
            paddingVertical: 11,
            borderRadius: 12,
            backgroundColor: pressed ? `${theme.colors.accent}DD` : theme.colors.accent,
            alignItems: 'center',
          })}
        >
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>設定到站提醒</Text>
        </Pressable>
        <Pressable
          onPress={onSeeOthers}
          style={({ pressed }) => ({
            flex: 1,
            paddingVertical: 11,
            borderRadius: 12,
            backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            alignItems: 'center',
          })}
        >
          <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>看其他路線</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ═════════════════════════════════════════════════════
// Schedule view
// ═════════════════════════════════════════════════════
function ScheduleView({
  selectedRouteId,
  onSelectRoute,
}: {
  selectedRouteId: string;
  onSelectRoute: (id: string) => void;
}) {
  const [dayType, setDayType] = useState<'weekday' | 'weekend'>(
    [0, 6].includes(new Date().getDay()) ? 'weekend' : 'weekday',
  );
  const [routeId, setRouteId] = useState(selectedRouteId || CAMPUS_BUS_ROUTES[0].id);
  const route = getCampusBusRoute(routeId)!;
  const times = dayType === 'weekday' ? route.weekdayDepartures : route.weekendDepartures;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const nextIdx = times.findIndex((t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m >= nowMin;
  });

  return (
    <View style={{ flex: 1, padding: 12 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 12 }}>
        {CAMPUS_BUS_ROUTES.map((r) => {
          const active = r.id === routeId;
          return (
            <Pressable
              key={r.id}
              onPress={() => {
                setRouteId(r.id);
                onSelectRoute(r.id);
              }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 99,
                backgroundColor: active ? r.color : theme.colors.surface,
                borderWidth: 1,
                borderColor: active ? r.color : theme.colors.border,
              }}
            >
              <Text style={{ color: active ? '#fff' : theme.colors.muted, fontWeight: '700', fontSize: 12 }}>
                {r.code}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <SegmentedControl
        options={[
          { key: 'weekday', label: '平日' },
          { key: 'weekend', label: '假日' },
        ]}
        selected={dayType}
        onChange={(v) => setDayType(v as 'weekday' | 'weekend')}
      />
      <ScrollView style={{ flex: 1, marginTop: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {times.length === 0 && (
            <Text
              style={{
                color: theme.colors.muted,
                fontSize: 13,
                paddingVertical: 20,
                width: '100%',
                textAlign: 'center',
              }}
            >
              此路線在{dayType === 'weekday' ? '平日' : '假日'}沒有班次
            </Text>
          )}
          {times.map((t, idx) => {
            const isNext = idx === nextIdx;
            const passed = idx < nextIdx;
            return (
              <View
                key={t}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor: isNext
                    ? route.color
                    : passed
                      ? theme.colors.surface
                      : theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: isNext ? route.color : theme.colors.border,
                  opacity: passed ? 0.45 : 1,
                  flexDirection: 'row',
                  gap: 6,
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    color: isNext ? '#fff' : theme.colors.text,
                    fontWeight: isNext ? '800' : '600',
                    fontSize: 13,
                  }}
                >
                  {t}
                </Text>
                {isNext && (
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>下一班</Text>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

// ═════════════════════════════════════════════════════
// Favorites view
// ═════════════════════════════════════════════════════
function FavoritesView({
  favorites,
  onToggle,
  onSelectRoute,
}: {
  favorites: string[];
  onToggle: (id: string) => Promise<void>;
  onSelectRoute: (id: string) => void;
}) {
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
    >
      {CAMPUS_BUS_ROUTES.map((r) => {
        const isFav = favorites.includes(r.id);
        return (
          <Pressable
            key={r.id}
            onPress={() => onSelectRoute(r.id)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              padding: 12,
              borderRadius: 14,
              backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            })}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: `${r.color}25`,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: r.color, fontWeight: '900', fontSize: 13 }}>{r.code}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
                {r.shortName}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{r.description}</Text>
            </View>
            <Pressable onPress={() => onToggle(r.id)} hitSlop={8}>
              <Ionicons
                name={isFav ? 'star' : 'star-outline'}
                size={22}
                color={isFav ? '#FF9500' : theme.colors.muted}
              />
            </Pressable>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ═════════════════════════════════════════════════════
// Small components
// ═════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════
// Persona greeting bar — 個人化問候
// ═════════════════════════════════════════════════════
function PersonaGreeting({
  name,
  role,
  nextClass,
  onPressNextClass,
}: {
  name: string;
  role: 'student' | 'teacher' | 'ta' | 'admin' | 'vendor' | 'unknown';
  nextClass: ReturnType<typeof usePersonaContext>['nextClass'];
  onPressNextClass: () => void;
}) {
  const hour = new Date().getHours();
  const greeting = hour < 11 ? '早安' : hour < 14 ? '午安' : hour < 18 ? '下午好' : '晚安';
  const roleEmoji =
    role === 'teacher' ? '👨‍🏫' :
    role === 'student' ? '🎓' :
    role === 'ta' ? '🧑‍💼' :
    role === 'admin' ? '🏛️' :
    role === 'vendor' ? '🏪' : '👤';

  return (
    <Pressable
      onPress={nextClass ? onPressNextClass : undefined}
      style={{
        marginHorizontal: 12,
        marginTop: 8,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 14,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Text style={{ fontSize: 22 }}>{roleEmoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '800' }}>
          {greeting}，{name}
        </Text>
        {nextClass ? (
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
            下一節「{nextClass.courseName}」{nextClass.startHHmm}（剩 {nextClass.startsInMin} 分）·{' '}
            {nextClass.poi.name} {nextClass.roomCode}
          </Text>
        ) : (
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
            今天沒有排程，享受悠閒時光
          </Text>
        )}
      </View>
      {nextClass && (
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 8,
            backgroundColor: theme.colors.accentSoft,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 3,
          }}
        >
          <Ionicons name="navigate" size={11} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: '700' }}>規劃</Text>
        </View>
      )}
    </Pressable>
  );
}

function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <Text
        style={{
          fontSize: 9,
          color: theme.colors.muted,
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}
      >
        {label}
      </Text>
      <Text style={{ fontSize: 16, fontWeight: '900', color, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function TinyTag({ text, color }: { text: string; color?: string }) {
  return (
    <View
      style={{
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 6,
        backgroundColor: color ? `${color}25` : theme.colors.surface2,
        borderWidth: 1,
        borderColor: color ? `${color}55` : theme.colors.border,
      }}
    >
      <Text style={{ color: color ?? theme.colors.muted, fontSize: 10, fontWeight: '700' }}>
        {text}
      </Text>
    </View>
  );
}

const SECTION_H_STYLE = {
  color: theme.colors.muted,
  fontSize: 11,
  fontWeight: '700' as const,
  letterSpacing: 2,
  textTransform: 'uppercase' as const,
  marginTop: 18,
  marginLeft: 16,
  marginBottom: 8,
};

export default BusV2Screen;
