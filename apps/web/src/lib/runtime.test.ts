import { afterEach, expect, it, vi } from 'vitest';
import { areUniversalDevAccountsEnabled, getAnnouncementVisibilityEnv, getWebAppEnv } from './runtime';
afterEach(() => vi.unstubAllEnvs());
it('production cannot re-enable test accounts with a public flag', () => {
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'production');
  vi.stubEnv('NEXT_PUBLIC_ENABLE_UNIVERSAL_DEV_ACCOUNTS', 'true');
  expect(areUniversalDevAccountsEnabled()).toBe(false);
});
it('a production build defaults to production when no environment is specified', () => {
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', '');
  vi.stubEnv('NODE_ENV', 'production');
  expect(getWebAppEnv()).toBe('production');
  expect(areUniversalDevAccountsEnabled()).toBe(false);
});
it('demo-school visibility reads the raw public env and treats blank as off', () => {
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', '');
  expect(getAnnouncementVisibilityEnv()).toBe('');
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'staging');
  expect(getAnnouncementVisibilityEnv()).toBe('staging');
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'test');
  expect(getAnnouncementVisibilityEnv()).toBe('test');
});
