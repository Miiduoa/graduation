// @vitest-environment node
import { expect, test } from 'vitest';
import { clubPortalRateLimit } from './clubPortalRateLimit';
test('三十人連續簽到加重讀不受共用每分鐘十次預算阻斷，仍有上限', () => {
  clubPortalRateLimit.reset();
  for (let i = 0; i < 90; i++) expect(() => clubPortalRateLimit.check('officer')).not.toThrow();
  for (let i = 90; i < 240; i++) clubPortalRateLimit.check('officer');
  expect(() => clubPortalRateLimit.check('officer')).toThrow();
  expect(() => clubPortalRateLimit.check('another')).not.toThrow();
  clubPortalRateLimit.reset();
});
