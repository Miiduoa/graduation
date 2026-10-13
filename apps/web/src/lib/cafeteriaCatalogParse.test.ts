import { expect, it } from 'vitest';
import {
  CAFETERIA_BACK_TO_LIST_TEXT,
  CAFETERIA_EMPTY_SCHOOL_TEXT,
  CAFETERIA_NOT_FOUND_TEXT,
  CAFETERIA_REVIEW_STATUS_DEFAULT,
  DEMO_CAFETERIA_BADGE,
  DEMO_CAFETERIA_NOTICE,
  UNVERIFIED_CAFETERIA_BADGE,
  UNVERIFIED_CAFETERIA_NOTICE,
  cafeteriaListHref,
  cafeteriaReviewBadge,
  cafeteriaReviewNotice,
  parseCafeteriaLocations,
  parseCafeteriaMenu,
  parseCafeteriaReviewStatus,
} from '@campus/shared/src/cafeteriaCatalog';

it('keeps the student-facing cafeteria copy used by empty and missing shops', () => {
  expect(CAFETERIA_EMPTY_SCHOOL_TEXT).toBe('這間學校的餐廳還沒上架');
  expect(CAFETERIA_NOT_FOUND_TEXT).toBe('找不到這間店。');
  expect(CAFETERIA_BACK_TO_LIST_TEXT).toBe('回餐廳列表');
  expect(DEMO_CAFETERIA_BADGE).toBe('示範');
  expect(DEMO_CAFETERIA_NOTICE).toBe('這是示範店家，菜單和價格不是真的，不能點餐。');
  expect(UNVERIFIED_CAFETERIA_BADGE).toBe('未核對');
  expect(UNVERIFIED_CAFETERIA_NOTICE).toBe(
    '這間店的菜單和價格還沒跟店家核對過，可能跟現場不一樣，目前不能點餐。',
  );
  expect(CAFETERIA_REVIEW_STATUS_DEFAULT).toBe('unverified');
  expect(cafeteriaListHref('cgu')).toBe('/cafeteria?schoolId=cgu');
});

it('reads only the catalog reviewStatus field and treats missing or unknown values as unverified', () => {
  expect(parseCafeteriaReviewStatus('verified')).toBe('verified');
  expect(parseCafeteriaReviewStatus('已核對')).toBe('verified');
  expect(parseCafeteriaReviewStatus('demo')).toBe('demo');
  expect(parseCafeteriaReviewStatus('示範')).toBe('demo');
  expect(parseCafeteriaReviewStatus('unverified')).toBe('unverified');
  expect(parseCafeteriaReviewStatus(undefined)).toBe('unverified');
  expect(parseCafeteriaReviewStatus(null)).toBe('unverified');
  expect(parseCafeteriaReviewStatus('')).toBe('unverified');
  expect(parseCafeteriaReviewStatus('unknown')).toBe('unverified');
  expect(parseCafeteriaReviewStatus(true)).toBe('unverified');
  expect(parseCafeteriaReviewStatus(false)).toBe('unverified');
  expect(cafeteriaReviewBadge('verified')).toBeNull();
  expect(cafeteriaReviewBadge('unverified')).toBe('未核對');
  expect(cafeteriaReviewBadge('demo')).toBe('示範');
  expect(cafeteriaReviewBadge(undefined)).toBe('未核對');
  expect(cafeteriaReviewNotice('verified')).toBeNull();
  expect(cafeteriaReviewNotice('unverified')).toBe(
    '這間店的菜單和價格還沒跟店家核對過，可能跟現場不一樣，目前不能點餐。',
  );
  expect(cafeteriaReviewNotice('demo')).toBe('這是示範店家，菜單和價格不是真的，不能點餐。');
  expect(cafeteriaReviewNotice('unknown')).toBe(
    '這間店的菜單和價格還沒跟店家核對過，可能跟現場不一樣，目前不能點餐。',
  );
});

it('does not infer review status from shop names such as 路易莎 or 全家', () => {
  const rows = parseCafeteriaLocations(
    {
      locations: [
        { id: 'louisa', name: '路易莎咖啡', schoolId: 'pu', merchantMode: 'info_only' },
        { id: 'family', name: '全家便利商店', schoolId: 'pu', merchantMode: 'info_only' },
        { id: 'unknown-shop', name: '未知店家', schoolId: 'pu' },
      ],
    },
    'pu',
  );
  expect(rows.map((row) => ({ id: row.id, reviewStatus: row.reviewStatus }))).toEqual([
    { id: 'unknown-shop', reviewStatus: 'unverified' },
    { id: 'family', reviewStatus: 'unverified' },
    { id: 'louisa', reviewStatus: 'unverified' },
  ]);
});

it('parses only the requested school and keeps reviewStatus from the data field', () => {
  const rows = parseCafeteriaLocations(
    {
      locations: [
        {
          id: 'jingyuan',
          name: '靜園餐廳',
          schoolId: 'pu',
          zoneLabel: '文興樓對面',
          merchantMode: 'info_only',
          reviewStatus: 'verified',
        },
        { id: 'cafe-1', name: '校園小棧', schoolId: 'pu', reviewStatus: 'demo' },
        { id: 'stall', name: '校內咖啡店', schoolId: 'pu', verificationStatus: '未核對' },
        { id: 'other', name: '他校餐廳', schoolId: 'cgu' },
        { id: 'bad/id', name: '無效' },
      ],
    },
    'pu',
  );
  expect(rows.map((row) => ({ id: row.id, reviewStatus: row.reviewStatus }))).toEqual([
    { id: 'stall', reviewStatus: 'unverified' },
    { id: 'cafe-1', reviewStatus: 'demo' },
    { id: 'jingyuan', reviewStatus: 'verified' },
  ]);
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
