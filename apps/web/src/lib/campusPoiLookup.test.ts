import { expect, it } from 'vitest';
import {
  PROVIDENCE_BUS_STOPS,
  PROVIDENCE_CAMPUS_BOUNDS,
  PROVIDENCE_CAMPUS_PLACES,
} from '../app/map/providenceCampus';
import { CAMPUS_POIS_LITE, getCampusPoiLite } from './campusPoiLookup';

const audited = [...PROVIDENCE_CAMPUS_PLACES, ...PROVIDENCE_BUS_STOPS];

it('web lite 清單與校園地圖核對資料逐筆一致，不另存一份座標', () => {
  expect(CAMPUS_POIS_LITE).toHaveLength(audited.length);
  for (const place of audited) {
    const lite = getCampusPoiLite(place.id);
    expect(lite, place.id).toBeDefined();
    expect(lite?.name).toBe(place.name);
    expect(lite?.lat).toBe(place.lat);
    expect(lite?.lng).toBe(place.lng);
    expect(lite?.verification).toBe(place.verification);
    expect(lite?.sourceUrl).toBe(place.sourceUrl);
  }
});

it('座標落在靜宜校園合理範圍，且不再出現偏離約 1.6 公里的舊批次', () => {
  for (const poi of CAMPUS_POIS_LITE) {
    expect(poi.lat).toBeGreaterThan(24.22);
    expect(poi.lat).toBeLessThan(24.235);
    expect(poi.lng).toBeGreaterThan(120.57);
    expect(poi.lng).toBeLessThan(120.59);
    // 舊批次約在東經 120.562～120.567、校園範圍以西
    expect(poi.lng).toBeGreaterThan(PROVIDENCE_CAMPUS_BOUNDS.west - 0.003);
    expect(poi.lng).not.toBeCloseTo(120.564, 2);
  }
});

it('建築落在校園範圍內；只有單一來源的地點有老實標待確認', () => {
  const pending = CAMPUS_POIS_LITE.filter((p) => p.verification === 'single-source');
  expect(pending.map((p) => p.id).sort()).toEqual(
    ['pu-gate-osm', 'pu-parking-moto', 'pu-parking-p1', 'pu-parking-p2'].sort(),
  );
  for (const place of PROVIDENCE_CAMPUS_PLACES) {
    const lite = getCampusPoiLite(place.id);
    expect(lite?.lng).toBeGreaterThanOrEqual(PROVIDENCE_CAMPUS_BOUNDS.west - 0.003);
    expect(lite?.lng).toBeLessThanOrEqual(PROVIDENCE_CAMPUS_BOUNDS.east + 0.001);
  }
});

it('舊清單對不上核對資料的地點已移除', () => {
  for (const removedId of [
    'pu-providence',
    'pu-research1',
    'pu-research2',
    'pu-admin',
    'pu-dorm-faith',
    'pu-track',
    'pu-atm',
    'pu-gate-main',
    'pu-bus-stop',
  ]) {
    expect(getCampusPoiLite(removedId), removedId).toBeUndefined();
  }
});
