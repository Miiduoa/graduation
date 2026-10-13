import { fetchCafeteriaDetail, fetchCafeteriaLocations } from '../../services/cafeteriaCatalog';
import { nuniPlatformRequest } from '../../services/nuniClient';

jest.mock('../../services/nuniClient', () => ({
  nuniPlatformRequest: jest.fn(),
}));

beforeEach(() => {
  jest.mocked(nuniPlatformRequest).mockReset();
});

test('parses platform locations for the requested school', async () => {
  jest.mocked(nuniPlatformRequest).mockResolvedValueOnce({
    locations: [
      { id: 'jingyuan', name: '靜園餐廳', merchantMode: 'info_only' },
      { id: 'cafe-1', name: '校園小棧', source: '示範' },
    ],
  });
  const rows = await fetchCafeteriaLocations('pu');
  expect(rows.map((row) => ({ id: row.id, demo: row.demo }))).toEqual([
    { id: 'cafe-1', demo: true },
    { id: 'jingyuan', demo: false },
  ]);
  expect(nuniPlatformRequest).toHaveBeenCalledWith('realms/pu/food/locations');
});

test('returns a missing shop as null instead of inventing a page', async () => {
  jest.mocked(nuniPlatformRequest).mockResolvedValueOnce({
    locations: [{ id: 'jingyuan', name: '靜園餐廳', merchantMode: 'info_only' }],
  });
  await expect(fetchCafeteriaDetail('pu', 'cafe-1')).resolves.toEqual({
    cafeteria: null,
    menus: [],
  });
});
