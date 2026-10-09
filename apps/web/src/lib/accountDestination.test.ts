import { expect, it } from 'vitest';
import { platformDestination } from './accountDestination';

it.each([
  '/profile',
  '/settings',
  '/merchant',
  '/merchant/apply',
  '/merchant/workspace',
  '/social?campus=tw-pu',
  '/classroom/course/cw_11111111-1111-4111-8111-111111111111#assignments',
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
  '/grades',
  '/api/nuni/logout',
  '/social/../login',
  '/profile?' + 'a'.repeat(1300),
])('rejects a foreign destination or wrong account flow: %s', (path) => {
  expect(platformDestination(path)).toBe('/classroom');
});
