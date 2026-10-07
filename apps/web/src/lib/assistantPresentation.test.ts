import { expect, it } from 'vitest';
import { assistantSources, readOnlyAssistantCards } from './assistantPresentation';

it('keeps useful read cards and excludes write proposals or unverified receipts', () => {
  const cards = readOnlyAssistantCards([
    { kind: 'order_draft_card', payload: { confirmAction: { functionName: 'createOrder' } } },
    { kind: 'order_submitted', payload: { orderId: 'claimed' } },
    { kind: 'menu_card', payload: { cafeteriaName: '一餐', items: [{ menuItemId: 'rice', name: '炒飯', price: 80 }] } },
    { kind: 'poi_card', payload: { pois: [{ id: 'library', name: '圖書館' }] } },
  ]);
  expect(cards.map(card => card.kind)).toEqual(['menu_card', 'poi_card']);
});

it('ignores malformed cards and replaces supplied deep links with internal map destinations', () => {
  const cards = readOnlyAssistantCards([null, { kind: 'poi_card', payload: { pois: 'wrong' } },
    { kind: 'route_card', payload: { from: { id: 'a&x=1', name: '教室' }, to: { id: 'b', name: '圖書館' }, distanceMeters: 100, walkMinutes: 2, deepLink: { web: 'javascript:alert(1)' }, steps: [{ instruction: {} }] } },
  ]);
  expect(cards).toHaveLength(1);
  expect(cards[0].payload).not.toHaveProperty('deepLink');
  expect(cards[0].payload).toMatchObject({ from: { id: 'a%26x%3D1' }, steps: [] });
});

it('shows only valid http sources and removes duplicate source links', () => {
  expect(assistantSources([{ source: 'javascript:alert(1)', label: 'unsafe' }, { source: 'https://school.edu/rules', label: '校規' }, { source: 'https://school.edu/rules' }, null]))
    .toEqual([{ url: 'https://school.edu/rules', label: '校規' }]);
});
