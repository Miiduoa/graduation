/**
 * 智慧路線規劃服務 — 免費方案 + AI 動態改道
 *
 * 地點搜尋：OSM Nominatim（免費，無需 API Key）
 * 路線引擎：routing.openstreetmap.de（支援步行 / 騎車 / 開車）
 * 大眾運輸：TDX + OSRM 組合
 * 智慧導航：AI 即時路線優化 + 塞車偵測 + 自動改道建議
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getBusStopsOfRoute,
  getBusEstimates,
  type TDXBusEstimate,
  type TDXBusStopOfRoute,
} from './tdxApi';

// ─── 座標類型 ────────────────────────────────────────────

export type LatLng = {
  lat: number;
  lng: number;
};

// ─── 共用 fetch 工具 ────────────────────────────────────

/**
 * 帶超時的 fetch — 不使用 AbortController（避免 RN 兼容問題）
 * 改用 Promise.race + timeout
 */
async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<any> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), timeoutMs),
  );
  const fetchPromise = fetch(url, {
    headers: { Accept: 'application/json' },
  }).then(async (resp) => {
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  });
  return Promise.race([fetchPromise, timeoutPromise]);
}

// ─── 地點搜尋 (OSM Nominatim) ───────────────────────────

export type SearchResult = {
  placeId: string;
  displayName: string;
  shortName: string;
  lat: number;
  lng: number;
  type: string;
  importance: number;
};

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const SEARCH_CACHE_PREFIX = '@geo_cache:';

/**
 * 搜尋地點（支援中英文，台灣優先）
 */
export async function searchPlaces(query: string, near?: LatLng): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  const cacheKey = `${SEARCH_CACHE_PREFIX}${query.trim().toLowerCase()}`;
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed._ts && Date.now() - parsed._ts < 3600000) {
        return parsed.data;
      }
    }
  } catch {}

  const params = new URLSearchParams({
    q: query.trim(),
    format: 'json',
    addressdetails: '1',
    limit: '10',
    countrycodes: 'tw',
    'accept-language': 'zh-TW,zh,en',
  });

  if (near) {
    const delta = 0.15;
    params.set(
      'viewbox',
      `${near.lng - delta},${near.lat - delta},${near.lng + delta},${near.lat + delta}`,
    );
    params.set('bounded', '0');
  }

  try {
    const data = await fetchWithTimeout(`${NOMINATIM_BASE}/search?${params.toString()}`);

    const results: SearchResult[] = data.map((item: any) => ({
      placeId: String(item.place_id),
      displayName: item.display_name,
      shortName: extractShortName(item),
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      type: item.type || item.class || '',
      importance: item.importance || 0,
    }));

    AsyncStorage.setItem(cacheKey, JSON.stringify({ data: results, _ts: Date.now() })).catch(
      () => {},
    );
    return results;
  } catch {
    return [];
  }
}

function extractShortName(item: any): string {
  const addr = item.address || {};
  const name = item.name || addr.amenity || addr.building || addr.shop || addr.tourism || '';
  if (name) return name;
  const road = addr.road || '';
  const district = addr.suburb || addr.city_district || addr.town || addr.city || '';
  if (road && district) return `${road}, ${district}`;
  if (road) return road;
  return item.display_name?.split(',')[0] || '';
}

/**
 * 反向地理編碼（座標 → 地址）
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const data = await fetchWithTimeout(
      `${NOMINATIM_BASE}/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=zh-TW,zh&zoom=18`,
      8000,
    );
    return (
      data.display_name?.split(',').slice(0, 3).join(',') || `${lat.toFixed(4)}, ${lng.toFixed(4)}`
    );
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

// ─── 路線規劃 (OSRM — routing.openstreetmap.de) ────────

/**
 * OSRM 公共伺服器配置
 *
 * ⚠️ router.project-osrm.org 只載入 driving profile，
 *    即使 URL 用 /foot/ 或 /bike/ 也會回傳「開車速度」的結果！
 *
 * 正確方案：
 *   - 步行 / 騎車 → routing.openstreetmap.de 為主（獨立伺服器，時間正確）
 *   - 開車        → router.project-osrm.org 為主（速度快、穩定）
 */
const OSRM_DE: Record<string, string> = {
  foot: 'https://routing.openstreetmap.de/routed-foot',
  bike: 'https://routing.openstreetmap.de/routed-bike',
  car: 'https://routing.openstreetmap.de/routed-car',
};
const OSRM_PROJECT = 'https://router.project-osrm.org';

export type RouteStep = {
  instruction: string;
  distance: number;
  duration: number;
  maneuver: string;
  name: string;
  coordinates: [number, number][];
};

export type RouteOption = {
  id: string;
  mode: 'walking' | 'cycling' | 'transit' | 'driving';
  modeLabel: string;
  totalDistance: number;
  totalDuration: number;
  summary: string;
  steps: RouteStep[];
  routeGeometry: [number, number][];
  transitDetails?: TransitDetail[];
  /** 路線查詢時間戳，用於智慧導航判斷是否需要重新規劃 */
  queriedAt?: number;
  /** 預估擁擠程度 0~1 (AI 計算) */
  congestionScore?: number;
};

export type TransitDetail = {
  type: 'walk' | 'bus' | 'train';
  routeName?: string;
  routeId?: string;
  fromStop?: string;
  toStop?: string;
  departureTime?: string;
  estimateMinutes?: number;
  walkDistance?: number;
  steps?: RouteStep[];
  coordinates?: [number, number][];
};

/**
 * OSRM 路線查詢 — 支援步行 / 騎車 / 開車
 * 使用主站 router.project-osrm.org + 備用站 routing.openstreetmap.de
 */
async function osrmRoute(
  from: LatLng,
  to: LatLng,
  profile: 'foot' | 'bike' | 'car',
): Promise<{
  distance: number;
  duration: number;
  steps: RouteStep[];
  geometry: [number, number][];
} | null> {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const qs = 'overview=full&geometries=geojson&steps=true';

  // routing.openstreetmap.de 各伺服器只載入一種 profile，URL 一律用 /driving/
  // router.project-osrm.org 只載入 driving，URL 也用 /driving/
  const urls: string[] =
    profile === 'car'
      ? [
          // 開車：project-osrm 為主，routing.openstreetmap.de 為備
          `${OSRM_PROJECT}/route/v1/driving/${coords}?${qs}`,
          `${OSRM_DE.car}/route/v1/driving/${coords}?${qs}`,
        ]
      : [
          // 步行 / 騎車：routing.openstreetmap.de 為主（時間正確）
          `${OSRM_DE[profile]}/route/v1/driving/${coords}?${qs}`,
          // project-osrm 做為最後備援（注意：回傳的是開車速度！）
          `${OSRM_PROJECT}/route/v1/driving/${coords}?${qs}`,
        ];

  for (const url of urls) {
    try {
      console.log(`[OSRM] ${profile}: ${url.substring(0, 90)}...`);
      const data = await fetchWithTimeout(url);

      if (data.code !== 'Ok' || !data.routes?.length) {
        console.warn(`[OSRM] ${profile} code=${data.code}`);
        continue;
      }

      const route = data.routes[0];
      const geometry: [number, number][] = route.geometry?.coordinates ?? [];

      const steps: RouteStep[] = [];
      for (const leg of route.legs ?? []) {
        for (const step of leg.steps ?? []) {
          steps.push({
            instruction: buildInstruction(step, profile),
            distance: step.distance ?? 0,
            duration: step.duration ?? 0,
            maneuver: step.maneuver?.type ?? '',
            name: step.name ?? '',
            coordinates: step.geometry?.coordinates ?? [],
          });
        }
      }

      console.log(`[OSRM] ${profile} OK — ${route.distance}m, ${steps.length} steps`);
      return { distance: route.distance ?? 0, duration: route.duration ?? 0, steps, geometry };
    } catch (err: any) {
      console.warn(`[OSRM] ${profile} error: ${err?.message ?? err}`);
      continue;
    }
  }

  console.warn(`[OSRM] ${profile} ALL servers failed`);
  return null;
}

/**
 * 僅查詢 OSM 步行路網（routing.openstreetmap.de foot profile）。
 * 供校園 AR 導航等需要「真實人行道／步道」幾何時使用；失敗時由上層改走本地路網備援。
 */
export async function getFootRoute(
  from: LatLng,
  to: LatLng,
): Promise<{
  distance: number;
  duration: number;
  steps: RouteStep[];
  geometry: [number, number][];
} | null> {
  return osrmRoute(from, to, 'foot');
}

function buildInstruction(step: any, profile: 'foot' | 'bike' | 'car' = 'car'): string {
  const maneuver = step.maneuver?.type ?? '';
  const modifier = step.maneuver?.modifier ?? '';
  const name = step.name || '道路';
  const verb = profile === 'foot' ? '走' : profile === 'bike' ? '騎' : '開';

  const directionMap: Record<string, string> = {
    left: '左轉',
    right: '右轉',
    'slight left': '稍微左轉',
    'slight right': '稍微右轉',
    'sharp left': '急轉左',
    'sharp right': '急轉右',
    straight: '直走',
    uturn: '迴轉',
  };

  switch (maneuver) {
    case 'depart':
      return `從 ${name} 出發`;
    case 'arrive':
      return `到達目的地`;
    case 'turn':
    case 'end of road':
    case 'fork':
      return `${directionMap[modifier] || modifier} 進入 ${name}`;
    case 'new name':
      return `繼續${verb} ${name}`;
    case 'merge':
      return `匯入 ${name}`;
    case 'roundabout':
      return `進入圓環，${verb} ${name}`;
    case 'rotary':
      return `進入圓環`;
    default:
      if (modifier && directionMap[modifier]) return `${directionMap[modifier]} ${name}`;
      return `沿 ${name} 繼續`;
  }
}

// ─── 多模式路線規劃 ─────────────────────────────────────

/**
 * 規劃多種交通方式的路線（步行 / 騎車 / 開車 / 大眾運輸）
 */
export async function planRoutes(from: LatLng, to: LatLng): Promise<RouteOption[]> {
  const results: RouteOption[] = [];
  const now = Date.now();

  console.log(
    `[Route] Planning from (${from.lat.toFixed(4)},${from.lng.toFixed(4)}) to (${to.lat.toFixed(4)},${to.lng.toFixed(4)})`,
  );

  // 同時查詢四種交通方式
  const [walkResult, bikeResult, driveResult, transitResult] = await Promise.allSettled([
    osrmRoute(from, to, 'foot'),
    osrmRoute(from, to, 'bike'),
    osrmRoute(from, to, 'car'),
    planTransitRoute(from, to),
  ]);

  console.log(
    `[Route] Results — walk:${walkResult.status === 'fulfilled' && walkResult.value ? 'OK' : 'FAIL'} bike:${bikeResult.status === 'fulfilled' && bikeResult.value ? 'OK' : 'FAIL'} drive:${driveResult.status === 'fulfilled' && driveResult.value ? 'OK' : 'FAIL'} transit:${transitResult.status === 'fulfilled' && transitResult.value ? 'OK' : 'FAIL'}`,
  );

  // 開車方案
  if (driveResult.status === 'fulfilled' && driveResult.value) {
    const r = driveResult.value;
    const congestion = estimateCongestion(r.duration, r.distance);
    const adjustedDuration = Math.round(r.duration * (1 + congestion * 0.5));
    results.push({
      id: 'drive',
      mode: 'driving',
      modeLabel: '開車',
      totalDistance: r.distance,
      totalDuration: adjustedDuration,
      summary: `開車 ${formatDistance(r.distance)}，約 ${formatDuration(adjustedDuration)}${congestion > 0.3 ? ' ⚠️ 可能壅塞' : ''}`,
      steps: r.steps,
      routeGeometry: r.geometry,
      queriedAt: now,
      congestionScore: congestion,
    });
  }

  // 騎車方案
  if (bikeResult.status === 'fulfilled' && bikeResult.value) {
    const r = bikeResult.value;
    results.push({
      id: 'bike',
      mode: 'cycling',
      modeLabel: '騎車',
      totalDistance: r.distance,
      totalDuration: r.duration,
      summary: `騎車 ${formatDistance(r.distance)}，約 ${formatDuration(r.duration)}`,
      steps: r.steps,
      routeGeometry: r.geometry,
      queriedAt: now,
    });
  }

  // 步行方案
  if (walkResult.status === 'fulfilled' && walkResult.value) {
    const r = walkResult.value;
    results.push({
      id: 'walk',
      mode: 'walking',
      modeLabel: '步行',
      totalDistance: r.distance,
      totalDuration: r.duration,
      summary: `步行 ${formatDistance(r.distance)}，約 ${formatDuration(r.duration)}`,
      steps: r.steps,
      routeGeometry: r.geometry,
      queriedAt: now,
    });
  }

  // 大眾運輸方案
  if (transitResult.status === 'fulfilled' && transitResult.value) {
    results.push({ ...transitResult.value, queriedAt: now });
  }

  // 依時間排序
  results.sort((a, b) => a.totalDuration - b.totalDuration);
  return results;
}

// ─── AI 智慧導航引擎 ───────────────────────────────────

export type RerouteResult = {
  shouldReroute: boolean;
  reason: string;
  newRoute?: RouteOption;
  timeSaved?: number; // 秒
};

/**
 * 基於時間的擁擠度估算 (AI 啟發式)
 * 考慮：時段、平均速度、距離
 */
function estimateCongestion(durationSec: number, distanceM: number): number {
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay(); // 0=Sun

  // 平均速度 (km/h)
  const avgSpeed = distanceM / 1000 / (durationSec / 3600);

  // 時段擁擠權重
  let timeFactor = 0;
  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    // 平日
    if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
      timeFactor = 0.7; // 尖峰
    } else if (hour >= 11 && hour <= 13) {
      timeFactor = 0.3; // 午間
    } else if (hour >= 22 || hour < 6) {
      timeFactor = 0.0; // 深夜
    } else {
      timeFactor = 0.15; // 離峰
    }
  } else {
    // 週末
    if (hour >= 10 && hour <= 18) {
      timeFactor = 0.35;
    } else {
      timeFactor = 0.1;
    }
  }

  // 速度過低 → 可能塞車
  const speedFactor = avgSpeed < 20 ? 0.5 : avgSpeed < 35 ? 0.2 : 0;

  return Math.min(1, timeFactor + speedFactor * 0.5);
}

/**
 * 智慧改道檢查 — 導航途中定期呼叫
 *
 * 比較當前路線 vs 重新規劃的路線：
 *   - 若新路線快 >15%（或 >3 分鐘）→ 建議改道
 *   - 若偵測到使用者偏離路線 >200m → 自動重新規劃
 */
export async function checkForBetterRoute(
  currentPos: LatLng,
  destination: LatLng,
  currentRoute: RouteOption,
): Promise<RerouteResult> {
  // 1. 檢查是否偏離路線
  const deviation = findMinDistanceToRoute(currentPos, currentRoute.routeGeometry);
  if (deviation > 200) {
    // 偏離路線 → 強制重新規劃
    const newRoutes = await planRoutes(currentPos, destination);
    const sameMode = newRoutes.find((r) => r.mode === currentRoute.mode);
    if (sameMode) {
      return {
        shouldReroute: true,
        reason: '您已偏離路線，已自動重新規劃',
        newRoute: sameMode,
        timeSaved: 0,
      };
    }
    // 沒有同模式路線，用最快的
    if (newRoutes.length > 0) {
      return {
        shouldReroute: true,
        reason: '您已偏離路線，已自動重新規劃',
        newRoute: newRoutes[0],
        timeSaved: 0,
      };
    }
  }

  // 2. 定期檢查是否有更快路線（每次導航 tick 呼叫）
  const elapsed = Date.now() - (currentRoute.queriedAt ?? 0);
  if (elapsed < 45000) {
    // 距離上次查詢不到 45 秒，不重新查
    return { shouldReroute: false, reason: '' };
  }

  try {
    const freshRoute = await osrmRoute(currentPos, destination, modeToProfile(currentRoute.mode));
    if (!freshRoute) return { shouldReroute: false, reason: '' };

    // 計算剩餘路程的預估時間
    const remainingDuration = estimateRemainingDuration(currentPos, currentRoute);
    const timeSaved = remainingDuration - freshRoute.duration;
    const percentSaved = timeSaved / remainingDuration;

    if (timeSaved > 180 && percentSaved > 0.15) {
      // 新路線快 >3 分鐘 且 >15%
      const congestion =
        currentRoute.mode === 'driving'
          ? estimateCongestion(freshRoute.duration, freshRoute.distance)
          : 0;
      const adjustedDuration = Math.round(freshRoute.duration * (1 + congestion * 0.5));

      return {
        shouldReroute: true,
        reason: `發現更快路線，可節省 ${formatDuration(timeSaved)}`,
        newRoute: {
          id: currentRoute.id + '-reroute',
          mode: currentRoute.mode,
          modeLabel: currentRoute.modeLabel,
          totalDistance: freshRoute.distance,
          totalDuration: adjustedDuration,
          summary: `${currentRoute.modeLabel} ${formatDistance(freshRoute.distance)}，約 ${formatDuration(adjustedDuration)}（已優化）`,
          steps: freshRoute.steps,
          routeGeometry: freshRoute.geometry,
          queriedAt: Date.now(),
          congestionScore: congestion,
        },
        timeSaved,
      };
    }
  } catch {}

  return { shouldReroute: false, reason: '' };
}

function modeToProfile(mode: RouteOption['mode']): 'foot' | 'bike' | 'car' {
  switch (mode) {
    case 'walking':
      return 'foot';
    case 'cycling':
      return 'bike';
    default:
      return 'car';
  }
}

/**
 * 計算使用者位置到路線最近點的距離（公尺）
 */
function findMinDistanceToRoute(pos: LatLng, geometry: [number, number][]): number {
  if (geometry.length === 0) return Infinity;
  let minDist = Infinity;
  for (const coord of geometry) {
    const d = haversine(pos, { lat: coord[1], lng: coord[0] });
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * 估算從當前位置到目的地的剩餘時間
 */
function estimateRemainingDuration(pos: LatLng, route: RouteOption): number {
  // 找到路線上最接近當前位置的點
  const geom = route.routeGeometry;
  if (geom.length === 0) return route.totalDuration;

  let minDist = Infinity;
  let closestIdx = 0;
  for (let i = 0; i < geom.length; i++) {
    const d = haversine(pos, { lat: geom[i][1], lng: geom[i][0] });
    if (d < minDist) {
      minDist = d;
      closestIdx = i;
    }
  }

  // 剩餘比例 ≈ 剩餘點數 / 總點數
  const remainRatio = Math.max(0, (geom.length - closestIdx) / geom.length);
  return Math.round(route.totalDuration * remainRatio);
}

/**
 * 即時 ETA 計算（考慮當前速度 + 擁擠度）
 */
export function calculateLiveETA(
  currentPos: LatLng,
  destination: LatLng,
  route: RouteOption,
  currentSpeedMps: number | null,
): { etaSeconds: number; etaText: string; congestionLevel: 'smooth' | 'moderate' | 'heavy' } {
  const remaining = estimateRemainingDuration(currentPos, route);
  const congestion = route.congestionScore ?? 0;

  // 如果有即時速度，用來修正 ETA
  let adjusted = remaining;
  if (currentSpeedMps && currentSpeedMps > 0.5) {
    const remainDist = route.totalDistance * (remaining / route.totalDuration);
    const speedEta = remainDist / currentSpeedMps;
    // 混合：60% 即時速度推算 + 40% 原始估算
    adjusted = Math.round(speedEta * 0.6 + remaining * 0.4);
  }

  // 加上擁擠修正
  adjusted = Math.round(adjusted * (1 + congestion * 0.3));

  const level: 'smooth' | 'moderate' | 'heavy' =
    congestion > 0.5 ? 'heavy' : congestion > 0.2 ? 'moderate' : 'smooth';

  return {
    etaSeconds: adjusted,
    etaText: formatDuration(adjusted),
    congestionLevel: level,
  };
}

// ─── 大眾運輸路線規劃 ─────────────────────────────────────

async function planTransitRoute(from: LatLng, to: LatLng): Promise<RouteOption | null> {
  try {
    const commonRoutes = [
      '300',
      '301',
      '302',
      '303',
      '304',
      '305',
      '306',
      '307',
      '308',
      '309',
      '310',
    ];
    const routePromises = commonRoutes.map((id) => getBusStopsOfRoute(id).catch(() => []));
    const allRouteStops = await Promise.all(routePromises);

    let bestPlan: {
      routeId: string;
      routeName: string;
      direction: number;
      boardStop: { name: string; lat: number; lng: number; seq: number };
      alightStop: { name: string; lat: number; lng: number; seq: number };
      walkToStop: number;
      walkFromStop: number;
      stopCount: number;
    } | null = null;
    let bestScore = Infinity;

    for (const routeStops of allRouteStops) {
      for (const dirStops of routeStops) {
        const stops = dirStops.Stops ?? [];
        if (stops.length < 2) continue;

        for (const boardStop of stops) {
          const dToBoard = haversine(from, {
            lat: boardStop.StopPosition.PositionLat,
            lng: boardStop.StopPosition.PositionLon,
          });
          if (dToBoard > 1500) continue;

          for (const alightStop of stops) {
            if (alightStop.StopSequence <= boardStop.StopSequence) continue;
            const dFromAlight = haversine(
              {
                lat: alightStop.StopPosition.PositionLat,
                lng: alightStop.StopPosition.PositionLon,
              },
              to,
            );
            if (dFromAlight > 1500) continue;

            const walkTime = (dToBoard + dFromAlight) / 1.2;
            const rideTime = (alightStop.StopSequence - boardStop.StopSequence) * 120;
            const score = walkTime + rideTime;

            if (score < bestScore) {
              bestScore = score;
              bestPlan = {
                routeId: dirStops.RouteID,
                routeName: dirStops.RouteName.Zh_tw,
                direction: dirStops.Direction,
                boardStop: {
                  name: boardStop.StopName.Zh_tw,
                  lat: boardStop.StopPosition.PositionLat,
                  lng: boardStop.StopPosition.PositionLon,
                  seq: boardStop.StopSequence,
                },
                alightStop: {
                  name: alightStop.StopName.Zh_tw,
                  lat: alightStop.StopPosition.PositionLat,
                  lng: alightStop.StopPosition.PositionLon,
                  seq: alightStop.StopSequence,
                },
                walkToStop: dToBoard,
                walkFromStop: dFromAlight,
                stopCount: alightStop.StopSequence - boardStop.StopSequence,
              };
            }
          }
        }
      }
    }

    if (!bestPlan) return null;

    let etaMinutes: number | undefined;
    try {
      const estimates = await getBusEstimates(bestPlan.routeId);
      const boardEta = estimates.find(
        (e) =>
          e.StopName?.Zh_tw === bestPlan!.boardStop.name && e.Direction === bestPlan!.direction,
      );
      if (boardEta?.EstimateTime !== undefined) {
        etaMinutes = Math.ceil(boardEta.EstimateTime / 60);
      }
    } catch {}

    const [walkToStop, walkFromStop] = await Promise.all([
      osrmRoute(from, { lat: bestPlan.boardStop.lat, lng: bestPlan.boardStop.lng }, 'foot'),
      osrmRoute({ lat: bestPlan.alightStop.lat, lng: bestPlan.alightStop.lng }, to, 'foot'),
    ]);

    const transitDetails: TransitDetail[] = [];
    const allSteps: RouteStep[] = [];
    let totalGeometry: [number, number][] = [];
    let totalDuration = 0;
    let totalDistance = 0;

    if (walkToStop) {
      transitDetails.push({
        type: 'walk',
        walkDistance: walkToStop.distance,
        steps: walkToStop.steps,
        coordinates: walkToStop.geometry,
      });
      allSteps.push({
        instruction: `步行 ${formatDistance(walkToStop.distance)} 到 ${bestPlan.boardStop.name} 站`,
        distance: walkToStop.distance,
        duration: walkToStop.duration,
        maneuver: 'depart',
        name: '',
        coordinates: walkToStop.geometry,
      });
      totalGeometry = [...totalGeometry, ...walkToStop.geometry];
      totalDuration += walkToStop.duration;
      totalDistance += walkToStop.distance;
    }

    const rideTime = bestPlan.stopCount * 120;
    transitDetails.push({
      type: 'bus',
      routeName: bestPlan.routeName,
      routeId: bestPlan.routeId,
      fromStop: bestPlan.boardStop.name,
      toStop: bestPlan.alightStop.name,
      estimateMinutes: etaMinutes,
    });
    allSteps.push({
      instruction: `搭 ${bestPlan.routeName} 路公車（${bestPlan.boardStop.name} → ${bestPlan.alightStop.name}，${bestPlan.stopCount} 站）${etaMinutes !== undefined ? `，預估 ${etaMinutes} 分鐘到站` : ''}`,
      distance: 0,
      duration: rideTime,
      maneuver: 'notification',
      name: bestPlan.routeName,
      coordinates: [
        [bestPlan.boardStop.lng, bestPlan.boardStop.lat],
        [bestPlan.alightStop.lng, bestPlan.alightStop.lat],
      ],
    });
    totalGeometry.push(
      [bestPlan.boardStop.lng, bestPlan.boardStop.lat],
      [bestPlan.alightStop.lng, bestPlan.alightStop.lat],
    );
    totalDuration += rideTime + (etaMinutes ? etaMinutes * 60 : 300);
    totalDistance += bestPlan.stopCount * 800;

    if (walkFromStop) {
      transitDetails.push({
        type: 'walk',
        walkDistance: walkFromStop.distance,
        steps: walkFromStop.steps,
        coordinates: walkFromStop.geometry,
      });
      allSteps.push({
        instruction: `步行 ${formatDistance(walkFromStop.distance)} 到目的地`,
        distance: walkFromStop.distance,
        duration: walkFromStop.duration,
        maneuver: 'arrive',
        name: '',
        coordinates: walkFromStop.geometry,
      });
      totalGeometry = [...totalGeometry, ...walkFromStop.geometry];
      totalDuration += walkFromStop.duration;
      totalDistance += walkFromStop.distance;
    }

    return {
      id: `transit-${bestPlan.routeId}`,
      mode: 'transit',
      modeLabel: '大眾運輸',
      totalDistance,
      totalDuration,
      summary: `搭 ${bestPlan.routeName} 路，${bestPlan.stopCount} 站，約 ${formatDuration(totalDuration)}`,
      steps: allSteps,
      routeGeometry: totalGeometry,
      transitDetails,
    };
  } catch (err) {
    console.warn('[Routing] Transit planning failed:', err);
    return null;
  }
}

// ─── 工具函式 ────────────────────────────────────────────

export function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} 公尺`;
  return `${(meters / 1000).toFixed(1)} 公里`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return '不到 1 分鐘';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} 分鐘`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (remainMins === 0) return `${hrs} 小時`;
  return `${hrs} 小時 ${remainMins} 分`;
}

export const PU_LOCATION: LatLng = { lat: 24.226, lng: 120.563 };
