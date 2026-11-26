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
import { Pressable, ScrollView, Text, View, Alert, Share, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Screen } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { pageTitleFont } from '../ui/styles';
import { useThemeMode } from '../state/theme';
import { analytics } from '../services/analytics';
import { upsertSavedPlace } from '../services/savedPlaces';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { VerifiedBusStopArrivals } from '../components/VerifiedBusStopArrivals';
import {
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
        <View
          style={{
            paddingVertical: 12,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="bus-outline" size={16} color={theme.colors.accent} />
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>公車站</Text>
          </View>
          <Text
            accessibilityRole="header"
            style={{
              color: theme.colors.text,
              fontFamily: pageTitleFont,
              fontSize: 30,
              marginVertical: 6,
            }}
          >
            {stop.name}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21 }}>
            {[
              `${routesAtStop.length} 條路線`,
              stop.hasShelter && '遮雨棚',
              stop.hasInfoBoard && 'LED 看板',
              stop.insideCampus && '校內',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            <CtaBtn icon="navigate" primary label="在地圖上查看" onPress={handleStartNav} />
            <CtaBtn icon="bookmark-outline" label="儲存" onPress={handleSavePlace} />
            <CtaBtn icon="share-outline" label="分享" onPress={handleShareStop} />
          </View>
        </View>

        <View style={{ gap: 10 }}>
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
        <View style={{ gap: 10 }}>
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
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                }}
              >
                {/* Route header */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${rt.code} ${rt.shortName}`}
                  onPress={() => nav.navigate('BusV2', { initialRouteId: rt.id })}
                  style={({ pressed }) => ({
                    paddingVertical: 14,
                    backgroundColor: pressed ? theme.colors.surface2 : 'transparent',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                  })}
                >
                  <View
                    style={{
                      paddingLeft: 10,
                      paddingRight: 4,
                      paddingVertical: 2,
                      borderLeftWidth: 3,
                      borderLeftColor: rt.color,
                    }}
                  >
                    <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 15 }}>
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
                    paddingBottom: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <MiniTag text={`參考營運時間 ${rt.firstBusTime}-${rt.lastBusTime}`} />
                  <MiniTag
                    text={`參考班距 ${rt.peakFrequencyMin}-${rt.offPeakFrequencyMin} 分鐘`}
                  />
                  {rt.studentFree && <MiniTag text="學生免費" color={theme.colors.success} />}
                  {rt.hasAccessibleBus && <MiniTag text="♿ 低底盤" color={theme.colors.success} />}
                </View>
              </View>
            );
          })}
        </View>

        {/* Transfer routes */}
        {stop.transferRoutes && stop.transferRoutes.length > 0 && (
          <View style={{ gap: 4 }}>
            <Text style={{ ...SECTION_HEADER }}>可在此站轉乘</Text>
            <View
              style={{
                paddingVertical: 8,
                flexDirection: 'row',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              {stop.transferRoutes.map((id) => (
                <View
                  key={id}
                  style={{
                    paddingRight: 12,
                    paddingVertical: 4,
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
          <View style={{ gap: 4 }}>
            <Text style={{ ...SECTION_HEADER }}>步行 5 分鐘內</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 14 }}
            >
              {nearbyPois.map((poi) => {
                const d = haversineMeters(stop.lat, stop.lng, poi.lat, poi.lng);
                return (
                  <Pressable
                    key={poi.id}
                    accessibilityRole="button"
                    onPress={() => nav.navigate('PoiDetail', { id: poi.id })}
                    style={({ pressed }) => ({
                      width: 160,
                      paddingVertical: 10,
                      minHeight: 44,
                      backgroundColor: pressed ? theme.colors.surface2 : 'transparent',
                      borderTopWidth: StyleSheet.hairlineWidth,
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

function CtaBtn({
  icon,
  label,
  onPress,
  primary = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  const ink = primary ? theme.colors.onAccent : theme.colors.accent;
  useThemeMode();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: primary ? 2 : 1,
        minHeight: 44,
        paddingHorizontal: 8,
        borderRadius: theme.radius.sm,
        backgroundColor: primary
          ? theme.colors.accent
          : pressed
            ? theme.colors.surface2
            : 'transparent',
        opacity: pressed && primary ? 0.85 : 1,
        flexDirection: 'row',
        gap: 4,
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      <Ionicons name={icon} size={16} color={ink} />
      <Text style={{ color: ink, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

function MiniTag({ text, color }: { text: string; color?: string }) {
  useThemeMode();
  return (
    <View
      style={{
        paddingRight: 6,
        paddingVertical: 2,
      }}
    >
      <Text style={{ color: color ?? theme.colors.muted, fontSize: 12 }}>{text}</Text>
    </View>
  );
}

const SECTION_HEADER = {
  get color() {
    return theme.colors.text;
  },
  fontSize: 18,
  fontWeight: '600' as const,
  marginTop: 4,
  marginBottom: 8,
};

export default BusStopDetailScreen;
