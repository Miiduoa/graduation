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
  expect(html).toContain('setView([25.2,121.3],16)');
  expect(html).toContain('OpenStreetMap');
  expect(html).toContain('label.textContent=place.name');
  expect(html).not.toMatch(/simulate|busTick|setInterval|buildMock/);
  expect(buildWalkingDirectionsUrl({ lat: 24, lng: 120 })).not.toContain('origin=');
});
