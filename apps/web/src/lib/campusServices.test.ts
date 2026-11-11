import { expect, it } from 'vitest';
import { ACADEMIC_LMS_SECTIONS, ACADEMIC_SECTIONS } from './academicSections';
import { ONLINE_ORDERING_OFF_TEXT } from './onlineOrdering';
import {
  CAMPUS_SERVICES,
  directoryCampusServices,
  flattenCampusServices,
  presentCampusService,
  readCampusServiceFilters,
  searchCampusServices,
  serviceAccessLabel,
  visibleCampusServices,
  writeCampusServiceFilters,
} from './campusServices';

it('keeps announcements and bus, and shows ordering-off copy for /food as a note', () => {
  const services = searchCampusServices('');
  expect(services.some((service) => service.href === '/bus' && service.name === '公車')).toBe(true);
  expect(services.some((service) => service.href === '/announcements' && service.name === '公告')).toBe(true);
  expect(
    services.some((service) => service.href === '/school-info' && service.name === '學校資訊'),
  ).toBe(true);
  const food = services.find((service) => service.href === '/food');
  expect(food?.name).toBe('點餐與取餐');
  expect(food?.text).toBe(ONLINE_ORDERING_OFF_TEXT);
  expect(food?.note).toBe(ONLINE_ORDERING_OFF_TEXT);
  expect(food?.text).not.toContain('選餐點');
});

it('lists lost-found as a Google platform service', () => {
  const lostFound = CAMPUS_SERVICES.find((service) => service.href === '/lost-found');
  expect(lostFound?.access).toBe('platform');
  expect(lostFound?.text).toContain('Google');
});

it.each(['Google', '公開 貼文', '跨校'])(
  'finds public exchange through %s without requiring school sign-in availability',
  (query) => {
    const service = searchCampusServices(query, 'connect').find((entry) => entry.href === '/social');
    expect(service?.access).toBe('platform');
    expect(serviceAccessLabel(service!.access, { loading: false, studentId: false })).toBe('Google 帳號');
    expect(directoryCampusServices().some((entry) => entry.href === '/social')).toBe(true);
    expect(CAMPUS_SERVICES.find((entry) => entry.href === '/community')?.access).toBe('school');
  },
);

it.each(['WOW Class', 'TronClass', 'LMS', '玩課雲'])(
  'finds the school course secondary through %s under 課程與作業',
  (query) => {
    const courseService = searchCampusServices(query).find((service) => service.href === '/school-courses');
    expect(courseService?.name).toBe(ACADEMIC_LMS_SECTIONS[0].label);
    expect(courseService?.access).toBe('public');
    expect(courseService?.category).toBe('study');
  },
);

it('lists the read-only homework surface as a searchable secondary', () => {
  const service = searchCampusServices('玩課雲作業', 'all', true).find((item) => item.href === '/school-lms');
  expect(service?.name).toBe(ACADEMIC_LMS_SECTIONS[1].label);
  expect(service?.access).toBe('public');
});

it.each(['總機', '職涯', '實習'])('finds school info through %s without a retired career entry', (query) => {
  const services = searchCampusServices(query);
  expect(services.some((service) => service.href === '/school-info')).toBe(true);
  expect(services.some((service) => service.href.includes('career'))).toBe(false);
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
  expect(presentCampusService({ href: '/food', text: '選餐點、查訂單、出示取餐憑證' })).toEqual({
    href: '/food',
    text: ONLINE_ORDERING_OFF_TEXT,
    note: ONLINE_ORDERING_OFF_TEXT,
  });
});

it('lists the local dormitory workspace without implying an official application', () => {
  const dorm = CAMPUS_SERVICES.find((service) => service.href === '/dormitory');
  expect(dorm?.access).toBe('device');
  expect(dorm?.text).toContain('宿舍備忘');
  expect(dorm?.text).not.toMatch(/單號|已送出給學校|查詢進度/);
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

it('routes semester-grade search to school records and feedback to the secondary grade entry', () => {
  expect(searchCampusServices('學期成績').some((service) => service.href === '/grades?tab=semester')).toBe(true);
  expect(
    searchCampusServices('成績回饋').some((service) => service.href === '/grades?tab=feedback'),
  ).toBe(true);
  expect(CAMPUS_SERVICES.some((service) => service.href === '/grades?tab=feedback')).toBe(true);
});

it('hides readonly homework from service searches by default', () => {
  expect(flattenCampusServices().some((item) => item.href === '/school-lms')).toBe(false);
  expect(searchCampusServices('玩課雲作業')).toEqual([]);
  expect(searchCampusServices('玩課雲作業', 'all', true).some((item) => item.href === '/school-lms')).toBe(
    true,
  );
});

it('merges course-work aliases under one directory primary with shared academic labels', () => {
  const directory = directoryCampusServices();
  const courseWork = directory.find((service) => service.href === '/classroom');
  expect(courseWork?.name).toBe(ACADEMIC_SECTIONS[1].label);
  expect(directory.some((service) => service.href === '/school-courses')).toBe(false);
  expect(directory.some((service) => service.href === '/groups')).toBe(false);
  expect(searchCampusServices('').some((service) => service.href === '/classroom')).toBe(true);
  expect(searchCampusServices('').some((service) => service.href === '/groups')).toBe(false);
  expect(searchCampusServices('課程與群組').some((service) => service.href === '/groups')).toBe(true);
  expect(
    CAMPUS_SERVICES.filter((service) => 'parentHref' in service && service.parentHref === '/classroom').map(
      (service) => service.href,
    ),
  ).toEqual(['/classroom/material-bookmarks', '/school-courses', '/school-lms', '/groups']);
});

it('merges cafeteria under the food primary while keeping both reachable', () => {
  expect(searchCampusServices('').some((service) => service.href === '/cafeteria')).toBe(false);
  expect(searchCampusServices('餐廳').some((service) => service.href === '/cafeteria')).toBe(true);
  expect(visibleCampusServices().some((service) => service.href === '/cafeteria')).toBe(true);
  expect(visibleCampusServices().some((service) => service.href === '/food')).toBe(true);
});

it('keeps academic vocabulary aligned across directory primaries', () => {
  const byHref = new Map(flattenCampusServices(true).map((service) => [service.href, service.name]));
  expect(byHref.get('/timetable')).toBe(ACADEMIC_SECTIONS[0].label);
  expect(byHref.get('/classroom')).toBe(ACADEMIC_SECTIONS[1].label);
  expect(byHref.get('/grades?tab=semester')).toBe(ACADEMIC_SECTIONS[2].label);
  expect(byHref.get('/credit-planner')).toBe(ACADEMIC_SECTIONS[3].label);
  expect(byHref.get('/calendar')).toBe(ACADEMIC_SECTIONS[4].label);
  expect(byHref.get('/school-courses')).toBe('校方課程');
  expect(byHref.get('/school-lms')).toBe('校方作業與教材');
  expect(byHref.get('/grades?tab=feedback')).toBe('成績回饋');
});

it('reads and writes directory query filters without keeping an unknown category', () => {
  const params = new URLSearchParams('q=借書&category=missing&session=old');
  expect(readCampusServiceFilters(params)).toEqual({ query: '借書', category: 'all' });
  writeCampusServiceFilters(params, '借書', 'campus');
  expect(params.get('q')).toBe('借書');
  expect(params.get('category')).toBe('campus');
  expect(params.get('session')).toBe('old');
});

it('exposes merchant and leave entries in the flattened catalog for intent lookup', () => {
  const hrefs = visibleCampusServices().map((service) => service.href);
  expect(hrefs).toContain('/merchant');
  expect(hrefs).toContain('/leave');
  expect(hrefs).toContain('/classroom');
  expect(CAMPUS_SERVICES.some((service) => service.href === '/classroom')).toBe(true);
});

it('finds the student card by its everyday names', () => {
  for (const term of ['學生證', '數位證件', 'student id']) {
    expect(searchCampusServices(term).some((service) => service.href === '/student-card')).toBe(true);
  }
  expect(directoryCampusServices().some((service) => service.href === '/student-card')).toBe(true);
});
