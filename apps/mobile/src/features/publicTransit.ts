/**
 * Public bus-stop discovery through the Campus One transit gateway.
 * No transport credentials are stored on the device.
 */
export const BUS_CITIES = {
  Taipei: '臺北市',
  NewTaipei: '新北市',
  Taoyuan: '桃園市',
  Taichung: '臺中市',
  Tainan: '臺南市',
  Kaohsiung: '高雄市',
  Keelung: '基隆市',
  Hsinchu: '新竹市',
  HsinchuCounty: '新竹縣',
  MiaoliCounty: '苗栗縣',
  ChanghuaCounty: '彰化縣',
  NantouCounty: '南投縣',
  YunlinCounty: '雲林縣',
  Chiayi: '嘉義市',
  ChiayiCounty: '嘉義縣',
  PingtungCounty: '屏東縣',
  YilanCounty: '宜蘭縣',
  HualienCounty: '花蓮縣',
  TaitungCounty: '臺東縣',
  PenghuCounty: '澎湖縣',
  KinmenCounty: '金門縣',
  LienchiangCounty: '連江縣',
} as const;

export type BusCity = keyof typeof BUS_CITIES;
export type PublicBusStop = {
  id: string;
  name: string;
  city: BusCity;
  lat: number;
  lon: number;
  distance: number | null;
  source?: 'taichung-open-data';
  catalogDate?: string;
  routes?: Array<{ name: string; direction: string; destination: string }>;
};
export type PublicBusArrival = {
  id: string;
  route: string;
  direction: 0 | 1 | null;
  destination: string;
  status: number | null;
  seconds: number | null;
  updatedAt: string | null;
};
export type PublicTransitQuery =
  | { action: 'search'; city: BusCity; text: string }
  | { action: 'nearby'; city: BusCity; lat: number; lon: number; radius: 300 | 600 | 1000 }
  | { action: 'arrivals'; city: BusCity; stopId: string };
export type PublicTransitResult =
  | { status: 'ready'; kind: 'stops'; stops: PublicBusStop[]; limited: boolean; fetchedAt: string }
  | { status: 'ready'; kind: 'arrivals'; arrivals: PublicBusArrival[]; fetchedAt: string }
  | { status: 'unavailable'; reason: 'not-configured' | 'invalid-query' | 'rate-limited' | 'upstream' | 'network' };

const TRANSIT_GATEWAY = 'https://nuni.tw/api/transit';
export const PUBLIC_TRANSIT_FRESHNESS_MS = 90_000;
export const PUBLIC_BUS_OFFICIAL_FALLBACK = 'https://www.taiwanbus.tw/eBUSPage/Query/NearbyQuery.aspx?lan=C';
export const TAICHUNG_BUS_OFFICIAL = 'https://citybus.taichung.gov.tw/';
export const TAICHUNG_BUS_CATALOG_SOURCE = 'https://data.gov.tw/dataset/81555';

/** Primary-campus search hints. These are not verified route or bus-stop IDs. */
const PRIMARY_CITY: Readonly<Record<string, BusCity>> = {
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

export function primaryBusCity(schoolId: string): BusCity | null {
  return Object.prototype.hasOwnProperty.call(PRIMARY_CITY, schoolId)
    ? PRIMARY_CITY[schoolId]
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
function isCity(value: unknown): value is BusCity {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BUS_CITIES, value);
}
function validPoint(lat: unknown, lon: unknown): lat is number {
  return typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
    typeof lon === 'number' && Number.isFinite(lon) && Math.abs(lon) <= 180;
}

function catalogMetadata(row: Record<string, unknown>): Pick<PublicBusStop, 'source' | 'catalogDate' | 'routes'> | null {
  const hasCatalogMetadata = row.source !== undefined || row.catalogDate !== undefined || row.routes !== undefined ||
    (typeof row.id === 'string' && row.id.startsWith('TCOD_'));
  if (!hasCatalogMetadata) return {};
  if (row.source !== 'taichung-open-data' || row.city !== 'Taichung' ||
    typeof row.id !== 'string' || !row.id.startsWith('TCOD_') ||
    typeof row.catalogDate !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(row.catalogDate) ||
    !Number.isFinite(Date.parse(row.catalogDate)) || Date.parse(row.catalogDate) > Date.now() + 5 * 60_000 ||
    !Array.isArray(row.routes) || row.routes.length > 200) return null;
  if (new Date(row.catalogDate).toISOString().replace('.000Z', 'Z') !== row.catalogDate.replace('.000Z', 'Z')) return null;
  const routes: NonNullable<PublicBusStop['routes']> = [];
  for (const item of row.routes) {
    const route = record(item);
    if (!route || typeof route.name !== 'string' || !route.name.trim() || route.name.length > 120 ||
      typeof route.direction !== 'string' || route.direction.length > 40 ||
      typeof route.destination !== 'string' || route.destination.length > 120) return null;
    routes.push({ name: route.name.trim(), direction: route.direction.trim(), destination: route.destination.trim() });
  }
  return { source: 'taichung-open-data', catalogDate: row.catalogDate, routes };
}

function validQuery(input: PublicTransitQuery): boolean {
  if (!isCity(input.city)) return false;
  if (input.action === 'search') {
    const value = input.text.trim();
    return value.length >= 2 && value.length <= 40 &&
      !Array.from(value).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
  }
  if (input.action === 'nearby')
    return validPoint(input.lat, input.lon) && [300, 600, 1000].includes(input.radius);
  return input.action === 'arrivals' && /^[A-Za-z0-9_-]{1,80}$/.test(input.stopId);
}

const unavailable = (reason: Extract<PublicTransitResult, { status: 'unavailable' }>['reason']): PublicTransitResult => ({
  status: 'unavailable', reason,
});

export function publicArrivalLabel(arrival: PublicBusArrival, now = Date.now()): string {
  const updated = arrival.updatedAt ? Date.parse(arrival.updatedAt) : NaN;
  if (!Number.isFinite(updated) || updated > now + 30_000 || now - updated >= PUBLIC_TRANSIT_FRESHNESS_MS)
    return '資料待更新';
  const messages: Record<number, string> = {
    1: '尚未發車',
    2: '交管不停靠',
    3: '末班車已駛離',
    4: '今日未營運',
  };
  if (arrival.status !== null && messages[arrival.status]) return messages[arrival.status];
  if (arrival.status !== 0 || arrival.seconds === null || arrival.seconds < 0 ||
    !Number.isFinite(arrival.seconds)) return '暫無到站預估';
  const seconds = arrival.seconds - Math.max(0, now - updated) / 1000;
  if (seconds < -30) return '等待更新';
  return seconds <= 60 ? '即將到站' : '約 ' + Math.ceil(seconds / 60) + ' 分鐘';
}

export async function queryPublicTransit(
  input: PublicTransitQuery,
  signal?: AbortSignal,
): Promise<PublicTransitResult> {
  if (!validQuery(input)) return unavailable('invalid-query');
  if (signal?.aborted) return unavailable('network');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  const timer = setTimeout(abort, 12_000);
  try {
    const response = await fetch(TRANSIT_GATEWAY, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
    });
    const body: unknown = await response.json();
    const data = record(body);
    if (!data) return unavailable('upstream');
    if (data.status === 'unavailable') {
      const reason = data.reason;
      if (reason === 'not-configured' || reason === 'invalid-query' || reason === 'rate-limited' ||
        reason === 'upstream' || reason === 'network') return unavailable(reason);
      return unavailable('upstream');
    }
    const fetchedAt = typeof data.fetchedAt === 'string' ? Date.parse(data.fetchedAt) : NaN;
    if (!response.ok || data.status !== 'ready' || !Number.isFinite(fetchedAt) ||
      Math.abs(Date.now() - fetchedAt) > 5 * 60_000) return unavailable('upstream');

    if (data.kind === 'stops' && Array.isArray(data.stops) && input.action !== 'arrivals') {
      const seen = new Set<string>();
      const stops = data.stops.flatMap((item): PublicBusStop[] => {
        const row = record(item);
        if (!row || !isCity(row.city) || row.city !== input.city ||
          typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(row.id) ||
          typeof row.name !== 'string' || !row.name.trim() || row.name.length > 120 ||
          !validPoint(row.lat, row.lon) || seen.has(row.id)) return [];
        const metadata = catalogMetadata(row);
        if (!metadata) return [];
        seen.add(row.id);
        return [{
          id: row.id,
          city: row.city,
          name: row.name.trim(),
          lat: row.lat,
          lon: row.lon as number,
          distance: typeof row.distance === 'number' && Number.isFinite(row.distance) &&
            row.distance >= 0 ? row.distance : null,
          ...metadata,
        }];
      }).slice(0, 16);
      return { status: 'ready', kind: 'stops', stops, limited: data.limited === true, fetchedAt: data.fetchedAt as string };
    }
    if (data.kind === 'arrivals' && Array.isArray(data.arrivals) && input.action === 'arrivals') {
      const arrivals = data.arrivals.flatMap((item): PublicBusArrival[] => {
        const row = record(item);
        if (!row || typeof row.id !== 'string' || row.id.length > 150 ||
          typeof row.route !== 'string' || !row.route.trim() ||
          typeof row.destination !== 'string') return [];
        if (!(row.direction === null || row.direction === 0 || row.direction === 1) ||
          !(row.status === null || (typeof row.status === 'number' && Number.isInteger(row.status))) ||
          !(row.seconds === null || (typeof row.seconds === 'number' && Number.isFinite(row.seconds))) ||
          !(row.updatedAt === null || typeof row.updatedAt === 'string')) return [];
        return [{
          id: row.id, route: row.route.trim(),
          direction: row.direction as 0 | 1 | null, destination: row.destination,
          status: row.status as number | null, seconds: row.seconds as number | null,
          updatedAt: row.updatedAt as string | null,
        }];
      }).slice(0, 100);
      return { status: 'ready', kind: 'arrivals', arrivals, fetchedAt: data.fetchedAt as string };
    }
    return unavailable('upstream');
  } catch {
    return unavailable('network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
