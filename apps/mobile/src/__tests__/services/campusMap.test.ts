import { getDocsFromServer, collection, query, where } from 'firebase/firestore';
import { isFirebaseMockMode } from '../../firebase';
import {
  loadCampusMapPlaces,
  buildWalkingDirectionsUrl,
  buildCampusMapHtml,
  MapSourceTimeoutError,
  MAP_SOURCE_TIMEOUT_MS,
  mergeCampusMapPlaces,
  withTimeout,
} from '../../features/campusMap';
import {
  PROVIDENCE_BUS_STOPS,
  PROVIDENCE_CAMPUS_PLACES,
  providencePlaceSourceUrl,
  isProvidencePendingVerification,
  locationMatchesSearch,
} from '@campus/shared/src/providenceCampus';
jest.mock('../../firebase', () => ({
  getDb: () => 'db',
  isFirebaseMockMode: jest.fn(() => false),
}));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((...args) => args.slice(1).join('/')),
  query: jest.fn((...args) => args),
  where: jest.fn((...args) => args),
  getDocsFromServer: jest.fn(),
}));
const row = { name: '圖書館', category: 'library', lat: 24.2, lng: 120.5 };
function snapshot(items: Array<Record<string, unknown>>) {
  return {
    empty: items.length === 0,
    docs: items.map((data, index) => ({ id: `place-${index}`, data: () => data })),
  } as Awaited<ReturnType<typeof getDocsFromServer>>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { resolve, reject, promise };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  jest.mocked(isFirebaseMockMode).mockReturnValue(false);
  jest.mocked(getDocsFromServer).mockResolvedValue(snapshot([row]));
});
afterEach(() => {
  jest.useRealTimers();
});
test('uses authoritative school data and maps only source-supplied details', async () => {
  const result = await loadCampusMapPlaces('pu');
  expect(collection).toHaveBeenCalledWith('db', 'schools', 'pu', 'pois');
  expect(getDocsFromServer).toHaveBeenCalledTimes(1);
  expect(result).toEqual([
    {
      id: 'place-0',
      name: '圖書館',
      category: '圖書館',
      lat: 24.2,
      lng: 120.5,
      description: '',
      facilities: [],
      building: undefined,
      floor: undefined,
    },
  ]);
});
test('a failed primary read cannot fall back and become an empty success', async () => {
  jest.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('permission-denied'));
  await expect(loadCampusMapPlaces('pu')).rejects.toThrow('permission-denied');
  expect(getDocsFromServer).toHaveBeenCalledTimes(1);
});
test('only an authoritative empty source reads the school-filtered migration collection', async () => {
  jest
    .mocked(getDocsFromServer)
    .mockResolvedValueOnce(snapshot([]))
    .mockResolvedValueOnce(snapshot([row]));
  expect(await loadCampusMapPlaces('pu')).toHaveLength(1);
  expect(where).toHaveBeenCalledWith('schoolId', '==', 'pu');
  expect(query).toHaveBeenCalledWith('pois', ['schoolId', '==', 'pu']);
});
test('rejects cross-school documents and excludes invalid coordinates', async () => {
  jest.mocked(getDocsFromServer).mockResolvedValueOnce(snapshot([{ ...row, schoolId: 'other' }]));
  await expect(loadCampusMapPlaces('pu')).rejects.toThrow('Invalid map school');
  jest
    .mocked(getDocsFromServer)
    .mockResolvedValueOnce(
      snapshot([{ ...row, lat: NaN }, { ...row, lng: 181 }, { ...row, name: '' }, row]),
    );
  expect(await loadCampusMapPlaces('pu')).toHaveLength(1);
});
test('mock runtime and malformed school IDs cannot produce published campus locations', async () => {
  await expect(loadCampusMapPlaces('../pu')).rejects.toThrow();
  jest.mocked(isFirebaseMockMode).mockReturnValue(true);
  await expect(loadCampusMapPlaces('pu')).rejects.toThrow();
  expect(getDocsFromServer).not.toHaveBeenCalled();
});
test('map uses provided school center and retains attribution without fake navigation scripts', () => {
  const html = buildCampusMapHtml(
    { background: '#fff', accent: '#314D40', surface: '#fff', text: '#000' },
    false,
    { lat: 25.2, lng: 121.3 },
  );
  expect(html).toContain('var campusCenter=L.latLng(25.2,121.3)');
  expect(html).toContain('setView(campusCenter,16)');
  expect(html).toContain('failedTiles>=4');
  expect(html).toContain('campusCenter.distanceTo');
  expect(html).toContain("data.type==='route'");
  expect(html).toContain("data.type==='clearRoute'");
  expect(html).toContain("dashArray:'6 9'");
  expect(html).toContain('OpenStreetMap');
  expect(html).toContain('label.textContent=place.name');
  expect(html).not.toMatch(/simulate|busTick|setInterval|buildMock/);
  expect(buildWalkingDirectionsUrl({ lat: 24, lng: 120 })).not.toContain('origin=');
});

test('loads an actual school POI from GeoPoint-style or nested coordinate fields', async () => {
  jest.mocked(getDocsFromServer).mockResolvedValueOnce(snapshot([
    {
      schoolId: 'pu',
      name: '任垣樓',
      category: 'academic',
      location: { latitude: 24.22765, longitude: 120.56453 },
      floor: 3,
      building: '理工學院',
      description: '教學大樓',
      facilities: ['電腦教室', '電腦教室', null, '電梯'],
    },
    { name: '缺少座標', category: 'academic', location: { lat: null, lng: 120.56 } },
    { name: '無效原點', category: 'building', lat: 0, lng: 0 },
  ]));
  expect(await loadCampusMapPlaces('pu')).toEqual([{
    id: 'place-0',
    name: '任垣樓',
    category: '教學',
    description: '教學大樓',
    lat: 24.22765,
    lng: 120.56453,
    building: '理工學院',
    floor: '3',
    facilities: ['電腦教室', '電梯'],
  }]);
});

test('rejects a wrong-school nested coordinate even when the values are valid', async () => {
  jest.mocked(getDocsFromServer).mockResolvedValueOnce(snapshot([{
    ...row,
    location: { lat: 24.227, lng: 120.564 },
    schoolId: 'another-school',
  }]));
  await expect(loadCampusMapPlaces('pu')).rejects.toThrow('Invalid map school');
});

test('hides historical demo POIs without hiding legitimate published places', async () => {
  const docs = [
    {
      id: 'tw-nchu-poi-1',
      data: () => ({ schoolId: 'tw-nchu', name: '工程館', category: 'building', location: { lat: 24.1234, lng: 120.789 } }),
    },
    {
      id: 'tagged',
      data: () => ({ schoolId: 'tw-nchu', name: '測試校舍', isDemo: true, lat: 24.2, lng: 120.5 }),
    },
    {
      id: 'official',
      data: () => ({ schoolId: 'tw-nchu', name: '學校提供的校舍', lat: 24.13, lng: 120.67 }),
    },
  ];
  jest.mocked(getDocsFromServer).mockResolvedValueOnce({ empty: false, docs } as never);
  const places = await loadCampusMapPlaces('tw-nchu');
  expect(places.map((place) => place.name)).toEqual(['學校提供的校舍']);
});

test('times out a hung canonical-plus-migration read without unhandled rejection', async () => {
  jest.useFakeTimers();
  const hang = deferred<ReturnType<typeof snapshot>>();
  jest.mocked(getDocsFromServer).mockReturnValueOnce(hang.promise as never);
  const pending = loadCampusMapPlaces('pu', { timeoutMs: MAP_SOURCE_TIMEOUT_MS });
  const expectation = expect(pending).rejects.toBeInstanceOf(MapSourceTimeoutError);
  await jest.advanceTimersByTimeAsync(MAP_SOURCE_TIMEOUT_MS);
  await expectation;
  hang.resolve(snapshot([row]));
  await Promise.resolve();
});

test('withTimeout clears the timer on success and still surfaces real failures', async () => {
  await expect(withTimeout(Promise.resolve(['ok']), 1000)).resolves.toEqual(['ok']);
  await expect(withTimeout(Promise.reject(new Error('denied')), 1000)).rejects.toThrow('denied');
});

test('confirmed empty Providence source merges bundled buildings and bus stops', () => {
  const merged = mergeCampusMapPlaces('pu', []);
  expect(merged.some((place) => place.name === '主顧樓')).toBe(true);
  expect(merged.some((place) => place.id === 'pu-library')).toBe(true);
  expect(merged.filter((place) => place.category === '公車站')).toHaveLength(PROVIDENCE_BUS_STOPS.length);
});

test('keeps nonempty server records authoritative and only fills missing bus stops', () => {
  const server = [
    {
      id: 'library',
      name: '蓋夏圖書館',
      category: '圖書館',
      description: '',
      lat: 24.226282,
      lng: 120.581377,
      facilities: [],
    },
  ];
  const merged = mergeCampusMapPlaces('pu', server);
  expect(merged.filter((place) => place.name === '蓋夏圖書館')).toEqual(server);
  expect(merged.some((place) => place.name === '主顧樓')).toBe(false);
  expect(merged.some((place) => place.category === '公車站')).toBe(true);
});

test('never lends Providence places to another school', () => {
  expect(mergeCampusMapPlaces('nthu', [])).toEqual([]);
  expect(
    mergeCampusMapPlaces('nthu', [
      {
        id: 'a',
        name: '清華一館',
        category: '教學',
        description: '',
        lat: 24.79,
        lng: 120.99,
        facilities: [],
      },
    ]),
  ).toHaveLength(1);
});

test('colliding ids do not inherit bundled provenance or pending labels', () => {
  const colliding = {
    id: 'pu-library',
    name: '別校圖書館',
    category: '圖書館',
    description: '',
    lat: 25.01,
    lng: 121.54,
    facilities: [] as string[],
  };
  expect(providencePlaceSourceUrl('pu', colliding)).toBeNull();
  expect(isProvidencePendingVerification('pu', colliding)).toBe(false);
  const library = PROVIDENCE_CAMPUS_PLACES.find((place) => place.id === 'pu-library')!;
  expect(providencePlaceSourceUrl('pu', library)).toMatch(/^https:\/\//);
  expect(providencePlaceSourceUrl('nthu', library)).toBeNull();
  expect(isProvidencePendingVerification('nthu', library)).toBe(false);
});

test('keeps unique bus ids and canonical server coordinates on colliding stop ids', () => {
  const server = [
    {
      id: 'pu-bus-main-a',
      name: 'renamed',
      category: '公車站',
      description: 'server',
      lat: 24.3,
      lng: 120.6,
      facilities: [] as string[],
    },
  ];
  const merged = mergeCampusMapPlaces('pu', server);
  const matches = merged.filter((place) => place.id === 'pu-bus-main-a');
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ name: 'renamed', lat: 24.3, lng: 120.6 });
  expect(new Set(merged.map((place) => place.id)).size).toBe(merged.length);
});

test('static facilities search only hits cross-checked buildings', () => {
  const byTerm = (term: string) =>
    PROVIDENCE_CAMPUS_PLACES.filter((place) => locationMatchesSearch(place, term)).map(
      (place) => place.id,
    );
  expect(byTerm('影印').sort()).toEqual(['pu-library', 'pu-zhishan']);
  expect(byTerm('宿舍').sort()).toEqual(['pu-sigao', 'pu-xijia']);
  expect(byTerm('廁所')).toEqual([]);
  expect(
    PROVIDENCE_CAMPUS_PLACES.some((place) => place.facilities?.includes('廁所')),
  ).toBe(false);
});
