export const TRANSIT_CITIES = {
  Taipei: '臺北市', NewTaipei: '新北市', Taoyuan: '桃園市', Taichung: '臺中市',
  Tainan: '臺南市', Kaohsiung: '高雄市', Keelung: '基隆市', Hsinchu: '新竹市',
  HsinchuCounty: '新竹縣', MiaoliCounty: '苗栗縣', ChanghuaCounty: '彰化縣',
  NantouCounty: '南投縣', YunlinCounty: '雲林縣', Chiayi: '嘉義市',
  ChiayiCounty: '嘉義縣', PingtungCounty: '屏東縣', YilanCounty: '宜蘭縣',
  HualienCounty: '花蓮縣', TaitungCounty: '臺東縣', PenghuCounty: '澎湖縣',
  KinmenCounty: '金門縣', LienchiangCounty: '連江縣',
} as const;
export type TransitCity = keyof typeof TRANSIT_CITIES;
export type Position = { lat: number; lon: number };
export type TransitStop = Position & { id: string; name: string; city: TransitCity; distance: number | null };
export type TransitArrival = {
  id: string; route: string; direction: number | null; destination: string;
  status: number | null; seconds: number | null; updatedAt: string | null;
};
export type TransitQuery =
  | { action: 'campus'; schoolId: string }
  | { action: 'search'; city: TransitCity; text: string }
  | { action: 'nearby'; city: TransitCity; lat: number; lon: number; radius: number }
  | { action: 'arrivals'; city: TransitCity; stopId: string };
export type TransitFailure = 'not-configured' | 'invalid-query' | 'rate-limited' | 'upstream' | 'network';
export type TransitResult =
  | { status: 'ready'; kind: 'stops'; stops: TransitStop[]; limited: boolean; fetchedAt: string }
  | { status: 'ready'; kind: 'arrivals'; arrivals: TransitArrival[]; fetchedAt: string }
  | { status: 'unavailable'; reason: TransitFailure };
export const TRANSIT_FRESHNESS_MS = 90_000;
export const CAMPUS_TRANSIT: Record<string, { city: TransitCity; stopName: string }> = {
  pu: { city: 'Taichung', stopName: '靜宜大學' },
  ncku: { city: 'Tainan', stopName: '成大' },
  ntpu: { city: 'NewTaipei', stopName: '臺北大學' },
};

/** TDX 公開站名與路線代碼，供校園搜尋 contains(StopName/Zh_tw) 對過後再寫進 CAMPUS_TRANSIT.stopName。 */
export const CAMPUS_TRANSIT_PUBLIC = {
  ncku: {
    city: 'Tainan' as TransitCity,
    stopName: '成大',
    stops: ['成大自強校區', '成大光復校區', '成大醫院(勝利路)', '成大醫院(小東路)'] as const,
    routes: [
      { name: '0左', routeUID: 'TNN10450' },
      { name: '0右', routeUID: 'TNN10451' },
      { name: '77', routeUID: 'TNN1077' },
    ] as const,
    sources: [
      { label: '交通部TDX｜0左', url: 'https://taiwanhelper.com/bus/TNN/TNN10450' },
      { label: '交通部TDX｜0右', url: 'https://taiwanhelper.com/bus/TNN/TNN10451' },
      { label: '交通部TDX｜77', url: 'https://taiwanhelper.com/bus/TNN/TNN1077' },
      { label: '大臺南公車｜0左站牌代碼 0465', url: 'https://busmap.tainan.gov.tw/ebus/pathInfo.jsp?pathId=10450' },
    ] as const,
  },
  ntpu: {
    city: 'NewTaipei' as TransitCity,
    stopName: '臺北大學',
    stops: ['臺北大學正門', '臺北大學宿舍', '捷運臺北大學站(復興大勇路口)'] as const,
    routes: [{ name: '851', routeUID: 'NWT16665', routeId: '0400085100' }] as const,
    sources: [
      { label: '交通部TDX｜851', url: 'https://taiwanhelper.com/bus/NWT/NWT16665' },
      { label: '大臺北公車｜851', url: 'https://ebus.gov.taipei/Route/StopsOfRoute?routeid=0400085100' },
    ] as const,
  },
} as const;

/**
 * Initial search city for a university's primary campus, not a claim that
 * any particular bus stop or route has been registered with TDX.
 * Multi-city universities deliberately require a manual city selection.
 */
const SCHOOL_SEARCH_CITIES: Readonly<Record<string, TransitCity>> = {
  pu: 'Taichung',
  ntu: 'Taipei',
  nthu: 'Hsinchu',
  ncku: 'Tainan',
  ntpu: 'NewTaipei',
  ncu: 'Taoyuan',
  nsysu: 'Kaohsiung',
  ntnu: 'Taipei',
  ntust: 'Taipei',
  nccu: 'Taipei',
  ncue: 'ChanghuaCounty',
  tmu: 'Taipei',
  fju: 'NewTaipei',
  thu: 'Taichung',
  cgu: 'Taoyuan',
  cycu: 'Taoyuan',
  scu: 'Taipei',
  ntub: 'Taipei',
  'tw-nchu': 'Taichung',
};

export function preferredTransitCity(schoolId: string): TransitCity | null {
  return Object.hasOwn(SCHOOL_SEARCH_CITIES, schoolId) ? SCHOOL_SEARCH_CITIES[schoolId] : null;
}
export const TRANSIT_MESSAGES: Record<TransitFailure, string> = {
  'not-configured': '附近站牌服務尚未啟用。你仍可查看已登錄路線，或開啟官方公車網站。',
  'invalid-query': '請確認縣市、站名或定位資料後再查詢。',
  'rate-limited': '交通資料服務忙碌中，請稍後再試。',
  upstream: '交通資料服務暫時沒有回應，請重新查詢或改用官方網站。',
  network: '目前無法連線，請檢查網路後重試。',
};
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const isCity = (value: unknown): value is TransitCity =>
  typeof value === 'string' && Object.hasOwn(TRANSIT_CITIES, value);
export const isPosition = (value: unknown): value is Position & Record<string, unknown> =>
  isRecord(value) && typeof value.lat === 'number' && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90 &&
  typeof value.lon === 'number' && Number.isFinite(value.lon) && Math.abs(value.lon) <= 180;
export const isStopId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
export function distanceMetres(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return Math.round(12_742_000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h)))));
}
export function formatDistance(distance: number): string {
  return distance < 1000 ? `約 ${Math.max(10, Math.round(distance / 10) * 10)} 公尺` : `約 ${(distance / 1000).toFixed(1)} 公里`;
}
export function arrivalLabel(arrival: TransitArrival, now: number): string {
  const timestamp = arrival.updatedAt ? Date.parse(arrival.updatedAt) : NaN;
  if (!Number.isFinite(timestamp) || timestamp > now + 30_000 || now - timestamp >= TRANSIT_FRESHNESS_MS)
    return '資料待更新';
  const statuses: Record<number, string> = { 1: '尚未發車', 2: '交管不停靠', 3: '末班車已駛離', 4: '今日未營運' };
  if (arrival.status !== null && statuses[arrival.status]) return statuses[arrival.status];
  if (arrival.status !== 0 || arrival.seconds === null || !Number.isFinite(arrival.seconds) || arrival.seconds < 0)
    return '暫無到站預估';
  const remaining = arrival.seconds - Math.max(0, now - timestamp) / 1000;
  if (remaining < -30) return '等待更新';
  return remaining <= 60 ? '即將到站' : `約 ${Math.ceil(remaining / 60)} 分鐘`;
}
export function directionLabel(arrival: TransitArrival): string {
  if (arrival.destination) return `往 ${arrival.destination}`;
  return arrival.direction === 0 ? '去程' : arrival.direction === 1 ? '返程' : '方向未提供';
}
export function stopMapUrl(stop: TransitStop): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lon}&travelmode=walking`;
}
export function readSavedStops(raw: string | null): TransitStop[] {
  try {
    const rows: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(rows)) return [];
    const seen = new Set<string>();
    return rows.filter((row): row is TransitStop => {
      if (!isPosition(row) || !isRecord(row) || !isStopId(row.id) || !isCity(row.city) ||
        typeof row.name !== 'string' || !row.name.trim() || row.name.length > 120) return false;
      const key = `${row.city}:${row.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 16).map((row) => ({ id: row.id, name: row.name, city: row.city, lat: row.lat, lon: row.lon, distance: null }));
  } catch { return []; }
}
export async function queryTransit(query: TransitQuery, signal: AbortSignal): Promise<TransitResult> {
  const response = await fetch('/api/transit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query), cache: 'no-store', signal,
  });
  const result: unknown = await response.json();
  if (!isRecord(result)) throw new Error('invalid-response');
  if (result.status === 'unavailable' && typeof result.reason === 'string' && Object.hasOwn(TRANSIT_MESSAGES, result.reason))
    return result as TransitResult;
  if (!response.ok || result.status !== 'ready' || typeof result.fetchedAt !== 'string' || !Number.isFinite(Date.parse(result.fetchedAt)))
    throw new Error('invalid-response');
  if (result.kind === 'stops' && Array.isArray(result.stops)) {
    const stops = readSavedStops(JSON.stringify(result.stops));
    // Preserve only verified distances; a saved stop never retains a user's distance.
    return { status: 'ready', kind: 'stops', fetchedAt: result.fetchedAt, limited: result.limited === true,
      stops: stops.map((stop) => {
        const raw = (result.stops as unknown[]).find((row) => isRecord(row) && row.id === stop.id && row.city === stop.city);
        return { ...stop, distance: isRecord(raw) && typeof raw.distance === 'number' && Number.isFinite(raw.distance) && raw.distance >= 0 ? raw.distance : null };
      }) };
  }
  if (result.kind === 'arrivals' && Array.isArray(result.arrivals)) {
    const arrivals = result.arrivals.filter((row): row is TransitArrival => isRecord(row) &&
      typeof row.id === 'string' && typeof row.route === 'string' && typeof row.destination === 'string' &&
      (row.direction === null || Number.isInteger(row.direction)) && (row.status === null || Number.isInteger(row.status)) &&
      (row.seconds === null || (typeof row.seconds === 'number' && Number.isFinite(row.seconds))) &&
      (row.updatedAt === null || typeof row.updatedAt === 'string')).slice(0, 100);
    return { status: 'ready', kind: 'arrivals', arrivals, fetchedAt: result.fetchedAt };
  }
  throw new Error('invalid-response');
}
