/* eslint-disable */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Alert,
  Animated,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Magnetometer, Accelerometer } from 'expo-sensors';
import { Screen, Button, Pill, AnimatedCard } from '../ui/components';
import { theme } from '../ui/theme';
import { useSchool } from '../state/school';
import { canUseProvidencePathNetwork } from '../features/campusArScope';
import { linkingOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';
import {
  calculateBearing,
  calculateDistance,
  calculateRelativeAngle,
  getRouteProgress,
  getDirectionType,
  getDirectionInstruction,
  generateVoiceGuidance,
  HeadingSmoother,
  type DirectionType,
  type Location as ARLocation,
} from '../services/ar';
import { getFootRoute, type LatLng, type RouteStep } from '../services/routingService';
import { useDataSource } from '../hooks/useDataSource';
import { useGeolocation } from '../hooks/useGeolocation';
import { isUsableFootRoute } from '../features/usableFootRoute';

type ARMode = 'preview' | 'navigating' | 'arrived';

type NavigationStep = {
  id: string;
  instruction: string;
  distance: number;
  direction: 'straight' | 'left' | 'right' | 'up' | 'down' | 'destination';
  landmark?: string;
};

/**
 * OSRM GeoJSON 座標為 [lng, lat]，轉成 AR / RN 慣用之 latitude, longitude
 */
function geometryLngLatToARLocations(geometry: [number, number][]): ARLocation[] {
  return geometry.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
}

function routeStepToNavigationStep(step: RouteStep, index: number): NavigationStep {
  let direction: NavigationStep['direction'] = 'straight';
  const m = step.maneuver;
  const instr = step.instruction;
  if (m === 'arrive') direction = 'destination';
  else if (/左轉|向左|稍微左轉|急轉左/.test(instr)) direction = 'left';
  else if (/右轉|向右|稍微右轉|急轉右/.test(instr)) direction = 'right';

  return {
    id: String(index + 1),
    instruction: instr,
    distance: Math.round(step.distance),
    direction,
    landmark: step.name?.trim() ? step.name : undefined,
  };
}

/** Use the routing provider's walking geometry, never unverified campus path sketches. */
async function buildARNavigationRoute(params: {
  start: ARLocation;
  destination: { lat: number; lng: number; name: string };
}): Promise<{ points: ARLocation[]; distance: number; steps: NavigationStep[] } | null> {
  const { start, destination: dest } = params;
  const from: LatLng = { lat: start.latitude, lng: start.longitude };
  const to: LatLng = { lat: dest.lat, lng: dest.lng };
  const foot = await getFootRoute(from, to);
  if (!isUsableFootRoute(foot, from, to)) return null;

  const steps: NavigationStep[] = foot.steps.length
    ? foot.steps.map((step, index) => routeStepToNavigationStep(step, index))
    : [{
        id: '1',
        instruction: '已找到步行路線，但供應商未提供轉彎指示，請改用一般地圖確認路線。',
        distance: Math.round(foot.distance),
        direction: 'straight',
      }];
  return {
    points: geometryLngLatToARLocations(foot.geometry),
    distance: Math.round(foot.distance),
    steps,
  };
}

// Fallback steps when no destination is provided
const FALLBACK_STEPS: NavigationStep[] = [
  { id: '1', instruction: '請先選擇目的地', distance: 0, direction: 'straight' },
];

const ARRIVAL_THRESHOLD_M = 12;
const WARN_ACCURACY_M = 20;
const LOW_ACCURACY_M = 35;
const ROUTE_RECALC_THRESHOLD_M = 40;
const ROUTE_RECALC_INTERVAL_MS = 15000;

function getDirectionIcon(direction: NavigationStep['direction']): string {
  switch (direction) {
    case 'straight':
      return 'arrow-up';
    case 'left':
      return 'arrow-back';
    case 'right':
      return 'arrow-forward';
    case 'up':
      return 'chevron-up-circle';
    case 'down':
      return 'chevron-down-circle';
    case 'destination':
      return 'flag';
    default:
      return 'navigate';
  }
}

function getDirectionColor(direction: NavigationStep['direction']): string {
  switch (direction) {
    case 'destination':
      return theme.colors.success;
    case 'up':
    case 'down':
      return '#FF9500';
    default:
      return theme.colors.accent;
  }
}

export function ARNavigationScreen(props: any) {
  const { school } = useSchool();
  if (!canUseProvidencePathNetwork(school.id)) {
    return (
      <Screen>
        <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 18 }}>
          <Text style={{ color: theme.colors.text, fontSize: 22, fontWeight: '700' }}>
            目前校園尚未提供 AR 校內導航
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 15, lineHeight: 25 }}>
            {school.name}尚未建立經校方核對的步行路網。為避免導錯校園，這裡不會套用靜宜大學的路徑節點或顯示未確認的轉彎指示。
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回目前校園地圖"
            style={{ minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.accent, borderRadius: 10, paddingHorizontal: 18 }}
            onPress={() => props?.navigation?.navigate?.('MapV2')}
          >
            <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.onAccent }}>
              返回目前校園地圖
            </Text>
          </Pressable>
        </View>
      </Screen>
    );
  }
  return <ProvidenceARNavigationScreen {...props} />;
}

function ProvidenceARNavigationScreen(props: any) {
  const nav = props?.navigation;
  const destination = props?.route?.params?.destination ?? '目的地';
  const destinationId = props?.route?.params?.destinationId;
  const destinationLat = props?.route?.params?.destinationLat;
  const destinationLng = props?.route?.params?.destinationLng;

  const [mode, setMode] = useState<ARMode>('preview');
  const [currentStep, setCurrentStep] = useState(0);
  const [permission, requestPermission] = useCameraPermissions();
  const [compassHeading, setCompassHeading] = useState(0);
  const [distanceRemaining, setDistanceRemaining] = useState(150);
  const [devicePitch, setDevicePitch] = useState(0);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [voiceGuidanceEnabled, setVoiceGuidanceEnabled] = useState(true);
  const [lastVoiceAnnouncement, setLastVoiceAnnouncement] = useState('');
  const [target, setTarget] = useState<{
    id?: string;
    name: string;
    lat: number;
    lng: number;
  } | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [routing, setRouting] = useState(false);
  const [routePoints, setRoutePoints] = useState<ARLocation[]>([]);
  const [routeTotalDistance, setRouteTotalDistance] = useState(0);
  const [deviationDistance, setDeviationDistance] = useState<number | null>(null);
  /** 開始導航後由 OSRM 步行路網或備援路網填入；preview 模式為 null */
  const [footNavigationSteps, setFootNavigationSteps] = useState<NavigationStep[] | null>(null);

  const ds = useDataSource();
  const geo = useGeolocation({
    enableHighAccuracy: true,
    distanceInterval: 2,
    timeInterval: 1000,
    autoStart: false,
  });
  const headingSmootherRef = useRef(new HeadingSmoother(15));
  const magnetometerSubscription = useRef<any>(null);
  const accelerometerSubscription = useRef<any>(null);
  const lastRecalcAtRef = useRef<number | null>(null);

  const pulseAnim = useState(new Animated.Value(1))[0];
  const arrowRotation = useState(new Animated.Value(0))[0];

  const hasPermission = permission?.granted ?? false;
  const hasLiveLocation = typeof geo.latitude === 'number' && typeof geo.longitude === 'number';

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  useEffect(() => {
    let active = true;
    const loadTarget = async () => {
      setRouteError(null);
      setRoutePoints([]);
      setRouteTotalDistance(0);
      setDeviationDistance(null);
      setFootNavigationSteps(null);
      if (typeof destinationLat === 'number' && typeof destinationLng === 'number') {
        setTarget({
          id: destinationId,
          name: destination,
          lat: destinationLat,
          lng: destinationLng,
        });
        return;
      }
      if (!destinationId) {
        setRouteError('缺少目的地座標，請從地點詳情頁啟動 AR 導航。');
        return;
      }
      setLoadingTarget(true);
      try {
        const poi = await ds.getPoi(destinationId);
        if (!active) return;
        if (poi && typeof poi.lat === 'number' && typeof poi.lng === 'number') {
          setTarget({ id: poi.id, name: poi.name ?? destination, lat: poi.lat, lng: poi.lng });
        } else {
          setRouteError('此地點尚未有可用座標，請先使用一般導航。');
        }
      } catch {
        if (active) setRouteError('讀取目的地失敗，請稍後再試。');
      } finally {
        if (active) setLoadingTarget(false);
      }
    };
    loadTarget();
    return () => {
      active = false;
    };
  }, [destination, destinationId, destinationLat, destinationLng, ds]);

  useEffect(() => {
    if (mode === 'navigating') {
      geo.startWatching();
      Magnetometer.setUpdateInterval(100);
      magnetometerSubscription.current = Magnetometer.addListener((data) => {
        let heading = Math.atan2(data.y, data.x) * (180 / Math.PI);
        if (heading < 0) heading += 360;

        const smoothedHeading = headingSmootherRef.current.addReading(heading);
        setCompassHeading(smoothedHeading);

        Animated.spring(arrowRotation, {
          toValue: smoothedHeading,
          useNativeDriver: true,
          tension: 40,
          friction: 8,
        }).start();
      });

      Accelerometer.setUpdateInterval(200);
      accelerometerSubscription.current = Accelerometer.addListener((data) => {
        const pitch =
          Math.atan2(data.y, Math.sqrt(data.x * data.x + data.z * data.z)) * (180 / Math.PI);
        setDevicePitch(pitch);
      });

      return () => {
        geo.stopWatching();
        magnetometerSubscription.current?.remove();
        accelerometerSubscription.current?.remove();
        headingSmootherRef.current.reset();
      };
    }
  }, [geo, mode]);

  const announceVoiceGuidance = useCallback(
    (text: string) => {
      if (!voiceGuidanceEnabled || text === lastVoiceAnnouncement) return;
      setLastVoiceAnnouncement(text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [voiceGuidanceEnabled, lastVoiceAnnouncement],
  );

  const currentLocation = useMemo<ARLocation | null>(() => {
    if (!hasLiveLocation) return null;
    return { latitude: geo.latitude!, longitude: geo.longitude! };
  }, [geo.latitude, geo.longitude, hasLiveLocation]);

  const targetLocation = useMemo<ARLocation | null>(() => {
    if (!target) return null;
    return { latitude: target.lat, longitude: target.lng };
  }, [target]);

  const routeProgress = useMemo(() => {
    if (!currentLocation || routePoints.length < 2) return null;
    return getRouteProgress(currentLocation, routePoints);
  }, [currentLocation, routePoints]);

  const bearingToTarget = useMemo(() => {
    if (!currentLocation) return null;
    if (routeProgress) {
      return calculateBearing(routeProgress.snappedLocation, routeProgress.nextTarget);
    }
    if (!targetLocation) return null;
    return calculateBearing(currentLocation, targetLocation);
  }, [currentLocation, routeProgress, targetLocation]);

  const liveDirection = useMemo<DirectionType>(() => {
    if (distanceRemaining <= ARRIVAL_THRESHOLD_M) return 'destination';
    if (bearingToTarget === null) return 'straight';
    return getDirectionType(calculateRelativeAngle(bearingToTarget, compassHeading));
  }, [bearingToTarget, compassHeading, distanceRemaining]);

  const previewNavigationSteps = useMemo<NavigationStep[]>(() => {
    if (!target) return FALLBACK_STEPS;
    return [{
      id: 'preview',
      instruction: '開始時才會向步行路網供應商確認路線，尚未產生轉彎指示。',
      distance: 0,
      direction: 'straight',
    }];
  }, [target]);

  const generatedSteps =
    footNavigationSteps && footNavigationSteps.length > 0
      ? footNavigationSteps
      : previewNavigationSteps;

  const currentInstruction = useMemo(() => {
    if (mode !== 'navigating') return generatedSteps[currentStep] ?? generatedSteps[0];
    return {
      id: 'live',
      instruction:
        liveDirection === 'destination'
          ? `抵達${target?.name ?? destination}`
          : getDirectionInstruction(liveDirection, Math.max(distanceRemaining, 0), target?.name),
      distance: Math.max(distanceRemaining, 0),
      direction:
        liveDirection === 'left' ||
        liveDirection === 'right' ||
        liveDirection === 'destination' ||
        liveDirection === 'straight'
          ? liveDirection
          : 'straight',
      landmark: target?.name,
    } as NavigationStep;
  }, [
    currentStep,
    destination,
    distanceRemaining,
    liveDirection,
    mode,
    target?.name,
    generatedSteps,
  ]);

  useEffect(() => {
    if (mode !== 'navigating' || !currentLocation) return;
    if (routeProgress) {
      setDistanceRemaining(Math.round(routeProgress.remainingDistance));
      setDeviationDistance(routeProgress.deviationDistance);
      return;
    }
    if (targetLocation) {
      const liveDistance = Math.round(calculateDistance(currentLocation, targetLocation));
      setDistanceRemaining(liveDistance);
      setDeviationDistance(null);
    }
  }, [currentLocation, mode, routeProgress, targetLocation]);

  useEffect(() => {
    if (mode === 'navigating' && distanceRemaining <= ARRIVAL_THRESHOLD_M && hasLiveLocation) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMode('arrived');
    }
  }, [distanceRemaining, hasLiveLocation, mode]);

  useEffect(() => {
    if (mode !== 'navigating') return;
    const guidance = generateVoiceGuidance(
      {
        id: currentInstruction.id,
        instruction: currentInstruction.instruction,
        distance: currentInstruction.distance,
        direction: currentInstruction.direction as any,
        bearing: bearingToTarget ?? 0,
      },
      distanceRemaining,
      {
        enabled: voiceGuidanceEnabled,
        language: 'zh-TW',
        rate: 1,
        pitch: 1,
        announceDistance: [50, 20, 10, 5],
      },
    );

    if (guidance) {
      announceVoiceGuidance(guidance);
    }
  }, [
    announceVoiceGuidance,
    bearingToTarget,
    currentInstruction,
    distanceRemaining,
    mode,
    voiceGuidanceEnabled,
  ]);

  useEffect(() => {
    if (mode !== 'navigating' || !routeProgress || !target) return;
    if (routeProgress.deviationDistance < ROUTE_RECALC_THRESHOLD_M) return;
    const now = Date.now();
    if (lastRecalcAtRef.current && now - lastRecalcAtRef.current < ROUTE_RECALC_INTERVAL_MS) return;
    lastRecalcAtRef.current = now;
    let cancelled = false;
    const snapped = routeProgress.snappedLocation;
    void (async () => {
      try {
        const built = await buildARNavigationRoute({
          start: snapped,
          destination: { lat: target.lat, lng: target.lng, name: target.name },
        });
        if (cancelled) return;
        if (!built) throw new Error('No usable walking route');
        setRoutePoints(built.points);
        setRouteTotalDistance(built.distance);
        setDistanceRemaining(Math.round(built.distance));
        setFootNavigationSteps(built.steps);
      } catch {
        if (cancelled) return;
        setRouteError('離開原路線後無法重新確認步行路線，已停止 AR 指示。請改用一般地圖。');
        setRoutePoints([]);
        setFootNavigationSteps(null);
        setMode('preview');
      }
    })();
    return () => { cancelled = true; };
  }, [mode, routeProgress, target]);

  const totalDistance = useMemo(() => {
    return Math.max(routeTotalDistance, distanceRemaining, 1);
  }, [distanceRemaining, routeTotalDistance]);

  const progress = useMemo(() => {
    if (!hasLiveLocation || totalDistance <= 0) return 0;
    const done = Math.max(totalDistance - distanceRemaining, 0);
    return Math.min(done / totalDistance, 1);
  }, [distanceRemaining, hasLiveLocation, totalDistance]);

  const handleRequestPermission = async () => {
    const result = await requestPermission();
    if (result.granted) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleStartNavigation = async () => {
    if (!target || loadingTarget || routing) {
      Alert.alert('無法開始導航', routeError ?? '目的地資料尚未準備好');
      return;
    }

    if (!hasPermission) {
      const response = await requestPermission();
      if (!response.granted) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    const hasLocationPermission = await geo.requestPermission();
    if (!hasLocationPermission) {
      Alert.alert('需要位置權限', '請授權位置權限以使用 AR 導航。');
      return;
    }
    const position = await geo.getCurrentPosition();

    if (!position || !target) {
      Alert.alert('無法取得位置', '請確認 GPS 已開啟後再試一次。');
      return;
    }

    const startLocation: ARLocation = {
      latitude: position.latitude!,
      longitude: position.longitude!,
    };

    setRouting(true);
    setRouteError(null);
    try {
      const built = await buildARNavigationRoute({
        start: startLocation,
        destination: { lat: target.lat, lng: target.lng, name: target.name },
      });
      if (!built) {
        const message = '目前無法取得可信的步行路網路線，請改用一般地圖確認路徑。';
        setRouteError(message);
        Alert.alert('尚無可用步行路線', message);
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setRoutePoints(built.points);
      setRouteTotalDistance(built.distance);
      setFootNavigationSteps(built.steps);
      setDistanceRemaining(Math.round(built.distance));
      setMode('navigating');
      setCurrentStep(0);
      setLastVoiceAnnouncement('');
    } catch {
      const message = '步行路網查詢失敗，請檢查連線並改用一般地圖。';
      setRouteError(message);
      Alert.alert('無法開始導航', message);
    } finally {
      setRouting(false);
    }
  };

  const handleCameraReady = () => {
    setIsCameraReady(true);
  };

  const handleEndNavigation = () => {
    Alert.alert('結束導航', '確定要結束目前的導航嗎？', [
      { text: '取消', style: 'cancel' },
      {
        text: '結束',
        onPress: () => {
          setFootNavigationSteps(null);
          setMode('preview');
        },
      },
    ]);
  };

  if (mode === 'arrived') {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Animated.View
            style={{
              width: 120,
              height: 120,
              borderRadius: 60,
              backgroundColor: `${theme.colors.success}20`,
              alignItems: 'center',
              justifyContent: 'center',
              transform: [{ scale: pulseAnim }],
            }}
          >
            <Ionicons name="checkmark-circle" size={80} color={theme.colors.success} />
          </Animated.View>
          <Text
            style={{
              color: theme.colors.text,
              fontWeight: '700',
              fontSize: 28,
              marginTop: 24,
              textAlign: 'center',
            }}
          >
            抵達目的地！
          </Text>
          <Text
            style={{ color: theme.colors.muted, fontSize: 16, marginTop: 12, textAlign: 'center' }}
          >
            {target?.name ?? destination}
          </Text>
          <View style={{ marginTop: 32, gap: 12, width: '100%' }}>
            <Button text="完成" kind="primary" onPress={() => nav?.goBack?.()} />
            <Button
              text="再導航一次"
              onPress={() => {
                setFootNavigationSteps(null);
                setMode('preview');
              }}
            />
          </View>
        </View>
      </Screen>
    );
  }

  if (mode === 'navigating') {
    const currentStepDir = generatedSteps[currentStep]?.direction ?? 'straight';
    const relativeAngle = calculateRelativeAngle(
      bearingToTarget ?? (currentStepDir === 'right' ? 90 : currentStepDir === 'left' ? -90 : 0),
      compassHeading,
    );

    return (
      <Screen>
        <View style={{ flex: 1 }}>
          <View
            style={{
              flex: 1,
              backgroundColor: '#000000',
              borderRadius: theme.radius.lg,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {hasPermission ? (
              <CameraView
                style={StyleSheet.absoluteFillObject}
                facing="back"
                onCameraReady={handleCameraReady}
              />
            ) : (
              <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000000' }]} />
            )}

            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  width: 200,
                  height: 200,
                  borderRadius: 100,
                  borderWidth: 3,
                  borderColor: `${theme.colors.accent}40`,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(0,0,0,0.3)',
                }}
              >
                <View
                  style={{
                    width: 150,
                    height: 150,
                    borderRadius: 75,
                    borderWidth: 2,
                    borderColor: `${theme.colors.accent}60`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Animated.View
                    style={{
                      transform: [{ scale: pulseAnim }, { rotate: `${relativeAngle}deg` }],
                    }}
                  >
                    <Ionicons
                      name={getDirectionIcon(currentInstruction.direction) as any}
                      size={80}
                      color={getDirectionColor(currentInstruction.direction)}
                    />
                  </Animated.View>
                </View>
              </View>

              <View
                style={{
                  position: 'absolute',
                  bottom: 20,
                  left: 20,
                  right: 20,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                }}
              >
                {[0, 1, 2, 3, 4].map((i) => (
                  <View
                    key={i}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: `${theme.colors.accent}${40 + i * 15}`,
                    }}
                  />
                ))}
              </View>
            </View>

            <View style={{ position: 'absolute', top: 16, left: 16, right: 16 }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 12,
                  borderRadius: theme.radius.md,
                  backgroundColor: 'rgba(0,0,0,0.6)',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="navigate" size={18} color={theme.colors.accent} />
                  <Text style={{ color: '#fff', fontWeight: '700' }}>{distanceRemaining}m</Text>
                </View>
                <Pressable
                  onPress={() => setVoiceGuidanceEnabled(!voiceGuidanceEnabled)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                >
                  <Ionicons
                    name={voiceGuidanceEnabled ? 'volume-high' : 'volume-mute'}
                    size={18}
                    color={voiceGuidanceEnabled ? theme.colors.success : theme.colors.muted}
                  />
                </Pressable>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                  精度 {geo.accuracy ? `${Math.round(geo.accuracy)}m` : '--'}
                </Text>
                <Pressable onPress={handleEndNavigation}>
                  <Ionicons name="close-circle" size={24} color={theme.colors.danger} />
                </Pressable>
              </View>
              {deviationDistance !== null && (
                <View
                  style={{
                    marginTop: 8,
                    padding: 8,
                    borderRadius: theme.radius.md,
                    backgroundColor: 'rgba(0,0,0,0.45)',
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 12 }}>
                    路線偏移：{Math.round(deviationDistance)}m（已啟用路網吸附）
                  </Text>
                </View>
              )}
              {geo.accuracy !== null && geo.accuracy > WARN_ACCURACY_M && (
                <View
                  style={{
                    marginTop: 8,
                    padding: 10,
                    borderRadius: theme.radius.md,
                    backgroundColor: 'rgba(255,149,0,0.2)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,149,0,0.4)',
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 12 }}>
                    定位精度偏低，建議移動到空曠處；若超過 {LOW_ACCURACY_M}m，請改用一般地圖導航。
                  </Text>
                </View>
              )}
            </View>

            {!isCameraReady && hasPermission && (
              <View style={{ position: 'absolute', top: '40%', left: 16, right: 16 }}>
                <Text style={{ color: '#fff', fontSize: 13, textAlign: 'center', opacity: 0.7 }}>
                  正在啟動相機...
                </Text>
              </View>
            )}

            <View style={{ position: 'absolute', bottom: 100, left: 16, right: 16 }}>
              <View
                style={{
                  padding: 12,
                  borderRadius: theme.radius.md,
                  backgroundColor: 'rgba(0,0,0,0.7)',
                }}
              >
                <Text style={{ color: '#fff', fontSize: 11, textAlign: 'center' }}>
                  羅盤方位: {Math.round(compassHeading)}° | 傾斜: {Math.round(devicePitch)}° | 追蹤:{' '}
                  {hasLiveLocation ? '即時定位' : '等待定位'}
                </Text>
              </View>
            </View>
          </View>

          <View style={{ padding: 16, gap: 12 }}>
            <View
              style={{
                padding: 16,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface2,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View
                  style={{
                    width: 50,
                    height: 50,
                    borderRadius: 25,
                    backgroundColor: `${getDirectionColor(currentInstruction.direction)}20`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons
                    name={getDirectionIcon(currentInstruction.direction) as any}
                    size={28}
                    color={getDirectionColor(currentInstruction.direction)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 18 }}>
                    {currentInstruction.instruction}
                  </Text>
                  {currentInstruction.landmark && (
                    <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 4 }}>
                      {currentInstruction.landmark}
                    </Text>
                  )}
                </View>
              </View>

              <View style={{ marginTop: 14 }}>
                <View
                  style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}
                >
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>導航進度</Text>
                  <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '700' }}>
                    {Math.round(progress * 100)}%
                  </Text>
                </View>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.border }}>
                  <View
                    style={{
                      width: `${progress * 100}%`,
                      height: '100%',
                      borderRadius: 3,
                      backgroundColor: theme.colors.accent,
                    }}
                  />
                </View>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => geo.getCurrentPosition()}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface2,
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Text style={{ color: theme.colors.text, fontWeight: '700' }}>重新定位</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  if (!target) return;
                  const url =
                    Platform.OS === 'android'
                      ? `geo:${target.lat},${target.lng}?q=${target.lat},${target.lng}(${encodeURIComponent(target.name)})`
                      : `https://www.google.com/maps/search/?api=1&query=${target.lat},${target.lng}`;
                  try {
                    const ok = await linkingOpenWithPuTronClassGate(url);
                    if (!ok) Alert.alert('無法開啟地圖', '請稍後再試。');
                  } catch {
                    Alert.alert('無法開啟地圖', '請稍後再試。');
                  }
                }}
                style={{
                  flex: 2,
                  paddingVertical: 14,
                  borderRadius: theme.radius.md,
                  backgroundColor: `${theme.colors.accent}20`,
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: `${theme.colors.accent}40`,
                }}
              >
                <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>改用一般地圖</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flex: 1, gap: 12 }}>
        <AnimatedCard title="AR 實景導航" subtitle={`前往：${target?.name ?? destination}`}>
          <View style={{ alignItems: 'center', padding: 20 }}>
            <View
              style={{
                width: 100,
                height: 100,
                borderRadius: 50,
                backgroundColor: theme.colors.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <Ionicons name="camera" size={50} color={theme.colors.accent} />
            </View>
            <Text
              style={{
                color: theme.colors.text,
                fontWeight: '700',
                fontSize: 16,
                textAlign: 'center',
              }}
            >
              透過相機畫面顯示導航指示
            </Text>
            <Text
              style={{
                color: theme.colors.muted,
                fontSize: 13,
                textAlign: 'center',
                marginTop: 8,
                lineHeight: 20,
              }}
            >
              AR 導航會以即時 GPS 與感測器資料更新方向；精度不足時可立即切換一般地圖。
            </Text>
          </View>

          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: theme.colors.accent, fontWeight: '700', fontSize: 24 }}>
                  {target ? target.lat.toFixed(4) : '--'}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>目標緯度</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: theme.colors.success, fontWeight: '700', fontSize: 24 }}>
                  {target ? target.lng.toFixed(4) : '--'}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>目標經度</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Pill
                  text={loadingTarget || routing ? '確認路線中' : routeError ? '待修正' : routePoints.length >= 2 ? '路線已取得' : '尚未查詢'}
                  kind={loadingTarget || routing ? 'muted' : routeError ? 'danger' : routePoints.length >= 2 ? 'success' : 'muted'}
                />
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>路線狀態</Text>
              </View>
            </View>

            {routeError && (
              <View
                style={{
                  padding: 10,
                  borderRadius: theme.radius.md,
                  backgroundColor: `${theme.colors.danger}15`,
                }}
              >
                <Text style={{ color: theme.colors.danger, fontSize: 12 }}>{routeError}</Text>
              </View>
            )}
            {!routeError && routePoints.length >= 2 && (
              <View
                style={{
                  padding: 10,
                  borderRadius: theme.radius.md,
                  backgroundColor: `${theme.colors.success}15`,
                }}
              >
                <Text style={{ color: theme.colors.success, fontSize: 12 }}>
                  已取得步行路網估算：{routePoints.length} 個路線座標，約 {Math.round(routeTotalDistance)}m（仍以現場為準）
                </Text>
              </View>
            )}

            <Button
              text={routing ? '正在查詢步行路線…' : hasPermission ? '查詢路線並開始 AR 導航' : '授權相機並查詢路線'}
              kind="primary"
              onPress={handleStartNavigation}
              disabled={!target || loadingTarget || routing}
            />
          </View>
        </AnimatedCard>

        <AnimatedCard
          title="導航路線預覽"
          subtitle={
            !target ? '請先選擇目的地' : '須取得步行路網資料，才會提供轉彎指示'
          }
          delay={100}
        >
          <View style={{ gap: 8 }}>
            {(!target ? FALLBACK_STEPS : generatedSteps).map((step, idx) => (
              <View
                key={step.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: 12,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface2,
                  gap: 12,
                }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: `${getDirectionColor(step.direction)}20`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons
                    name={getDirectionIcon(step.direction) as any}
                    size={18}
                    color={getDirectionColor(step.direction)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                    {step.instruction}
                  </Text>
                  {step.landmark && (
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                      {step.landmark}
                    </Text>
                  )}
                </View>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{idx + 1}</Text>
              </View>
            ))}
          </View>
        </AnimatedCard>

        <AnimatedCard title="導航技術" subtitle="公開步行路網 + 裝置感測器" delay={200}>
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name="git-network-outline" size={20} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.muted, flex: 1, lineHeight: 20 }}>
                步行路網由第三方供應商查詢，失敗時不會生成示意路線
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name="videocam-outline" size={20} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.muted, flex: 1, lineHeight: 20 }}>
                相機即時 AR 方向箭頭與距離疊加
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name="compass-outline" size={20} color={theme.colors.success} />
              <Text style={{ color: theme.colors.muted, flex: 1, lineHeight: 20 }}>
                磁力計 + 加速計感測器融合，平滑方位
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name="locate-outline" size={20} color={theme.colors.success} />
              <Text style={{ color: theme.colors.muted, flex: 1, lineHeight: 20 }}>
                路線偏移偵測 + 自動重新規劃路徑
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name="accessibility-outline" size={20} color={theme.colors.info} />
              <Text style={{ color: theme.colors.muted, flex: 1, lineHeight: 20 }}>
                觸覺回饋 + 語音提示 + 角度轉彎偵測
              </Text>
            </View>
          </View>
        </AnimatedCard>
      </View>
    </Screen>
  );
}
