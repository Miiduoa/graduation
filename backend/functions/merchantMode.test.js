'use strict';

const {
  normalizeMerchantMode,
  resolveStoredMerchantMode,
  isHttpsOrderingUrl,
  buildShowcaseOrderingUrl,
  isMenuStale,
  parseMenuCsv,
  studentCafeteriaAction,
  NATIVE_ORDERING_CLOSED_TEXT,
  EXTERNAL_ORDER_HONEST_TEXT,
} = require('./lib/merchantMode');
const { isOnlineOrderingEnabled } = require('./lib/onlineOrdering');

test('showcase stores keep https ordering URLs with a source tag', () => {
  expect(normalizeMerchantMode('nope')).toBe('info_only');
  expect(isHttpsOrderingUrl('http://shop.example/order')).toBe(false);
  expect(isHttpsOrderingUrl('https://user:pass@shop.example/order')).toBe(false);
  expect(
    buildShowcaseOrderingUrl('https://shop.example/order?x=1', 'pu', 'cafe-1'),
  ).toBe('https://shop.example/order?x=1&utm_source=nuni&utm_campaign=campus&ref=nuni-pu-cafe-1');
});

test('missing merchantMode stays native when the shop already takes orders', () => {
  expect(resolveStoredMerchantMode({ orderingEnabled: true })).toBe('native_order');
  expect(
    studentCafeteriaAction({
      orderingEnabled: true,
      onlineOrderingEnabled: false,
    }),
  ).toEqual({ kind: 'native_closed', label: NATIVE_ORDERING_CLOSED_TEXT });
});

test('native_order stays closed when the global switch is off and is not rewritten to an outbound link', () => {
  expect(
    studentCafeteriaAction({
      merchantMode: 'native_order',
      orderingEnabled: true,
      onlineOrderingEnabled: false,
      orderingUrl: 'https://shop.example/order',
    }),
  ).toEqual({ kind: 'native_closed', label: NATIVE_ORDERING_CLOSED_TEXT });
  expect(isOnlineOrderingEnabled({ ONLINE_ORDERING_ENABLED: 'false', JEST_WORKER_ID: '1' })).toBe(false);
});

test('CSV menus and stale hints stay honest', () => {
  const rows = parseMenuCsv('品名,價格,分類\n滷肉飯,60,主食\n紅茶,,飲料');
  expect(rows).toEqual([
    { name: '滷肉飯', price: 60, category: '主食' },
    { name: '紅茶', price: null, category: '飲料' },
  ]);
  expect(isMenuStale('2026-10-10T00:00:00.000Z', new Date('2026-10-12T01:00:00.000Z'))).toBe(true);
  expect(isMenuStale('2026-10-12T00:00:00.000Z', new Date('2026-10-12T01:00:00.000Z'))).toBe(false);
  expect(EXTERNAL_ORDER_HONEST_TEXT).toContain('請到店家查看');
});
