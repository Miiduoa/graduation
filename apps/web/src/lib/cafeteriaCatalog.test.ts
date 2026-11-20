// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchCafeteriaCatalog, fetchCafeteriaDetail } from './cafeteriaCatalog';

const fetcher = vi.fn();

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetcher.mockReset());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('rejects a catalog response whose schoolId does not match the request', async () => {
  fetcher.mockResolvedValueOnce(
    json({
      schoolId: 'pu',
      cafeterias: [{ id: 'stall', name: '靜園餐廳', merchantMode: 'info_only' }],
      menus: [],
    }),
  );
  await expect(fetchCafeteriaCatalog('cgu')).rejects.toThrow('unavailable');
  expect(fetcher).toHaveBeenCalledWith(
    '/api/cafeterias?schoolId=cgu',
    expect.objectContaining({ credentials: 'same-origin' }),
  );
});

it('rejects a detail response whose schoolId does not match the request', async () => {
  fetcher.mockResolvedValueOnce(
    json({
      schoolId: 'pu',
      cafeteria: { id: 'stall', name: '靜園餐廳', merchantMode: 'info_only' },
      menus: [],
    }),
  );
  await expect(fetchCafeteriaDetail('cgu', 'stall')).rejects.toThrow('unavailable');
  expect(fetcher).toHaveBeenCalledWith(
    '/api/cafeterias/stall?schoolId=cgu',
    expect.objectContaining({ credentials: 'same-origin' }),
  );
});

it('keeps a legitimate missing shop as null when schoolId matches', async () => {
  fetcher.mockResolvedValueOnce(json({ schoolId: 'pu', cafeteria: null, menus: [] }));
  await expect(fetchCafeteriaDetail('pu', 'missing')).resolves.toEqual({
    cafeteria: null,
    menus: [],
  });
});

it('returns the matching catalog payload', async () => {
  fetcher.mockResolvedValueOnce(
    json({
      schoolId: 'cgu',
      cafeterias: [{ id: 'stall', name: '校內咖啡店', merchantMode: 'info_only' }],
      menus: [{ id: 'toast', name: '蔬菜吐司', cafeteriaId: 'stall', price: 60 }],
    }),
  );
  const result = await fetchCafeteriaCatalog('cgu');
  expect(result.cafeterias).toEqual([
    expect.objectContaining({ id: 'stall', name: '校內咖啡店', schoolId: 'cgu' }),
  ]);
  expect(result.menus).toEqual([
    expect.objectContaining({ id: 'toast', cafeteriaId: 'stall', schoolId: 'cgu', price: 60 }),
  ]);
});

it('保留餐廳本身的來源與菜單時間，不借用其他快照', async () => {
  fetcher.mockResolvedValueOnce(
    json({
      schoolId: 'pu',
      cafeteria: {
        id: 'stall',
        name: '校內咖啡店',
        sourceLabel: '校方餐飲名錄',
        menuSyncedAt: '2026-10-01T00:00:00Z',
      },
      menus: [],
    }),
  );
  const result = await fetchCafeteriaDetail('pu', 'stall');
  expect(result.cafeteria).toMatchObject({
    sourceLabel: '校方餐飲名錄',
    menuSyncedAt: '2026-10-01T00:00:00Z',
  });
});
