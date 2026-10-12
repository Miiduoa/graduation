import {
  CAMPUS_TRANSIT, distanceMetres, isCity, isPosition, isRecord, isStopId,
  type TransitArrival, type TransitCity, type TransitFailure, type TransitQuery,
  type TransitResult, type TransitStop,
} from './transit';

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

export function normalizeTransitArrivals(rows: unknown[], stopId: string): TransitArrival[] {
  const arrivals = new Map<string, TransitArrival>();
  for (const row of rows) {
    if (!isRecord(row) || row.StopUID !== stopId) continue;
    const route = localName(row.RouteName);
    if (!route) continue;
    const direction = typeof row.Direction === 'number' && Number.isInteger(row.Direction) ? row.Direction : null;
    const id = `${text(row.RouteUID) || route}:${text(row.SubRouteUID)}:${direction}:${stopId}`;
    // Source time is authoritative. A new HTTP fetch does not make old vehicle data fresh.
    const stamp = text(row.SrcUpdateTime) || text(row.UpdateTime);
    const timestamp = Date.parse(stamp);
    const current = arrivals.get(id);
    if (current?.updatedAt && (!Number.isFinite(timestamp) || Date.parse(current.updatedAt) > timestamp)) continue;
    arrivals.set(id, {
      id, route, direction, destination: text(row.DestinationStopNameZh),
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

export function createTransitService(options: {
  credentials: () => { clientId?: string; clientSecret?: string };
  fetcher?: typeof fetch;
  now?: () => number;
}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let token: { value: string; expires: number } | null = null;
  let tokenPending: Promise<string> | null = null;
  let blockedUntil = 0;
  let budget = { window: 0, count: 0 };
  let running = 0;
  const cache = new Map<string, { expires: number; value: unknown[] }>();
  const pending = new Map<string, Promise<unknown[]>>();

  async function request(url: string, init: RequestInit): Promise<unknown> {
    if (now() < blockedUntil || running >= 4) throw new TransitError('rate-limited');
    if (now() - budget.window >= 60_000) budget = { window: now(), count: 0 };
    if (++budget.count > 60) throw new TransitError('rate-limited');
    running += 1;
    try {
      const response = await fetcher(url, { ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after'));
        blockedUntil = now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 300) : 60) * 1000;
        throw new TransitError('rate-limited');
      }
      if (response.status === 401) { token = null; throw new TransitError('upstream'); }
      if (!response.ok) throw new TransitError('upstream');
      return await response.json();
    } finally { running -= 1; }
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

  async function query(path: string, params: URLSearchParams, ttl: number): Promise<unknown[]> {
    const key = `${path}?${params}`;
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.value;
    if (pending.has(key)) return pending.get(key)!;
    if (pending.size >= 8) throw new TransitError('rate-limited');
    const work = (async () => {
      const bearer = await accessToken();
      const rows = await request(`${BASE}/api/basic/v2/Bus/${key}`, { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' } });
      if (!Array.isArray(rows)) throw new TransitError('upstream');
      for (const [cacheKey, entry] of cache) if (entry.expires <= now()) cache.delete(cacheKey);
      if (cache.size >= 128) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires: now() + ttl, value: rows });
      return rows;
    })();
    pending.set(key, work);
    try { return await work; } finally { pending.delete(key); }
  }

  return async function execute(value: unknown): Promise<TransitResult> {
    try {
      const input = validateTransitQuery(value);
      const campus = input.action === 'campus' ? CAMPUS_TRANSIT[input.schoolId] : null;
      const city = campus ? campus.city : (input as Exclude<TransitQuery, { action: 'campus' }>).city;
      const params = new URLSearchParams({ '$format': 'JSON', '$top': '200' });
      if (input.action === 'arrivals') {
        params.set('$filter', `StopUID eq ${literal(input.stopId)}`);
        const rows = await query(`EstimatedTimeOfArrival/City/${city}`, params, 15_000);
        return { status: 'ready', kind: 'arrivals', arrivals: normalizeTransitArrivals(rows, input.stopId), fetchedAt: new Date(now()).toISOString() };
      }
      if (input.action === 'nearby') {
        // Round only the cache centre; pad the query and filter exact distances afterward.
        params.set('$spatialFilter', `nearby(StopPosition,${input.lat.toFixed(3)},${input.lon.toFixed(3)},${input.radius + 160})`);
      } else {
        const name = campus ? campus.stopName : (input as Extract<TransitQuery, { action: 'search' }>).text;
        params.set('$filter', `contains(StopName/Zh_tw,${literal(name)})`);
      }
      const rows = await query(`Stop/City/${city}`, params, 120_000);
      const stops = normalizeTransitStops(rows, city, input, 17);
      return { status: 'ready', kind: 'stops', stops: stops.slice(0, 16), limited: rows.length >= 200 || stops.length > 16, fetchedAt: new Date(now()).toISOString() };
    } catch (error) {
      return { status: 'unavailable', reason: error instanceof TransitError ? error.reason : 'upstream' };
    }
  };
}
