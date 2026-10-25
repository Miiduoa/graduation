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

test('rewrites retired staff, department and dormitory paths to today', () => {
  expect(rewriteLegacyShopsPath('staff')).toBe('home');
  expect(rewriteLegacyShopsPath('/department')).toBe('/home');
  expect(rewriteLegacyShopsPath('dormitory?id=1')).toBe('home?id=1');
  expect(rewriteLegacyShopsPath('library')).toBe('library');
});
