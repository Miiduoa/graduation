import { expect, it } from 'vitest';
import { assistantSources, readOnlyAssistantCards } from './assistantPresentation';

it('keeps useful read cards and excludes write proposals or unverified receipts', () => {
  const cards = readOnlyAssistantCards([
    { kind: 'order_draft_card', payload: { confirmAction: { functionName: 'createOrder' } } },
    { kind: 'order_submitted', payload: { orderId: 'claimed' } },
    { kind: 'menu_card', payload: { cafeteriaName: '一餐', items: [{ menuItemId: 'rice', name: '炒飯', price: 80 }] } },
    { kind: 'poi_card', payload: { schoolId: 'pu', pois: [{ id: 'library', name: '圖書館', schoolId: 'pu' }] } },
  ], 'pu');
  expect(cards.map(card => card.kind)).toEqual(['menu_card', 'poi_card']);
});

it('ignores malformed cards and old unverified route or navigation cards', () => {
  const cards = readOnlyAssistantCards([null, { kind: 'poi_card', payload: { pois: 'wrong' } },
    { kind: 'route_card', payload: { from: { id: 'a&x=1', name: '教室' }, to: { id: 'b', name: '圖書館' }, distanceMeters: 100, walkMinutes: 2, deepLink: { web: 'javascript:alert(1)' }, steps: [{ instruction: {} }] } },
    { kind: 'navigate', payload: { screen: 'GoogleMapsLike', params: { fromPoiId: 'a', toPoiId: 'b' } } },
  ], 'pu');
  expect(cards).toEqual([]);
});

it.each([
  { pois: [{ id: 'library', name: '圖書館', schoolId: 'pu' }] },
  { schoolId: 'pu', pois: [{ id: 'library', name: '圖書館' }] },
  { schoolId: 'pu', pois: [{ id: 'library', name: '圖書館', schoolId: 'nthu' }] },
  { schoolId: 'nthu', pois: [{ id: 'library', name: '圖書館', schoolId: 'nthu' }] },
])('rejects location cards with missing or mismatched school metadata', payload => {
  expect(readOnlyAssistantCards([{ kind: 'poi_card', payload }], 'pu')).toEqual([]);
});

it('shows only valid http sources and removes duplicate source links', () => {
  expect(assistantSources([{ source: 'javascript:alert(1)', label: 'unsafe' }, { source: 'https://school.edu/rules', label: '校規' }, { source: 'https://school.edu/rules' }, null]))
    .toEqual([{ url: 'https://school.edu/rules', label: '校規' }]);
});

it.each([
  { cafeterias: [{ id: 'one', name: '餐廳', schoolId: 'pu' }] },
  { schoolId: 'pu', cafeterias: [{ id: 'one', name: '餐廳' }] },
  { schoolId: 'pu', cafeterias: [{ id: 'one', name: '餐廳', schoolId: 'nthu' }] },
  { schoolId: 'nthu', cafeterias: [{ id: 'one', name: '餐廳', schoolId: 'nthu' }] },
])('rejects cafeterias with missing or mismatched school metadata', payload => {
  expect(readOnlyAssistantCards([{ kind: 'cafeteria_list_card', payload }], 'pu')).toEqual([]);
});
