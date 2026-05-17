/* eslint-disable */
/**
 * 路線規劃 — 多模式 Directions
 *
 * 對標 Google Maps「Directions」:
 *  - 起點/終點搜尋（校園 POI + 儲存地點）
 *  - 4 種模式：走路 / 搭公車 / 騎機車 / 開車
 *  - 公車模式自動算出「走到上車站 → 搭乘 → 走到終點」三段
 *  - 結果列出多種可能，點開展開步驟
 *  - 出發按鈕 → 走路啟動 Turn-by-turn；公車啟動 OnBus
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  Text,
  View,
  TextInput,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Screen, SegmentedControl } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { analytics } from '../services/analytics';
import { useGeolocation } from '../hooks/useGeolocation';
import { useSavedPlaces, type SavedPlace } from '../services/savedPlaces';
import { usePersonaContext } from '../services/personaContext';
import {
  CAMPUS_POIS,
  getCampusPoi,
  searchCampusPois,
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  type CampusPoi,
} from '../data/puCampusData';
import {
  CAMPUS_BUS_ROUTES,
  recommendBus,
  haversineMeters,
  type AiBusRecommendation,
} from '../data/campusBusRoutes';

type TravelMode = 'walk' | 'bus' | 'bike' | 'drive';

type EndpointKind = 'mylocation' | 'poi' | 'savedplace' | 'custom';

type Endpoint = {
  label: string;
  lat: number;
  lng: number;
  kind: EndpointKind;
  poiId?: string;
};

type PlannedRoute = {
  id: string;
  mode: TravelMode;
  /** 顯示標題 */
  title: string;
  /** 顯示子標題 */
  subtitle: string;
  totalMin: number;
  totalDistanceM: number;
  /** 步驟（每段路徑） */
  steps: PlanStep[];
  /** 路線色 */
  color: string;
};

type PlanStep = {
  kind: 'walk' | 'bus';
  /** 顯示這段的指令 */
  instruction: string;
  /** 距離（公尺） */
  distanceM: number;
  /** 時間（分鐘） */
  durationMin: number;
  /** 公車段才會帶 */
  busPayload?: {
    routeId: string;
    routeCode: string;
    routeColor: string;
    boardStopId: string;
    boardStopName: string;
    alightStopId: string;
    alightStopName: string;
    nextDepHHmm: string;
  };
};

const MODE_CONFIG: Record<TravelMode, { icon: string; label: string; color: string; mPerMin: number }> = {
  walk: { icon: 'walk-outline', label: '走路', color: '#10B981', mPerMin: 75 },
  bus: { icon: 'bus-outline', label: '公車', color: '#3B82F6', mPerMin: 350 },
  bike: { icon: 'bicycle-outline', label: '騎車', color: '#F59E0B', mPerMin: 250 },
  drive: { icon: 'car-outline', label: '開車', color: '#8B5CF6', mPerMin: 500 },
};

// ═════════════════════════════════════════════════════
// Endpoint Picker Modal Body (inline)
// ═════════════════════════════════════════════════════

function EndpointPicker({
  label,
  endpoint,
  onChange,
  userLat,
  userLng,
  savedPlaces,
  onRecordPlaceUsage,
  active,
  onActive,
}: {
  label: string;
  endpoint: Endpoint | null;
  onChange: (e: Endpoint) => void;
  userLat: number;
  userLng: number;
  savedPlaces: SavedPlace[];
  onRecordPlaceUsage: (id: string) => void;
  active: boolean;
  onActive: () => void;
}) {
  const [q, setQ] = useState('');
  const searchResults = useMemo(
    () => (q.trim() ? searchCampusPois(q.trim()).slice(0, 6) : []),
    [q],
  );

  return (
    <View>
      <Pressable
        onPress={onActive}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: active ? theme.colors.accentSoft : theme.colors.surface,
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: 11,
          borderWidth: 1,
          borderColor: active ? theme.colors.accent : theme.colors.border,
          opacity: pressed ? 0.92 : 1,
        })}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: theme.colors.surface2,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: theme.colors.muted, fontSize: 10, fontWeight: '800' }}>
            {label}
          </Text>
        </View>
        <Text
          style={{
            flex: 1,
            color: endpoint ? theme.colors.text : theme.colors.muted,
            fontWeight: endpoint ? '700' : '500',
            fontSize: 14,
          }}
          numberOfLines={1}
        >
          {endpoint ? endpoint.label : `選擇${label === 'A' ? '起點' : '終點'}`}
        </Text>
        <Ionicons name="chevron-down" size={16} color={theme.colors.muted} />
      </Pressable>

      {active && (
        <View
          style={{
            marginTop: 8,
            backgroundColor: theme.colors.surface,
            borderRadius: 12,
            padding: 10,
            gap: 6,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: theme.colors.surface2,
              borderRadius: 10,
              paddingHorizontal: 10,
              paddingVertical: 8,
            }}
          >
            <Ionicons name="search" size={14} color={theme.colors.muted} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="搜尋校園地點..."
              placeholderTextColor={theme.colors.muted}
              style={{ flex: 1, color: theme.colors.text, fontSize: 13, paddingVertical: 0 }}
              autoFocus
            />
          </View>

          {/* My location quick pick */}
          {!q.trim() && (
            <Pressable
              onPress={() => {
                onChange({
                  kind: 'mylocation',
                  label: '我的位置',
                  lat: userLat,
                  lng: userLng,
                });
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                gap: 10,
                alignItems: 'center',
                padding: 8,
                borderRadius: 8,
                backgroundColor: pressed ? theme.colors.surface2 : 'transparent',
              })}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: '#3B82F622',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="locate" size={15} color="#3B82F6" />
              </View>
              <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>
                我的位置
              </Text>
            </Pressable>
          )}

          {/* Saved places */}
          {!q.trim() &&
            savedPlaces.slice(0, 4).map((p) => (
              <Pressable
                key={p.id}
                onPress={() => {
                  onChange({
                    kind: 'savedplace',
                    label: p.label,
                    lat: p.lat,
                    lng: p.lng,
                    poiId: p.poiId,
                  });
                  onRecordPlaceUsage(p.id);
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  gap: 10,
                  alignItems: 'center',
                  padding: 8,
                  borderRadius: 8,
                  backgroundColor: pressed ? theme.colors.surface2 : 'transparent',
                })}
              >
                <Text style={{ fontSize: 18 }}>{p.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>
                    {p.label}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }} numberOfLines={1}>
                    {p.name}
                  </Text>
                </View>
              </Pressable>
            ))}

          {/* Search results */}
          {searchResults.map((poi) => (
            <Pressable
              key={poi.id}
              onPress={() =>
                onChange({
                  kind: 'poi',
                  label: poi.name,
                  lat: poi.lat,
                  lng: poi.lng,
                  poiId: poi.id,
                })
              }
              style={({ pressed }) => ({
                flexDirection: 'row',
                gap: 10,
                alignItems: 'center',
                padding: 8,
                borderRadius: 8,
                backgroundColor: pressed ? theme.colors.surface2 : 'transparent',
              })}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: `${CATEGORY_COLORS[poi.category]}22`,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons
                  name={CATEGORY_ICONS[poi.category] as any}
                  size={14}
                  color={CATEGORY_COLORS[poi.category]}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>
                  {poi.name}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }} numberOfLines={1}>
                  {poi.description}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

// ═════════════════════════════════════════════════════
// Main
// ═════════════════════════════════════════════════════

export function TripPlannerScreen(_props: Record<string, unknown>) {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const params = route.params ?? {};

  const geo = useGeolocation({ enableHighAccuracy: true, autoStart: true });
  const uLat = typeof geo.latitude === 'number' ? geo.latitude : 24.22612;
  const uLng = typeof geo.longitude === 'number' ? geo.longitude : 120.5647;

  const { places: savedPlaces, useNow: recordPlaceUsageNow } = useSavedPlaces();
  const persona = usePersonaContext();

  // 起點預設「我的位置」
  const [from, setFrom] = useState<Endpoint | null>({
    kind: 'mylocation',
    label: '我的位置',
    lat: uLat,
    lng: uLng,
  });

  // 終點：params > 下節課地點 > null
  const [to, setTo] = useState<Endpoint | null>(() => {
    if (params?.toPoiId) {
      const poi = getCampusPoi(params.toPoiId);
      if (poi) {
        return {
          kind: 'poi',
          label: poi.name,
          lat: poi.lat,
          lng: poi.lng,
          poiId: poi.id,
        };
      }
    }
    if (params?.toLat && params?.toLng && params?.toName) {
      return {
        kind: 'custom',
        label: params.toName,
        lat: params.toLat,
        lng: params.toLng,
      };
    }
    // 從 persona.nextClass 推測
    if (persona.nextClass) {
      const np = persona.nextClass.poi;
      return {
        kind: 'poi',
        label: `${np.name}（下節課 ${persona.nextClass.courseName}）`,
        lat: np.lat,
        lng: np.lng,
        poiId: np.id,
      };
    }
    return null;
  });

  // 起點切換時同步「我的位置」
  useEffect(() => {
    if (from?.kind === 'mylocation') {
      setFrom((f) => (f && f.kind === 'mylocation' ? { ...f, lat: uLat, lng: uLng } : f));
    }
  }, [uLat, uLng]);

  const [mode, setMode] = useState<TravelMode>('walk');
  const [activePicker, setActivePicker] = useState<'from' | 'to' | null>(null);

  useEffect(() => {
    analytics.logScreenView('TripPlanner');
  }, []);

  // 規劃路線
  const planned: PlannedRoute[] = useMemo(() => {
    if (!from || !to) return [];
    const d = haversineMeters(from.lat, from.lng, to.lat, to.lng);

    if (mode === 'walk' || mode === 'bike' || mode === 'drive') {
      const cfg = MODE_CONFIG[mode];
      const min = Math.max(1, Math.ceil(d / cfg.mPerMin));
      return [
        {
          id: `${mode}-direct`,
          mode,
          title: `${cfg.label} ${min} 分`,
          subtitle: `${formatDist(d)} · ${min} 分鐘`,
          totalMin: min,
          totalDistanceM: d,
          color: cfg.color,
          steps: [
            {
              kind: 'walk',
              instruction: `從 ${from.label} 直接前往 ${to.label}`,
              distanceM: d,
              durationMin: min,
            },
          ],
        },
      ];
    }

    // BUS mode
    const recs = recommendBus({
      userLat: from.lat,
      userLng: from.lng,
      destinationPoiId: to.poiId,
      destinationLat: to.lat,
      destinationLng: to.lng,
    });

    return recs.slice(0, 3).map((rec) => ({
      id: `bus-${rec.route.id}-${rec.boardStop.id}-${rec.alightStop.id}`,
      mode: 'bus' as TravelMode,
      title: `${rec.route.shortName} · ${rec.totalMin} 分`,
      subtitle: `${rec.nextDepartureHHmm} 班 · 走 ${rec.walkToBoardMin} 分 + 車 ${rec.rideTimeMin} 分${rec.walkToDestMin ? ` + 走 ${rec.walkToDestMin} 分` : ''}`,
      totalMin: rec.totalMin,
      totalDistanceM: Math.round(haversineMeters(from.lat, from.lng, to.lat, to.lng) * 1.2),
      color: rec.route.color,
      steps: [
        {
          kind: 'walk',
          instruction: `走到 ${rec.boardStop.name}`,
          distanceM: Math.max(40, rec.walkToBoardMin * 75),
          durationMin: rec.walkToBoardMin,
        },
        {
          kind: 'bus',
          instruction: `搭 ${rec.route.shortName} 到 ${rec.alightStop.name}`,
          distanceM: 0,
          durationMin: rec.rideTimeMin,
          busPayload: {
            routeId: rec.route.id,
            routeCode: rec.route.code,
            routeColor: rec.route.color,
            boardStopId: rec.boardStop.id,
            boardStopName: rec.boardStop.name,
            alightStopId: rec.alightStop.id,
            alightStopName: rec.alightStop.name,
            nextDepHHmm: rec.nextDepartureHHmm,
          },
        },
        ...(rec.walkToDestMin > 0
          ? [
              {
                kind: 'walk' as const,
                instruction: `從 ${rec.alightStop.name} 走到 ${to.label}`,
                distanceM: Math.max(20, rec.walkToDestMin * 75),
                durationMin: rec.walkToDestMin,
              },
            ]
          : []),
      ],
    }));
  }, [from, to, mode]);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 開始導航
  const startRoute = useCallback(
    (r: PlannedRoute) => {
      if (!from || !to) return;
      analytics.logEvent('trip_start', { mode: r.mode, route_id: r.id });
      if (r.mode === 'bus' && r.steps.some((s) => s.kind === 'bus')) {
        const busStep = r.steps.find((s) => s.kind === 'bus')!;
        const payload = busStep.busPayload!;
        nav.navigate('OnBusMode', {
          routeId: payload.routeId,
          vehicleId: '', // 由 OnBusMode 自己挑第一台
          alightStopId: payload.alightStopId,
        });
      } else {
        // walk / bike / drive → 目前都導去 MapV2，可未來擴充
        nav.navigate('MapV2', { focusLat: to.lat, focusLng: to.lng });
      }
    },
    [from, to, nav],
  );

  // ═════════════════════════════════════════════════════
  // Render
  // ═════════════════════════════════════════════════════
  return (
    <Screen>
      <View style={{ flex: 1, paddingHorizontal: 12, gap: 8 }}>
        {/* From/To */}
        <View style={{ gap: 6, marginTop: 8 }}>
          <EndpointPicker
            label="A"
            endpoint={from}
            active={activePicker === 'from'}
            onActive={() => setActivePicker((c) => (c === 'from' ? null : 'from'))}
            onChange={(e) => {
              setFrom(e);
              setActivePicker(null);
            }}
            userLat={uLat}
            userLng={uLng}
            savedPlaces={savedPlaces}
            onRecordPlaceUsage={(id) => void recordPlaceUsageNow(id)}
          />
          <EndpointPicker
            label="B"
            endpoint={to}
            active={activePicker === 'to'}
            onActive={() => setActivePicker((c) => (c === 'to' ? null : 'to'))}
            onChange={(e) => {
              setTo(e);
              setActivePicker(null);
            }}
            userLat={uLat}
            userLng={uLng}
            savedPlaces={savedPlaces}
            onRecordPlaceUsage={(id) => void recordPlaceUsageNow(id)}
          />

          {/* Swap button */}
          {from && to && (
            <Pressable
              onPress={() => {
                setFrom(to);
                setTo(from);
              }}
              style={({ pressed }) => ({
                alignSelf: 'flex-end',
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 99,
                backgroundColor: pressed ? theme.colors.surface2 : 'transparent',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
              })}
            >
              <Ionicons name="swap-vertical" size={14} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '700' }}>
                對調
              </Text>
            </Pressable>
          )}
        </View>

        {/* Persona quick chips */}
        {(persona.nextClass || savedPlaces.find((p) => p.kind === 'home')) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {persona.nextClass && (
              <Pressable
                onPress={() => {
                  const nc = persona.nextClass!;
                  setTo({
                    kind: 'poi',
                    label: `${nc.poi.name}（下節課 ${nc.courseName}）`,
                    lat: nc.poi.lat,
                    lng: nc.poi.lng,
                    poiId: nc.poi.id,
                  });
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 11,
                  paddingVertical: 7,
                  borderRadius: 99,
                  backgroundColor: theme.colors.accent,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Ionicons name="school" size={12} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>
                  去下節課 · {persona.nextClass.startHHmm}
                </Text>
              </Pressable>
            )}
            {savedPlaces
              .filter((p) => p.kind === 'home' || p.kind === 'school' || p.kind === 'work')
              .map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() =>
                    setTo({
                      kind: 'savedplace',
                      label: p.label,
                      lat: p.lat,
                      lng: p.lng,
                      poiId: p.poiId,
                    })
                  }
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: 11,
                    paddingVertical: 7,
                    borderRadius: 99,
                    backgroundColor: theme.colors.surface,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Text style={{ fontSize: 12 }}>{p.emoji}</Text>
                  <Text style={{ color: theme.colors.text, fontSize: 11, fontWeight: '700' }}>
                    {p.label}
                  </Text>
                </Pressable>
              ))}
          </ScrollView>
        )}

        {/* Mode selector */}
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
          {(Object.keys(MODE_CONFIG) as TravelMode[]).map((m) => {
            const cfg = MODE_CONFIG[m];
            const active = mode === m;
            return (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                style={({ pressed }) => ({
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor: active ? cfg.color : theme.colors.surface,
                  borderWidth: 1,
                  borderColor: active ? cfg.color : theme.colors.border,
                  alignItems: 'center',
                  gap: 2,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <Ionicons name={cfg.icon as any} size={18} color={active ? '#fff' : theme.colors.muted} />
                <Text
                  style={{
                    color: active ? '#fff' : theme.colors.textSecondary,
                    fontSize: 11,
                    fontWeight: '700',
                  }}
                >
                  {cfg.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Results */}
        {!from || !to ? (
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingBottom: 80,
            }}
          >
            <Ionicons name="map-outline" size={48} color={theme.colors.muted} />
            <Text style={{ color: theme.colors.muted, fontSize: 14, marginTop: 12 }}>
              選擇起點與終點開始規劃
            </Text>
          </View>
        ) : planned.length === 0 ? (
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingBottom: 80,
            }}
          >
            <Ionicons name="alert-circle-outline" size={36} color={theme.colors.muted} />
            <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 8 }}>
              這個時間沒有合適的{MODE_CONFIG[mode].label}路線
            </Text>
            <Pressable
              onPress={() => setMode('walk')}
              style={{
                marginTop: 12,
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 99,
                backgroundColor: theme.colors.accent,
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>改用走路</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={planned}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ gap: 10, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 20 }}
            renderItem={({ item, index }) => {
              const expanded = expandedId === item.id;
              const isBest = index === 0;
              return (
                <Pressable
                  onPress={() => setExpandedId(expanded ? null : item.id)}
                  style={({ pressed }) => ({
                    backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: isBest ? item.color : theme.colors.border,
                    borderLeftWidth: 4,
                    borderLeftColor: item.color,
                    overflow: 'hidden',
                  })}
                >
                  <View
                    style={{
                      padding: 14,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 14,
                        backgroundColor: `${item.color}22`,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons name={MODE_CONFIG[item.mode].icon as any} size={20} color={item.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 15 }}>
                          {item.title}
                        </Text>
                        {isBest && (
                          <View
                            style={{
                              paddingHorizontal: 6,
                              paddingVertical: 2,
                              borderRadius: 4,
                              backgroundColor: item.color,
                            }}
                          >
                            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>最佳</Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }} numberOfLines={2}>
                        {item.subtitle}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: item.color, fontSize: 22, fontWeight: '900', lineHeight: 24 }}>
                        {item.totalMin}
                      </Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 10 }}>分</Text>
                    </View>
                  </View>

                  {expanded && (
                    <View
                      style={{
                        borderTopWidth: 1,
                        borderTopColor: theme.colors.border,
                        padding: 14,
                        gap: 8,
                      }}
                    >
                      {item.steps.map((step, i) => (
                        <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                          <View
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 14,
                              backgroundColor: step.kind === 'bus' ? `${step.busPayload!.routeColor}22` : `${MODE_CONFIG.walk.color}22`,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Ionicons
                              name={step.kind === 'bus' ? 'bus-outline' : 'walk-outline'}
                              size={14}
                              color={step.kind === 'bus' ? step.busPayload!.routeColor : MODE_CONFIG.walk.color}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>
                              {step.instruction}
                            </Text>
                            <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 1 }}>
                              {step.kind === 'bus'
                                ? `${step.busPayload!.nextDepHHmm} 班 · ${step.durationMin} 分鐘`
                                : `${formatDist(step.distanceM)} · 約 ${step.durationMin} 分鐘`}
                            </Text>
                          </View>
                        </View>
                      ))}
                      <Pressable
                        onPress={() => startRoute(item)}
                        style={({ pressed }) => ({
                          marginTop: 6,
                          paddingVertical: 12,
                          borderRadius: 12,
                          backgroundColor: pressed ? `${item.color}DD` : item.color,
                          alignItems: 'center',
                          flexDirection: 'row',
                          gap: 6,
                          justifyContent: 'center',
                        })}
                      >
                        <Ionicons name="navigate" size={14} color="#fff" />
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>出發</Text>
                      </Pressable>
                    </View>
                  )}
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </Screen>
  );
}

function formatDist(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

export default TripPlannerScreen;
