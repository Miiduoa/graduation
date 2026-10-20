import {
  CAMPUS_TRANSIT, distanceMetres, isCity, isPosition, isRecord, isStopId,
  type TransitArrival, type TransitCity, type TransitFailure, type TransitQuery,
  type TransitResult, type TransitStop,
} from './transit';
import { searchTaichungCatalog } from './transit-catalog';

const BASE = 'https://tdx.transportdata.tw';
const text = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 120) : '';
const localName = (value: unknown) => isRecord(value) ? text(value.Zh_tw) || text(value.En) : '';
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
class TransitError extends Error {
  constructor(readonly reason: TransitFailure) { super(reason); }
}

export function validateTransitQuery(value: unknown): TransitQuery {
  if (!isRecord(value)) throw new TransitError('invalid-query');
  if (value.action === 'campus' && typeof value.schoolId === 'string' && Object.hasOwn(CAMPUS_TRANSIT, value.schoolId))
    return { action: 'campus', schoolId: value.schoolId };
  if (!isCity(value.city)) throw new TransitError('invalid-query');
  if (value.action === 'nearby' && isPosition(value) && typeof value.radius === 'number' && [300, 600, 1000].includes(value.radius))
    return { action: 'nearby', city: value.city, lat: value.lat, lon: value.lon, radius: value.radius };
  if (value.action === 'arrivals' && isStopId(value.stopId))
    return { action: 'arrivals', city: value.city, stopId: value.stopId };
  if (value.action === 'search' && typeof value.text === 'string') {
    const name = value.text.trim();
    if (name.length >= 2 && name.length <= 40 && !/[\u0000-\u001f\u007f]/.test(name))
      return { action: 'search', city: value.city, text: name };
  }
  throw new TransitError('invalid-query');
}

export function normalizeTransitStops(rows: unknown[], city: TransitCity, query: TransitQuery, limit = 16): TransitStop[] {
  const stops = new Map<string, TransitStop>();
  for (const row of rows) {
    if (!isRecord(row) || !isStopId(row.StopUID) || !isRecord(row.StopPosition)) continue;
    const point = { lat: row.StopPosition.PositionLat, lon: row.StopPosition.PositionLon };
    const name = localName(row.StopName);
    if (!isPosition(point) || !name) continue;
    const distance = query.action === 'nearby' ? distanceMetres(query, point) : null;
    if (query.action === 'nearby' && distance !== null && distance > query.radius) continue;
    stops.set(row.StopUID, { id: row.StopUID, name, city, ...point, distance });
  }
  return [...stops.values()].sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0) || a.name.localeCompare(b.name, 'zh-Hant') || a.id.localeCompare(b.id)).slice(0, limit);
}

/**
 * 每條路線各方向的真終點：TDX 路線站序（StopOfRoute）中該方向的最後一站。
 * 路線基本資料（Route）的 DestinationStopNameZh 只對去程與站序末站一致，
 * 返程訖站名稱與實際末站有出入（實查 162、301），故不拿起站名或路線牌
 * （Headsign）充當終點；站序沒給的方向就留空，維持「終點未提供」。
 */
export function normalizeRouteDestinations(rows: unknown[]): Map<string, string> {
  const destinations = new Map<string, string>();
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const direction = typeof row.Direction === 'number' && Number.isInteger(row.Direction) ? row.Direction : null;
    if (direction === null || !Array.isArray(row.Stops) || !row.Stops.length) continue;
    const last = row.Stops[row.Stops.length - 1];
    const destination = isRecord(last) ? localName(last.StopName) : '';
    if (!destination) continue;
    for (const uid of [text(row.RouteUID), text(row.SubRouteUID)]) {
      if (uid) destinations.set(`${uid}:${direction}`, destination);
    }
  }
  return destinations;
}

export function normalizeTransitArrivals(rows: unknown[], stopId: string, destinations?: Map<string, string>): TransitArrival[] {
  const arrivals = new Map<string, TransitArrival>();
  for (const row of rows) {
    if (!isRecord(row) || row.StopUID !== stopId) continue;
    const route = localName(row.RouteName);
    if (!route) continue;
    const direction = typeof row.Direction === 'number' && Number.isInteger(row.Direction) ? row.Direction : null;
    const routeUid = text(row.RouteUID);
    const subRouteUid = text(row.SubRouteUID);
    const id = `${routeUid || route}:${subRouteUid}:${direction}:${stopId}`;
    // Source time is authoritative. A new HTTP fetch does not make old vehicle data fresh.
    const stamp = text(row.SrcUpdateTime) || text(row.UpdateTime);
    const timestamp = Date.parse(stamp);
    const current = arrivals.get(id);
    if (current?.updatedAt && (!Number.isFinite(timestamp) || Date.parse(current.updatedAt) > timestamp)) continue;
    // 到站資料本身給的終點優先；沒給才用站序末站補，兩者都沒有就留空不編造。
    const destination = text(row.DestinationStopNameZh) ||
      (direction !== null ? destinations?.get(`${subRouteUid}:${direction}`) || destinations?.get(`${routeUid}:${direction}`) || '' : '');
    arrivals.set(id, {
      id, route, direction, destination,
      status: typeof row.StopStatus === 'number' && Number.isInteger(row.StopStatus) ? row.StopStatus : null,
      seconds: typeof row.EstimateTime === 'number' && Number.isFinite(row.EstimateTime) && row.EstimateTime >= 0 ? row.EstimateTime : null,
      updatedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
    });
  }
  return [...arrivals.values()].sort((a, b) => {
    const rank = (row: TransitArrival) => row.status === 0 && row.seconds !== null ? row.seconds : Infinity;
    return rank(a) - rank(b) || a.route.localeCompare(b.route, 'zh-Hant', { numeric: true }) || (a.direction ?? 9) - (b.direction ?? 9);
  }).slice(0, 100);
}

/** 被 TDX 限流或自身用量保護擋下時，可改回最近一份成功資料的保留時間。 */
export const TRANSIT_STALE_RETENTION_MS = 10 * 60_000;
/** 路線站序（各方向真終點）很少變動，被限流時可沿用最近一份 TDX 站序較久。 */
export const ROUTE_STOPS_RETENTION_MS = 24 * 60 * 60_000;
const ROUTE_STOPS_TTL_MS = 6 * 60 * 60_000;
/**
 * 靜宜站牌常見路線的 TDX RouteUID。只是代碼清單：啟動後背景向 TDX 預載站序，
 * 終點仍取自 TDX 真資料；預載失敗就維持「終點未提供」，不寫死任何站名。
 */
export const PROVIDENCE_PRELOAD_ROUTES = {
  city: 'Taichung' as TransitCity,
  routeUids: ['TXG162', 'TXG301', 'TXG368', 'TXG326'] as const,
};
function routeStopsQuery(city: TransitCity, routeUid: string): [string, URLSearchParams] {
  const params = new URLSearchParams({ '$format': 'JSON', '$top': '20' });
  params.set('$filter', `RouteUID eq ${literal(routeUid)}`);
  return [`StopOfRoute/City/${city}`, params];
}
/** 同時對 TDX 的請求上限；超過時短暫排隊，而不是立刻回忙碌。 */
const MAX_RUNNING = 4;
const SLOT_WAIT_MS = 3_000;

type QueryResult = { rows: unknown[]; fetchedAt: number; stale: boolean };

export function createTransitService(options: {
  credentials: () => { clientId?: string; clientSecret?: string };
  fetcher?: typeof fetch;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  preloadRoutes?: { city: TransitCity; routeUids: readonly string[] };
}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let token: { value: string; expires: number } | null = null;
  let tokenPending: Promise<string> | null = null;
  let blockedUntil = 0;
  let budget = { window: 0, count: 0 };
  let running = 0;
  const waiters: Array<() => void> = [];
  const cache = new Map<string, { expires: number; fetchedAt: number; value: unknown[] }>();
  // 最近一份成功資料，只在被限流時拿來回覆並如實標資料時間；不會讓舊預估重新變新鮮。
  const lastGood = new Map<string, { fetchedAt: number; retainUntil: number; value: unknown[] }>();
  let preloadStarted = false;
  const pending = new Map<string, Promise<QueryResult>>();

  // 用量保護不放寬：最多 MAX_RUNNING 個同時請求、每分鐘 60 次、遇 429 依 Retry-After 暫停。
  // 只是在名額滿時最多排隊 SLOT_WAIT_MS，排不到才回忙碌。
  async function acquireSlot(): Promise<void> {
    if (running < MAX_RUNNING) { running += 1; return; }
    let granted = false;
    let release!: () => void;
    const turn = new Promise<void>((resolve) => { release = () => { granted = true; resolve(); }; });
    waiters.push(release);
    await Promise.race([turn, wait(SLOT_WAIT_MS)]);
    if (!granted) {
      const index = waiters.indexOf(release);
      if (index >= 0) waiters.splice(index, 1);
      throw new TransitError('rate-limited');
    }
  }
  function releaseSlot() {
    const next = waiters.shift();
    if (next) next(); // 名額直接交給排隊中的請求，running 不變。
    else running -= 1;
  }

  async function request(url: string, init: RequestInit): Promise<unknown> {
    if (now() < blockedUntil) throw new TransitError('rate-limited');
    await acquireSlot();
    try {
      if (now() < blockedUntil) throw new TransitError('rate-limited');
      if (now() - budget.window >= 60_000) budget = { window: now(), count: 0 };
      if (++budget.count > 60) throw new TransitError('rate-limited');
      const response = await fetcher(url, { ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after'));
        blockedUntil = now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 300) : 60) * 1000;
        throw new TransitError('rate-limited');
      }
      if (response.status === 401) { token = null; throw new TransitError('upstream'); }
      if (!response.ok) throw new TransitError('upstream');
      return await response.json();
    } finally { releaseSlot(); }
  }

  async function accessToken(): Promise<string> {
    if (token && token.expires > now()) return token.value;
    if (tokenPending) return tokenPending;
    tokenPending = (async () => {
      const { clientId, clientSecret } = options.credentials();
      if (!clientId?.trim() || !clientSecret?.trim()) throw new TransitError('not-configured');
      const data = await request(`${BASE}/auth/realms/TDXConnect/protocol/openid-connect/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
      });
      if (!isRecord(data) || typeof data.access_token !== 'string' || !data.access_token || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0)
        throw new TransitError('upstream');
      token = { value: data.access_token, expires: now() + Math.max(0, data.expires_in * 1000 - 60_000) };
      return token.value;
    })();
    try { return await tokenPending; } finally { tokenPending = null; }
  }

  function staleOrThrow(key: string, error: unknown): QueryResult {
    const last = lastGood.get(key);
    if (error instanceof TransitError && error.reason === 'rate-limited' && last && now() <= last.retainUntil)
      return { rows: last.value, fetchedAt: last.fetchedAt, stale: true };
    throw error;
  }

  async function query(path: string, params: URLSearchParams, ttl: number): Promise<QueryResult> {
    const key = `${path}?${params}`;
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return { rows: hit.value, fetchedAt: hit.fetchedAt, stale: false };
    // 同一站牌同時進來的查詢共用同一次上游請求。
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    if (pending.size >= 8) return staleOrThrow(key, new TransitError('rate-limited'));
    const work = (async (): Promise<QueryResult> => {
      try {
        const bearer = await accessToken();
        const rows = await request(`${BASE}/api/basic/v2/Bus/${key}`, { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' } });
        if (!Array.isArray(rows)) throw new TransitError('upstream');
        const fetchedAt = now();
        for (const [cacheKey, entry] of cache) if (entry.expires <= fetchedAt) cache.delete(cacheKey);
        if (cache.size >= 128) cache.delete(cache.keys().next().value!);
        cache.set(key, { expires: fetchedAt + ttl, fetchedAt, value: rows });
        for (const [lastKey, entry] of lastGood) if (fetchedAt > entry.retainUntil) lastGood.delete(lastKey);
        lastGood.delete(key);
        if (lastGood.size >= 256) lastGood.delete(lastGood.keys().next().value!);
        const retention = path.startsWith('StopOfRoute/') ? ROUTE_STOPS_RETENTION_MS : TRANSIT_STALE_RETENTION_MS;
        lastGood.set(key, { fetchedAt, retainUntil: fetchedAt + retention, value: rows });
        return { rows, fetchedAt, stale: false };
      } catch (error) {
        return staleOrThrow(key, error);
      }
    })();
    pending.set(key, work);
    try { return await work; } finally { pending.delete(key); }
  }

  // 只在第一次有人查詢時於背景依序預載，走同一套用量保護；失敗不影響任何回應。
  function startPreload() {
    const plan = options.preloadRoutes;
    if (preloadStarted || !plan || !plan.routeUids.length) return;
    const { clientId, clientSecret } = options.credentials();
    if (!clientId?.trim() || !clientSecret?.trim()) return;
    preloadStarted = true;
    void (async () => {
      for (const routeUid of plan.routeUids.slice(0, 8)) {
        try { await query(...routeStopsQuery(plan.city, routeUid), ROUTE_STOPS_TTL_MS); }
        catch { /* 預載失敗就等真正查詢時再補，終點維持未提供。 */ }
      }
    })();
  }

  return async function execute(value: unknown): Promise<TransitResult> {
    try {
      startPreload();
      const input = validateTransitQuery(value);
      const campus = input.action === 'campus' ? CAMPUS_TRANSIT[input.schoolId] : null;
      const city = campus ? campus.city : (input as Exclude<TransitQuery, { action: 'campus' }>).city;
      // Catalog IDs identify static source records, never TDX StopUIDs. In
      // particular, an old App must not receive made-up or mismatched arrivals.
      if (input.action === 'arrivals' && input.stopId.startsWith('TCOD_'))
        return { status: 'unavailable', reason: 'not-configured' };
      const credentials = options.credentials();
      if (city === 'Taichung' && input.action !== 'arrivals' &&
          credentials.clientId === undefined && credentials.clientSecret === undefined) {
        return { status: 'ready', kind: 'stops', ...searchTaichungCatalog(input),
          fetchedAt: new Date(now()).toISOString() };
      }
      const params = new URLSearchParams({ '$format': 'JSON', '$top': '200' });
      if (input.action === 'arrivals') {
        params.set('$filter', `StopUID eq ${literal(input.stopId)}`);
        const eta = await query(`EstimatedTimeOfArrival/City/${city}`, params, 15_000);
        const rows = eta.rows;
        // 只為「到站資料沒給終點」的路線補查站序末站；查不到或上游忙碌就留空，
        // 不能因為補終點失敗就把整份即時到站丟掉，也不能拿路線牌文字充數。
        const missing = new Set<string>();
        for (const row of rows) {
          if (!isRecord(row) || row.StopUID !== input.stopId || text(row.DestinationStopNameZh)) continue;
          const direction = typeof row.Direction === 'number' && Number.isInteger(row.Direction) ? row.Direction : null;
          const routeUid = text(row.RouteUID);
          if (direction === null || !routeUid || missing.has(routeUid)) continue;
          missing.add(routeUid);
          if (missing.size >= 8) break;
        }
        const destinations = new Map<string, string>();
        for (const routeUid of missing) {
          try {
            const { rows: routeRows } = await query(...routeStopsQuery(city, routeUid), ROUTE_STOPS_TTL_MS);
            for (const [key, value] of normalizeRouteDestinations(routeRows)) destinations.set(key, value);
          } catch { /* 補不到終點就維持未提供，不影響即時到站本身。 */ }
        }
        // 保留資料的 fetchedAt 是當時真正向 TDX 取得的時間；倒數仍依每筆來源時間，逾 90 秒不顯示。
        return { status: 'ready', kind: 'arrivals', arrivals: normalizeTransitArrivals(rows, input.stopId, destinations),
          fetchedAt: new Date(eta.stale ? eta.fetchedAt : now()).toISOString(), ...(eta.stale ? { stale: true as const } : {}) };
      }
      if (input.action === 'nearby') {
        // Round only the cache centre; pad the query and filter exact distances afterward.
        params.set('$spatialFilter', `nearby(StopPosition,${input.lat.toFixed(3)},${input.lon.toFixed(3)},${input.radius + 160})`);
      } else {
        const name = campus ? campus.stopName : (input as Extract<TransitQuery, { action: 'search' }>).text;
        params.set('$filter', `contains(StopName/Zh_tw,${literal(name)})`);
      }
      const station = await query(`Stop/City/${city}`, params, 120_000);
      const rows = station.rows;
      const stops = normalizeTransitStops(rows, city, input, 17);
      return { status: 'ready', kind: 'stops', stops: stops.slice(0, 16), limited: rows.length >= 200 || stops.length > 16,
        fetchedAt: new Date(station.stale ? station.fetchedAt : now()).toISOString(), ...(station.stale ? { stale: true as const } : {}) };
    } catch (error) {
      return { status: 'unavailable', reason: error instanceof TransitError ? error.reason : 'upstream' };
    }
  };
}
