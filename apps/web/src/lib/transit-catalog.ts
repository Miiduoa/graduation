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
const normalizeName = (name: string) => name.normalize('NFKC').trim().replaceAll('台', '臺').toLocaleLowerCase('zh-TW');
const indexedStops = catalog.stops.map((stop) => ({ ...stop, normalizedName: normalizeName(stop.name) }));

/** Server-side bundled snapshot lookup. No credentials, runtime download, or arrival estimates. */
export function searchTaichungCatalog(query: TaichungCatalogQuery): { stops: TaichungCatalogStop[]; limited: boolean } {
  if (query.action === 'campus' && query.schoolId !== 'pu') return { stops: [], limited: false };
  if (query.action === 'nearby' && (!Number.isFinite(query.lat) || !Number.isFinite(query.lon) ||
    Math.abs(query.lat) > 90 || Math.abs(query.lon) > 180 || !Number.isFinite(query.radius) || query.radius <= 0 || query.radius > 5000))
    return { stops: [], limited: false };
  const name = query.action === 'campus' ? '靜宜大學' : query.action === 'search' ? normalizeName(query.text) : '';
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
    stops: matches.slice(0, 16).map(({ stop, distance }) => ({
      id: stop.id, name: stop.name, lat: stop.lat, lon: stop.lon, city: 'Taichung', distance,
      source: 'taichung-open-data', catalogDate: catalog.metadata.catalogDate,
      routes: stop.routes.map((route) => ({ ...route })),
    })),
  };
}
