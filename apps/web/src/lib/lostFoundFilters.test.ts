import { expect, it } from 'vitest';
import { filterLostFoundItems, describeLostFoundFilterScope } from './lostFoundFilters';
import type { LostFoundItem } from './lostFound';

const items: LostFoundItem[] = [
  {
    id: '1',
    type: 'lost',
    title: '雨傘',
    description: '黑色',
    category: 'other',
    location: '圖書館',
    date: '2026-10-01T00:00:00.000Z',
    status: 'open',
    reporterId: 'alice',
    userId: 'alice',
    createdAt: '2026-10-01T00:00:00.000Z',
    schoolId: 'pu',
    canonical: true,
  },
  {
    id: '2',
    type: 'found',
    title: '學生證',
    description: '拾獲於餐廳',
    category: 'cards',
    location: '餐廳',
    date: '2026-10-02T00:00:00.000Z',
    status: 'resolved',
    reporterId: 'bob',
    userId: 'bob',
    createdAt: '2026-10-02T00:00:00.000Z',
    schoolId: 'pu',
    canonical: true,
  },
];

it('filters by type, status, mine, and search query', () => {
  expect(
    filterLostFoundItems(items, { query: '', type: 'lost', status: 'all', mine: false }, 'alice').map(
      (row) => row.id,
    ),
  ).toEqual(['1']);
  expect(
    filterLostFoundItems(
      items,
      { query: '餐廳', type: 'all', status: 'resolved', mine: false },
      'alice',
    ).map((row) => row.id),
  ).toEqual(['2']);
  expect(
    filterLostFoundItems(items, { query: '', type: 'all', status: 'all', mine: true }, 'alice').map(
      (row) => row.id,
    ),
  ).toEqual(['1']);
});

it('limits results to the requested item category and names it in the visible scope', () => {
  const filters = { query: '', type: 'all', status: 'all', mine: false, category: 'cards' } as const;
  expect(filterLostFoundItems(items, filters, 'alice').map(item => item.id)).toEqual(['2']);
  expect(describeLostFoundFilterScope(filters, '靜宜大學')).toContain('證件／卡片');
});

it('describes the visible filter scope in Traditional Chinese', () => {
  expect(
    describeLostFoundFilterScope(
      { query: '雨傘', type: 'lost', status: 'open', mine: true },
      '靜宜大學',
    ),
  ).toContain('靜宜大學');
  expect(
    describeLostFoundFilterScope(
      { query: '雨傘', type: 'lost', status: 'open', mine: true },
      '靜宜大學',
    ),
  ).toContain('僅顯示我刊登的');
});
