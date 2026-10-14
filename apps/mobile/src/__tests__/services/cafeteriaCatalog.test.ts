import { fetchCafeteriaDetail, fetchCafeteriaLocations } from '../../services/cafeteriaCatalog';
import { nuniPublicRequest } from '../../services/nuniClient';

jest.mock('../../services/nuniClient', () => ({
  nuniPublicRequest: jest.fn(),
}));

beforeEach(() => {
  jest.mocked(nuniPublicRequest).mockReset();
});

test('parses platform locations for the requested school', async () => {
  jest.mocked(nuniPublicRequest).mockResolvedValueOnce({
    cafeterias: [
      { id: 'jingyuan', name: '靜園餐廳', merchantMode: 'info_only', reviewStatus: 'verified' },
      { id: 'cafe-1', name: '校園小棧', reviewStatus: 'demo' },
      { id: 'louisa', name: '路易莎咖啡' },
    ],
    menus: [],
  });
  const rows = await fetchCafeteriaLocations('pu');
  expect(rows.map((row) => ({ id: row.id, reviewStatus: row.reviewStatus }))).toEqual([
    { id: 'cafe-1', reviewStatus: 'demo' },
    { id: 'louisa', reviewStatus: 'unverified' },
    { id: 'jingyuan', reviewStatus: 'verified' },
  ]);
  expect(nuniPublicRequest).toHaveBeenCalledWith('schools/pu/cafeterias');
});

test('returns a missing shop as null instead of inventing a page', async () => {
  jest.mocked(nuniPublicRequest).mockResolvedValueOnce({
    cafeterias: [{ id: 'jingyuan', name: '靜園餐廳', merchantMode: 'info_only' }],
    menus: [],
  });
  await expect(fetchCafeteriaDetail('pu', 'cafe-1')).resolves.toEqual({
    cafeteria: null,
    menus: [],
  });
});
