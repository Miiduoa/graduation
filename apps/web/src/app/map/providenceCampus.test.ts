import { expect, it } from 'vitest';
import {
  isProvidencePendingVerification,
  locationMatchesSearch,
  PROVIDENCE_BUS_STOPS,
  PROVIDENCE_CAMPUS_BOUNDS,
  PROVIDENCE_CAMPUS_CENTER,
  PROVIDENCE_CAMPUS_PLACES,
  PROVIDENCE_CAMPUS_SOURCE,
  providencePlaceSourceUrl,
  walkingEstimateLabel,
  walkingMinutesFromMeters,
  WALKING_METERS_PER_MINUTE,
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
    expect(providencePlaceSourceUrl('pu', place)).toMatch(/^https:\/\//);
  }
  expect(PROVIDENCE_CAMPUS_CENTER.lat).toBeGreaterThan(PROVIDENCE_CAMPUS_BOUNDS.south);
  expect(PROVIDENCE_CAMPUS_CENTER.lat).toBeLessThan(PROVIDENCE_CAMPUS_BOUNDS.north);
});

it('carries audited verification states, transit codes and no unverified ATM', () => {
  expect(PROVIDENCE_CAMPUS_PLACES).toHaveLength(24);
  expect(PROVIDENCE_CAMPUS_PLACES.some((place) => place.name.includes('ATM'))).toBe(false);
  expect(PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-yiyuan')?.name).toBe('宜園餐廳');
  expect(PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-pool')?.name).toBe('溫水游泳池');
  expect(PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-xijia')).toMatchObject({
    name: '希嘉學苑',
    lat: 24.228017,
    lng: 120.58067,
    sourceUrl: 'https://www.openstreetmap.org/relation/9246899',
    verification: 'cross-checked',
  });
  expect(PROVIDENCE_CAMPUS_PLACES.some((place) => place.name.includes('善牧'))).toBe(false);
  expect(PROVIDENCE_CAMPUS_PLACES.some((place) => place.sourceUrl.includes('4081204263'))).toBe(
    false,
  );
  expect(
    PROVIDENCE_CAMPUS_PLACES.filter((place) => place.verification === 'single-source').map(
      (place) => place.id,
    ),
  ).toEqual(['pu-parking-p1', 'pu-parking-p2', 'pu-parking-moto', 'pu-gate-osm']);
  expect(
    isProvidencePendingVerification(
      'pu',
      PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-gate-osm')!,
    ),
  ).toBe(true);
  for (const stop of PROVIDENCE_BUS_STOPS) {
    expect(stop.transitStopIds?.length).toBeGreaterThan(0);
    for (const id of stop.transitStopIds!) expect(id).toMatch(/^TCOD_[A-Za-z0-9_-]+$/);
    expect(stop.description).toContain('往');
  }
  expect(WALKING_METERS_PER_MINUTE).toBe(80);
  expect(walkingMinutesFromMeters(400)).toBe(5);
  expect(walkingEstimateLabel(400)).toBe(
    '步行約 5 分鐘（直線 400 公尺 ÷ 每分鐘 80 公尺，四捨五入；不是導航路線時間）',
  );
  expect(walkingEstimateLabel(-1)).toBe('');
});

it('matches dorm and print searches without claiming verified public toilets', () => {
  const byTerm = (term: string) =>
    PROVIDENCE_CAMPUS_PLACES.filter((place) => locationMatchesSearch(place, term)).map(
      (place) => place.id,
    );
  expect(byTerm('宿舍').sort()).toEqual(['pu-sigao', 'pu-xijia']);
  expect(byTerm('廁所')).toEqual([]);
  expect(byTerm('影印').sort()).toEqual(['pu-library', 'pu-zhishan']);
  for (const dormId of ['pu-xijia', 'pu-sigao'] as const) {
    const dorm = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === dormId)!;
    expect(dorm.facilities?.includes('廁所')).toBe(false);
    expect(dorm.description).toMatch(/僅供住宿生/);
    expect(dorm.description).toMatch(/訪客是否可使用尚未核實/);
  }
  expect(PROVIDENCE_CAMPUS_SOURCE.dormXijiaUrl).toMatch(/^https:\/\/osadorm\.pu\.edu\.tw\//);
  expect(PROVIDENCE_CAMPUS_SOURCE.libraryPrintUrl).toMatch(/^https:\/\/b028\.pu\.edu\.tw\//);
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

it('keeps unique bus ids and the canonical server stop when a bundled id is reused', () => {
  const serverStop: MapLocation = {
    id: 'pu-bus-main-a',
    name: 'renamed',
    category: '公車站',
    description: 'server canonical',
    lat: 24.3,
    lng: 120.6,
  };
  const merged = withProvidenceCampusPlaces('pu', [serverStop]);
  const matches = merged.filter((place) => place.id === 'pu-bus-main-a');
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({
    name: 'renamed',
    lat: 24.3,
    lng: 120.6,
    description: 'server canonical',
  });
  expect(new Set(merged.map((place) => place.id)).size).toBe(merged.length);
});

it('never lends Providence places or stops to another school', () => {
  expect(withProvidenceCampusPlaces('nthu', [])).toEqual([]);
  expect(withProvidenceCampusPlaces('nthu', [firestoreLibrary])).toEqual([firestoreLibrary]);
});

it('does not attach bundled provenance to a colliding id with different content', () => {
  const colliding: MapLocation = {
    id: 'pu-library',
    name: '別校同名館舍',
    category: '圖書館',
    description: '',
    lat: 25.017,
    lng: 121.54,
  };
  expect(providencePlaceSourceUrl('pu', colliding)).toBeNull();
  expect(isProvidencePendingVerification('pu', colliding)).toBe(false);
  const parkingCollision: MapLocation = {
    id: 'pu-parking-p1',
    name: 'P1 停車場',
    category: '停車',
    description: '校方改過的說明',
    lat: 24.23,
    lng: 120.59,
  };
  expect(isProvidencePendingVerification('pu', parkingCollision)).toBe(false);
  expect(providencePlaceSourceUrl('pu', parkingCollision)).toBeNull();
});

it('attaches provenance only for Providence when id, name and coordinates match', () => {
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  expect(providencePlaceSourceUrl('pu', library)).toBe(library.sourceUrl);
  expect(isProvidencePendingVerification('pu', library)).toBe(false);
  const gate = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-gate-osm')!;
  expect(isProvidencePendingVerification('pu', gate)).toBe(true);
  expect(providencePlaceSourceUrl('nthu', library)).toBeNull();
  expect(isProvidencePendingVerification('nthu', gate)).toBe(false);
});
