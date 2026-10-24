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

it('finds school info through contact keywords', () => {
  const services = searchCampusServices('總機');
  expect(services.some((service) => service.href === '/school-info')).toBe(true);
});

it('does not rewrite non-food services when ordering is off', () => {
  expect(presentCampusService({ href: '/bus', text: '查詢路線與站牌' }).text).toBe('查詢路線與站牌');
  expect(presentCampusService({ href: '/food', text: '選餐點、查訂單、出示取餐憑證' }).text).toBe(
    ONLINE_ORDERING_OFF_TEXT,
  );
});
