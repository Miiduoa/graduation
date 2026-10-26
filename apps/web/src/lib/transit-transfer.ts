import {
  campusEtaView, campusPlaceLabel, distanceMetres, isPosition,
  type Position, type TransitArrival,
} from './transit';
import {
  PROVIDENCE_DIRECT_ORIGIN,
  type DirectDestination, type DirectTrip,
} from './transit-direct';

/** TDX 公共運輸旅運規劃（MaaS）路徑，不含付費加值。 */
export const MAAS_PLANNER_PATH = '/api/maas/routing';
export const MAAS_RATE_LIMIT_PER_MINUTE = 5;
export const MAAS_CACHE_SLOT_MS = 5 * 60_000;
export const MAAS_TIMEOUT_MS = 8_000;
/** 快取鍵粗化到約 111 公尺，避免微移 lat/lon 刷出大量 miss。 */
export const MAAS_CACHE_COORD_DECIMALS = 3;
/** 出發點須在校門 2.5 公里內，否則改用校門常數，不用呼叫端任意座標。 */
export const MAAS_ORIGIN_MAX_METERS = 2_500;
/** 迄點限臺中市區常見範圍（校門、沙鹿、臺中車站、高鐵、逢甲）。 */
export const MAAS_DESTINATION_BOUNDS = {
  minLat: 24.08,
  maxLat: 24.32,
  minLon: 120.50,
  maxLon: 120.80,
} as const;
export const TRANSFER_PLAN_LIMIT = 3;
/** 轉乘總時間至少少這幾分鐘，才算「明顯更快」。 */
export const TRANSFER_FASTER_BY_MINUTES = 10;
const TAXI_RE = /yoxi|taxi|uber|cab|rideshare|計程車|小黃/;
const BIKE_RE = /bike|cycling|ubike|youbike|t-bike|bicycle|單車|自行車|腳踏/;
const WALK_RE = /walk|foot|pedestrian|步行/;
const WAIT_RE = /\bwait(ing)?\b|等車|候車/;
const TRANSIT_RE = /transit|bus|rail|train|thsr|hsr|mrt|metro|tram|lrt|subway|ferry|gondola|cable|公車|客運|火車|臺鐵|台鐵|高鐵|捷運|輕軌|渡輪/;
/** 送當下時間會被 TDX 以 400／20001 拒絕，出發時刻往後推這段再往上取整到分鐘。 */
export const MAAS_DEPART_LEAD_MS = 5 * 60_000;

export type TransferTrip = {
  boardStopName: string;
  firstRoute: string;
  transferStopName: string;
  transferWalkMinutes: number;
  secondRoute: string;
  alightStopName: string;
  totalMinutes: number;
  firstDepartureAt: string | null;
  arrival: TransitArrival | null;
};

export type MaasPlannerQuery = {
  origin: Position;
  destination: Position;
  departureAt: number;
};

const TAIPEI_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function taipeiPlannerTime(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const parts = TAIPEI_PARTS.formatToParts(new Date(ms));
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = read('year');
  const month = read('month');
  const day = read('day');
  const hour = read('hour');
  const minute = read('minute');
  if (!year || !month || !day || hour == null || minute == null) return null;
  return `${year}-${month}-${day}T${hour}:${minute}:00`;
}

export function maasDepartTimestamp(ms: number): number {
  if (!Number.isFinite(ms)) return ms;
  return Math.ceil((ms + MAAS_DEPART_LEAD_MS) / 60_000) * 60_000;
}

export function taipeiMaasDepartTime(ms: number): string | null {
  return taipeiPlannerTime(maasDepartTimestamp(ms));
}

export function taipeiLocalTimeToIso(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const stamped = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}+08:00`;
  const parsed = Date.parse(stamped);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function maasCacheSlot(ms: number): number {
  return Math.floor(ms / MAAS_CACHE_SLOT_MS);
}

export function roundCoord(value: number): string {
  return value.toFixed(MAAS_CACHE_COORD_DECIMALS);
}

export function isNearCampusOrigin(origin: Position): boolean {
  return isPosition(origin) && distanceMetres(origin, PROVIDENCE_DIRECT_ORIGIN) <= MAAS_ORIGIN_MAX_METERS;
}

export function clampMaasOrigin(origin: Position): Position {
  return isNearCampusOrigin(origin) ? origin : PROVIDENCE_DIRECT_ORIGIN;
}

export function isAllowedMaasDestination(destination: Position): boolean {
  if (!isPosition(destination)) return false;
  const { minLat, maxLat, minLon, maxLon } = MAAS_DESTINATION_BOUNDS;
  return destination.lat >= minLat && destination.lat <= maxLat
    && destination.lon >= minLon && destination.lon <= maxLon;
}

export function maasCacheKey(query: MaasPlannerQuery): string {
  return [
    roundCoord(query.origin.lat),
    roundCoord(query.origin.lon),
    roundCoord(query.destination.lat),
    roundCoord(query.destination.lon),
    String(maasCacheSlot(query.departureAt)),
  ].join(':');
}

/**
 * 組 TDX MaaS 旅運規劃查詢。
 * 端點：GET /api/maas/routing。origin／destination 為 WGS84 緯度,經度。
 * gc 是票價與時間的權重，實測 gc=1 可用，不是座標系統。
 * 不送 transfer_time（送 0 會 404／40001）。
 * depart 為台北時間、現在加 5 分鐘再往上取整到分鐘；送當下時間會 400／20001。
 * transit=3,4,5,6,7 為公共運具；first_mile_mode／last_mile_mode=0 為步行。
 * 不送 arrival。
 */
export function buildMaasPlannerUrl(query: MaasPlannerQuery): string {
  const depart = taipeiMaasDepartTime(query.departureAt);
  const params = new URLSearchParams({
    origin: `${query.origin.lat.toFixed(6)},${query.origin.lon.toFixed(6)}`,
    destination: `${query.destination.lat.toFixed(6)},${query.destination.lon.toFixed(6)}`,
    gc: '1',
    top: '5',
    transit: '3,4,5,6,7',
    first_mile_mode: '0',
    last_mile_mode: '0',
  });
  if (depart) params.set('depart', depart);
  return `https://tdx.transportdata.tw${MAAS_PLANNER_PATH}?${params.toString()}`;
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.Zh_tw === 'string') return record.Zh_tw.trim();
    if (typeof record.zh === 'string') return record.zh.trim();
    if (typeof record.En === 'string') return record.En.trim();
    if (typeof record.name === 'string') return record.name.trim();
  }
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rawDuration(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function toMinutes(value: number, unit: 'seconds' | 'minutes'): number {
  if (value === 0) return 1;
  return Math.max(1, Math.round(unit === 'seconds' ? value / 60 : value));
}

type LegKind = 'walk' | 'wait' | 'transit' | 'taxi' | 'bike' | 'other';

type ParsedLeg = {
  kind: LegKind;
  route: string;
  fromName: string;
  toName: string;
  minutes: number;
  startAt: string | null;
  rawMinutes: number | null;
};

function classifyMode(raw: string): LegKind {
  const value = raw.normalize('NFKC').trim().toLowerCase();
  if (!value) return 'other';
  if (WAIT_RE.test(value)) return 'wait';
  if (TAXI_RE.test(value)) return 'taxi';
  if (BIKE_RE.test(value)) return 'bike';
  if (WALK_RE.test(value)) return 'walk';
  if (TRANSIT_RE.test(value)) return 'transit';
  return 'other';
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  if (Array.isArray(value.section)) return value.section;
  if (isRecord(value.section)) return [value.section];
  return [value];
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function summaryDuration(value: unknown): number | null {
  const summary = recordOf(value);
  return summary ? rawDuration(summary.duration) : null;
}

function legKind(leg: Record<string, unknown>, transport: Record<string, unknown> | null): LegKind {
  const mode = [
    textOf(leg.type), textOf(transport?.mode), textOf(transport?.name), textOf(transport?.shortName),
  ].filter(Boolean).join(' ');
  const classified = classifyMode(mode);
  if (classified !== 'other') return classified;
  if (textOf(transport?.shortName) || textOf(transport?.name)) return 'transit';
  return 'other';
}

function placeName(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!isRecord(value)) return '';
  return textOf(value.name) || textOf(value.Name) || textOf(value.StopName) || textOf(value.stopName);
}

function parseLeg(value: unknown): ParsedLeg | null {
  if (!isRecord(value)) return null;
  const transport = recordOf(value.transport);
  const departure = recordOf(value.departure);
  const arrival = recordOf(value.arrival);
  const kind = legKind(value, transport);
  const route = textOf(transport?.shortName) || textOf(transport?.name);
  const fromName = placeName(departure?.place) || placeName(departure);
  const toName = placeName(arrival?.place) || placeName(arrival);
  const duration = summaryDuration(value.travelSummary);
  const startAt = taipeiLocalTimeToIso(textOf(departure?.time));
  return {
    kind, route: route.slice(0, 40), fromName: fromName.slice(0, 80), toName: toName.slice(0, 80),
    minutes: duration ?? 1, startAt, rawMinutes: duration,
  };
}

function collectRoutes(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  const data = recordOf(payload.data) ?? payload;
  const routes = data.routes ?? data.Routes;
  if (routes == null) return [];
  return asList(routes);
}

function collectLegs(plan: Record<string, unknown>): ParsedLeg[] {
  const sections = plan.sections ?? plan.Sections;
  if (sections == null) return [];
  return asList(sections).flatMap((row) => {
    const leg = parseLeg(row);
    return leg ? [leg] : [];
  });
}

function listedDuration(plan: Record<string, unknown>): number | null {
  return rawDuration(plan.travel_time)
    ?? summaryDuration(plan.travelSummary)
    ?? rawDuration(plan.duration)
    ?? rawDuration(plan.Duration);
}

function scaledLegs(legs: ParsedLeg[]): ParsedLeg[] {
  return legs.map((leg) => ({
    ...leg,
    minutes: leg.rawMinutes == null ? leg.minutes : toMinutes(leg.rawMinutes, 'seconds'),
  }));
}

function planTotalMinutes(plan: Record<string, unknown>, legs: ParsedLeg[]): number {
  const listed = listedDuration(plan);
  if (listed != null) return toMinutes(listed, 'seconds');
  const sum = legs.reduce((total, leg) => total + leg.minutes, 0);
  return Math.max(1, sum);
}

export function isWalkOnlyAccess(legs: readonly ParsedLeg[]): boolean {
  if (!legs.length) return false;
  if (legs.some((leg) => leg.kind === 'taxi' || leg.kind === 'bike')) return false;
  const trimmed = legs.filter((leg) => leg.kind !== 'walk' && leg.kind !== 'wait');
  if (!trimmed.length) return false;
  return trimmed.every((leg) => leg.kind === 'transit');
}

function transferWalkMinutes(legs: readonly ParsedLeg[], firstIndex: number, secondIndex: number): number {
  const between = legs.slice(firstIndex + 1, secondIndex).filter((leg) => leg.kind === 'walk');
  const sum = between.reduce((total, leg) => total + leg.minutes, 0);
  return Math.max(1, sum || 1);
}

export function transferFromWalkOnlyLegs(legs: readonly ParsedLeg[], totalMinutes: number): TransferTrip | null {
  if (!isWalkOnlyAccess(legs)) return null;
  const transit = legs
    .map((leg, index) => ({ leg, index }))
    .filter((entry) => entry.leg.kind === 'transit' && entry.leg.route);
  if (transit.length !== 2) return null;
  const first = transit[0]!;
  const second = transit[1]!;
  const boardStopName = first.leg.fromName;
  const alightStopName = second.leg.toName;
  const transferStopName = first.leg.toName || second.leg.fromName;
  if (!boardStopName || !alightStopName || !transferStopName) return null;
  if (!first.leg.route || !second.leg.route) return null;
  if (first.leg.route === second.leg.route && first.leg.fromName === second.leg.fromName) return null;
  return {
    boardStopName,
    firstRoute: first.leg.route,
    transferStopName,
    transferWalkMinutes: transferWalkMinutes(legs, first.index, second.index),
    secondRoute: second.leg.route,
    alightStopName,
    totalMinutes: Math.max(1, totalMinutes),
    firstDepartureAt: first.leg.startAt,
    arrival: null,
  };
}

export function parseMaasTransferPlans(payload: unknown): TransferTrip[] {
  const plans = collectRoutes(payload);
  const trips: TransferTrip[] = [];
  const seen = new Set<string>();
  for (const plan of plans) {
    if (!isRecord(plan)) continue;
    const legs = scaledLegs(collectLegs(plan));
    const trip = transferFromWalkOnlyLegs(legs, planTotalMinutes(plan, legs));
    if (!trip) continue;
    const key = `${trip.firstRoute}:${trip.secondRoute}:${trip.boardStopName}:${trip.transferStopName}:${trip.alightStopName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    trips.push(trip);
  }
  return trips;
}

export function estimateDirectMinutes(trip: DirectTrip, origin: Position, destination: Position, now: number): number {
  const view = campusEtaView(trip.arrival, now);
  const wait = view.kind === 'soon' ? 1
    : view.kind === 'live' ? (view.minutes ?? 8)
    : view.kind === 'scheduled' || view.kind === 'night'
      ? Math.max(1, trip.arrival?.scheduledAt ? Math.round((Date.parse(trip.arrival.scheduledAt) - now) / 60_000) : 20)
      : 20;
  const ride = Math.max(8, Math.round(distanceMetres(origin, destination) / 500));
  return trip.walkMinutes + wait + ride;
}

export function shouldRequestMaas(directs: readonly DirectTrip[], now: number): boolean {
  if (!directs.length) return true;
  const best = directs.reduce((current, trip) => {
    const view = campusEtaView(trip.arrival, now);
    if (view.kind === 'soon') return 0;
    if (view.kind === 'live') return Math.min(current, view.minutes ?? 99);
    return current;
  }, 99);
  return best >= 20;
}

export function mergeDirectAndTransfers(input: {
  directs: readonly DirectTrip[];
  transfers: readonly TransferTrip[];
  origin: Position;
  destination: Position;
  now: number;
  limit?: number;
}): { trips: DirectTrip[]; transfers: TransferTrip[] } {
  const limit = input.limit ?? TRANSFER_PLAN_LIMIT;
  const bestDirect = input.directs[0];
  const directEstimate = bestDirect
    ? estimateDirectMinutes(bestDirect, input.origin, input.destination, input.now)
    : Infinity;
  const qualifying = input.directs.length === 0
    ? [...input.transfers]
    : input.transfers.filter((trip) => trip.totalMinutes + TRANSFER_FASTER_BY_MINUTES <= directEstimate);
  if (!qualifying.length) return { trips: [...input.directs], transfers: [] };
  qualifying.sort((a, b) => a.totalMinutes - b.totalMinutes);
  const trips: DirectTrip[] = [];
  const transfers: TransferTrip[] = [];
  const reserve = qualifying.length ? Math.min(qualifying.length, limit - 1) : 0;
  for (const trip of input.directs) {
    if (trips.length >= limit - reserve) break;
    trips.push(trip);
  }
  for (const trip of qualifying) {
    if (trips.length + transfers.length >= limit) break;
    transfers.push(trip);
  }
  return { trips, transfers };
}

export function scheduledTransferArrival(trip: TransferTrip, now: number): TransitArrival | null {
  if (!trip.firstDepartureAt || !Number.isFinite(Date.parse(trip.firstDepartureAt))) return null;
  const at = Date.parse(trip.firstDepartureAt);
  if (at < now - 30_000) return null;
  return {
    id: `transfer:${trip.firstRoute}:${trip.boardStopName}`,
    route: trip.firstRoute,
    direction: null,
    destination: trip.transferStopName,
    status: 0,
    seconds: null,
    updatedAt: new Date(now).toISOString(),
    stopName: trip.boardStopName,
    scheduledAt: trip.firstDepartureAt,
  };
}

export function pickTransferArrival(
  arrivals: readonly TransitArrival[],
  trip: TransferTrip,
  now: number,
): TransitArrival | null {
  const boardPlace = campusPlaceLabel(trip.boardStopName);
  const candidates = arrivals.filter((arrival) => {
    if (arrival.route !== trip.firstRoute) return false;
    if (arrival.stopName === trip.boardStopName) return true;
    const arrivalPlace = campusPlaceLabel(arrival.stopName ?? '');
    return Boolean(boardPlace) && boardPlace === arrivalPlace;
  });
  if (candidates.length) {
    const rank = (arrival: TransitArrival): [number, number] => {
      const view = campusEtaView(arrival, now);
      if (view.kind === 'soon' || view.kind === 'live') return [0, view.minutes ?? 0];
      if ((view.kind === 'scheduled' || view.kind === 'night') && arrival.scheduledAt) return [1, Date.parse(arrival.scheduledAt)];
      return [2, 0];
    };
    const live = [...candidates].sort((a, b) => {
      const left = rank(a);
      const right = rank(b);
      return left[0] - right[0] || left[1] - right[1];
    })[0];
    if (live) return live;
  }
  return scheduledTransferArrival(trip, now);
}

export function withTransferArrivals(
  trips: readonly TransferTrip[],
  arrivals: readonly TransitArrival[],
  now: number,
): TransferTrip[] {
  return trips.map((trip) => ({
    ...trip,
    arrival: pickTransferArrival(arrivals, trip, now) ?? scheduledTransferArrival(trip, now),
  }));
}

export function transferPlannerQuery(
  origin: Position,
  destination: DirectDestination | null,
  now: number,
): MaasPlannerQuery | null {
  if (!destination || destination.lat === null || destination.lon === null) return null;
  const dest = { lat: destination.lat, lon: destination.lon };
  if (!isPosition(origin) || !isPosition(dest) || !isAllowedMaasDestination(dest)) return null;
  return { origin: clampMaasOrigin(origin), destination: dest, departureAt: now };
}

export function defaultTransferOrigin(origin?: Position | null): Position {
  return origin && isPosition(origin) ? origin : PROVIDENCE_DIRECT_ORIGIN;
}

export function maasUrlHasArrivalParam(url: string): boolean {
  return /[?&]arrival=/.test(url);
}
