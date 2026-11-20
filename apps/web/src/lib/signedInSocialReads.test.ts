import { expect, it } from 'vitest';
import {
  LOGIN_REQUIRED_ACTION_TEXT,
  LOGIN_REQUIRED_COMMENTS_TEXT,
  LOGIN_REQUIRED_LOST_FOUND_AND_COMMENTS_TEXT,
  isPermissionDeniedError,
  permissionDeniedError,
  sanitizeLoginReturnPath,
} from '@campus/shared/src/signedInSocialReads';

it('keeps the signed-in social read copy stable', () => {
  expect(LOGIN_REQUIRED_LOST_FOUND_AND_COMMENTS_TEXT).toBe('登入後才能看失物招領和評論');
  expect(LOGIN_REQUIRED_COMMENTS_TEXT).toBe('登入後才能看評論');
  expect(LOGIN_REQUIRED_ACTION_TEXT).toBe('登入');
});

it('treats permission-denied codes and messages as login-required failures', () => {
  expect(isPermissionDeniedError(permissionDeniedError())).toBe(true);
  expect(
    isPermissionDeniedError(
      Object.assign(new Error('Missing or insufficient permissions.'), {
        code: 'permission-denied',
      }),
    ),
  ).toBe(true);
  expect(isPermissionDeniedError({ code: 'functions/permission-denied' })).toBe(true);
  expect(isPermissionDeniedError(new Error('offline'))).toBe(false);
});

it('keeps in-site login return paths and drops off-site or control characters', () => {
  expect(sanitizeLoginReturnPath('/cafeteria/stall?schoolId=pu')).toBe(
    '/cafeteria/stall?schoolId=pu',
  );
  expect(sanitizeLoginReturnPath('https://evil.test')).toBe('/');
  expect(sanitizeLoginReturnPath('//evil.test')).toBe('/');
  expect(sanitizeLoginReturnPath('/\\evil.test')).toBe('/');
  expect(sanitizeLoginReturnPath('/cafeteria/\nstall')).toBe('/');
  expect(sanitizeLoginReturnPath(`/${String.fromCharCode(127)}cafeteria`)).toBe('/');
  expect(sanitizeLoginReturnPath(null, '/cafeteria')).toBe('/cafeteria');
});
