import { describe, expect, it } from 'vitest';
import { buildCampusSpatialModel } from './campusSpatialModel';
import type { MapLocation } from './mapService';

const place = (id: string, lat: number, lng: number): MapLocation => ({
  id, name: `地點 ${id}`, category: '教學', description: '', lat, lng,
});

describe('campus spatial coordinates', () => {
  it('leaves an empty source unavailable instead of supplying a different campus', () => {
    expect(buildCampusSpatialModel([])).toEqual({
      points: [], extent: { width: 0, depth: 0 }, radius: 0,
      excludedCount: 0, unavailableReason: 'no-locations',
    });
  });

  it('keeps east and north in their geographic direction and distance in meters', () => {
    const model = buildCampusSpatialModel([
      place('origin', 24, 120), place('east', 24, 120.001), place('north', 24.001, 120),
    ]);
    const [origin, east, north] = model.points;
    expect(model.unavailableReason).toBeNull();
    expect(east.x - origin.x).toBeCloseTo(101.58, 1);
    expect(north.z - origin.z).toBeCloseTo(-111.195, 1);
    expect(Math.abs(north.x - origin.x)).toBeLessThan(0.01);
    expect(Math.abs(east.z - origin.z)).toBeLessThan(0.01);
    expect(model.extent.width).toBeCloseTo(101.58, 1);
    expect(model.extent.depth).toBeCloseTo(111.195, 1);
  });

  it('keeps co-located services at one point without inventing physical separation', () => {
    const library = { ...place('library', 24.226282, 120.581377), facilities: ['列印'] };
    const printer = place('printer', library.lat, library.lng);
    const model = buildCampusSpatialModel([library, printer]);
    expect(model.points).toHaveLength(2);
    expect(model.points[0].x).toBe(model.points[1].x);
    expect(model.points[0].z).toBe(model.points[1].z);
    expect(model.extent).toEqual({ width: 0, depth: 0 });
    expect(model.radius).toBeGreaterThan(0);
    expect(model.points[0].location).toBe(library);
    expect(library).toEqual({ ...place('library', 24.226282, 120.581377), facilities: ['列印'] });
  });

  it('rejects invalid coordinates and duplicate ids while preserving a later valid record', () => {
    const good = place('good', 24, 120);
    const model = buildCampusSpatialModel([
      place('bad-lat', 91, 120), place('bad-lng', 24, -181),
      place('nonfinite', NaN, 120), place('infinite', 24, Infinity),
      place('', 24, 120), { ...place('unnamed', 24, 120), name: ' ' },
      place('good', NaN, 120), good, place('good', 24.001, 120.001),
    ]);
    expect(model.excludedCount).toBe(8);
    expect(model.points).toHaveLength(1);
    expect(model.points[0].location).toBe(good);
    expect(model.points[0].x).toBe(0);
    expect(model.points[0].z).toBe(0);
  });

  it('ignores a zero-origin placeholder without hiding real campus places', () => {
    const nearby = [
      place('library', 24.226282, 120.581377),
      place('admin', 24.226939, 120.583587),
    ];
    const original = buildCampusSpatialModel(nearby);
    const withPlaceholder = buildCampusSpatialModel([place('unlocated', 0, 0), ...nearby]);
    expect(withPlaceholder.unavailableReason).toBeNull();
    expect(withPlaceholder.excludedCount).toBe(1);
    // A missing-GPS placeholder must not shift the geographic center, camera
    // framing or measured position of any sourced campus marker.
    expect(withPlaceholder.points).toEqual(original.points);
    expect(withPlaceholder.extent).toEqual(original.extent);
    expect(withPlaceholder.radius).toBe(original.radius);
    expect(buildCampusSpatialModel([place('unlocated', 0, 0)])).toEqual({
      points: [], extent: { width: 0, depth: 0 }, radius: 0,
      excludedCount: 1, unavailableReason: 'no-locations',
    });
  });

  it('retains real near-equatorial or near-prime-meridian coordinates', () => {
    const model = buildCampusSpatialModel([
      place('equator', 0, 0.001), place('meridian', 0.001, 0),
    ]);
    expect(model.unavailableReason).toBeNull();
    expect(model.excludedCount).toBe(0);
    expect(model.points).toHaveLength(2);
  });

  it('does not stretch an existing pair of places to fill the view when another place arrives', () => {
    const original = [place('a', 24, 120), place('b', 24.002, 120.002)];
    const pair = buildCampusSpatialModel(original).points;
    const expanded = buildCampusSpatialModel([...original, place('c', 24.01, 120.01)]).points;
    const distance = (points: typeof pair) => Math.hypot(points[1].x - points[0].x, points[1].z - points[0].z);
    expect(Math.abs(distance(pair) - distance(expanded))).toBeLessThan(0.01);
  });

  it('projects nearby places across the date line together', () => {
    const model = buildCampusSpatialModel([
      place('west', 0, 179.999), place('east', 0, -179.999),
    ]);
    expect(model.unavailableReason).toBeNull();
    expect(model.points[1].x - model.points[0].x).toBeCloseTo(222.39, 1);
    expect(model.extent.width).toBeLessThan(300);
    expect(model.extent.depth).toBe(0);
  });

  it('returns an explicit limitation for distant campuses rather than dropping remote places', () => {
    const model = buildCampusSpatialModel([place('south', 24, 120), place('north', 25, 121)]);
    expect(model.unavailableReason).toBe('area-too-large');
    expect(model.points).toEqual([]);
    expect(model.excludedCount).toBe(0);
  });

  it('handles antipodal data and very high latitude without invalid projected numbers', () => {
    expect(buildCampusSpatialModel([place('a', 0, 0), place('b', 0, 180)]).unavailableReason)
      .toBe('area-too-large');
    const polar = buildCampusSpatialModel([place('a', 89.999, 0), place('b', 89.999, 90)]);
    expect(polar.unavailableReason).toBeNull();
    expect(polar.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.z))).toBe(true);
    expect(polar.radius).toBeLessThan(200);
  });
});
