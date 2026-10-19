import { expect, it } from 'vitest';
import {
  isProvidencePendingVerification,
  PROVIDENCE_BUS_STOPS,
  PROVIDENCE_CAMPUS_BOUNDS,
  PROVIDENCE_CAMPUS_CENTER,
  PROVIDENCE_CAMPUS_PLACES,
  providencePlaceSourceUrl,
  walkingEstimateLabel,
  withProvidenceCampusPlaces,
} from './providenceCampus';
import type { MapLocation } from './mapService';

const firestoreLibrary: MapLocation = {
  id: 'library',
  name: '蓋夏圖書館',
  category: '圖書館',
  description: '',
  lat: 24.226282,
  lng: 120.581377,
};

it('keeps every Providence place inside the published campus bounds area', () => {
  for (const place of [...PROVIDENCE_CAMPUS_PLACES, ...PROVIDENCE_BUS_STOPS]) {
    expect(place.lat).toBeGreaterThan(24.22);
    expect(place.lat).toBeLessThan(24.235);
    expect(place.lng).toBeGreaterThan(120.57);
    expect(place.lng).toBeLessThan(120.59);
    expect(providencePlaceSourceUrl(place)).toMatch(/^https:\/\//);
  }
  expect(PROVIDENCE_CAMPUS_CENTER.lat).toBeGreaterThan(PROVIDENCE_CAMPUS_BOUNDS.south);
  expect(PROVIDENCE_CAMPUS_CENTER.lat).toBeLessThan(PROVIDENCE_CAMPUS_BOUNDS.north);
});

it('carries audited verification states, transit codes and no unverified ATM', () => {
  expect(PROVIDENCE_CAMPUS_PLACES).toHaveLength(23);
  expect(PROVIDENCE_CAMPUS_PLACES.some((place) => place.name.includes('ATM'))).toBe(false);
  expect(PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-yiyuan')?.name).toBe('宜園餐廳');
  expect(PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-pool')?.name).toBe('溫水游泳池');
  expect(
    PROVIDENCE_CAMPUS_PLACES.filter((place) => place.verification === 'single-source').map(
      (place) => place.id,
    ),
  ).toEqual(['pu-parking-p1', 'pu-parking-p2', 'pu-parking-moto', 'pu-gate-osm']);
  expect(isProvidencePendingVerification(PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-gate-osm')!)).toBe(true);
  for (const stop of PROVIDENCE_BUS_STOPS) {
    expect(stop.transitStopIds?.length).toBeGreaterThan(0);
    for (const id of stop.transitStopIds!) expect(id).toMatch(/^TCOD_[A-Za-z0-9_-]+$/);
    expect(stop.description).toContain('往');
  }
  expect(walkingEstimateLabel(400)).toBe('步行約 5 分鐘（直線估算，實際路線會更長）');
  expect(walkingEstimateLabel(-1)).toBe('');
});

it('uses the bundled OpenStreetMap places only when the Providence source is empty', () => {
  const merged = withProvidenceCampusPlaces('pu', []);
  expect(merged.some((place) => place.name === '主顧樓')).toBe(true);
  expect(merged.some((place) => place.name === '蓋夏圖書館')).toBe(true);
  expect(merged.filter((place) => place.category === '公車站')).toHaveLength(
    PROVIDENCE_BUS_STOPS.length,
  );
});

it('keeps Firestore places authoritative and only adds missing bus stops', () => {
  const merged = withProvidenceCampusPlaces('pu', [firestoreLibrary]);
  expect(merged.filter((place) => place.name === '蓋夏圖書館')).toEqual([firestoreLibrary]);
  expect(merged.some((place) => place.category === '公車站')).toBe(true);
  expect(merged.some((place) => place.name === '主顧樓')).toBe(false);
});

it('never lends Providence places or stops to another school', () => {
  expect(withProvidenceCampusPlaces('nthu', [])).toEqual([]);
  expect(withProvidenceCampusPlaces('nthu', [firestoreLibrary])).toEqual([firestoreLibrary]);
});
