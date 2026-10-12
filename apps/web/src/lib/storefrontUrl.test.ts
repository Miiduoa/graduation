import { afterEach, expect, it, vi } from 'vitest';
import {
  STOREFRONT_URL_CREDENTIALS_TEXT,
  STOREFRONT_URL_HTTPS_TEXT,
  STOREFRONT_URL_TOO_LONG_TEXT,
  isHttpsOrderingUrl,
  isStoredStorefrontUrlAllowed,
  safeStorefrontUrl,
  storefrontUrlIssue,
} from '@campus/shared/src/merchantMode';
import { recordExternalOrderClick, saveShopStorefront } from './storefront';

const TOO_LONG_URL = `https://shop.example/${'a'.repeat(2048)}`;
const REJECTED_STOREFRONT_URLS = [
  'javascript:alert(1)',
  'https://a@evil.com',
  TOO_LONG_URL,
  ' https://shop.example/order',
  'https://shop.example/order ',
  'http://shop.example',
  'data:text/html,hi',
];

const updateDoc = vi.fn(async (_ref?: unknown, _data?: unknown) => undefined);
const addDoc = vi.fn(async (_ref?: unknown, _data?: unknown) => undefined);
vi.mock('firebase/firestore', async (original) => {
  const actual = await original();
  return {
    ...(actual as object),
    updateDoc: (ref: unknown, data: unknown) => updateDoc(ref, data),
    addDoc: (ref?: unknown, data?: unknown) => addDoc(ref, data),
    collection: (...path: unknown[]) => path,
    doc: (...path: unknown[]) => path,
    serverTimestamp: () => 'now',
  };
});
vi.mock('@/lib/firebase', () => ({
  getDb: () => ({}),
  isFirebaseConfigured: () => true,
}));

afterEach(() => {
  updateDoc.mockClear();
  addDoc.mockClear();
});

it('trims storefront URLs in the editor and rejects whitespace on stored values', () => {
  expect(storefrontUrlIssue('  https://shop.example/order  ')).toBeNull();
  expect(storefrontUrlIssue('http://shop.example')).toBe(STOREFRONT_URL_HTTPS_TEXT);
  expect(storefrontUrlIssue('https://user:pass@shop.example/order')).toBe(
    STOREFRONT_URL_CREDENTIALS_TEXT,
  );
  expect(storefrontUrlIssue(TOO_LONG_URL)).toBe(STOREFRONT_URL_TOO_LONG_TEXT);
  expect(storefrontUrlIssue('javascript:alert(1)')).toBe(STOREFRONT_URL_HTTPS_TEXT);
  expect(storefrontUrlIssue('https://a@evil.com')).toBe(STOREFRONT_URL_CREDENTIALS_TEXT);
  expect(storefrontUrlIssue('data:text/html,hi')).toBe(STOREFRONT_URL_HTTPS_TEXT);
  expect(isStoredStorefrontUrlAllowed(' https://shop.example/order')).toBe(false);
  expect(isStoredStorefrontUrlAllowed('https://shop.example/order ')).toBe(false);
  expect(isStoredStorefrontUrlAllowed('https://shop.example/order')).toBe(true);
});

it('blocks javascript, userinfo, overlong, padded, http and data URLs before they become outbound links', () => {
  for (const url of REJECTED_STOREFRONT_URLS) {
    expect(isHttpsOrderingUrl(url)).toBe(false);
    expect(isStoredStorefrontUrlAllowed(url)).toBe(false);
    expect(safeStorefrontUrl(url)).toBeUndefined();
  }
});

it('treats NUL and uppercase HTTPS the same for save and display helpers', () => {
  const nul = 'https://shop.example/order\u0000';
  const upper = 'HTTPS://shop.example/order';
  expect(isHttpsOrderingUrl(nul)).toBe(false);
  expect(isStoredStorefrontUrlAllowed(nul)).toBe(false);
  expect(safeStorefrontUrl(nul)).toBeUndefined();
  expect(storefrontUrlIssue(nul)).toBe(STOREFRONT_URL_HTTPS_TEXT);
  expect(isHttpsOrderingUrl(upper)).toBe(true);
  expect(isStoredStorefrontUrlAllowed(upper)).toBe(true);
  expect(safeStorefrontUrl(upper)).toBe(upper);
  expect(storefrontUrlIssue(upper)).toBeNull();
});

it('saves the trimmed URL and does not write a padded value', async () => {
  await expect(
    saveShopStorefront({
      schoolId: 'pu',
      cafeteriaId: 'stall',
      websiteUrl: '  https://shop.example  ',
      orderingUrl: '  https://shop.example/order  ',
      merchantMode: 'showcase_link',
    }),
  ).resolves.toEqual({
    websiteUrl: 'https://shop.example',
    orderingUrl: 'https://shop.example/order',
  });
  expect(updateDoc).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      websiteUrl: 'https://shop.example',
      orderingUrl: 'https://shop.example/order',
    }),
  );
});

it('does not save an invalid storefront URL', async () => {
  await expect(
    saveShopStorefront({
      schoolId: 'pu',
      cafeteriaId: 'stall',
      websiteUrl: 'http://shop.example',
    }),
  ).rejects.toThrow(STOREFRONT_URL_HTTPS_TEXT);
  await expect(
    saveShopStorefront({
      schoolId: 'pu',
      cafeteriaId: 'stall',
      websiteUrl: 'javascript:alert(1)',
    }),
  ).rejects.toThrow(STOREFRONT_URL_HTTPS_TEXT);
  await expect(
    saveShopStorefront({
      schoolId: 'pu',
      cafeteriaId: 'stall',
      orderingUrl: 'https://a@evil.com',
    }),
  ).rejects.toThrow(STOREFRONT_URL_CREDENTIALS_TEXT);
  await expect(
    saveShopStorefront({
      schoolId: 'pu',
      cafeteriaId: 'stall',
      websiteUrl: TOO_LONG_URL,
    }),
  ).rejects.toThrow(STOREFRONT_URL_TOO_LONG_TEXT);
  await expect(
    saveShopStorefront({
      schoolId: 'pu',
      cafeteriaId: 'stall',
      websiteUrl: 'data:text/html,hi',
    }),
  ).rejects.toThrow(STOREFRONT_URL_HTTPS_TEXT);
  expect(updateDoc).not.toHaveBeenCalled();
});

it('records an uppercase HTTPS click and rejects a NUL URL', async () => {
  await expect(
    recordExternalOrderClick({
      uid: 'alice',
      schoolId: 'pu',
      cafeteriaId: 'stall',
      orderingUrl: 'HTTPS://shop.example/order',
    }),
  ).resolves.toContain('https://shop.example/order');
  expect(addDoc).toHaveBeenCalled();
  addDoc.mockClear();
  await expect(
    recordExternalOrderClick({
      uid: 'alice',
      schoolId: 'pu',
      cafeteriaId: 'stall',
      orderingUrl: 'https://shop.example/order\u0000',
    }),
  ).rejects.toThrow('Invalid ordering url');
  expect(addDoc).not.toHaveBeenCalled();
});

it('does not record an external order click for an unsafe URL', async () => {
  for (const orderingUrl of REJECTED_STOREFRONT_URLS) {
    await expect(
      recordExternalOrderClick({
        uid: 'alice',
        schoolId: 'pu',
        cafeteriaId: 'stall',
        orderingUrl,
      }),
    ).rejects.toThrow('Invalid ordering url');
  }
  expect(addDoc).not.toHaveBeenCalled();
});
