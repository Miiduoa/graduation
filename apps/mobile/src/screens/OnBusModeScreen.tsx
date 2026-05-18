/* eslint-disable */
/**
 * 搭車中模式（On-Bus Mode）
 *
 * 使用者上車後進入的全螢幕沉浸式畫面：
 *  - 上方顯示當前車輛資訊（路線代號、車牌、司機）
 *  - 中央大字顯示下一站名 + ETA
 *  - 站點進度條 + 完整站點清單
 *  - 即將到下車站前 1 分鐘自動震動提醒
 *  - 「分享我在這台車」分享位置給朋友
 *  - 「提前下車」結束此模式
 *
 * 觸發方式：
 *  - 從 BusScheduleScreen 點擊「我在這台車」
 *  - 之後可整合 NFC 讀卡 / BLE Beacon 自動進入
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
  Alert,
  Animated,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute } from '@react-navigation/native';
import { theme } from '../ui/theme';
import { analytics } from '../services/analytics';
import { usePersonaContext } from '../services/personaContext';
import {
  CAMPUS_BUS_ROUTES,
  crowdLabel,
  getCampusBusRoute,
  haversineMeters,
  simulateActiveVehicles,
  type CampusBusRoute,
  type CampusBusStop,
  type CampusBusVehicle,
} from '../data/campusBusRoutes';

type OnBusRouteParams = {
  /** 必填：路線 ID */
  routeId: string;
  /** 必填：車輛 ID（從 BusScheduleScreen 帶進來） */
  vehicleId: string;
  /** 必填：使用者預計下車的站點 ID */
  alightStopId?: string;
};

export function OnBusModeScreen(_props: Record<string, unknown>) {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const params = (route.params ?? {}) as Partial<OnBusRouteParams>;
  const persona = usePersonaContext();

  // ── State ──
  const [now, setNow] = useState<Date>(new Date());
  const lastBuzzedStopRef = useRef<string | null>(null);

  // 每 5 秒刷新位置（demo 模擬）
  useEffect(() => {
    analytics.logScreenView('OnBusMode');
    const t = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(t);
  }, []);

  // 找路線
  const busRoute: CampusBusRoute | null = useMemo(() => {
    return params.routeId ? getCampusBusRoute(params.routeId) : null;
  }, [params.routeId]);

  // 找車輛
  const vehicle: CampusBusVehicle | null = useMemo(() => {
    if (!busRoute) return null;
    const vehicles = simulateActiveVehicles(now);
    return vehicles.find((v) => v.id === params.vehicleId) ?? vehicles.find((v) => v.routeId === busRoute.id) ?? null;
  }, [busRoute, params.vehicleId, now]);

  const alightStop: CampusBusStop | null = useMemo(() => {
    if (!busRoute) return null;
    // 1. 明確指定的下車站
    if (params.alightStopId) {
      return busRoute.stops.find((s) => s.id === params.alightStopId) ?? null;
    }
    // 2. 用 persona 下節課地點推算最近的下車站
    if (persona.nextClass) {
      const np = persona.nextClass.poi;
      let best: { stop: CampusBusStop; d: number } | null = null;
      for (const s of busRoute.stops) {
        const d = haversineMeters(np.lat, np.lng, s.lat, s.lng);
        if (!best || d < best.d) best = { stop: s, d };
      }
      if (best) return best.stop;
    }
    // 3. fallback：終點站
    return busRoute.stops[busRoute.stops.length - 1];
  }, [busRoute, params.alightStopId, persona.nextClass]);

  const nextStop: CampusBusStop | null = useMemo(() => {
    if (!busRoute || !vehicle) return null;
    return busRoute.stops.find((s) => s.id === vehicle.nextStopId) ?? null;
  }, [busRoute, vehicle]);

  // 計算進度
  const progress = useMemo(() => {
    if (!busRoute || !vehicle || !nextStop) return 0;
    const total = busRoute.stops.length - 1;
    return Math.min(1, Math.max(0, nextStop.order / total));
  }, [busRoute, vehicle, nextStop]);

  // 進度條動畫
  const progressAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, progressAnim]);

  // 下一站閃爍 pulse
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.04,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  // 自動震動：當下車站就是下一站 → 強震動提醒
  useEffect(() => {
    if (!vehicle || !alightStop || !nextStop) return;
    if (lastBuzzedStopRef.current === nextStop.id) return;
    // 提早 1 站提醒
    if (alightStop.order === nextStop.order + 1) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      lastBuzzedStopRef.current = nextStop.id;
    }
    // 到站時再震一次
    if (alightStop.id === nextStop.id && vehicle.etaToNextStopMin <= 1) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      lastBuzzedStopRef.current = `arrived-${nextStop.id}`;
    }
  }, [vehicle, alightStop, nextStop]);

  // ── Actions ──
  const handleShareLocation = useCallback(async () => {
    if (!busRoute || !vehicle) return;
    try {
      await Share.share({
        message:
          `📍 我正在搭 ${busRoute.name}（${vehicle.plate}），目前往 ${nextStop?.name ?? '下一站'}` +
          `\n預計 ${vehicle.etaToNextStopMin} 分後到下一站。`,
      });
      analytics.logEvent('onbus_share_location', { route_id: busRoute.id });
    } catch (err) {
      console.warn('share failed', err);
    }
  }, [busRoute, vehicle, nextStop]);

  const handleEndTrip = useCallback(() => {
    Alert.alert(
      '結束搭車',
      '要結束「搭車中」模式嗎？',
      [
        { text: '繼續', style: 'cancel' },
        {
          text: '結束',
          style: 'destructive',
          onPress: () => {
            analytics.logEvent('onbus_end_trip', { route_id: busRoute?.id });
            navigation.goBack();
          },
        },
      ],
      { cancelable: true },
    );
  }, [navigation, busRoute]);

  // ── Render ──
  if (!busRoute || !vehicle) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#0B0A1A',
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 32,
        }}
      >
        <Ionicons name="bus" size={48} color={theme.colors.muted} />
        <Text style={{ color: '#fff', fontSize: 17, marginTop: 14, textAlign: 'center' }}>
          找不到車輛資訊
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 6, textAlign: 'center' }}>
          請從公車畫面選擇要追蹤的車輛
        </Text>
        <Pressable
          onPress={() => navigation.goBack()}
          style={{
            marginTop: 24,
            paddingVertical: 12,
            paddingHorizontal: 28,
            borderRadius: 14,
            backgroundColor: theme.colors.accent,
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>返回</Text>
        </Pressable>
      </View>
    );
  }

  const crowdInfo = crowdLabel(vehicle.crowd);
  const passedSet = new Set(vehicle.passedStopIds);
  const isAtAlight = alightStop && nextStop && alightStop.id === nextStop.id;
  const isOneStopBefore =
    alightStop && nextStop && alightStop.order === nextStop.order + 1;

  return (
    <View style={{ flex: 1, backgroundColor: '#0F0820' }}>
      {/* Background gradient effect via overlapping colored views */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -100,
          left: -100,
          right: -100,
          height: 400,
          backgroundColor: '#5856D6',
          opacity: 0.35,
          borderRadius: 999,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          bottom: -100,
          left: -100,
          right: -100,
          height: 300,
          backgroundColor: '#1E3A8A',
          opacity: 0.28,
          borderRadius: 999,
        }}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 64, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero — vehicle info */}
        <View style={{ paddingHorizontal: 22, alignItems: 'center' }}>
          <Text
            style={{
              color: 'rgba(255,255,255,0.55)',
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 3,
            }}
          >
            你正在搭乘
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              marginTop: 6,
            }}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                backgroundColor: busRoute.color,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>{busRoute.code}</Text>
            </View>
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>
              {busRoute.shortName}
              <Text style={{ color: '#E8B547' }}> · {vehicle.plate}</Text>
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Chip text={`方向：${vehicle.headsign}`} />
            <Chip text={crowdInfo.text} color={crowdInfo.color} />
            {vehicle.isAccessible && <Chip text="♿ 無障礙" color="#34D399" />}
          </View>
          {vehicle.driverName && (
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 8 }}>
              司機 · {vehicle.driverName}
            </Text>
          )}
          {persona.isDemoPersona && persona.nextClass && (
            <View
              style={{
                marginTop: 10,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 12,
                backgroundColor: 'rgba(232,181,71,0.18)',
                borderWidth: 1,
                borderColor: 'rgba(232,181,71,0.35)',
              }}
            >
              <Text style={{ color: '#FBBF24', fontSize: 11, fontWeight: '700' }}>
                {persona.displayName} · {persona.nextClass.startHHmm}「
                {persona.nextClass.courseName}」在 {persona.nextClass.poi.name}{' '}
                {persona.nextClass.roomCode}
              </Text>
            </View>
          )}
        </View>

        {/* Big next-stop card */}
        <Animated.View
          style={{
            marginHorizontal: 22,
            marginTop: 22,
            padding: 22,
            backgroundColor: 'rgba(255,255,255,0.06)',
            borderRadius: 26,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.12)',
            transform: [{ scale: isAtAlight || isOneStopBefore ? pulseAnim : 1 }],
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              color: 'rgba(255,255,255,0.6)',
              fontSize: 11,
              letterSpacing: 3,
              fontWeight: '700',
            }}
          >
            下一站
          </Text>
          <Text
            style={{
              color: '#fff',
              fontSize: 36,
              fontWeight: '700',
              marginTop: 6,
              textAlign: 'center',
            }}
          >
            {nextStop?.name ?? '—'}
          </Text>
          <Text
            style={{
              color: isOneStopBefore
                ? '#FBBF24'
                : isAtAlight
                  ? '#34D399'
                  : '#A5B4FC',
              fontSize: 14,
              marginTop: 6,
              fontWeight: '700',
            }}
          >
            {isAtAlight
              ? '🚨 你的目的地 · 即將到站'
              : isOneStopBefore
                ? '⚠️ 下一站就要下車了'
                : `約 ${vehicle.etaToNextStopMin} 分鐘抵達`}
          </Text>
        </Animated.View>

        {/* Progress bar */}
        <View style={{ marginTop: 22, paddingHorizontal: 22 }}>
          <View
            style={{
              height: 6,
              backgroundColor: 'rgba(255,255,255,0.1)',
              borderRadius: 99,
              overflow: 'hidden',
            }}
          >
            <Animated.View
              style={{
                height: '100%',
                width: progressAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
                backgroundColor: '#A5B4FC',
                borderRadius: 99,
              }}
            />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>
              {busRoute.stops[0].name}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>
              共 {busRoute.stops.length} 站
              {alightStop && nextStop
                ? ` · 剩 ${Math.max(0, alightStop.order - nextStop.order + 1)} 站`
                : ''}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>
              {busRoute.stops[busRoute.stops.length - 1].name}
            </Text>
          </View>
        </View>

        {/* Full stop list */}
        <View
          style={{
            marginTop: 22,
            marginHorizontal: 22,
            padding: 14,
            backgroundColor: 'rgba(255,255,255,0.04)',
            borderRadius: 20,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.08)',
          }}
        >
          {busRoute.stops.map((stop) => {
            const isPassed = passedSet.has(stop.id);
            const isNow = stop.id === nextStop?.id;
            const isAlight = stop.id === alightStop?.id;
            const dotColor = isAlight
              ? '#FBBF24'
              : isNow
                ? '#FBBF24'
                : isPassed
                  ? '#34D399'
                  : 'rgba(255,255,255,0.3)';
            return (
              <View
                key={stop.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 10,
                  paddingHorizontal: 8,
                  borderRadius: 12,
                  backgroundColor: isNow ? 'rgba(251,191,36,0.12)' : 'transparent',
                  borderWidth: isNow ? 1 : 0,
                  borderColor: 'rgba(251,191,36,0.3)',
                  gap: 12,
                }}
              >
                <View
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: dotColor,
                    ...(isNow
                      ? {
                          shadowColor: '#FBBF24',
                          shadowOpacity: 0.7,
                          shadowRadius: 6,
                          shadowOffset: { width: 0, height: 0 },
                        }
                      : {}),
                  }}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: isPassed
                        ? 'rgba(255,255,255,0.5)'
                        : isAlight
                          ? '#FBBF24'
                          : isNow
                            ? '#FBBF24'
                            : '#fff',
                      fontWeight: isNow || isAlight ? '800' : '600',
                      fontSize: 14,
                      textDecorationLine: isPassed ? 'line-through' : 'none',
                    }}
                  >
                    {stop.name}
                    {isNow ? '  · 下一站' : ''}
                    {isAlight && !isNow ? '  · 你要下車' : ''}
                  </Text>
                  {stop.transferRoutes && stop.transferRoutes.length > 0 && (
                    <Text
                      style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 2 }}
                    >
                      可轉乘：{stop.transferRoutes.slice(0, 3).join('、')}
                    </Text>
                  )}
                </View>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>
                  {String(stop.order + 1).padStart(2, '0')}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Tips */}
        <View
          style={{
            marginTop: 18,
            marginHorizontal: 22,
            padding: 14,
            backgroundColor: 'rgba(45,107,216,0.18)',
            borderRadius: 16,
            borderWidth: 1,
            borderColor: 'rgba(99,153,255,0.3)',
            flexDirection: 'row',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <Ionicons name="information-circle" size={20} color="#93C5FD" />
          <Text style={{ color: '#BFDBFE', fontSize: 12, flex: 1, lineHeight: 18 }}>
            下車前 1 站手機會震動提醒你。如果想中途下車，按下方「提前下車」並通知司機。
          </Text>
        </View>
      </ScrollView>

      {/* Sticky bottom CTAs */}
      <View
        style={{
          position: 'absolute',
          left: 22,
          right: 22,
          bottom: 28,
          flexDirection: 'row',
          gap: 10,
        }}
      >
        <Pressable
          onPress={handleShareLocation}
          style={({ pressed }) => ({
            flex: 1,
            paddingVertical: 16,
            borderRadius: 18,
            backgroundColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.2)',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 6,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
        >
          <Ionicons name="paper-plane" size={17} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>分享位置</Text>
        </Pressable>
        <Pressable
          onPress={handleEndTrip}
          style={({ pressed }) => ({
            flex: 1.2,
            paddingVertical: 16,
            borderRadius: 18,
            backgroundColor: '#F87171',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 6,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
        >
          <Ionicons name="exit-outline" size={17} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
            {isAtAlight ? '已到站' : '提前下車'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function Chip({ text, color = 'rgba(255,255,255,0.6)' }: { text: string; color?: string }) {
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 99,
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.12)',
      }}
    >
      <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export default OnBusModeScreen;
