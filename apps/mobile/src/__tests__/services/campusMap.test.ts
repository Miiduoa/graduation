import { getDocsFromServer, collection, query, where } from 'firebase/firestore';
import { isFirebaseMockMode } from '../../firebase';
import {
  loadCampusMapPlaces,
  buildWalkingDirectionsUrl,
  buildCampusMapHtml,
} from '../../features/campusMap';
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
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(isFirebaseMockMode).mockReturnValue(false);
  jest.mocked(getDocsFromServer).mockResolvedValue(snapshot([row]));
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
  jest.mocked(getDocsFromServer).mockResolvedValueOnce(snapshot([
    { schoolId: 'tw-nchu', name: '工程館', category: 'building', location: { lat: 24.1234, lng: 120.789 } },
    { schoolId: 'tw-nchu', name: '真實地點', isDemo: true, lat: 24.2, lng: 120.5 },
    { schoolId: 'tw-nchu', name: '學校提供的校舍', lat: 24.13, lng: 120.67 },
  ]));
  // The fixture generator assigns a document ID matching its known seed signature.
  const places = await loadCampusMapPlaces('tw-nchu');
  expect(places.map((place) => place.name)).toEqual(['工程館', '學校提供的校舍']);
});
