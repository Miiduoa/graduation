import { rewriteLegacyShopsPath } from '../app/legacyShopsPath';

test('rewrites the old /shops entry to the current school login path', () => {
  expect(rewriteLegacyShopsPath('shops')).toBe('sso-login');
  expect(rewriteLegacyShopsPath('/shops')).toBe('/sso-login');
  expect(rewriteLegacyShopsPath('shops?returnTo=%2Fcafeteria')).toBe(
    'sso-login?returnTo=%2Fcafeteria',
  );
  expect(rewriteLegacyShopsPath('sso-login')).toBe('sso-login');
  expect(rewriteLegacyShopsPath('cafeteria')).toBe('cafeteria');
});
