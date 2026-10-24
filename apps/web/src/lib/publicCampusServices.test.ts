import { expect, it } from 'vitest';
import { isPublicCampusPath, publicCampusServices } from './publicCampusServices';

it('registers campus events as a public browsing entry including detail paths', () => {
  expect(publicCampusServices.some((service) => service.href === '/events')).toBe(true);
  expect(isPublicCampusPath('/events')).toBe(true);
  expect(isPublicCampusPath('/events/talk-1')).toBe(true);
  expect(isPublicCampusPath('/events/talk-1/extra')).toBe(false);
  expect(isPublicCampusPath('/clubs')).toBe(false);
});
