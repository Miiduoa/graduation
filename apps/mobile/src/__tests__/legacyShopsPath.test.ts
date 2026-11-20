import { rewriteLegacyShopsPath } from '../app/legacyShopsPath';

test.each([
  ['shops', 'campus-one?tab=food'],
  ['/shops', '/campus-one?tab=food'],
  ['shops/', 'campus-one?tab=food'],
  ['/shops/', '/campus-one?tab=food'],
])('rewrites the old %s root to platform food', (path, expected) => {
  expect(rewriteLegacyShopsPath(path)).toBe(expected);
});

test('preserves only bounded campus hints, without selecting an identity or a school membership', () => {
  expect(rewriteLegacyShopsPath('shops?school=pu&schoolId=%74%77-pu&campus=nthu')).toBe(
    'campus-one?tab=food&school=pu&schoolId=tw-pu&campus=nthu',
  );
});

test('drops role, account, credentials and return targets while forcing the food tab', () => {
  expect(rewriteLegacyShopsPath(
    'shops?school=pu&tab=merchant&role=admin&uid=other&platformAccountId=pa-other' +
    '&assistantAccountId=pa-other&workspaceId=cw-other&assignmentId=cwa-other' +
    '&materialId=cwm-other&context=private&token=secret&sessionHandle=ps-secret' +
    '&credential=secret&returnTo=%2Fadmin&returnUrl=https%3A%2F%2Fevil.test#tab=merchant',
  )).toBe('campus-one?tab=food&school=pu');
});

test.each([
  'school=pu&school=nthu',
  'school=pu&%73chool=nthu',
  'school=pu&school=%E0%A4',
  'school',
  'schoolId=https%3A%2F%2Fevil.test',
  'campus=..%2Fadmin',
  'campus=pu=admin',
  'campus=%00pu',
  'campus=%E0%A4',
  `schoolId=${'a'.repeat(81)}`,
])('does not forward ambiguous or malformed campus query: %s', (query) => {
  expect(rewriteLegacyShopsPath(`shops?${query}`)).toBe('campus-one?tab=food');
});

test('keeps a valid school hint when another field is malformed without relying on the native URL parser', () => {
  expect(rewriteLegacyShopsPath('shops?schoolId=pu&campus=%E0%A4&%broken=value')).toBe(
    'campus-one?tab=food&schoolId=pu',
  );
});

test.each([
  'shops/vendor-one',
  '/shops/vendor/vendor-one',
  'shops/detail/order-one?schoolId=pu',
  'shops/staff',
  'shops//',
  'nested/shops',
  'shops-other',
  'sso-login',
  'cafeteria',
])('keeps unsupported details and unrelated route %s out of the food redirect', (path) => {
  expect(rewriteLegacyShopsPath(path)).toBe(path);
});

test('keeps an explicit school login distinct from the Google food entry', () => {
  expect(rewriteLegacyShopsPath('sso-login?returnTo=%2Fcafeteria')).toBe(
    'sso-login?returnTo=%2Fcafeteria',
  );
});

test('rewrites retired staff and department paths while preserving the restored dormitory route', () => {
  expect(rewriteLegacyShopsPath('staff')).toBe('home');
  expect(rewriteLegacyShopsPath('/department')).toBe('/home');
  expect(rewriteLegacyShopsPath('dormitory?id=1')).toBe('dormitory?id=1');
  expect(rewriteLegacyShopsPath('library')).toBe('library');
});
