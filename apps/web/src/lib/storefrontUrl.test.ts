import { afterEach, expect, it, vi } from 'vitest';
import {
  STOREFRONT_URL_CREDENTIALS_TEXT,
  STOREFRONT_URL_HTTPS_TEXT,
  STOREFRONT_URL_TOO_LONG_TEXT,
  isStoredStorefrontUrlAllowed,
  storefrontUrlIssue,
} from '@campus/shared/src/merchantMode';
import { saveShopStorefront } from './storefront';

const updateDoc = vi.fn(async (_ref?: unknown, _data?: unknown) => undefined);
vi.mock('firebase/firestore', async (original) => {
  const actual = await original();
  return {
    ...(actual as object),
    updateDoc: (ref: unknown, data: unknown) => updateDoc(ref, data),
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
});

it('trims storefront URLs in the editor and rejects whitespace on stored values', () => {
  expect(storefrontUrlIssue('  https://shop.example/order  ')).toBeNull();
  expect(storefrontUrlIssue('http://shop.example')).toBe(STOREFRONT_URL_HTTPS_TEXT);
  expect(storefrontUrlIssue('https://user:pass@shop.example/order')).toBe(
    STOREFRONT_URL_CREDENTIALS_TEXT,
  );
  expect(storefrontUrlIssue(`https://shop.example/${'a'.repeat(500)}`)).toBe(
    STOREFRONT_URL_TOO_LONG_TEXT,
  );
  expect(isStoredStorefrontUrlAllowed(' https://shop.example/order')).toBe(false);
  expect(isStoredStorefrontUrlAllowed('https://shop.example/order ')).toBe(false);
  expect(isStoredStorefrontUrlAllowed('https://shop.example/order')).toBe(true);
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
  expect(updateDoc).not.toHaveBeenCalled();
});
