import { expect, it } from 'vitest';
import { isPublicCampusPath, publicCampusServices } from './publicCampusServices';

it('registers campus events as a public browsing entry including detail paths', () => {
  expect(publicCampusServices.some((service) => service.href === '/events')).toBe(true);
  expect(isPublicCampusPath('/events')).toBe(true);
  expect(isPublicCampusPath('/events/talk-1')).toBe(true);
  expect(isPublicCampusPath('/events/talk-1/extra')).toBe(false);
  expect(isPublicCampusPath('/clubs')).toBe(false);
});

it('treats the public service directories as public without opening academic routes', () => {
  expect(isPublicCampusPath('/life')).toBe(true);
  expect(isPublicCampusPath('/search')).toBe(true);
  expect(isPublicCampusPath('/life/private')).toBe(false);
  expect(isPublicCampusPath('/search/private')).toBe(false);
  expect(isPublicCampusPath('/timetable')).toBe(false);
  expect(isPublicCampusPath('/grades')).toBe(false);
  expect(isPublicCampusPath('/course/cs101')).toBe(false);
});
