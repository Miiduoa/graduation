import { expect, it } from 'vitest';
import { ONLINE_ORDERING_OFF_TEXT } from './onlineOrdering';
import { CAMPUS_SERVICES, presentCampusService, searchCampusServices } from './campusServices';

it('keeps announcements and bus, and shows ordering-off copy for /food', () => {
  const services = searchCampusServices('');
  expect(services.some((service) => service.href === '/bus' && service.name === '公車')).toBe(true);
  expect(services.some((service) => service.href === '/announcements' && service.name === '公告')).toBe(true);
  expect(
    services.some((service) => service.href === '/school-info' && service.name === '學校資訊'),
  ).toBe(true);
  const food = services.find((service) => service.href === '/food');
  expect(food?.text).toBe(ONLINE_ORDERING_OFF_TEXT);
  expect(food?.text).not.toContain('選餐點');
});

it('lists lost-found as a school-account service, not a platform Google task', () => {
  const lostFound = CAMPUS_SERVICES.find((service) => service.href === '/lost-found');
  expect(lostFound?.access).toBe('school');
  expect(lostFound?.access).not.toBe('platform');
});

it.each(['WOW Class', 'TronClass', 'LMS'])('finds the school course service through %s', (query) => {
  const courseService = searchCampusServices(query).find((service) => service.href === '/school-courses');
  expect(courseService?.name).toBe('WOW Class 課程');
  expect(courseService?.access).toBe('school');
  expect(courseService?.category).toBe('study');
});

it('lists the read-only homework surface beside the course list', () => {
  const service = searchCampusServices('玩課雲作業', 'all', true).find((item) => item.href === '/school-lms');
  expect(service?.name).toBe('玩課雲作業與教材');
  expect(service?.access).toBe('school');
});

it.each(['總機', '職涯', '實習'])('finds school info through %s without a retired career entry', (query) => {
  const services = searchCampusServices(query);
  expect(services.some((service) => service.href === '/school-info')).toBe(true);
  expect(services.some((service) => service.href === '/career')).toBe(false);
});

it('exposes a separate public campus-events entry beside clubs', () => {
  const events = searchCampusServices('講座').find((service) => service.href === '/events');
  expect(events?.name).toBe('校園活動');
  expect(events?.access).toBe('public');
  expect(searchCampusServices('社團').some((service) => service.href === '/clubs')).toBe(true);
  expect(searchCampusServices('社團').some((service) => service.href === '/events')).toBe(false);
});

it('does not rewrite non-food services when ordering is off', () => {
  expect(presentCampusService({ href: '/bus', text: '查詢路線與站牌' }).text).toBe('查詢路線與站牌');
  expect(presentCampusService({ href: '/food', text: '選餐點、查訂單、出示取餐憑證' }).text).toBe(
    ONLINE_ORDERING_OFF_TEXT,
  );
});

it('lists the local dormitory workspace without implying an official application', () => {
  const dorm = CAMPUS_SERVICES.find((service) => service.href === '/dormitory');
  expect(dorm?.access).toBe('device');
  expect(searchCampusServices('報修').some((service) => service.href === '/dormitory')).toBe(true);
});


it('offers school-account leave workflows without presenting them as official leave submission', () => {
  const student = CAMPUS_SERVICES.find((service) => service.href === '/leave');
  const teacher = CAMPUS_SERVICES.find((service) => service.href === '/leave/review');
  expect(student?.access).toBe('school');
  expect(teacher?.access).toBe('school');
  expect(student?.text).toContain('站內核閱');
  expect(searchCampusServices('請假').map((service) => service.href)).toContain('/leave');
  expect(searchCampusServices('核閱').map((service) => service.href)).toContain('/leave/review');
  expect(student?.text).not.toContain('正式');
});

it('hides readonly homework from service searches by default', () => {
  expect(searchCampusServices('').some((item) => item.href === '/school-lms')).toBe(false);
  expect(searchCampusServices('玩課雲作業')).toEqual([]);
  expect(searchCampusServices('', 'all', true).some((item) => item.href === '/school-lms')).toBe(true);
});
