/**
 * TDX 公共運輸 API 服務層
 *
 * 交通部 TDX (Transport Data eXchange) 開放資料平台
 * https://tdx.transportdata.tw/
 *
 * 提供：
 *   1. 公車路線與站牌查詢（台中市公車）
 *   2. 公車預估到站時間
 *   3. 台鐵時刻查詢
 *   4. 高鐵時刻查詢
 *   5. YouBike 站點查詢
 *
 * 認證方式：
 *   TDX API 使用 Client Credentials (OAuth2)
 *   免費方案每日 50 次呼叫（需註冊取得 Client ID/Secret）
 *   若無金鑰則使用 guest 存取（有 rate limit）
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

// ─── 設定 ────────────────────────────────────────────────

const TDX_BASE = "https://tdx.transportdata.tw/api/basic";
const TDX_AUTH_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";

// TDX 金鑰（可透過 .env 或直接設定，免費方案即可）
// 若未設定則用 guest 模式（可能有 rate limit）
const TDX_CLIENT_ID = "";
const TDX_CLIENT_SECRET = "";

// 快取金鑰
const CACHE_PREFIX = "@tdx_cache:";
const TOKEN_KEY = "@tdx_token";

// 快取時效（毫秒）
const CACHE_TTL = {
  busRoutes: 24 * 60 * 60 * 1000,     // 路線資料 24h
  busStops: 24 * 60 * 60 * 1000,      // 站牌資料 24h
  busEstimate: 30 * 1000,             // 到站預估 30s
  trainSchedule: 6 * 60 * 60 * 1000,  // 火車時刻 6h
  hsrSchedule: 6 * 60 * 60 * 1000,    // 高鐵時刻 6h
  youbike: 60 * 1000,                 // YouBike 1min
};

// ─── Token 管理 ──────────────────────────────────────────

let _cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (!TDX_CLIENT_ID || !TDX_CLIENT_SECRET) return null;

  // 記憶體快取
  if (_cachedToken && Date.now() < _cachedToken.expiresAt - 60000) {
    return _cachedToken.token;
  }

  // AsyncStorage 快取
  try {
    const stored = await AsyncStorage.getItem(TOKEN_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.expiresAt > Date.now() + 60000) {
        _cachedToken = parsed;
        return parsed.token;
      }
    }
  } catch {}

  // 重新取得
  try {
    const resp = await fetch(TDX_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&client_id=${TDX_CLIENT_ID}&client_secret=${TDX_CLIENT_SECRET}`,
    });
    const data = await resp.json();
    if (data.access_token) {
      const tokenData = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      };
      _cachedToken = tokenData;
      await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify(tokenData)).catch(() => {});
      return data.access_token;
    }
  } catch (err) {
    console.warn("[TDX] Token fetch failed:", err);
  }

  return null;
}

// ─── 通用 Fetch ─────────────────────────────────────────

async function tdxFetch<T>(path: string, cacheKey?: string, ttl?: number): Promise<T | null> {
  // 檢查快取
  if (cacheKey && ttl) {
    try {
      const cached = await AsyncStorage.getItem(CACHE_PREFIX + cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed._ts && Date.now() - parsed._ts < ttl) {
          return parsed.data as T;
        }
      }
    } catch {}
  }

  const token = await getAccessToken();
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "Accept-Encoding": "gzip",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const url = `${TDX_BASE}${path}`;
    console.log("[TDX] Fetching:", url);
    const resp = await fetch(url, { headers, signal: controller.signal });

    if (!resp.ok) {
      console.warn("[TDX] HTTP", resp.status, "for", path);
      return null;
    }

    const data = await resp.json();

    // 寫入快取
    if (cacheKey && ttl) {
      AsyncStorage.setItem(
        CACHE_PREFIX + cacheKey,
        JSON.stringify({ data, _ts: Date.now() }),
      ).catch(() => {});
    }

    return data as T;
  } catch (err) {
    if (controller.signal.aborted) {
      console.warn("[TDX] Request timeout:", path);
    } else {
      console.warn("[TDX] Fetch error:", err);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ═══════════════════════════════════════════════════════
// 1. 公車 API
// ═══════════════════════════════════════════════════════

export type TDXBusRoute = {
  RouteUID: string;
  RouteID: string;
  RouteName: { Zh_tw: string; En: string };
  DepartureStopNameZh?: string;
  DestinationStopNameZh?: string;
  City?: string;
  CityCode?: string;
  RouteMapImageUrl?: string;
};

export type TDXBusStop = {
  StopUID: string;
  StopID: string;
  StopName: { Zh_tw: string; En: string };
  StopPosition: { PositionLat: number; PositionLon: number };
  StopSequence: number;
  StationID?: string;
};

export type TDXBusStopOfRoute = {
  RouteUID: string;
  RouteID: string;
  RouteName: { Zh_tw: string; En: string };
  Direction: number; // 0=去程 1=返程
  Stops: TDXBusStop[];
};

export type TDXBusEstimate = {
  RouteUID: string;
  RouteID: string;
  RouteName: { Zh_tw: string; En: string };
  StopUID: string;
  StopID: string;
  StopName: { Zh_tw: string; En: string };
  Direction: number;
  EstimateTime?: number; // 秒
  StopStatus: number; // 0=正常 1=尚未發車 2=交管不停靠 3=末班已過 4=今日未營運
  NextBusTime?: string;
  IsLastBus?: boolean;
  PlateNumb?: string;
};

/**
 * 查詢台中市公車路線
 * @param keyword - 路線號碼或名稱（如 "300"、"301"）
 */
export async function searchBusRoutes(keyword?: string): Promise<TDXBusRoute[]> {
  let filter = "";
  if (keyword) {
    const k = keyword.trim();
    filter = `&$filter=contains(RouteName/Zh_tw,'${k}') or contains(RouteID,'${k}')`;
  }
  const data = await tdxFetch<TDXBusRoute[]>(
    `/v2/Bus/Route/City/Taichung?$top=50&$format=JSON${filter}`,
    keyword ? undefined : "bus_routes_all",
    keyword ? undefined : CACHE_TTL.busRoutes,
  );
  return data ?? [];
}

/**
 * 查詢指定路線的站牌（含去程/返程）
 */
export async function getBusStopsOfRoute(routeId: string): Promise<TDXBusStopOfRoute[]> {
  const data = await tdxFetch<TDXBusStopOfRoute[]>(
    `/v2/Bus/StopOfRoute/City/Taichung/${routeId}?$format=JSON`,
    `bus_stops_${routeId}`,
    CACHE_TTL.busStops,
  );
  return data ?? [];
}

/**
 * 查詢指定路線的預估到站時間
 */
export async function getBusEstimates(routeId: string): Promise<TDXBusEstimate[]> {
  const data = await tdxFetch<TDXBusEstimate[]>(
    `/v2/Bus/EstimatedTimeOfArrival/City/Taichung/${routeId}?$format=JSON`,
    `bus_eta_${routeId}`,
    CACHE_TTL.busEstimate,
  );
  return data ?? [];
}

/**
 * 查詢靜宜大學附近站牌的到站預估（所有路線）
 */
export async function getNearbyBusEstimates(): Promise<TDXBusEstimate[]> {
  // 靜宜大學座標: 24.2260, 120.5630
  // 搜尋半徑 500m 內的站牌
  const data = await tdxFetch<TDXBusEstimate[]>(
    `/v2/Bus/EstimatedTimeOfArrival/City/Taichung/NearBy?$spatialFilter=nearby(24.2260,120.5630,500)&$format=JSON`,
    undefined, // 不快取，即時資料
    undefined,
  );
  return data ?? [];
}

// ─── 靜宜周邊常用路線 ────────────────────────────────────

export const PU_COMMON_BUS_ROUTES = [
  { id: "300", name: "300", desc: "台中車站 - 靜宜大學 - 清水（台灣大道幹線）" },
  { id: "301", name: "301", desc: "新民高中 - 靜宜大學（經台灣大道）" },
  { id: "302", name: "302", desc: "台中公園 - 沙鹿（經台灣大道）" },
  { id: "303", name: "303", desc: "港區藝術中心 - 新民高中（經清水）" },
  { id: "304", name: "304", desc: "新民高中 - 港區藝術中心（經大甲）" },
  { id: "305", name: "305", desc: "大甲 - 鹿寮（經沙鹿）" },
  { id: "306", name: "306", desc: "清水 - 梧棲（經靜宜大學）" },
  { id: "307", name: "307", desc: "台中車站 - 梧棲觀光漁港" },
  { id: "308", name: "308", desc: "關連工業區 - 靜宜大學（經東海大學）" },
  { id: "309", name: "309", desc: "台中車站 - 港區藝術中心（經龍井）" },
  { id: "310", name: "310", desc: "台中車站 - 台中港旅客服務中心" },
];

// ═══════════════════════════════════════════════════════
// 2. 台鐵 API
// ═══════════════════════════════════════════════════════

export type TDXTrainTimetable = {
  TrainDate: string;
  DailyTrainInfo: {
    TrainNo: string;
    TrainTypeName: { Zh_tw: string; En: string };
    Direction: number;
    StartingStationName: { Zh_tw: string; En: string };
    EndingStationName: { Zh_tw: string; En: string };
  };
  StopTimes: Array<{
    StopSequence: number;
    StationName: { Zh_tw: string; En: string };
    StationID: string;
    ArrivalTime: string;
    DepartureTime: string;
  }>;
};

/** 靜宜附近的台鐵車站 */
export const PU_NEARBY_TRAIN_STATIONS = [
  { id: "3330", name: "沙鹿", distance: "2.5km" },
  { id: "3340", name: "清水", distance: "5km" },
  { id: "3320", name: "龍井", distance: "5km" },
  { id: "3350", name: "大甲", distance: "12km" },
];

/**
 * 查詢台鐵時刻表（指定車站、指定日期）
 */
export async function getTrainSchedule(
  stationId: string,
  date?: string, // YYYY-MM-DD
): Promise<TDXTrainTimetable[]> {
  const today = date || new Date().toISOString().split("T")[0];
  const data = await tdxFetch<TDXTrainTimetable[]>(
    `/v3/Rail/TRA/DailyTrainTimetable/Station/${stationId}/${today}?$format=JSON`,
    `train_${stationId}_${today}`,
    CACHE_TTL.trainSchedule,
  );
  return data ?? [];
}

// ═══════════════════════════════════════════════════════
// 3. 高鐵 API
// ═══════════════════════════════════════════════════════

export type TDXHSRTimetable = {
  TrainDate: string;
  DailyTrainInfo: {
    TrainNo: string;
    Direction: number; // 0=南下 1=北上
    StartingStationName: { Zh_tw: string; En: string };
    EndingStationName: { Zh_tw: string; En: string };
  };
  StopTimes: Array<{
    StopSequence: number;
    StationName: { Zh_tw: string; En: string };
    StationID: string;
    ArrivalTime: string;
    DepartureTime: string;
  }>;
};

/** 高鐵台中站 */
export const HSR_TAICHUNG_STATION_ID = "1035";

/**
 * 查詢高鐵時刻表（台中站）
 */
export async function getHSRSchedule(
  date?: string,
): Promise<TDXHSRTimetable[]> {
  const today = date || new Date().toISOString().split("T")[0];
  const data = await tdxFetch<TDXHSRTimetable[]>(
    `/v2/Rail/THSR/DailyTimetable/Station/${HSR_TAICHUNG_STATION_ID}/${today}?$format=JSON`,
    `hsr_taichung_${today}`,
    CACHE_TTL.hsrSchedule,
  );
  return data ?? [];
}

// ═══════════════════════════════════════════════════════
// 4. YouBike API
// ═══════════════════════════════════════════════════════

export type TDXBikeStation = {
  StationUID: string;
  StationID: string;
  StationName: { Zh_tw: string; En: string };
  StationPosition: { PositionLat: number; PositionLon: number };
  StationAddress?: { Zh_tw?: string; En?: string };
  BikesCapacity: number;
  ServiceType: number; // 1=YouBike1.0 2=YouBike2.0
  SrcUpdateTime: string;
  UpdateTime: string;
};

export type TDXBikeAvailability = {
  StationUID: string;
  StationID: string;
  ServiceStatus: number; // 0=停止 1=正常 2=暫停
  AvailableRentBikes: number;
  AvailableReturnBikes: number;
  SrcUpdateTime: string;
  UpdateTime: string;
  AvailableRentGeneralBikes?: number;
  AvailableRentElectricBikes?: number;
};

/**
 * 查詢台中市 YouBike 站點（靜宜大學附近）
 */
export async function getNearbyBikeStations(): Promise<TDXBikeStation[]> {
  // 靜宜大學座標: 24.2260, 120.5630，搜尋 2km 內
  const data = await tdxFetch<TDXBikeStation[]>(
    `/v2/Bike/Station/City/Taichung?$spatialFilter=nearby(24.2260,120.5630,2000)&$format=JSON`,
    "bike_stations_pu",
    CACHE_TTL.youbike,
  );
  return data ?? [];
}

/**
 * 查詢 YouBike 站點即時可借車輛數
 */
export async function getNearbyBikeAvailability(): Promise<TDXBikeAvailability[]> {
  const data = await tdxFetch<TDXBikeAvailability[]>(
    `/v2/Bike/Availability/City/Taichung?$spatialFilter=nearby(24.2260,120.5630,2000)&$format=JSON`,
    undefined, // 不快取即時資料
    undefined,
  );
  return data ?? [];
}

// ═══════════════════════════════════════════════════════
// 組合查詢
// ═══════════════════════════════════════════════════════

export type BikeStationWithAvailability = TDXBikeStation & {
  availableRent: number;
  availableReturn: number;
  serviceStatus: number;
  hasElectric: boolean;
  electricBikes: number;
};

/**
 * 查詢 YouBike 站點 + 即時可借數量（合併查詢）
 */
export async function getNearbyBikesWithAvailability(): Promise<BikeStationWithAvailability[]> {
  const [stations, availability] = await Promise.all([
    getNearbyBikeStations(),
    getNearbyBikeAvailability(),
  ]);

  const availMap = new Map(availability.map((a) => [a.StationUID, a]));

  return stations.map((station): BikeStationWithAvailability => {
    const avail = availMap.get(station.StationUID);
    return {
      ...station,
      availableRent: avail?.AvailableRentBikes ?? 0,
      availableReturn: avail?.AvailableReturnBikes ?? 0,
      serviceStatus: avail?.ServiceStatus ?? 0,
      hasElectric: (avail?.AvailableRentElectricBikes ?? 0) > 0,
      electricBikes: avail?.AvailableRentElectricBikes ?? 0,
    };
  }).sort((a, b) => {
    // 有車的排前面
    if (a.availableRent > 0 && b.availableRent === 0) return -1;
    if (a.availableRent === 0 && b.availableRent > 0) return 1;
    return 0;
  });
}
