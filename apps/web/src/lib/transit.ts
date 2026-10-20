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
export type TransitRoute = { name: string; direction: string; destination: string };
export type TransitStop = Position & {
  id: string; name: string; city: TransitCity; distance: number | null;
  source?: 'taichung-open-data'; catalogDate?: string; routes?: TransitRoute[];
};
export const TAICHUNG_BUS_URL = 'https://citybus.taichung.gov.tw/';
export const TAICHUNG_CATALOG_URL = 'https://data.gov.tw/dataset/81555';
export const isStaticTransitStop = (stop: TransitStop): boolean => stop.source === 'taichung-open-data';
export type TransitArrival = {
  id: string; route: string; direction: number | null; destination: string;
  status: number | null; seconds: number | null; updatedAt: string | null;
  stopName?: string; scheduledAt?: string | null;
};
export type TransitQuery =
  | { action: 'campus'; schoolId: string }
  | { action: 'campus-next'; schoolId: string }
  | { action: 'search'; city: TransitCity; text: string }
  | { action: 'nearby'; city: TransitCity; lat: number; lon: number; radius: number }
  | { action: 'arrivals'; city: TransitCity; stopId: string };
export type TransitFailure = 'not-configured' | 'invalid-query' | 'rate-limited' | 'upstream' | 'network';
export type TransitResult =
  | { status: 'ready'; kind: 'stops'; stops: TransitStop[]; limited: boolean; fetchedAt: string; stale?: true }
  | { status: 'ready'; kind: 'arrivals'; arrivals: TransitArrival[]; fetchedAt: string; stale?: true }
  | { status: 'unavailable'; reason: TransitFailure };
export const TRANSIT_FRESHNESS_MS = 90_000;
export const CAMPUS_TRANSIT: Record<string, { city: TransitCity; stopName: string }> = {
  pu: { city: 'Taichung', stopName: '靜宜大學' },
  ncku: { city: 'Tainan', stopName: '成大' },
  ntpu: { city: 'NewTaipei', stopName: '臺北大學' },
};
/** 靜宜校門口這四班：查詢仍走 TDX 到站，不寫死分鐘數。 */
export const CAMPUS_NEXT = {
  pu: {
    city: 'Taichung' as TransitCity,
    stopName: '靜宜大學',
    routes: [
      { name: '162', routeUid: 'TXG162' },
      { name: '301', routeUid: 'TXG301' },
      { name: '368', routeUid: 'TXG368' },
      { name: '326', routeUid: 'TXG326' },
    ],
  },
} as const;
export type CampusNextSchoolId = keyof typeof CAMPUS_NEXT;
export const hasCampusNext = (schoolId: string): schoolId is CampusNextSchoolId =>
  Object.hasOwn(CAMPUS_NEXT, schoolId);
export const CAMPUS_NEXT_ROUTES = CAMPUS_NEXT.pu.routes.map((route) => route.name);

export type RouteStopPoint = { id: string; name: string };
export type RouteStopSequence = {
  routeUid: string; subRouteUid: string; routeName: string; direction: number; stops: RouteStopPoint[];
};
export type CampusHeadingBucket = '往沙鹿' | '往市區' | '往校內' | '';
export type CampusPlaceLabel = '校門口' | '英才路側' | '專用道' | '校內';
export const CAMPUS_GROUP_LIMIT = 4;
export const CAMPUS_GROUP_ORDER = [
  '校門口・往沙鹿', '校門口・往市區', '英才路側', '專用道', '校門口・往校內', '校內',
] as const;
export type CampusStopGroup = { label: string; stops: TransitStop[]; representative: TransitStop };

const CAMPUS_NAME = /靜宜/;
const HEADING_LANDMARKS: ReadonlyArray<{ test: RegExp; label: string }> = [
  { test: /沙鹿車站/, label: '沙鹿火車站' },
  { test: /臺中車站|台中車站/, label: '台中車站' },
  { test: /新民高中/, label: '新民高中' },
  { test: /新光里/, label: '新光里' },
  { test: /嘉陽高中/, label: '嘉陽高中' },
  { test: /巨業沙鹿/, label: '巨業沙鹿站' },
  { test: /臺中榮總|台中榮總/, label: '臺中榮總' },
  { test: /幼獅/, label: '幼獅工業區' },
  { test: /清水/, label: '清水' },
  { test: /梧棲/, label: '梧棲' },
  { test: /臺中港|台中港/, label: '臺中港' },
];

export function isCampusStopName(name: string): boolean {
  return CAMPUS_NAME.test(name);
}
export function publicPlaceName(name: string): string {
  const value = name.trim();
  if (!value) return '';
  if (isCampusStopName(value)) return '校內';
  for (const landmark of HEADING_LANDMARKS) {
    if (landmark.test.test(value)) return landmark.label;
  }
  return value.replace(/[（(].*$/, '').trim() || value;
}
export function publicHeadingFromStops(remainingNames: readonly string[]): string {
  const afterCampus = remainingNames.filter((stop) => !isCampusStopName(stop));
  if (!afterCampus.length) return remainingNames.length ? '校內' : '';
  for (const landmark of HEADING_LANDMARKS) {
    if (afterCampus.some((stop) => landmark.test.test(stop))) return landmark.label;
  }
  return publicPlaceName(afterCampus[afterCampus.length - 1] ?? '');
}
export function headingAfterBoarding(
  sequence: RouteStopSequence, boardingId: string, boardingName = '',
): string {
  let index = boardingId ? sequence.stops.findIndex((stop) => stop.id === boardingId) : -1;
  if (index < 0 && boardingName) {
    index = sequence.stops.findIndex((stop) => stop.name === boardingName ||
      (isCampusStopName(boardingName) && stop.name === boardingName));
  }
  if (index >= 0) return publicHeadingFromStops(sequence.stops.slice(index + 1).map((stop) => stop.name));
  const last = sequence.stops[sequence.stops.length - 1]?.name ?? '';
  return publicPlaceName(last);
}
export function headingBucket(heading: string): CampusHeadingBucket {
  if (!heading) return '';
  if (heading === '校內') return '往校內';
  if (/沙鹿|嘉陽/.test(heading)) return '往沙鹿';
  if (/台中車站|臺中車站|新民高中|新光里|榮總/.test(heading)) return '往市區';
  return '';
}
export function campusPlaceLabel(name: string): CampusPlaceLabel | '' {
  if (!isCampusStopName(name)) return '';
  if (name.includes('專用道')) return '專用道';
  if (name.includes('英才')) return '英才路側';
  if (/主顧|靜園/.test(name)) return '校內';
  return '校門口';
}
export function campusGroupLabel(place: CampusPlaceLabel | '', bucket: CampusHeadingBucket): string {
  if (place === '校門口' && bucket === '往沙鹿') return '校門口・往沙鹿';
  if (place === '校門口' && bucket === '往市區') return '校門口・往市區';
  if (place === '英才路側' && bucket === '往沙鹿') return '校門口・往沙鹿';
  if (place === '校門口' && bucket === '往校內') return '校門口・往校內';
  return place || '';
}
export function campusStopGroupLabels(stop: TransitStop): string[] {
  const place = campusPlaceLabel(stop.name);
  if (!place) return [stop.name];
  const headings = [...new Set((stop.routes ?? []).map((route) => publicPlaceName(route.destination)).filter(Boolean))];
  if (!headings.length) return [place];
  return [...new Set(headings.map((heading) => campusGroupLabel(place, headingBucket(heading))).filter(Boolean))];
}
export function arrivalMatchesCampusGroup(arrival: TransitArrival, label: string): boolean {
  const heading = publicPlaceName(arrival.destination);
  const place = campusPlaceLabel(arrival.stopName ?? '');
  if (!place) return publicPlaceName(label) === heading || label.includes(headingBucket(heading));
  return campusGroupLabel(place, headingBucket(heading)) === label;
}
function pickGroupRepresentative(label: string, stops: TransitStop[]): TransitStop {
  const ranked = [...stops].sort((a, b) => {
    const score = (stop: TransitStop) => {
      if (label.startsWith('校門口') && stop.name.includes('校門')) return 0;
      if (label === '校門口・往沙鹿' && stop.name.includes('英才')) return 1;
      if (label === '校門口・往市區' && stop.name === '靜宜大學') return 1;
      if (label === '專用道' && stop.name.includes('專用道')) return 0;
      return 2;
    };
    return score(a) - score(b) || a.name.localeCompare(b.name, 'zh-Hant') || a.id.localeCompare(b.id);
  });
  const first = ranked[0] ?? stops[0];
  const routes: TransitRoute[] = [];
  const seen = new Set<string>();
  for (const stop of stops) {
    for (const route of stop.routes ?? []) {
      const rewritten = { ...route, destination: publicPlaceName(route.destination) || route.destination };
      const key = `${rewritten.name}:${rewritten.direction}:${rewritten.destination}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push(rewritten);
    }
  }
  return routes.length ? { ...first, routes } : first;
}
export function groupCampusStops(stops: TransitStop[]): CampusStopGroup[] {
  const buckets = new Map<string, TransitStop[]>();
  for (const stop of stops) {
    for (const label of campusStopGroupLabels(stop)) {
      const list = buckets.get(label) ?? [];
      if (!list.some((entry) => entry.id === stop.id && entry.city === stop.city)) list.push(stop);
      buckets.set(label, list);
    }
  }
  const ranked = [
    ...CAMPUS_GROUP_ORDER.filter((label) => buckets.has(label)),
    ...[...buckets.keys()].filter((label) => !CAMPUS_GROUP_ORDER.includes(label as typeof CAMPUS_GROUP_ORDER[number]))
      .sort((a, b) => a.localeCompare(b, 'zh-Hant')),
  ];
  return ranked.map((label) => ({
    label, stops: buckets.get(label)!, representative: pickGroupRepresentative(label, buckets.get(label)!),
  }));
}
export function listedCampusStops(stops: TransitStop[]): { listed: TransitStop[]; extra: CampusStopGroup[] } {
  const groups = groupCampusStops(stops);
  const primary = groups.slice(0, CAMPUS_GROUP_LIMIT);
  return {
    listed: primary.map((group) => ({ ...group.representative, name: group.label })),
    extra: groups.slice(CAMPUS_GROUP_LIMIT),
  };
}

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
export function taipeiClock(iso: string): string | null {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toLocaleTimeString('zh-TW', {
    timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
export function scheduledLabel(arrival: TransitArrival, now: number): string | null {
  if (!arrival.scheduledAt) return null;
  const timestamp = Date.parse(arrival.scheduledAt);
  if (!Number.isFinite(timestamp) || timestamp < now - 30_000) return null;
  const clock = taipeiClock(arrival.scheduledAt);
  return clock ? `表定 ${clock}（非即時）` : null;
}
export function arrivalLabel(arrival: TransitArrival, now: number): string {
  const timestamp = arrival.updatedAt ? Date.parse(arrival.updatedAt) : NaN;
  const fresh = Number.isFinite(timestamp) && timestamp <= now + 30_000 && now - timestamp < TRANSIT_FRESHNESS_MS;
  if (fresh && arrival.status === 0 && arrival.seconds !== null && Number.isFinite(arrival.seconds) && arrival.seconds >= 0) {
    const remaining = arrival.seconds - Math.max(0, now - timestamp) / 1000;
    if (remaining >= -30) return remaining <= 60 ? '即將到站' : `約 ${Math.ceil(remaining / 60)} 分鐘`;
    const liveScheduled = scheduledLabel(arrival, now);
    if (liveScheduled) return liveScheduled;
    return '等待更新';
  }
  const scheduled = scheduledLabel(arrival, now);
  if (scheduled) return scheduled;
  if (!fresh) return '資料待更新';
  const statuses: Record<number, string> = { 1: '尚未發車', 2: '交管不停靠', 3: '末班車已駛離', 4: '今日未營運' };
  if (arrival.status !== null && statuses[arrival.status]) return statuses[arrival.status];
  return '暫無到站預估';
}
export function directionLabel(arrival: TransitArrival): string {
  const heading = publicPlaceName(arrival.destination) || arrival.destination;
  if (heading) return `往 ${heading}`;
  // 到站資料本身常未提供終點，伺服器會以 TDX 路線站序離開靜宜後的大站補上；
  // 兩者都沒有時只寫「去程／返程」學生無法判斷往哪裡，明講終點未提供，
  // 避免把方向代碼假裝成可判斷的方向。
  return arrival.direction === 0 ? '去程（終點未提供）' : arrival.direction === 1 ? '返程（終點未提供）' : '方向未提供';
}
export type ArrivalKind = 'live' | 'not-started' | 'ended' | 'stale' | 'other';
export function arrivalKind(arrival: TransitArrival, now: number): ArrivalKind {
  const timestamp = arrival.updatedAt ? Date.parse(arrival.updatedAt) : NaN;
  if (!Number.isFinite(timestamp) || timestamp > now + 30_000 || now - timestamp >= TRANSIT_FRESHNESS_MS) return 'stale';
  if (arrival.status === 1) return 'not-started';
  if (arrival.status === 3 || arrival.status === 4) return 'ended';
  if (arrival.status !== 0 || arrival.seconds === null || !Number.isFinite(arrival.seconds) || arrival.seconds < 0) return 'other';
  const remaining = arrival.seconds - Math.max(0, now - timestamp) / 1000;
  return remaining < -30 ? 'stale' : 'live';
}
export function nextLiveArrival(arrivals: TransitArrival[], now: number): TransitArrival | null {
  let best: TransitArrival | null = null;
  let bestRemaining = Infinity;
  for (const arrival of arrivals) {
    if (arrivalKind(arrival, now) !== 'live' || arrival.seconds === null || !arrival.updatedAt) continue;
    const remaining = arrival.seconds - Math.max(0, now - Date.parse(arrival.updatedAt)) / 1000;
    if (remaining < bestRemaining) { best = arrival; bestRemaining = remaining; }
  }
  return best;
}
export function campusStopRank(name: string): number {
  if (name.includes('校門')) return 0;
  if (/英才|專用道|主顧|靜園/.test(name)) return 2;
  if (name.includes('靜宜大學')) return 1;
  return 3;
}
export type CampusNextRow = { route: string; heading: string; arrival: TransitArrival | null };
function liveRemaining(arrival: TransitArrival, now: number): number | null {
  if (arrivalKind(arrival, now) !== 'live' || arrival.seconds === null || !arrival.updatedAt) return null;
  return arrival.seconds - Math.max(0, now - Date.parse(arrival.updatedAt)) / 1000;
}
function pickCampusArrival(candidates: TransitArrival[], now: number): TransitArrival | null {
  if (!candidates.length) return null;
  const scored = candidates.map((arrival) => ({
    arrival,
    rank: campusStopRank(arrival.stopName ?? ''),
    live: liveRemaining(arrival, now),
    scheduled: arrival.scheduledAt ? Date.parse(arrival.scheduledAt) : NaN,
  }));
  const live = scored.filter((row) => row.live !== null).sort((a, b) => a.rank - b.rank || a.live! - b.live!);
  if (live[0]) return live[0].arrival;
  const scheduled = scored
    .filter((row) => Number.isFinite(row.scheduled) && row.scheduled >= now - 30_000)
    .sort((a, b) => a.rank - b.rank || a.scheduled - b.scheduled);
  if (scheduled[0]) return scheduled[0].arrival;
  const stale = scored
    .filter((row) => arrivalKind(row.arrival, now) === 'stale')
    .sort((a, b) => a.rank - b.rank);
  return stale[0]?.arrival ?? null;
}
export function pickCampusNext(
  arrivals: TransitArrival[],
  now: number,
  routes: readonly string[] = CAMPUS_NEXT_ROUTES,
): CampusNextRow[] {
  const headingRank = (heading: string) => {
    const bucket = headingBucket(heading);
    return bucket === '往沙鹿' ? 0 : bucket === '往市區' ? 1 : bucket === '往校內' ? 2 : 3;
  };
  const rows: CampusNextRow[] = [];
  for (const route of routes) {
    const exact = arrivals.filter((row) => row.route === route);
    if (!exact.length) {
      rows.push({ route, heading: '', arrival: null });
      continue;
    }
    const buckets = new Map<string, TransitArrival[]>();
    for (const arrival of exact) {
      const heading = publicPlaceName(arrival.destination) || arrival.destination;
      const list = buckets.get(heading) ?? [];
      list.push(arrival);
      buckets.set(heading, list);
    }
    const headings = [...buckets.keys()].sort((a, b) => headingRank(a) - headingRank(b) || a.localeCompare(b, 'zh-Hant'));
    for (const heading of headings) {
      rows.push({ route, heading, arrival: pickCampusArrival(buckets.get(heading) ?? [], now) });
    }
  }
  return sortCampusNextRows(rows, now);
}
export function campusGroupForRow(row: CampusNextRow): string {
  const heading = row.heading || (row.arrival ? publicPlaceName(row.arrival.destination) : '');
  const place = (row.arrival ? campusPlaceLabel(row.arrival.stopName ?? '') : '') || '校門口';
  return campusGroupLabel(place, headingBucket(heading)) || place;
}
export function waitingStopLabel(name: string): string {
  const place = campusPlaceLabel(name);
  if (place === '校門口') return '在校門口等';
  if (place === '英才路側') return '在英才路側等';
  if (place === '專用道') return '在專用道等';
  if (place === '校內') return '在校內等';
  return name ? `在${name}等` : '';
}
export type CampusEtaView = { kind: 'live' | 'soon' | 'scheduled' | 'empty'; text: string };
export function campusEtaView(arrival: TransitArrival | null, now: number): CampusEtaView {
  if (!arrival) return { kind: 'empty', text: '沒有班次' };
  const remaining = liveRemaining(arrival, now);
  if (remaining !== null) {
    if (remaining <= 60) return { kind: 'soon', text: '即將進站' };
    return { kind: 'live', text: `${Math.ceil(remaining / 60)} 分` };
  }
  const clock = arrival.scheduledAt ? taipeiClock(arrival.scheduledAt) : null;
  const scheduledAt = arrival.scheduledAt ? Date.parse(arrival.scheduledAt) : NaN;
  if (clock && Number.isFinite(scheduledAt) && scheduledAt >= now - 30_000) {
    return { kind: 'scheduled', text: `表定 ${clock}` };
  }
  return { kind: 'empty', text: '沒有班次' };
}
export function fetchedAgoLabel(fetchedAt: string, now: number): string {
  const timestamp = Date.parse(fetchedAt);
  if (!Number.isFinite(timestamp) || timestamp > now + 5_000) return '重新整理';
  const ago = Math.max(0, now - timestamp);
  if (ago < 20_000) return '剛剛更新';
  const seconds = Math.max(1, Math.round(ago / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  return `${Math.max(1, Math.round(seconds / 60))} 分鐘前`;
}
export function sortCampusNextRows(rows: CampusNextRow[], now: number): CampusNextRow[] {
  const rank = (row: CampusNextRow): [number, number] => {
    const view = campusEtaView(row.arrival, now);
    if ((view.kind === 'soon' || view.kind === 'live') && row.arrival) return [0, liveRemaining(row.arrival, now) ?? 0];
    if (view.kind === 'scheduled' && row.arrival?.scheduledAt) return [1, Date.parse(row.arrival.scheduledAt)];
    return [2, 0];
  };
  return [...rows].sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    return left[0] - right[0] || left[1] - right[1] ||
      a.route.localeCompare(b.route, 'zh-Hant', { numeric: true }) || a.heading.localeCompare(b.heading, 'zh-Hant');
  });
}
export function stopMapUrl(stop: TransitStop): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lon}&travelmode=walking`;
}
function readTransitRoutes(value: unknown): TransitRoute[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200) return null;
  const routes: TransitRoute[] = [];
  for (const route of value) {
    if (!isRecord(route) || typeof route.name !== 'string' || !route.name.trim() || route.name.length > 120 ||
      typeof route.direction !== 'string' || route.direction.length > 40 ||
      typeof route.destination !== 'string' || route.destination.length > 120) return null;
    routes.push({
      name: route.name,
      direction: route.direction,
      destination: route.destination,
    });
  }
  return routes;
}
function readStop(value: unknown): TransitStop | null {
  if (!isPosition(value) || !isStopId(value.id) || !isCity(value.city) ||
    typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120) return null;
  const stop: TransitStop = { id: value.id, name: value.name, city: value.city, lat: value.lat, lon: value.lon, distance: null };
  if (value.source === undefined && !value.id.startsWith('TCOD_')) {
    const routes = readTransitRoutes(value.routes);
    return routes && routes.length ? { ...stop, routes } : stop;
  }
  // Static identifiers must never lose their provider marker and enter TDX arrival polling.
  if (value.source !== 'taichung-open-data' || value.city !== 'Taichung' || !/^TCOD_[A-Za-z0-9_-]+$/.test(value.id) ||
    typeof value.catalogDate !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.catalogDate) ||
    !Number.isFinite(Date.parse(value.catalogDate)) || Date.parse(value.catalogDate) > Date.now() + 5 * 60_000 ||
    new Date(value.catalogDate).toISOString().replace('.000Z', 'Z') !== value.catalogDate.replace('.000Z', 'Z') ||
    !Array.isArray(value.routes)) return null;
  const routes = readTransitRoutes(value.routes);
  if (!routes) return null;
  return { ...stop, source: 'taichung-open-data', catalogDate: value.catalogDate, routes };
}
export function readSavedStops(raw: string | null): TransitStop[] {
  try {
    const rows: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(rows)) return [];
    const seen = new Set<string>();
    const stops: TransitStop[] = [];
    for (const row of rows) {
      const stop = readStop(row);
      if (!stop) continue;
      const key = `${stop.city}:${stop.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stops.push(stop);
      if (stops.length === 16) break;
    }
    return stops;
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
      ...(result.stale === true ? { stale: true as const } : {}),
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
      (row.updatedAt === null || typeof row.updatedAt === 'string') &&
      (row.stopName === undefined || typeof row.stopName === 'string') &&
      (row.scheduledAt === undefined || row.scheduledAt === null || typeof row.scheduledAt === 'string')).slice(0, 200);
    return { status: 'ready', kind: 'arrivals', arrivals, fetchedAt: result.fetchedAt,
      ...(result.stale === true ? { stale: true as const } : {}) };
  }
  throw new Error('invalid-response');
}
