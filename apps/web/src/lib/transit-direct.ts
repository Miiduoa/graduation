import {
  campusEtaView, campusPlaceLabel, distanceMetres, headingBucket, isCampusStopName, isPosition,
  liveMinutesTrusted, publicPlaceName, waitingStopLabel,
  type Position, type RouteStopSequence, type TransitArrival,
} from './transit';
import {
  findCatalogStopsByName, normalizeCatalogName, searchTaichungCatalog, type TaichungCatalogStop,
} from './transit-catalog';

/**
 * 靜宜校門（沒有定位時的出發點，也是 TDX 旅運規劃起點）。
 *
 * OSM 閘門 node 4692506551 為 24.225714, 120.577096，落在臺灣大道西側，
 * 實測會讓旅運規劃把首段走到校外。改用 OSM 公車站
 * 「Providence University(Main Gate)」node 9612420907
 * https://www.openstreetmap.org/node/9612420907
 * （2026-10-25 查詢：24.2253877, 120.5775610）。
 * 交叉核對：臺中站牌快照「靜宜大學（校門）」24.2253, 120.577797；
 * 校方「如何到靜宜」GPS 24.2257, 120.5772
 * https://www.pu.edu.tw/p/406-1000-2733,r192.php?Lang=zh-tw
 */
export const PROVIDENCE_DIRECT_ORIGIN: Position = { lat: 24.225388, lon: 120.577561 };
/**
 * 主顧樓建築中心（校內目的地與 TDX 迄點）。
 *
 * OSM way 255784268「主顧樓」範圍中心 24.226939, 120.583587
 * https://www.openstreetmap.org/way/255784268 （校園地圖 2026-10-19 核對）。
 * 公車站「靜宜大學主顧樓」在 24.226601, 120.583099，偏西約 50 公尺，
 * 不當作出發／迄點以免旅運規劃把人放到樓西側。
 * Google 地圖地點 24.227105, 120.583577 相距約 18 公尺、同一棟。
 */
export const PROVIDENCE_ZHUGU_HALL: Position = { lat: 24.226939, lon: 120.583587 };
export const DIRECT_WALKING_METERS_PER_MINUTE = 80;
export const DIRECT_TRIP_LIMIT = 6;
export type DirectDestinationKind = 'landmark' | 'campus-place' | 'stop';
export type DirectEvidence = 'sequence' | 'terminus' | 'catalog';
export type DirectDestination = {
  query: string;
  label: string;
  kind: DirectDestinationKind;
  lat: number | null;
  lon: number | null;
  matchNames: readonly string[];
};
export type DirectTrip = {
  route: string;
  boardStopName: string;
  alightStopName: string;
  walkMeters: number;
  walkMinutes: number;
  arrival: TransitArrival | null;
  evidence: DirectEvidence;
};
export type DirectPlan = {
  destination: DirectDestination | null;
  origin: Position;
  trips: DirectTrip[];
  googleMapsUrl: string;
};

export const PROVIDENCE_DIRECT_CHIPS = [
  { label: '沙鹿車站', query: '沙鹿車站' },
  { label: '臺中車站', query: '臺中車站' },
  { label: '主顧樓', query: '主顧樓' },
  { label: '靜園餐廳', query: '靜園餐廳' },
  { label: '巨業沙鹿站', query: '巨業沙鹿站' },
  { label: '高鐵臺中站', query: '高鐵臺中站' },
] as const;

const LANDMARKS: ReadonlyArray<{ label: string; aliases: readonly string[] }> = [
  { label: '沙鹿車站', aliases: ['沙鹿車站', '沙鹿火車站', '沙鹿車站'] },
  { label: '臺中車站', aliases: ['臺中車站', '台中車站', '臺中火車站', '台中火車站'] },
  { label: '高鐵臺中站', aliases: ['高鐵臺中站', '高鐵台中站', '高鐵臺中', '高鐵台中'] },
  { label: '逢甲', aliases: ['逢甲', '逢甲夜市', '逢甲大學'] },
  { label: '巨業沙鹿站', aliases: ['巨業沙鹿站', '巨業沙鹿'] },
];

const CAMPUS_PLACES: ReadonlyArray<{ label: string; aliases: readonly string[]; lat: number; lon: number }> = [
  { label: '主顧樓', aliases: ['主顧樓', 'ph'], lat: PROVIDENCE_ZHUGU_HALL.lat, lon: PROVIDENCE_ZHUGU_HALL.lon },
  { label: '任垣樓', aliases: ['任垣樓', 'ak'], lat: 24.226415, lon: 120.580067 },
  { label: '伯鐸樓', aliases: ['伯鐸樓', 'sp'], lat: 24.22606, lon: 120.580649 },
  { label: '文興樓', aliases: ['文興樓'], lat: 24.226953, lon: 120.581189 },
  { label: '格倫樓', aliases: ['格倫樓', 'tg'], lat: 24.226197, lon: 120.583373 },
  { label: '方濟樓', aliases: ['方濟樓', 'sf'], lat: 24.227864, lon: 120.583509 },
  { label: '思源樓', aliases: ['思源樓', 'sy'], lat: 24.226931, lon: 120.582346 },
  { label: '靜安樓', aliases: ['靜安樓', 'ja'], lat: 24.226214, lon: 120.5823 },
  { label: '至善樓', aliases: ['至善樓'], lat: 24.228147, lon: 120.579773 },
  { label: '蓋夏圖書館', aliases: ['蓋夏圖書館', '圖書館'], lat: 24.226282, lon: 120.581377 },
  { label: '主顧聖母堂', aliases: ['主顧聖母堂', '主顧堂'], lat: 24.228164, lon: 120.581515 },
  { label: '靜園餐廳', aliases: ['靜園餐廳'], lat: 24.227517, lon: 120.58157 },
  { label: '宜園餐廳', aliases: ['宜園餐廳'], lat: 24.227152, lon: 120.579543 },
  { label: '希嘉學苑', aliases: ['希嘉學苑'], lat: 24.228017, lon: 120.58067 },
  { label: '思高學苑', aliases: ['思高學苑'], lat: 24.22906, lon: 120.58206 },
  { label: '若望保祿二世體育館', aliases: ['若望保祿二世體育館', '體育館', 'st'], lat: 24.229194, lon: 120.581062 },
];

export function walkingMinutesFromMeters(distanceInMeters: number): number | null {
  if (!Number.isFinite(distanceInMeters) || distanceInMeters < 0) return null;
  return Math.max(1, Math.round(distanceInMeters / DIRECT_WALKING_METERS_PER_MINUTE));
}

export function googleTransitUrl(origin: Position, destination: Position | string): string {
  const dest = typeof destination === 'string'
    ? destination.slice(0, 80)
    : `${destination.lat},${destination.lon}`;
  const params = new URLSearchParams({
    api: '1',
    origin: `${origin.lat},${origin.lon}`,
    destination: dest,
    travelmode: 'transit',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function suggestDirectDestinations(raw: string): Array<{ label: string; query: string }> {
  const seen = new Set<string>();
  const options: Array<{ label: string; query: string }> = [];
  const add = (label: string, query: string) => {
    const key = normalizeCatalogName(query);
    if (!key || seen.has(key)) return;
    seen.add(key);
    options.push({ label, query });
  };
  for (const chip of PROVIDENCE_DIRECT_CHIPS) add(chip.label, chip.query);
  for (const place of CAMPUS_PLACES) add(place.label, place.label);
  for (const landmark of LANDMARKS) add(landmark.label, landmark.label);
  const term = normalizeCatalogName(raw);
  if (!term) return options.slice(0, 12);
  return options.filter((item) =>
    normalizeCatalogName(item.label).includes(term) || normalizeCatalogName(item.query).includes(term));
}

function aliasHit(value: string, aliases: readonly string[]): boolean {
  const name = normalizeCatalogName(value);
  return aliases.some((alias) => {
    const key = normalizeCatalogName(alias);
    return name === key || name.includes(key) || key.includes(name);
  });
}

function stopMatchesDestination(stopName: string, destination: DirectDestination): boolean {
  const name = normalizeCatalogName(stopName);
  if (!name) return false;
  return destination.matchNames.some((entry) => {
    const key = normalizeCatalogName(entry);
    if (!key) return false;
    if (name === key) return true;
    if (name.includes(key) && key.length >= 2) return true;
    return false;
  });
}

function pickStopCoords(stops: readonly TaichungCatalogStop[], destination: DirectDestination): Position | null {
  const ranked = [...stops].sort((a, b) =>
    Number(stopMatchesDestination(b.name, destination)) - Number(stopMatchesDestination(a.name, destination)) ||
    a.name.localeCompare(b.name, 'zh-Hant'));
  const first = ranked.find((stop) => isPosition(stop));
  return first ? { lat: first.lat, lon: first.lon } : null;
}

export function resolveDirectDestination(
  raw: string,
  catalogStops: readonly TaichungCatalogStop[] = [],
): DirectDestination | null {
  const query = raw.normalize('NFKC').trim();
  if (query.length < 2 || query.length > 40) return null;
  const place = CAMPUS_PLACES.find((entry) => aliasHit(query, entry.aliases));
  if (place) {
    return {
      query, label: place.label, kind: 'campus-place', lat: place.lat, lon: place.lon,
      matchNames: [place.label, `靜宜大學${place.label}`, ...place.aliases],
    };
  }
  const landmark = LANDMARKS.find((entry) => aliasHit(query, entry.aliases));
  if (landmark) {
    const coords = pickStopCoords(catalogStops, {
      query, label: landmark.label, kind: 'landmark', lat: null, lon: null, matchNames: landmark.aliases,
    });
    return {
      query, label: landmark.label, kind: 'landmark',
      lat: coords?.lat ?? null, lon: coords?.lon ?? null,
      matchNames: landmark.aliases,
    };
  }
  const matched = catalogStops.filter((stop) =>
    normalizeCatalogName(stop.name).includes(normalizeCatalogName(query)));
  const best = matched[0];
  if (!best) return null;
  return {
    query, label: best.name.replace(/[（(].*$/, '').trim() || best.name, kind: 'stop',
    lat: best.lat, lon: best.lon, matchNames: [query, best.name],
  };
}

function isAfterOnRoute(board: Position, alight: Position, terminus: Position | null): boolean {
  if (!terminus) return false;
  return distanceMetres(alight, terminus) + 40 < distanceMetres(board, terminus);
}

function terminusStop(routeName: string, direction: string, terminusName: string): TaichungCatalogStop | null {
  const short = terminusName.replace(/[（(].*$/, '').trim() || terminusName;
  if (short.length < 2) return null;
  const hits = findCatalogStopsByName(short, 24);
  const key = normalizeCatalogName(terminusName);
  const ranked = hits.filter((stop) =>
    stop.routes.some((route) => route.name === routeName && route.direction === direction));
  const pool = ranked.length ? ranked : hits;
  return pool.sort((a, b) =>
    Number(normalizeCatalogName(b.name) === key) - Number(normalizeCatalogName(a.name) === key) ||
    a.name.localeCompare(b.name, 'zh-Hant'))[0] ?? null;
}

function walkTo(origin: Position, stop: Position): { walkMeters: number; walkMinutes: number } {
  const walkMeters = Math.round(distanceMetres(origin, stop));
  return { walkMeters, walkMinutes: walkingMinutesFromMeters(walkMeters) ?? 1 };
}

function tripKey(trip: Pick<DirectTrip, 'route' | 'boardStopName' | 'alightStopName'>): string {
  return `${trip.route}:${trip.boardStopName}:${trip.alightStopName}`;
}

function arrivalFitsTrip(arrival: TransitArrival, trip: DirectTrip, destination: DirectDestination): boolean {
  if (arrival.route !== trip.route) return false;
  const boardPlace = campusPlaceLabel(trip.boardStopName);
  const arrivalPlace = campusPlaceLabel(arrival.stopName ?? '');
  const sameStop = arrival.stopName === trip.boardStopName ||
    (Boolean(boardPlace) && boardPlace === arrivalPlace);
  if (!sameStop) return false;
  if (!liveMinutesTrusted(arrival)) return false;
  const heading = publicPlaceName(arrival.destination) || arrival.destination;
  if (!heading) return true;
  if (stopMatchesDestination(heading, destination)) return true;
  if (destination.kind !== 'campus-place' && headingBucket(heading) === '往校內') return false;
  if (destination.kind === 'campus-place' && headingBucket(heading) && headingBucket(heading) !== '往校內') return false;
  return headingBucket(heading) !== '';
}

function pickTripArrival(arrivals: readonly TransitArrival[], trip: DirectTrip, destination: DirectDestination, now: number): TransitArrival | null {
  const candidates = arrivals.filter((arrival) => arrivalFitsTrip(arrival, trip, destination));
  if (!candidates.length) return null;
  const rank = (arrival: TransitArrival): [number, number] => {
    const view = campusEtaView(arrival, now);
    if (view.kind === 'soon' || view.kind === 'live') return [0, view.minutes ?? 0];
    if ((view.kind === 'scheduled' || view.kind === 'night') && arrival.scheduledAt) return [1, Date.parse(arrival.scheduledAt)];
    if (view.kind === 'ended') return [3, 0];
    return [2, 0];
  };
  return [...candidates].sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    return left[0] - right[0] || left[1] - right[1];
  })[0] ?? null;
}

function sequenceTrips(
  origin: Position,
  destination: DirectDestination,
  campusStops: readonly TaichungCatalogStop[],
  sequences: readonly RouteStopSequence[],
): DirectTrip[] {
  const trips: DirectTrip[] = [];
  for (const sequence of sequences) {
    if (!sequence.routeName) continue;
    const alightAt = sequence.stops
      .map((stop, index) => stopMatchesDestination(stop.name, destination) ? index : -1)
      .filter((index) => index >= 0);
    const campusAt = sequence.stops
      .map((stop, index) => isCampusStopName(stop.name) ? index : -1)
      .filter((index) => index >= 0);
    for (const alightIndex of alightAt) {
      const boardIndexes = campusAt.filter((index) => index < alightIndex);
      if (!boardIndexes.length) continue;
      const boardChoices = boardIndexes.map((index) => {
        const stop = sequence.stops[index]!;
        const located = campusStops.find((entry) => entry.name === stop.name)
          ?? campusStops.find((entry) => campusPlaceLabel(entry.name) === campusPlaceLabel(stop.name));
        return { stop, located };
      }).filter((entry) => entry.located);
      boardChoices.sort((a, b) => distanceMetres(origin, a.located!) - distanceMetres(origin, b.located!));
      const chosen = boardChoices[0];
      if (!chosen?.located) continue;
      const alight = sequence.stops[alightIndex]!;
      if (chosen.stop.name === alight.name) continue;
      trips.push({
        route: sequence.routeName,
        boardStopName: chosen.stop.name,
        alightStopName: alight.name,
        ...walkTo(origin, chosen.located),
        arrival: null,
        evidence: 'sequence',
      });
    }
  }
  return trips;
}

function catalogTrips(
  origin: Position,
  destination: DirectDestination,
  campusStops: readonly TaichungCatalogStop[],
  destinationStops: readonly TaichungCatalogStop[],
): DirectTrip[] {
  const trips: DirectTrip[] = [];
  for (const campus of campusStops) {
    if (!isCampusStopName(campus.name)) continue;
    for (const route of campus.routes) {
      const terminusName = route.destination;
      const terminusHit = stopMatchesDestination(terminusName, destination);
      const destHits = destinationStops.filter((stop) =>
        stop.id !== campus.id &&
        stopMatchesDestination(stop.name, destination) &&
        stop.routes.some((entry) => entry.name === route.name && entry.direction === route.direction));
      if (terminusHit) {
        const alight = destHits[0] ?? {
          name: terminusName.replace(/[（(].*$/, '').trim() || terminusName,
          lat: destination.lat ?? campus.lat,
          lon: destination.lon ?? campus.lon,
        };
        if (alight.name !== campus.name) {
          trips.push({
            route: route.name,
            boardStopName: campus.name,
            alightStopName: alight.name,
            ...walkTo(origin, campus),
            arrival: null,
            evidence: 'terminus',
          });
        }
        continue;
      }
      const terminus = terminusStop(route.name, route.direction, terminusName);
      for (const destStop of destHits) {
        if (destStop.name === campus.name) continue;
        if (!isAfterOnRoute(campus, destStop, terminus)) continue;
        trips.push({
          route: route.name,
          boardStopName: campus.name,
          alightStopName: destStop.name,
          ...walkTo(origin, campus),
          arrival: null,
          evidence: 'catalog',
        });
      }
    }
  }
  return trips;
}

function mergeTrips(rows: DirectTrip[]): DirectTrip[] {
  const rank = (evidence: DirectEvidence) => evidence === 'sequence' ? 0 : evidence === 'terminus' ? 1 : 2;
  const best = new Map<string, DirectTrip>();
  for (const trip of rows) {
    const key = tripKey(trip);
    const current = best.get(key);
    if (!current || rank(trip.evidence) < rank(current.evidence) ||
      (trip.evidence === current.evidence && trip.walkMeters < current.walkMeters)) {
      best.set(key, trip);
    }
  }
  return [...best.values()];
}

function sortTrips(trips: DirectTrip[], now: number): DirectTrip[] {
  const rank = (trip: DirectTrip): [number, number, number] => {
    const view = campusEtaView(trip.arrival, now);
    if (view.kind === 'soon') return [0, 0, trip.walkMinutes];
    if (view.kind === 'live') return [0, view.minutes ?? 99, trip.walkMinutes];
    if (view.kind === 'scheduled' || view.kind === 'night') {
      return [1, trip.arrival?.scheduledAt ? Date.parse(trip.arrival.scheduledAt) : 0, trip.walkMinutes];
    }
    if (view.kind === 'ended') return [2, 0, trip.walkMinutes];
    return [3, 0, trip.walkMinutes];
  };
  return [...trips].sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    return left[0] - right[0] || left[1] - right[1] || left[2] - right[2] ||
      a.route.localeCompare(b.route, 'zh-Hant', { numeric: true });
  });
}

export function planDirectTrips(input: {
  origin: Position;
  destination: DirectDestination;
  campusStops: readonly TaichungCatalogStop[];
  destinationStops: readonly TaichungCatalogStop[];
  sequences: readonly RouteStopSequence[];
  arrivals: readonly TransitArrival[];
  now: number;
}): DirectTrip[] {
  const merged = mergeTrips([
    ...sequenceTrips(input.origin, input.destination, input.campusStops, input.sequences),
    ...catalogTrips(input.origin, input.destination, input.campusStops, input.destinationStops),
  ]).map((trip) => ({
    ...trip,
    arrival: pickTripArrival(input.arrivals, trip, input.destination, input.now),
  }));
  return sortTrips(merged, input.now).slice(0, DIRECT_TRIP_LIMIT);
}

export function loadDirectCatalogStops(destinationQuery: string): {
  campusStops: TaichungCatalogStop[];
  destinationStops: TaichungCatalogStop[];
} {
  return {
    campusStops: searchTaichungCatalog({ action: 'campus', schoolId: 'pu' }).stops,
    destinationStops: findCatalogStopsByName(destinationQuery),
  };
}

export function buildDirectPlan(input: {
  query: string;
  origin?: Position | null;
  sequences?: readonly RouteStopSequence[];
  arrivals?: readonly TransitArrival[];
  now?: number;
}): DirectPlan {
  const origin = input.origin && isPosition(input.origin) ? input.origin : PROVIDENCE_DIRECT_ORIGIN;
  const query = input.query.normalize('NFKC').trim();
  const catalogs = query.length >= 2 ? loadDirectCatalogStops(query) : { campusStops: [], destinationStops: [] };
  const destination = resolveDirectDestination(query, catalogs.destinationStops);
  const mapsTarget = destination && destination.lat !== null && destination.lon !== null
    ? { lat: destination.lat, lon: destination.lon }
    : (destination?.label || query || '靜宜大學');
  const googleMapsUrl = googleTransitUrl(origin, mapsTarget);
  if (!destination) {
    return { destination: null, origin, trips: [], googleMapsUrl };
  }
  const destinationStops = catalogs.destinationStops.length
    ? catalogs.destinationStops
    : findCatalogStopsByName(destination.label);
  const trips = planDirectTrips({
    origin,
    destination,
    campusStops: catalogs.campusStops,
    destinationStops,
    sequences: input.sequences ?? [],
    arrivals: input.arrivals ?? [],
    now: input.now ?? Date.now(),
  });
  return { destination, origin, trips, googleMapsUrl };
}

export function directWaitLine(boardStopName: string): string {
  return waitingStopLabel(boardStopName) || `在${boardStopName}等`;
}

export function isDirectQueryText(value: string): boolean {
  const text = value.normalize('NFKC').trim();
  return text.length >= 2 && text.length <= 40 && !/[\u0000-\u001f\u007f]/.test(text);
}
