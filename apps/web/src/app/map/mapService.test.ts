import { beforeEach, expect, it, vi } from 'vitest';
import {
  distanceMeters,
  formatDistance,
  loadMapFavorites,
  loadMapLocations,
  setMapFavorite,
  type MapLocation,
} from './mapService';
import { centerOfCoordinates } from '@campus/shared/src/campusGeo';
import { getDocsFromServer } from 'firebase/firestore';

const state = vi.hoisted(() => ({
  configured: true,
  uid: 'alice',
  read: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/lib/firebase', () => ({
  getDb: () => ({}),
  isFirebaseConfigured: () => state.configured,
  getAuth: () => ({ currentUser: { uid: state.uid } }),
}));
vi.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...path: string[]) => path.join('/'),
  doc: (_: unknown, ...path: string[]) => path.join('/'),
  query: (path: string, ...constraints: unknown[]) => ({ path, constraints }),
  where: (...values: unknown[]) => values,
  getDocsFromServer: vi.fn(),
  serverTimestamp: () => 'server-time',
  runTransaction: async (_: unknown, update: (transaction: unknown) => Promise<void>) =>
    update({
      get: state.read,
      set: state.set,
      delete: state.remove,
    }),
}));

const location: MapLocation = {
  id: 'library',
  name: '蓋夏圖書館',
  description: '',
  category: '圖書館',
  lat: 24.2275,
  lng: 120.5635,
};
const entry = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });
const snapshot = (...docs: ReturnType<typeof entry>[]) => ({ empty: docs.length === 0, docs });
const respond = (value: ReturnType<typeof snapshot>) =>
  vi.mocked(getDocsFromServer).mockResolvedValueOnce(value as never);

beforeEach(() => {
  vi.clearAllMocks();
  state.configured = true;
  state.uid = 'alice';
  state.read.mockResolvedValue({ exists: () => false });
});

it('accepts only actual valid coordinates and normalizes category labels', async () => {
  respond(
    snapshot(
      entry('library', { ...location, id: 'spoofed', category: 'library' }),
      entry('no-position', { name: '未定位', lat: undefined, lng: undefined }),
      entry('invalid', { name: '無效', lat: NaN, lng: 120 }),
      entry('outside-earth', { name: '錯誤', lat: 91, lng: 181 }),
    ),
  );
  expect(await loadMapLocations('pu')).toEqual([location]);
  expect(getDocsFromServer).toHaveBeenCalledTimes(1);
});

it('uses school-filtered legacy data only after a confirmed empty canonical source', async () => {
  respond(snapshot());
  respond(snapshot(entry('library', { ...location, schoolId: 'pu' })));
  expect(await loadMapLocations('pu')).toEqual([location]);
  expect(vi.mocked(getDocsFromServer).mock.calls).toEqual([
    ['schools/pu/pois'],
    [{ path: 'pois', constraints: [['schoolId', '==', 'pu']] }],
  ]);
});

it('propagates source failures instead of substituting fallback or sample data', async () => {
  vi.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('offline'));
  await expect(loadMapLocations('pu')).rejects.toThrow('offline');
  expect(getDocsFromServer).toHaveBeenCalledTimes(1);
});

it('rejects a mismatched school and an unconfigured source', async () => {
  respond(snapshot(entry('library', { ...location, schoolId: 'another' })));
  await expect(loadMapLocations('pu')).rejects.toThrow('Invalid map school');
  state.configured = false;
  await expect(loadMapLocations('pu')).rejects.toThrow('Map source unavailable');
  expect(getDocsFromServer).toHaveBeenCalledTimes(1);
});

it('reads only the authenticated accounts school favorites and validates their identity', async () => {
  respond(
    snapshot(
      entry('poi_library', { type: 'poi', itemId: 'library', schoolId: 'pu' }),
      entry('poi_other', { type: 'poi', itemId: 'other', schoolId: 'another' }),
      entry('wrong_id', { type: 'poi', itemId: 'forged', schoolId: 'pu' }),
    ),
  );
  expect(await loadMapFavorites('alice', 'pu')).toEqual(['library']);
  expect(getDocsFromServer).toHaveBeenCalledWith({
    path: 'users/alice/schools/pu/favorites',
    constraints: [['type', '==', 'poi']],
  });
});

it('makes saving an already-saved location idempotent without a forbidden update', async () => {
  state.read.mockResolvedValue({ exists: () => true });
  await setMapFavorite('alice', 'pu', location, true, () => true);
  expect(state.read).toHaveBeenCalledWith('users/alice/schools/pu/favorites/poi_library');
  expect(state.set).not.toHaveBeenCalled();
  expect(state.remove).not.toHaveBeenCalled();
});

it('writes the clicked location title and school and removes only the scoped favorite', async () => {
  await setMapFavorite('alice', 'pu', location, true, () => true);
  expect(state.set).toHaveBeenCalledWith('users/alice/schools/pu/favorites/poi_library', {
    type: 'poi',
    itemId: 'library',
    itemTitle: '蓋夏圖書館',
    schoolId: 'pu',
    addedAt: 'server-time',
  });
  state.read.mockResolvedValue({ exists: () => true });
  await setMapFavorite('alice', 'pu', location, false, () => true);
  expect(state.remove).toHaveBeenCalledWith('users/alice/schools/pu/favorites/poi_library');
});

it('does not write after the SDK account changes during the transaction read', async () => {
  state.read.mockImplementation(async () => {
    state.uid = 'bob';
    return { exists: () => false };
  });
  await expect(setMapFavorite('alice', 'pu', location, true, () => true)).rejects.toThrow(
    'Account changed',
  );
  expect(state.set).not.toHaveBeenCalled();
});

it('does not write after the page scope is revoked during the transaction read', async () => {
  let current = true;
  state.read.mockImplementation(async () => {
    current = false;
    return { exists: () => false };
  });
  await expect(setMapFavorite('alice', 'pu', location, true, () => current)).rejects.toThrow(
    'Account changed',
  );
  expect(state.set).not.toHaveBeenCalled();
});


it('shows only measured straight-line distances and uses a robust campus viewport', () => {
  expect(distanceMeters(location, location)).toBe(0);
  expect(distanceMeters(location, { lat: 24.22495, lng: 120.56535 })).toBeGreaterThan(200);
  expect(formatDistance(56)).toBe('60 公尺');
  expect(formatDistance(1600)).toBe('1.6 公里');
  expect(centerOfCoordinates([
    { lat: 24.225, lng: 120.563 },
    { lat: 24.226, lng: 120.564 },
    { lat: 24.227, lng: 120.565 },
    { lat: 25.1, lng: 121.2 },
  ])).toEqual({ lat: 24.2265, lng: 120.5645 });
  expect(centerOfCoordinates([])).toBeNull();
});

it('reads valid latitude/longitude and nested school POIs without borrowing other schools', async () => {
  respond(snapshot(
    entry('library', {
      schoolId: 'pu',
      name: '蓋夏圖書館',
      category: 'library',
      location: { latitude: 24.2275, longitude: 120.5635 },
      building: '圖書館',
      floor: 'B1~5F',
      facilities: ['閱覽室', '討論室', '閱覽室', '  '],
    }),
    entry('entrance', {
      name: '大門',
      category: 'gate',
      latitude: 24.22495,
      longitude: 120.56535,
    }),
    entry('missing', { name: '未提供座標', location: '校園中心' }),
    entry('zero', { name: '無效原點', lat: 0, lng: 0 }),
  ));
  const locations = await loadMapLocations('pu');
  expect(locations).toHaveLength(2);
  expect(locations.find((location) => location.id === 'library')).toEqual({
    id: 'library',
    name: '蓋夏圖書館',
    category: '圖書館',
    description: '',
    lat: 24.2275,
    lng: 120.5635,
    building: '圖書館',
    floor: 'B1~5F',
    facilities: ['閱覽室', '討論室'],
  });
  expect(locations.find((location) => location.id === 'entrance')).toEqual({
    id: 'entrance',
    name: '大門',
    category: '交通',
    description: '',
    lat: 24.22495,
    lng: 120.56535,
  });
});

it('does not promote malformed primary coordinates over a second nested coordinate', async () => {
  respond(snapshot(entry('wrong-coordinates', {
    name: '無法定位',
    lat: Number.NaN,
    lng: 120.56,
    location: { lat: 24.22, lng: 120.56 },
  })));
  expect(await loadMapLocations('pu')).toEqual([]);
});
