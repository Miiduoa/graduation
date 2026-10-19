import { expect, it } from 'vitest';
import {
  PROVIDENCE_BUS_STOPS,
  PROVIDENCE_CAMPUS_BOUNDS,
  PROVIDENCE_CAMPUS_CENTER,
  PROVIDENCE_CAMPUS_PLACES,
  providencePlaceSourceUrl,
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
