/** 地點搜尋與道路路線查詢。行程時間來自路線供應商，不代表即時路況。 */
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });
  const fetchPromise = fetch(url, {
    headers: { Accept: 'application/json' },
  }).then(async (resp) => {
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  });
  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
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
 * 供應商模式：
 *   - 步行 / 騎車 → routing.openstreetmap.de 為主（獨立模式，時間為供應商估算）
 *   - 開車        → router.project-osrm.org 為主（開車模式）
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
  /** 路線查詢時間戳 */
  queriedAt?: number;
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
          // 步行 / 騎車：routing.openstreetmap.de 為主（對應模式的供應商估算）
          `${OSRM_DE[profile]}/route/v1/driving/${coords}?${qs}`,
        ];

  for (const url of urls) {
    try {
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

      return { distance: route.distance ?? 0, duration: route.duration ?? 0, steps, geometry };
    } catch {
      console.warn(`[OSRM] ${profile} request failed`);
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
 * 查詢供應商道路路線（步行 / 騎車 / 開車）
 */
export async function planRoutes(from: LatLng, to: LatLng): Promise<RouteOption[]> {
  const results: RouteOption[] = [];
  const now = Date.now();

  // 每種交通方式僅使用符合該模式的道路資料。
  const [walkResult, bikeResult, driveResult] = await Promise.allSettled([
    osrmRoute(from, to, 'foot'),
    osrmRoute(from, to, 'bike'),
    osrmRoute(from, to, 'car'),
  ]);

  // 開車方案
  if (driveResult.status === 'fulfilled' && driveResult.value) {
    const r = driveResult.value;
    results.push({
      id: 'drive',
      mode: 'driving',
      modeLabel: '開車',
      totalDistance: r.distance,
      totalDuration: r.duration,
      summary: `開車 ${formatDistance(r.distance)}，約 ${formatDuration(r.duration)}（路線估算）`,
      steps: r.steps,
      routeGeometry: r.geometry,
      queriedAt: now,
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

  // 依時間排序
  results.sort((a, b) => a.totalDuration - b.totalDuration);
  return results;
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
