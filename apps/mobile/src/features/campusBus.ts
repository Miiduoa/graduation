import { httpsCallable } from 'firebase/functions';
import { collection, getDocsFromServer, query, where } from 'firebase/firestore';
import { getDb, getFunctionsInstance, isFirebaseMockMode } from '../firebase';

export type BusStop = { id: string; name: string; order: number };
export type CampusBusRoute = {
  id: string;
  name: string;
  description: string;
  city: string;
  stops: BusStop[];
};
export type BusArrival = { routeName: string; direction: string; label: string };
export type BusArrivals =
  | { status: 'ready'; arrivals: BusArrival[]; fetchedAt: string }
  | { status: 'unavailable' | 'error'; arrivals: []; fetchedAt: null };
type ObjectData = Record<string, unknown>;
const object = (value: unknown): ObjectData =>
  value && typeof value === 'object' ? (value as ObjectData) : {};
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export const TAICHUNG_BUS_URL = 'https://citybus-free.taichung.gov.tw/';
export const BUS_FRESHNESS_MS = 90_000;

export function normalizeBusRoutes(rows: unknown[], schoolId: string): CampusBusRoute[] {
  return rows.flatMap((entry) => {
    const route = object(entry);
    const name = text(route.name) || text(route.routeName);
    const city = text(route.city) || (schoolId === 'pu' ? 'Taichung' : '');
    if (
      !text(route.id) ||
      !name ||
      !city ||
      route.isActive !== true ||
      route.isDemo === true ||
      route.source === 'demo'
    )
      return [];
    if (route.schoolId && route.schoolId !== schoolId) return [];
    const stops = (Array.isArray(route.stops) ? route.stops : [])
      .flatMap((entry, index) => {
        const stop = object(entry);
        return text(stop.id) && text(stop.name)
          ? [
              {
                id: text(stop.id),
                name: text(stop.name),
                order: typeof stop.order === 'number' ? stop.order : index,
              },
            ]
          : [];
      })
      .sort((left, right) => left.order - right.order);
    return stops.length
      ? [{ id: text(route.id), name, description: text(route.description), city, stops }]
      : [];
  });
}

export async function loadBusRoutes(schoolId: string): Promise<CampusBusRoute[]> {
  if (!schoolId || schoolId.includes('/') || isFirebaseMockMode())
    throw new Error('bus-unavailable');
  const db = getDb();
  let snapshot = await getDocsFromServer(collection(db, 'schools', schoolId, 'busRoutes'));
  if (snapshot.empty)
    snapshot = await getDocsFromServer(
      query(collection(db, 'busRoutes'), where('schoolId', '==', schoolId)),
    );
  return normalizeBusRoutes(
    snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id })),
    schoolId,
  );
}

export function normalizeBusArrivals(
  value: unknown,
  stopId: string,
  now = Date.now(),
): BusArrivals {
  const data = object(value);
  const fetchedAt = typeof data.fetchedAt === 'string' ? Date.parse(data.fetchedAt) : NaN;
  if (
    data.source !== 'tdx' ||
    data.isRealtime !== true ||
    data.noApiKey ||
    data.error ||
    !Array.isArray(data.arrivals) ||
    !Number.isFinite(fetchedAt) ||
    fetchedAt > now + 30_000 ||
    now - fetchedAt >= BUS_FRESHNESS_MS
  )
    return { status: 'unavailable', arrivals: [], fetchedAt: null };

  const arrivals = data.arrivals.flatMap((entry): BusArrival[] => {
    const row = object(entry);
    if (row.stopId !== stopId || !text(row.routeName)) return [];
    const status = row.status;
    const estimate = row.estimatedArrival;
    let label = '暫無到站預估';
    if (
      status === 0 &&
      typeof estimate === 'number' &&
      Number.isFinite(estimate) &&
      estimate >= 0
    ) {
      const seconds = Math.max(0, estimate - Math.max(0, now - fetchedAt) / 1000);
      label = seconds < 60 ? '即將到站' : `約 ${Math.ceil(seconds / 60)} 分鐘`;
    } else if (status === 1) label = '尚未發車';
    else if (status === 2) label = '交管不停靠';
    else if (status === 3) label = '末班車已駛離';
    return [
      {
        routeName: text(row.routeName),
        direction: row.direction === 0 ? '去程' : row.direction === 1 ? '返程' : '',
        label,
      },
    ];
  });
  return { status: 'ready', arrivals, fetchedAt: new Date(fetchedAt).toISOString() };
}

export async function loadBusArrivals(input: {
  schoolId: string;
  stopId: string;
  city: string;
}): Promise<BusArrivals> {
  if (isFirebaseMockMode()) return { status: 'unavailable', arrivals: [], fetchedAt: null };
  try {
    const response = await httpsCallable<typeof input, unknown>(
      getFunctionsInstance(),
      'getBusArrivals',
    )(input);
    return normalizeBusArrivals(response.data, input.stopId);
  } catch {
    return { status: 'error', arrivals: [], fetchedAt: null };
  }
}
