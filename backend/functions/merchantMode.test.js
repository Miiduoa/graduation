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
  PRICE_DISCLAIMER,
  EXTERNAL_ORDER_HONEST_TEXT,
  SHOWCASE_ORDER_BUTTON_TEXT,
  SHOWCASE_ORDER_CAPTION,
  storefrontUrlIssue,
  isStoredStorefrontUrlAllowed,
  safeStorefrontUrl,
  STOREFRONT_URL_HTTPS_TEXT,
  STOREFRONT_URL_CREDENTIALS_TEXT,
  STOREFRONT_URL_TOO_LONG_TEXT,
} = require('./lib/merchantMode');

const TOO_LONG_URL = `https://shop.example/${'a'.repeat(2048)}`;
const REJECTED_STOREFRONT_URLS = [
  'javascript:alert(1)',
  'https://a@evil.com',
  TOO_LONG_URL,
  ' https://shop.example/order',
  'https://shop.example/order ',
  'http://shop.example/order',
  'data:text/html,hi',
];
const { isOnlineOrderingEnabled } = require('./lib/onlineOrdering');

test('showcase stores keep https ordering URLs with a source tag', () => {
  expect(normalizeMerchantMode('nope')).toBe('info_only');
  expect(isHttpsOrderingUrl('https://shop.example/order')).toBe(true);
  expect(isHttpsOrderingUrl('http://shop.example/order')).toBe(false);
  expect(isHttpsOrderingUrl('https://user:pass@shop.example/order')).toBe(false);
  expect(
    buildShowcaseOrderingUrl('https://shop.example/order?x=1', 'pu', 'cafe-1'),
  ).toBe('https://shop.example/order?x=1&utm_source=nuni&utm_campaign=campus&ref=nuni-pu-cafe-1');
});

test('shared storefront URL check rejects javascript, userinfo, overlong, spaces, http and data', () => {
  for (const url of REJECTED_STOREFRONT_URLS) {
    expect(isHttpsOrderingUrl(url)).toBe(false);
    expect(isStoredStorefrontUrlAllowed(url)).toBe(false);
    expect(safeStorefrontUrl(url)).toBeUndefined();
    expect(studentCafeteriaAction({ merchantMode: 'showcase_link', orderingUrl: url }).kind).toBe(
      'info',
    );
  }
  expect(isHttpsOrderingUrl('https://shop.example/order\u0000')).toBe(false);
  expect(isHttpsOrderingUrl('\thttps://shop.example/order')).toBe(false);
  expect(isStoredStorefrontUrlAllowed('')).toBe(true);
  expect(safeStorefrontUrl('https://shop.example/order')).toBe('https://shop.example/order');
});

test('NUL and uppercase HTTPS have the same result in save, display and stored checks', () => {
  const nul = 'https://shop.example/order\u0000';
  const upper = 'HTTPS://shop.example/order';
  expect(isHttpsOrderingUrl(nul)).toBe(false);
  expect(isStoredStorefrontUrlAllowed(nul)).toBe(false);
  expect(safeStorefrontUrl(nul)).toBeUndefined();
  expect(storefrontUrlIssue(nul)).toBe(STOREFRONT_URL_HTTPS_TEXT);
  expect(studentCafeteriaAction({ merchantMode: 'showcase_link', orderingUrl: nul }).kind).toBe(
    'info',
  );
  expect(isHttpsOrderingUrl(upper)).toBe(true);
  expect(isStoredStorefrontUrlAllowed(upper)).toBe(true);
  expect(safeStorefrontUrl(upper)).toBe(upper);
  expect(storefrontUrlIssue(upper)).toBeNull();
  expect(studentCafeteriaAction({ merchantMode: 'showcase_link', orderingUrl: upper })).toEqual({
    kind: 'showcase',
    label: SHOWCASE_ORDER_BUTTON_TEXT,
  });
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

test('showcase stores use outbound-order copy and stay info-only without an https URL', () => {
  expect(SHOWCASE_ORDER_BUTTON_TEXT).toBe('到店家網站訂餐');
  expect(SHOWCASE_ORDER_CAPTION).toBe(
    '會開啟店家自己的網站，訂單和付款由店家處理，Campus One 查不到這筆訂單',
  );
  expect(SHOWCASE_ORDER_BUTTON_TEXT).not.toMatch(/點餐|下單/);
  expect(
    studentCafeteriaAction({
      merchantMode: 'showcase_link',
      orderingUrl: 'https://shop.example/order',
    }),
  ).toEqual({ kind: 'showcase', label: SHOWCASE_ORDER_BUTTON_TEXT });
  expect(
    studentCafeteriaAction({
      merchantMode: 'showcase_link',
      location: '學生餐廳',
      openingHours: '11:00–14:00',
    }),
  ).toEqual({ kind: 'info', label: '查看店面' });
});

test('storefront URL editor trims spaces and explains https, credentials and length failures', () => {
  expect(storefrontUrlIssue('  https://shop.example/order  ')).toBeNull();
  expect(storefrontUrlIssue('')).toBeNull();
  expect(storefrontUrlIssue('http://shop.example')).toBe(STOREFRONT_URL_HTTPS_TEXT);
  expect(storefrontUrlIssue('https://user:pass@shop.example/order')).toBe(
    STOREFRONT_URL_CREDENTIALS_TEXT,
  );
  expect(storefrontUrlIssue(TOO_LONG_URL)).toBe(STOREFRONT_URL_TOO_LONG_TEXT);
  expect(storefrontUrlIssue('javascript:alert(1)')).toBe(STOREFRONT_URL_HTTPS_TEXT);
  expect(storefrontUrlIssue('https://a@evil.com')).toBe(STOREFRONT_URL_CREDENTIALS_TEXT);
  expect(storefrontUrlIssue('data:text/html,hi')).toBe(STOREFRONT_URL_HTTPS_TEXT);
  expect(isStoredStorefrontUrlAllowed('https://shop.example/order')).toBe(true);
  expect(isStoredStorefrontUrlAllowed('')).toBe(true);
  expect(isStoredStorefrontUrlAllowed(' https://shop.example/order')).toBe(false);
  expect(isStoredStorefrontUrlAllowed('https://shop.example/order ')).toBe(false);
  expect(isStoredStorefrontUrlAllowed('https://shop.example/path with space')).toBe(false);
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
  expect(PRICE_DISCLAIMER).toBe('價格、是否賣完、是否接單以店家訂餐頁為準，付款與退款由店家處理。');
  expect(PRICE_DISCLAIMER).not.toMatch(/nuni/i);
});
