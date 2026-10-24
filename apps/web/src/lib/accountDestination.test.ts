import { expect, it } from 'vitest';
import { platformDestination } from './accountDestination';

it.each([
  '/profile',
  '/settings',
  '/merchant',
  '/merchant/apply',
  '/merchant/workspace',
  '/social?campus=tw-pu',
  '/map?school=pu&focus=library#route',
  '/bus?schoolId=tw-pu',
  '/announcements?school=pu',
  '/announcements/news-123?schoolId=tw-pu',
  '/cafeteria',
  '/cafeteria/stall?schoolId=pu',
  '/lost-found',
  '/lost-found/item-1?schoolId=pu',
  '/lost-found/post',
  '/library',
  '/school-info',
  '/classroom/course/cw_11111111-1111-4111-8111-111111111111#assignment-cwa_22222222-2222-4222-8222-222222222222',
])('returns to platform task %s', (path) => {
  expect(platformDestination(path)).toBe(path);
});
it.each([
  '//attacker.example',
  '/\\attacker.example',
  'https://attacker.example',
  '/login',
  '/classroom/login',
  '/auth/platform/start',
  '/timetable',
  '/course/cs101#assignment-hw-1',
  '/grades',
  '/map/../grades',
  '/announcements/../../grades',
  '/api/nuni/logout',
  '/social/../login',
  '/profile?' + 'a'.repeat(1300),
])('rejects a foreign destination or wrong account flow: %s', (path) => {
  expect(platformDestination(path)).toBe('/classroom');
});
