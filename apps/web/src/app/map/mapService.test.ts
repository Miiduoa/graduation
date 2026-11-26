import { beforeEach, expect, it, vi } from 'vitest';
import {
  distanceMeters,
  formatDistance,
  walkingDirectionsUrl,
  appleWalkingDirectionsUrl,
  isUsableMapCoordinate,
  loadMapFavorites,
  loadMapLocations,
  MapSourceTimeoutError,
  MAP_SOURCE_TIMEOUT_MS,
  withTimeout,
  setMapFavorite,
  type MapLocation,
} from './mapService';
import { centerOfCoordinates } from '@campus/shared/src/campusGeo';
import { resolveCampusClassroom } from '@campus/shared/src/campusClassroomLookup';
import { parseCampusMapRecord } from '@campus/shared/src/campusMapRecords';
import { PROVIDENCE_CAMPUS_PLACES } from '@campus/shared/src/providenceCampus';
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

it('builds Google and Apple walking links from exact marker coordinates without inventing an entrance', () => {
  const google = new URL(walkingDirectionsUrl(location));
  const apple = new URL(appleWalkingDirectionsUrl(location));
  expect(google.origin).toBe('https://www.google.com');
  expect(google.searchParams.get('destination')).toBe('24.2275,120.5635');
  expect(google.searchParams.get('travelmode')).toBe('walking');
  expect(google.searchParams.has('origin')).toBe(false);
  expect(apple.origin).toBe('https://maps.apple.com');
  expect(apple.searchParams.get('daddr')).toBe('24.2275,120.5635');
  expect(apple.searchParams.get('dirflg')).toBe('w');
  expect(apple.searchParams.has('saddr')).toBe(false);

  const start = { lat: 24.23, lng: 120.56 };
  expect(new URL(appleWalkingDirectionsUrl(location, start)).searchParams.get('saddr'))
    .toBe('24.23,120.56');
  expect(new URL(walkingDirectionsUrl(location, start)).searchParams.get('origin'))
    .toBe('24.23,120.56');

  for (const origin of [
    { lat: 0, lng: 0 },
    { lat: -0, lng: 0 },
    { lat: 91, lng: 120 },
    { lat: 24, lng: NaN },
  ]) {
    expect(isUsableMapCoordinate(origin)).toBe(false);
    expect(new URL(walkingDirectionsUrl(location, origin)).searchParams.has('origin')).toBe(false);
    expect(new URL(appleWalkingDirectionsUrl(location, origin)).searchParams.has('saddr')).toBe(false);
  }
});

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

const providenceHall = PROVIDENCE_CAMPUS_PLACES.find(({ id }) => id === 'pu-zhugu')!;
const resolvePH303 = (locations: readonly MapLocation[]) =>
  resolveCampusClassroom({ schoolId: 'pu', query: 'PH303', locations });

it.each([
  { transitStopIds: ['synthetic-stop'] },
  { transitStopIds: 'synthetic-stop' },
  { transitStopIds: [42] },
  { transitStopIds: 0 },
  { transitStopIds: false },
  { transitStopIds: {} },
])('excludes a synthetic teaching POI with transitStopIds=$transitStopIds after parsing and loading', async ({ transitStopIds }) => {
  const id = 'synthetic-stop-poi';
  // Reuse the catalog hall point as test input without assigning a location to a real stop.
  const raw = { ...providenceHall, description: 'Synthetic POI', transitStopIds };
  const parsed = parseCampusMapRecord(id, raw, 'pu')!;
  expect(parsed.transitStopIds).toBe(transitStopIds);
  expect(resolvePH303([parsed]).status).toBe('unmatched');

  respond(snapshot(entry(id, raw), entry(providenceHall.id, providenceHall)));
  const locations = await loadMapLocations('pu');
  const synthetic = locations.find((place) => place.id === id)!;
  expect(synthetic.transitStopIds).toBe(transitStopIds);
  expect(resolvePH303([synthetic]).status).toBe('unmatched');
  expect(resolvePH303(locations).matches.map((place) => place.id)).toEqual([providenceHall.id]);
});

it.each([
  {},
  { transitStopIds: '' },
  { transitStopIds: '  ' },
  { transitStopIds: [] },
  { transitStopIds: null },
])('still resolves the loaded hall with transit metadata %j', async (metadata) => {
  respond(snapshot(entry(providenceHall.id, { ...providenceHall, ...metadata })));
  const [hall] = await loadMapLocations('pu');
  if ('transitStopIds' in metadata) {
    expect(hall).toHaveProperty('transitStopIds', metadata.transitStopIds);
  } else {
    expect(hall).not.toHaveProperty('transitStopIds');
  }
  expect(resolvePH303([hall]).matches).toEqual([hall]);
});

it('omits inherited and non-enumerable transit metadata during parsing', () => {
  const inherited = Object.assign(Object.create({ transitStopIds: ['synthetic-stop'] }), providenceHall);
  const hidden = Object.defineProperty({ ...providenceHall }, 'transitStopIds', {
    value: ['synthetic-stop'],
  });
  for (const raw of [inherited, hidden]) {
    const parsed = parseCampusMapRecord(providenceHall.id, raw, 'pu')!;
    expect(parsed).not.toHaveProperty('transitStopIds');
    expect(resolvePH303([parsed]).matches).toEqual([parsed]);
  }
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

it('times out a stalled school-scoped favorites read instead of waiting indefinitely', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(getDocsFromServer).mockReturnValueOnce(new Promise(() => {}) as never);
    const result = loadMapFavorites('alice', 'pu');
    const rejected = expect(result).rejects.toBeInstanceOf(MapSourceTimeoutError);
    await vi.advanceTimersByTimeAsync(MAP_SOURCE_TIMEOUT_MS);
    await rejected;
    expect(getDocsFromServer).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it('preserves valid saved places when the source finishes before the deadline', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(getDocsFromServer).mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve(snapshot(entry('poi_library', {
        type: 'poi', itemId: 'library', schoolId: 'pu',
      })) as never), MAP_SOURCE_TIMEOUT_MS - 10);
    }) as never);
    const result = loadMapFavorites('alice', 'pu');
    await vi.advanceTimersByTimeAsync(MAP_SOURCE_TIMEOUT_MS - 10);
    await expect(result).resolves.toEqual(['library']);
  } finally {
    vi.useRealTimers();
  }
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

it('does not publish locations from historical unflagged demo seed documents', async () => {
  respond(snapshot(
    entry('tw-nchu-poi-1', { schoolId: 'tw-nchu', name: '工程館', category: 'building', location: { lat: 24.1234, lng: 120.789 } }),
    entry('tw-nchu-poi-2', { schoolId: 'tw-nchu', name: '圖書館', category: 'library', location: { lat: 24.124, lng: 120.7885 } }),
    entry('tw-nchu-poi-3', { schoolId: 'tw-nchu', name: '學生餐廳', category: 'cafeteria', location: { lat: 24.122, lng: 120.79 } }),
    entry('official', { schoolId: 'tw-nchu', name: '圖書館', category: 'library', lat: 24.12, lng: 120.67 }),
  ));
  expect((await loadMapLocations('tw-nchu')).map((place) => place.id)).toEqual(['official']);
});

it('excludes explicitly marked demo data but does not discard verified POIs merely for sharing a name', async () => {
  respond(snapshot(
    entry('marked', { name: '第一圖書館', isDemo: true, lat: 24.2, lng: 120.5 }),
    entry('tw-nchu-poi-2', { name: '圖書館', lat: 24.12, lng: 120.67 }),
  ));
  expect((await loadMapLocations('tw-nchu')).map((place) => place.id)).toEqual(['tw-nchu-poi-2']);
});

it('fails a stuck map source after the timeout instead of loading forever', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(getDocsFromServer).mockReturnValueOnce(new Promise(() => {}) as never);
    const result = loadMapLocations('pu', { timeoutMs: 50 });
    const settled = expect(result).rejects.toBeInstanceOf(MapSourceTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await settled;
  } finally {
    vi.useRealTimers();
  }
});

it('does not start a legacy POI read when the canonical response arrives after the deadline', async () => {
  vi.useFakeTimers();
  try {
    let complete!: (value: ReturnType<typeof snapshot>) => void;
    vi.mocked(getDocsFromServer).mockReturnValueOnce(new Promise((resolve) => {
      complete = resolve;
    }) as never);
    // Supply a response to detect an unexpected extra read without an unhandled error.
    respond(snapshot());
    const result = loadMapLocations('pu', { timeoutMs: 50 });
    const rejected = expect(result).rejects.toBeInstanceOf(MapSourceTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    complete(snapshot());
    await vi.advanceTimersByTimeAsync(0);
    expect(getDocsFromServer).toHaveBeenCalledTimes(1);
    // Consume the queued response with a fresh request, not the expired one.
    respond(snapshot(entry('library', { ...location, schoolId: 'pu' })));
    await expect(loadMapLocations('pu')).resolves.toEqual([location]);
    expect(getDocsFromServer).toHaveBeenCalledTimes(3);
  } finally {
    vi.resetAllMocks();
    vi.useRealTimers();
  }
});

it('does not parse a legacy POI response that arrives after the shared deadline', async () => {
  vi.useFakeTimers();
  try {
    respond(snapshot());
    let complete!: (value: ReturnType<typeof snapshot>) => void;
    vi.mocked(getDocsFromServer).mockReturnValueOnce(new Promise((resolve) => {
      complete = resolve;
    }) as never);
    const readData = vi.fn(() => ({ ...location, schoolId: 'pu' }));
    const result = loadMapLocations('pu', { timeoutMs: 50 });
    const rejected = expect(result).rejects.toBeInstanceOf(MapSourceTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(getDocsFromServer).toHaveBeenCalledTimes(2);
    complete({ empty: false, docs: [{ id: 'library', data: readData }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(readData).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it('passes through a source answer that arrives before the timeout', async () => {
  await expect(withTimeout(Promise.resolve(['ok']), 1000)).resolves.toEqual(['ok']);
  await expect(withTimeout(Promise.reject(new Error('denied')), 1000)).rejects.toThrow('denied');
});
