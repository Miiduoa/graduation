import { describe, expect, it } from 'vitest';
import catalog from '../data/taichung-transit-catalog.json';
import { findCatalogStopsByName, searchTaichungCatalog, TAICHUNG_CATALOG_METADATA } from './transit-catalog';
import { distanceMetres } from './transit';

describe('bundled Taichung static transit catalog', () => {
  it('returns real PU stop variants with source/date/routes, retaining opposite directions', () => {
    const result = searchTaichungCatalog({ action: 'campus', schoolId: 'pu' });
    expect(result.stops).toHaveLength(16);
    expect(result.limited).toBe(false);
    expect(new Set(result.stops.map((stop) => stop.id)).size).toBe(16);
    for (const stop of result.stops) {
      expect(stop.name).toContain('靜宜大學');
      expect(stop.city).toBe('Taichung');
      expect(stop.source).toBe('taichung-open-data');
      expect(stop.catalogDate).toBe(TAICHUNG_CATALOG_METADATA.catalogDate);
      expect(stop.distance).toBeNull();
      expect(stop.routes.length).toBeGreaterThan(0);
    }
    const names = result.stops.filter((stop) => stop.name === '靜宜大學(英才路)');
    expect(new Set(names.map((stop) => `${stop.lat},${stop.lon}`)).size).toBeGreaterThan(1);
    expect(new Set(names.flatMap((stop) => stop.routes.map((route) => route.direction)))).toEqual(new Set(['去', '返']));
    expect(searchTaichungCatalog({ action: 'campus', schoolId: 'ncku' })).toEqual({ stops: [], limited: false });
  });

  it('searches station names, accepts 台/臺 variants, and reports truncation after 16 matches', () => {
    const result = searchTaichungCatalog({ action: 'search', text: '路口' });
    expect(result.stops).toHaveLength(16);
    expect(result.limited).toBe(true);
    expect(result.stops.every((stop) => stop.name.includes('路口'))).toBe(true);
    expect(searchTaichungCatalog({ action: 'search', text: ' 台中車站 ' })).toEqual(searchTaichungCatalog({ action: 'search', text: '臺中車站' }));
    expect(searchTaichungCatalog({ action: 'search', text: '不存在的站牌XYZ' })).toEqual({ stops: [], limited: false });
    expect(searchTaichungCatalog({ action: 'search', text: ' ' })).toEqual({ stops: [], limited: false });
  });

  it('filters and orders nearby results by actual coordinates instead of route names', () => {
    const query = { action: 'nearby' as const, lat: 24.227, lon: 120.575, radius: 1000 };
    const result = searchTaichungCatalog(query);
    const matching = catalog.stops.filter((stop) => distanceMetres(query, stop) <= query.radius);
    expect(result.stops.length).toBe(Math.min(16, matching.length));
    expect(result.limited).toBe(matching.length > 16);
    const distances = result.stops.map((stop) => stop.distance!);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(result.stops.every((stop) => stop.distance === distanceMetres(query, stop) && stop.distance <= query.radius)).toBe(true);
    expect(searchTaichungCatalog({ ...query, lat: NaN })).toEqual({ stops: [], limited: false });
    expect(searchTaichungCatalog({ ...query, radius: -1 })).toEqual({ stops: [], limited: false });
    expect(searchTaichungCatalog({ ...query, lat: 0, lon: 0 })).toEqual({ stops: [], limited: false });
  });

  it('does not let callers mutate the bundled route data', () => {
    const first = searchTaichungCatalog({ action: 'campus', schoolId: 'pu' });
    first.stops[0].routes[0].name = 'modified';
    expect(searchTaichungCatalog({ action: 'campus', schoolId: 'pu' }).stops[0].routes[0].name).not.toBe('modified');
  });

  it('lists more than 16 臺中車站 variants for direct matching', () => {
    const stops = findCatalogStopsByName('臺中車站');
    expect(stops.length).toBeGreaterThan(16);
    expect(stops.some((stop) => stop.name.includes('A月台'))).toBe(true);
    expect(findCatalogStopsByName('x')).toEqual([]);
  });
});
