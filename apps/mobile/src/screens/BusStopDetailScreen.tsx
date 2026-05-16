/* eslint-disable */
/**
 * 公車站詳情頁
 *
 * 點地圖上任何公車站 → 此頁面
 * 提供：
 *   - 站名 + 站牌設施（遮雨棚、LED 看板）
 *   - 所有經過此站的路線
 *   - 每條路線下一班 ETA + 後續班次
 *   - 路線首末班、班距
 *   - 設定到站提醒
 *   - 加入「儲存地點」
 *   - 附近 POI（餐廳、便利商店）
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  View,
  Alert,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { Screen } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { analytics } from '../services/analytics';
import { scheduleLocalNotification } from '../services/notifications';
import { savePoi, upsertSavedPlace } from '../services/savedPlaces';
import {
  CAMPUS_BUS_ROUTES,
  crowdLabel,
  getAllBusStops,
  getRoutesByStop,
  haversineMeters,
  simulateActiveVehicles,
  type CampusBusRoute,
  type CampusBusStop,
  type CampusBusVehicle,
} from '../data/campusBusRoutes';
import { CAMPUS_POIS, type CampusPoi } from '../data/puCampusData';

type ParamShape = {
  stopId: string;
};

export function BusStopDetailScreen(_props: Record<string, unknown>) {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const params = (route.params ?? {}) as Partial<ParamShape>;

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    analytics.logScreenView('BusStopDetail');
  }, []);

  const stop: CampusBusStop | null = useMemo(() => {
    if (!params.stopId) return null;
    return getAllBusStops().find((s) => s.id === params.stopId) ?? null;
  }, [params.stopId]);

  const routesAtStop: CampusBusRoute[] = useMemo(
    () => (stop ? getRoutesByStop(stop.id) : []),
    [stop],
  );

  const activeVehicles: CampusBusVehicle[] = useMemo(
    () => simulateActiveVehicles(new Date()),
    [tick],
  );

  // 每條路線下一班抵達此站的車
  const arrivalsByRoute: Record<
    string,
    { vehicle: CampusBusVehicle; etaMin: number }[]
  > = useMemo(() => {
    if (!stop) return {};
    const out: Record<string, { vehicle: CampusBusVehicle; etaMin: number }[]> = {};
    for (const r of routesAtStop) {
      // 這條路線所有活躍車輛
      const vs = activeVehicles.filter((v) => v.routeId === r.id);
      const stopIndex = r.stops.findIndex((s) => s.id === stop.id);
      const arr = vs
        .map((v) => {
          // 估算車輛從目前位置到此站的時間
          const dToStop = haversineMeters(v.position.lat, v.position.lng, stop.lat, stop.lng);
          // 簡化：以速度 350 公尺/分（含停站）
          let etaMin = Math.max(1, Math.round(dToStop / 350));
          // 如果車已過此站，加上一整圈時間
          const nextIdx = r.stops.findIndex((s) => s.id === v.nextStopId);
          if (nextIdx > stopIndex) {
            etaMin += r.durationMin;
          }
          return { vehicle: v, etaMin };
        })
        .sort((a, b) => a.etaMin - b.etaMin)
        .slice(0, 3);
      out[r.id] = arr;
    }
    return out;
  }, [stop, routesAtStop, activeVehicles]);

  // 附近 POI（500 公尺內）
  const nearbyPois: CampusPoi[] = useMemo(() => {
    if (!stop) return [];
    return CAMPUS_POIS.filter((p) => haversineMeters(stop.lat, stop.lng, p.lat, p.lng) < 500)
      .filter((p) => p.category === 'cafeteria' || p.category === 'convenience' || p.category === 'library')
      .slice(0, 6);
  }, [stop]);

  const handleSetReminder = useCallback(
    async (rt: CampusBusRoute, vehicle: CampusBusVehicle, etaMin: number) => {
      const triggerSeconds = Math.max(etaMin * 60 - 60, 5);
      try {
        await scheduleLocalNotification(
          `${rt.shortName} 即將到站`,
          `${vehicle.plate} 將抵達 ${stop?.name ?? ''}（${etaMin} 分鐘）`,
          { type: 'bus_stop', routeId: rt.id, stopId: stop?.id },
          {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: triggerSeconds,
            repeats: false,
          },
        );
        Alert.alert('提醒已設定', `${rt.shortName} 將抵達 ${stop?.name} 前 1 分鐘通知你`);
        analytics.logEvent('busstop_reminder_set', { route_id: rt.id, stop_id: stop?.id });
      } catch (err) {
        Alert.alert('提醒失敗', '請確認通知權限');
      }
    },
    [stop],
  );

  const handleSavePlace = useCallback(async () => {
    if (!stop) return;
    await upsertSavedPlace({
      id: `busstop-${stop.id}`,
      kind: 'custom',
      label: stop.name,
      name: stop.name,
      lat: stop.lat,
      lng: stop.lng,
    });
    Alert.alert('已儲存', `${stop.name} 已加入儲存地點`);
    analytics.logEvent('busstop_save', { stop_id: stop.id });
  }, [stop]);

  const handleShareStop = useCallback(async () => {
    if (!stop) return;
    try {
      await Share.share({
        message: `📍 ${stop.name} · 經過 ${routesAtStop.length} 條路線：${routesAtStop.map((r) => r.code).join('、')}`,
      });
    } catch {}
  }, [stop, routesAtStop]);

  const handleStartNav = useCallback(() => {
    if (!stop) return;
    nav.navigate('MapV2', { focusLat: stop.lat, focusLng: stop.lng });
  }, [stop, nav]);

  if (!stop) {
    return (
      <Screen>
        <View style={{ alignItems: 'center', paddingTop: 60 }}>
          <Ionicons name="alert-circle" size={48} color={theme.colors.muted} />
          <Text style={{ color: theme.colors.text, fontSize: 16, marginTop: 12 }}>找不到此站點</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 40, gap: 16 }}
      >
        {/* Hero */}
        <View
          style={{
            backgroundColor: theme.colors.accent,
            padding: 20,
            borderRadius: 20,
            marginHorizontal: 12,
            marginTop: 8,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                backgroundColor: 'rgba(255,255,255,0.2)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="bus" size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '700', letterSpacing: 2 }}>
                公車站
              </Text>
              <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>{stop.name}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
            {stop.hasShelter && <FeatureChip text="遮雨棚" />}
            {stop.hasInfoBoard && <FeatureChip text="LED 看板" />}
            {stop.insideCampus && <FeatureChip text="校內" />}
            <FeatureChip text={`${routesAtStop.length} 條路線`} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            <CtaBtn icon="navigate" label="在地圖上查看" onPress={handleStartNav} />
            <CtaBtn icon="bookmark-outline" label="儲存" onPress={handleSavePlace} />
            <CtaBtn icon="share-outline" label="分享" onPress={handleShareStop} />
          </View>
        </View>

        {/* Routes section */}
        <View style={{ paddingHorizontal: 12, gap: 10 }}>
          <Text style={SECTION_HEADER}>經過此站的路線</Text>
          {routesAtStop.length === 0 && (
            <Text style={{ color: theme.colors.muted, textAlign: 'center', paddingVertical: 20 }}>
              暫時沒有路線資料
            </Text>
          )}
          {routesAtStop.map((rt) => {
            const arrivals = arrivalsByRoute[rt.id] ?? [];
            const stopIdx = rt.stops.findIndex((s) => s.id === stop.id);
            return (
              <View
                key={rt.id}
                style={{
                  backgroundColor: theme.colors.surface,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderLeftWidth: 4,
                  borderLeftColor: rt.color,
                  overflow: 'hidden',
                }}
              >
                {/* Route header */}
                <Pressable
                  onPress={() => nav.navigate('BusV2', { initialRouteId: rt.id })}
                  style={({ pressed }) => ({
                    padding: 14,
                    backgroundColor: pressed ? theme.colors.surface2 : 'transparent',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                  })}
                >
                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 8,
                      backgroundColor: rt.color,
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>{rt.code}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 14 }}>
                      {rt.shortName}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 1 }} numberOfLines={1}>
                      {stopIdx === 0
                        ? `起點 → ${rt.stops[rt.stops.length - 1].name}`
                        : stopIdx === rt.stops.length - 1
                          ? `${rt.stops[0].name} → 終點`
                          : `${rt.stops[0].name} → ${rt.stops[rt.stops.length - 1].name}`}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
                </Pressable>

                {/* Arrivals */}
                <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 6 }}>
                  {arrivals.length === 0 ? (
                    <Text style={{ color: theme.colors.muted, fontSize: 12, paddingVertical: 6 }}>
                      此時段暫無班次
                    </Text>
                  ) : (
                    arrivals.map(({ vehicle, etaMin }, idx) => {
                      const crowd = crowdLabel(vehicle.crowd);
                      return (
                        <View
                          key={vehicle.id}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 10,
                            padding: 10,
                            backgroundColor: theme.colors.surface2,
                            borderRadius: 10,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                          }}
                        >
                          <View
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 16,
                              backgroundColor: idx === 0 ? `${rt.color}25` : theme.colors.surface,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Text style={{ color: rt.color, fontWeight: '900', fontSize: 12 }}>
                              {etaMin}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '700' }}>
                              {vehicle.plate}{idx === 0 ? ' · 下一班' : ''}
                            </Text>
                            <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 1 }}>
                              {vehicle.headsign} · {crowd.text}
                            </Text>
                          </View>
                          {idx === 0 && (
                            <Pressable
                              onPress={() => handleSetReminder(rt, vehicle, etaMin)}
                              hitSlop={8}
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 8,
                                backgroundColor: theme.colors.accentSoft,
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <Ionicons name="alarm-outline" size={15} color={theme.colors.accent} />
                            </Pressable>
                          )}
                        </View>
                      );
                    })
                  )}
                </View>

                {/* Meta row */}
                <View
                  style={{
                    flexDirection: 'row',
                    gap: 4,
                    paddingHorizontal: 14,
                    paddingBottom: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <MiniTag text={`${rt.firstBusTime}-${rt.lastBusTime}`} />
                  <MiniTag text={`${rt.peakFrequencyMin}-${rt.offPeakFrequencyMin} 分一班`} />
                  {rt.studentFree && <MiniTag text="學生免費" color="#34D399" />}
                  {rt.hasAccessibleBus && <MiniTag text="♿ 低底盤" color="#34D399" />}
                </View>
              </View>
            );
          })}
        </View>

        {/* Transfer routes */}
        {stop.transferRoutes && stop.transferRoutes.length > 0 && (
          <View style={{ paddingHorizontal: 12 }}>
            <Text style={SECTION_HEADER}>可在此站轉乘</Text>
            <View
              style={{
                padding: 14,
                backgroundColor: theme.colors.surface,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: theme.colors.border,
                flexDirection: 'row',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              {stop.transferRoutes.map((id) => (
                <View
                  key={id}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    backgroundColor: theme.colors.surface2,
                    borderRadius: 99,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}
                >
                  <Text style={{ color: theme.colors.text, fontSize: 11, fontWeight: '700' }}>
                    {id.toUpperCase()}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Nearby POIs */}
        {nearbyPois.length > 0 && (
          <View style={{ paddingHorizontal: 12 }}>
            <Text style={SECTION_HEADER}>步行 5 分鐘內</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {nearbyPois.map((poi) => {
                const d = haversineMeters(stop.lat, stop.lng, poi.lat, poi.lng);
                return (
                  <Pressable
                    key={poi.id}
                    onPress={() => nav.navigate('PoiDetail', { id: poi.id })}
                    style={({ pressed }) => ({
                      width: 160,
                      padding: 10,
                      borderRadius: 12,
                      backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                    })}
                  >
                    <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>
                      {poi.name}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                      {Math.round(d)}m · 步行 {Math.max(1, Math.ceil(d / 75))} 分
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function FeatureChip({ text }: { text: string }) {
  return (
    <View
      style={{
        paddingHorizontal: 9,
        paddingVertical: 3,
        backgroundColor: 'rgba(255,255,255,0.18)',
        borderRadius: 99,
      }}
    >
      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

function CtaBtn({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: pressed ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.16)',
        flexDirection: 'row',
        gap: 4,
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      <Ionicons name={icon} size={14} color="#fff" />
      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  );
}

function MiniTag({ text, color }: { text: string; color?: string }) {
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
      <Text style={{ color: color ?? theme.colors.muted, fontSize: 10, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

const SECTION_HEADER = {
  color: theme.colors.muted,
  fontSize: 11,
  fontWeight: '700' as const,
  letterSpacing: 2,
  textTransform: 'uppercase' as const,
  marginTop: 4,
  marginBottom: 8,
  marginLeft: 4,
};

export default BusStopDetailScreen;
