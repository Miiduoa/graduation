import { expect, it } from 'vitest';
import { isPublicCampusPath, publicCampusServices } from './publicCampusServices';

it('keeps the career directory public without opening unlisted career routes', () => {
  expect(publicCampusServices.some((service) => service.href === '/career')).toBe(true);
  expect(isPublicCampusPath('/career')).toBe(true);
  expect(isPublicCampusPath('/career/private')).toBe(false);
  expect(isPublicCampusPath('/career-other')).toBe(false);
  expect(isPublicCampusPath('/career%2fprivate')).toBe(false);
});

it('registers campus events as a public browsing entry including detail paths', () => {
  expect(publicCampusServices.some((service) => service.href === '/events')).toBe(true);
  expect(isPublicCampusPath('/events')).toBe(true);
  expect(isPublicCampusPath('/events/talk-1')).toBe(true);
  expect(isPublicCampusPath('/events/talk-1/extra')).toBe(false);
  expect(isPublicCampusPath('/clubs')).toBe(false);
});

it('treats the public service directories as public without opening academic routes', () => {
  expect(isPublicCampusPath('/life')).toBe(true);
  expect(isPublicCampusPath('/connect')).toBe(true);
  expect(isPublicCampusPath('/search')).toBe(true);
  expect(isPublicCampusPath('/life/private')).toBe(false);
  expect(isPublicCampusPath('/connect/private')).toBe(false);
  expect(isPublicCampusPath('/connect-other')).toBe(false);
  expect(isPublicCampusPath('/search/private')).toBe(false);
  expect(isPublicCampusPath('/timetable')).toBe(false);
  expect(isPublicCampusPath('/grades')).toBe(false);
  expect(isPublicCampusPath('/course/cs101')).toBe(false);
});
