import catalog from '../data/taichung-transit-catalog.json';
import { distanceMetres } from './transit';

export type TaichungCatalogQuery =
  | { action: 'campus'; schoolId: string }
  | { action: 'search'; text: string }
  | { action: 'nearby'; lat: number; lon: number; radius: number };
export type TaichungCatalogRoute = { name: string; direction: string; destination: string };
export type TaichungCatalogStop = {
  id: string; name: string; city: 'Taichung'; lat: number; lon: number; distance: number | null;
  source: 'taichung-open-data'; catalogDate: string; routes: TaichungCatalogRoute[];
};
export const TAICHUNG_CATALOG_METADATA = Object.freeze({ ...catalog.metadata, source: 'taichung-open-data' as const });
export function normalizeCatalogName(name: string): string {
  return name.normalize('NFKC').trim().replaceAll('台', '臺').toLocaleLowerCase('zh-TW');
}
const indexedStops = catalog.stops.map((stop) => ({ ...stop, normalizedName: normalizeCatalogName(stop.name) }));
function toCatalogStop(stop: (typeof indexedStops)[number], distance: number | null): TaichungCatalogStop {
  return {
    id: stop.id, name: stop.name, lat: stop.lat, lon: stop.lon, city: 'Taichung', distance,
    source: 'taichung-open-data', catalogDate: catalog.metadata.catalogDate,
    routes: stop.routes.map((route) => ({ ...route })),
  };
}

/** 靜宜大學(專用道) 各路線去／返終點，取自已打包的臺中靜態目錄，不另打 TDX。 */
const PROVIDENCE_LANE_DESTINATIONS = (() => {
  const map = new Map<string, string>();
  for (const stop of indexedStops) {
    if (!stop.name.includes('專用道') || !stop.name.includes('靜宜')) continue;
    for (const route of stop.routes) {
      const key = `${route.name}:${route.direction}`;
      if (route.destination && !map.has(key)) map.set(key, route.destination);
    }
  }
  return map;
})();

export function catalogProvidenceLaneDestination(route: string, direction: number | null): string {
  const name = route.trim();
  if (!name) return '';
  if (direction === 0) return PROVIDENCE_LANE_DESTINATIONS.get(`${name}:去`) ?? '';
  if (direction === 1) return PROVIDENCE_LANE_DESTINATIONS.get(`${name}:返`) ?? '';
  return PROVIDENCE_LANE_DESTINATIONS.get(`${name}:去`) || PROVIDENCE_LANE_DESTINATIONS.get(`${name}:返`) || '';
}

/** Server-side bundled snapshot lookup. No credentials, runtime download, or arrival estimates. */
export function searchTaichungCatalog(query: TaichungCatalogQuery): { stops: TaichungCatalogStop[]; limited: boolean } {
  if (query.action === 'campus' && query.schoolId !== 'pu') return { stops: [], limited: false };
  if (query.action === 'nearby' && (!Number.isFinite(query.lat) || !Number.isFinite(query.lon) ||
    Math.abs(query.lat) > 90 || Math.abs(query.lon) > 180 || !Number.isFinite(query.radius) || query.radius <= 0 || query.radius > 5000))
    return { stops: [], limited: false };
  const name = query.action === 'campus' ? '靜宜大學' : query.action === 'search' ? normalizeCatalogName(query.text) : '';
  if (query.action === 'search' && (name.length < 2 || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)))
    return { stops: [], limited: false };
  const matches = indexedStops.flatMap((stop) => {
    if (query.action !== 'nearby' && !stop.normalizedName.includes(name)) return [];
    const distance = query.action === 'nearby' ? distanceMetres(query, stop) : null;
    if (query.action === 'nearby' && distance !== null && distance > query.radius) return [];
    return [{ stop, distance }];
  });
  matches.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0) ||
    Number(b.stop.normalizedName === name) - Number(a.stop.normalizedName === name) ||
    a.stop.name.localeCompare(b.stop.name, 'zh-Hant') || a.stop.id.localeCompare(b.stop.id));
  return {
    limited: matches.length > 16,
    stops: matches.slice(0, 16).map(({ stop, distance }) => toCatalogStop(stop, distance)),
  };
}

/** 直達比對用：不受一般搜尋 16 筆上限限制，仍截在合理筆數，避免把整份名錄送進演算法。 */
export function findCatalogStopsByName(text: string, limit = 80): TaichungCatalogStop[] {
  const name = normalizeCatalogName(text);
  if (name.length < 2 || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name) || limit <= 0) return [];
  const cap = Math.min(Math.floor(limit), 200);
  const matches = indexedStops.filter((stop) => stop.normalizedName.includes(name));
  matches.sort((a, b) =>
    Number(b.normalizedName === name) - Number(a.normalizedName === name) ||
    a.name.localeCompare(b.name, 'zh-Hant') || a.id.localeCompare(b.id));
  return matches.slice(0, cap).map((stop) => toCatalogStop(stop, null));
}
