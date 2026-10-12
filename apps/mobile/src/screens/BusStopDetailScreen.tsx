/* eslint-disable */
/**
 * 公車站詳情頁
 *
 * 點地圖上任何公車站 → 此頁面
 * 提供：
 *   - 站名 + 站牌設施（遮雨棚、LED 看板）
 *   - 所有經過此站的路線
 *   - 僅在官方站牌識別碼符合時顯示到站資料
 *   - 路線首末班、班距
 *   - 加入「儲存地點」
 *   - 附近 POI（餐廳、便利商店）
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { Pressable, ScrollView, Text, View, Alert, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Screen } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';
import { analytics } from '../services/analytics';
import { upsertSavedPlace } from '../services/savedPlaces';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { VerifiedBusStopArrivals } from '../components/VerifiedBusStopArrivals';
import {
  CAMPUS_BUS_ROUTES,
  getAllBusStops,
  getRoutesByStop,
  haversineMeters,
  type CampusBusRoute,
  type CampusBusStop,
} from '../data/campusBusRoutes';
import { CAMPUS_POIS, type CampusPoi } from '../data/puCampusData';

type ParamShape = {
  stopId: string;
};

export function BusStopDetailScreen(_props: Record<string, unknown>) {
  useThemeMode();
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const params = (route.params ?? {}) as Partial<ParamShape>;
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const { school } = useSchool();

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

  // 附近 POI（500 公尺內）
  const nearbyPois: CampusPoi[] = useMemo(() => {
    if (!stop) return [];
    return CAMPUS_POIS.filter((p) => haversineMeters(stop.lat, stop.lng, p.lat, p.lng) < 500)
      .filter(
        (p) =>
          p.category === 'cafeteria' || p.category === 'convenience' || p.category === 'library',
      )
      .slice(0, 6);
  }, [stop]);

  const handleSavePlace = useCallback(async () => {
    if (!stop) return;
    await upsertSavedPlace(uid, {
      id: `busstop-${stop.id}`,
      kind: 'custom',
      label: stop.name,
      name: stop.name,
      lat: stop.lat,
      lng: stop.lng,
    });
    Alert.alert('已儲存', `${stop.name} 已加入儲存地點`);
    analytics.logEvent('busstop_save', { stop_id: stop.id });
  }, [stop, uid]);

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
          <Text style={{ color: theme.colors.text, fontSize: 16, marginTop: 12 }}>
            找不到此站點
          </Text>
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
              <Text
                style={{
                  color: 'rgba(255,255,255,0.85)',
                  fontSize: 11,
                  fontWeight: '700',
                  letterSpacing: 2,
                }}
              >
                公車站
              </Text>
              <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700' }}>{stop.name}</Text>
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

        <View style={{ paddingHorizontal: 12, gap: 10 }}>
          <Text style={{ color: theme.colors.muted, lineHeight: 21 }}>
            站點與路線來源：App
            內建參考資料，非即時班表。營運時間、班距與停靠資訊可能有異動，請以官方公告為準。
          </Text>
          <VerifiedBusStopArrivals
            key={`${uid ?? 'guest'}:${school.id}:${stop.id}`}
            schoolId={school.id}
            stopId={stop.id}
          />
        </View>

        {/* Routes section */}
        <View style={{ paddingHorizontal: 12, gap: 10 }}>
          <Text style={{ ...SECTION_HEADER }}>經過此站的路線</Text>
          {routesAtStop.length === 0 && (
            <Text style={{ color: theme.colors.muted, textAlign: 'center', paddingVertical: 20 }}>
              暫時沒有路線資料
            </Text>
          )}
          {routesAtStop.map((rt) => {
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
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                      {rt.code}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
                      {rt.shortName}
                    </Text>
                    <Text
                      style={{ color: theme.colors.muted, fontSize: 11, marginTop: 1 }}
                      numberOfLines={1}
                    >
                      {stopIdx === 0
                        ? `起點 → ${rt.stops[rt.stops.length - 1].name}`
                        : stopIdx === rt.stops.length - 1
                          ? `${rt.stops[0].name} → 終點`
                          : `${rt.stops[0].name} → ${rt.stops[rt.stops.length - 1].name}`}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
                </Pressable>

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
                  <MiniTag text={`參考營運時間 ${rt.firstBusTime}-${rt.lastBusTime}`} />
                  <MiniTag
                    text={`參考班距 ${rt.peakFrequencyMin}-${rt.offPeakFrequencyMin} 分鐘`}
                  />
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
            <Text style={{ ...SECTION_HEADER }}>可在此站轉乘</Text>
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
            <Text style={{ ...SECTION_HEADER }}>步行 5 分鐘內</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
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
                    <Text
                      style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}
                      numberOfLines={1}
                    >
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
  useThemeMode();
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
  useThemeMode();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
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
      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function MiniTag({ text, color }: { text: string; color?: string }) {
  useThemeMode();
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

const SECTION_HEADER = {
  get color() {
    return theme.colors.muted;
  },
  fontSize: 11,
  fontWeight: '700' as const,
  letterSpacing: 2,
  textTransform: 'uppercase' as const,
  marginTop: 4,
  marginBottom: 8,
  marginLeft: 4,
};

export default BusStopDetailScreen;
