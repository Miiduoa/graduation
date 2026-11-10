import { expect, it } from 'vitest';
import { inAppHref, isInternalPath, isSafeHref, pageLabel } from './copy';

it('distinguishes assistant permissions from the general settings entry', () => {
  expect(pageLabel('/settings?schoolId=pu')).toBe('設定');
  expect(pageLabel('/settings?section=assistant&schoolId=pu')).toBe('助理權限');
  expect(pageLabel('/settings?section=assistant&section=profile')).toBe('設定');
});

it('accepts campus paths and rejects javascript or protocol-relative hrefs', () => {
  expect(isInternalPath('/food?tenant=a&location=dining-a')).toBe(true);
  expect(isInternalPath('/calendar#today')).toBe(true);
  expect(isInternalPath('https://example.invalid')).toBe(false);
  expect(isInternalPath('javascript:alert(1)')).toBe(false);
  expect(isInternalPath('//evil.test/food')).toBe(false);
});

it('treats https as a safe URL but not an in-app path', () => {
  expect(isSafeHref('/clubs')).toBe(true);
  expect(isSafeHref('https://example.invalid/x')).toBe(true);
  expect(isSafeHref('javascript:alert(1)')).toBe(false);
  expect(inAppHref('/food?tenant=a')).toBe('/food?tenant=a');
  expect(inAppHref('https://example.invalid')).toBeNull();
  expect(inAppHref('javascript:alert(1)')).toBeNull();
});
