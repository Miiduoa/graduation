import { expect, it } from 'vitest';
import {
  CAFETERIA_BACK_TO_LIST_TEXT,
  CAFETERIA_EMPTY_SCHOOL_TEXT,
  CAFETERIA_NOT_FOUND_TEXT,
  DEMO_CAFETERIA_BADGE,
  DEMO_CAFETERIA_NOTICE,
  cafeteriaListHref,
  isDemoCafeteria,
  parseCafeteriaLocations,
  parseCafeteriaMenu,
} from '@campus/shared/src/cafeteriaCatalog';

it('keeps the student-facing cafeteria copy used by empty and missing shops', () => {
  expect(CAFETERIA_EMPTY_SCHOOL_TEXT).toBe('這間學校的餐廳還沒上架');
  expect(CAFETERIA_NOT_FOUND_TEXT).toBe('找不到這間店。');
  expect(CAFETERIA_BACK_TO_LIST_TEXT).toBe('回餐廳列表');
  expect(DEMO_CAFETERIA_BADGE).toBe('示範');
  expect(DEMO_CAFETERIA_NOTICE).toBe('這是示範店家，菜單和價格不是真的，不能點餐。');
  expect(cafeteriaListHref('cgu')).toBe('/cafeteria?schoolId=cgu');
});

it('treats official Providence names as real shops even when the id looks generated', () => {
  expect(isDemoCafeteria({ id: 'cafe-1', name: '靜園餐廳' })).toBe(false);
  expect(isDemoCafeteria({ id: 'yiyuan', name: '宜園小廚', sourceLabel: '靜宜官網' })).toBe(false);
  expect(isDemoCafeteria({ id: 'louisa', name: '路易莎咖啡' })).toBe(false);
});

it('marks sample shops from source notes, fake names or generated ids', () => {
  expect(isDemoCafeteria({ id: 'stall', name: '校園小棧' })).toBe(true);
  expect(isDemoCafeteria({ id: 'paper', name: '紙感小店' })).toBe(true);
  expect(isDemoCafeteria({ id: 'cafe-1', name: '測試店家' })).toBe(true);
  expect(isDemoCafeteria({ id: 'demo-shop', name: '任意店名' })).toBe(true);
  expect(
    isDemoCafeteria({ id: 'real-id', name: '任意店名', sourceLabel: '示範種子' }),
  ).toBe(true);
});

it('parses only the requested school and drops other-school rows', () => {
  const rows = parseCafeteriaLocations(
    {
      locations: [
        {
          id: 'jingyuan',
          name: '靜園餐廳',
          schoolId: 'pu',
          zoneLabel: '文興樓對面',
          merchantMode: 'info_only',
        },
        { id: 'cafe-1', name: '校園小棧', schoolId: 'pu', source: '示範' },
        { id: 'other', name: '他校餐廳', schoolId: 'cgu' },
        { id: 'bad/id', name: '無效' },
      ],
    },
    'pu',
  );
  expect(rows.map((row) => row.id)).toEqual(['cafe-1', 'jingyuan']);
  expect(rows.find((row) => row.id === 'jingyuan')?.demo).toBe(false);
  expect(rows.find((row) => row.id === 'cafe-1')?.demo).toBe(true);
});

it('reads menu sections and treats amountMinor as TWD yuan', () => {
  const items = parseCafeteriaMenu(
    {
      location: { id: 'stall', name: '校內咖啡店' },
      generatedAt: '2026-10-13',
      sections: [
        {
          name: '吐司',
          items: [
            {
              id: 'toast',
              name: '蔬菜吐司',
              basePrice: { amountMinor: 60 },
              available: true,
            },
          ],
        },
      ],
    },
    'pu',
    'stall',
    '校內咖啡店',
  );
  expect(items).toEqual([
    expect.objectContaining({
      id: 'toast',
      name: '蔬菜吐司',
      cafeteriaId: 'stall',
      price: 60,
      category: '吐司',
      schoolId: 'pu',
    }),
  ]);
});
