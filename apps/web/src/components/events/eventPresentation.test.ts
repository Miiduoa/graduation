import { expect, it } from 'vitest';
import {
  buildCampusEventDetailHref,
  buildCampusEventListHref,
  buildCampusEventLoginHref,
  campusEventKey,
  campusEventMatchesSearch,
  campusEventRegistrationCountLabel,
  campusEventSourceLabel,
  formatCampusEventDateTime,
  isCampusEventSource,
  readCampusEventFilters,
  campusEventMatchesView,
  userFacingCampusEventError,
} from './eventPresentation';
import type { EventRegistrationState } from '@/lib/campusEventRegistration';

it('keeps source labels informational without claiming official status', () => {
  expect(campusEventSourceLabel('school-club-events')).toBe('社團活動資料');
  expect(campusEventSourceLabel('school-events')).toBe('校園活動資料');
  expect(campusEventSourceLabel('legacy-events')).toBe('其他活動資料');
  expect(campusEventSourceLabel('school-events')).not.toMatch(/官方/);
});

it('bounds list filters and carries only known navigation data into detail and back links', () => {
  const filters = readCampusEventFilters(new URLSearchParams('q=%00講座&view=ongoing&returnUrl=https://outside.example'));
  expect(filters).toEqual({ q: '講座', view: 'ongoing' });
  expect(readCampusEventFilters({ q: ['a', 'b'], view: 'unsupported' })).toEqual({ q: '', view: 'all' });
  expect(readCampusEventFilters({ q: '字'.repeat(300) }).q).toHaveLength(200);
  expect(readCampusEventFilters({ page: '999' })).toMatchObject({ page: 100 });
  const href = buildCampusEventDetailHref('talk', 'school-events', '?schoolId=nthu&campus=nthu&token=secret&returnUrl=//outside.example', filters);
  expect(href).toBe('/events/talk?schoolId=nthu&campus=nthu&q=%E8%AC%9B%E5%BA%A7&view=ongoing&source=school-events');
  expect(buildCampusEventListHref('?schoolId=nthu&source=school-events', filters)).toBe('/events?schoolId=nthu&q=%E8%AC%9B%E5%BA%A7&view=ongoing');
});

it('does not classify an active multi-day event as past', () => {
  const event = { startsAt: '2026-10-24T08:00:00Z', endsAt: '2026-10-26T08:00:00Z' };
  const now = Date.parse('2026-10-25T08:00:00Z');
  expect(campusEventMatchesView(event, 'ongoing', now)).toBe(true);
  expect(campusEventMatchesView(event, 'past', now)).toBe(false);
  expect(campusEventMatchesView({ ...event, endsAt: undefined }, 'past', now)).toBe(true);
});

it('preserves school context and source on detail and login URLs', () => {
  expect(buildCampusEventListHref('?schoolId=nthu&campus=nthu')).toBe(
    '/events?schoolId=nthu&campus=nthu',
  );
  expect(
    buildCampusEventDetailHref('evt-1', 'school-club-events', '?schoolId=nthu&campus=nthu'),
  ).toBe('/events/evt-1?schoolId=nthu&campus=nthu&source=school-club-events');
  expect(
    buildCampusEventLoginHref('/events/evt-1?schoolId=nthu&source=school-club-events'),
  ).toContain('reconnect=school');
  expect(
    decodeURIComponent(
      buildCampusEventLoginHref('/events/evt-1?schoolId=nthu&source=school-club-events').split(
        'returnUrl=',
      )[1]!,
    ),
  ).toBe('/events/evt-1?schoolId=nthu&source=school-club-events');
});

it('rejects invalid sources and treats missing dates as unknown', () => {
  expect(isCampusEventSource('school-club-events')).toBe(true);
  expect(isCampusEventSource('made-up')).toBe(false);
  expect(formatCampusEventDateTime('')).toBe('時間未提供');
  expect(formatCampusEventDateTime(undefined)).toBe('時間未提供');
});

it('keeps the activity fragment through school login without stacking document hashes', () => {
  const href = buildCampusEventLoginHref('/events/evt-1?schoolId=nthu#registration#leftover');
  const url = new URL(href, 'https://campus.example');
  expect(url.searchParams.get('reconnect')).toBe('school');
  expect(url.searchParams.get('returnUrl')).toBe('/events/evt-1?schoolId=nthu#registration');
  expect(href.endsWith('#')).toBe(true);
});

it('rejects an external login return destination', () => {
  const href = buildCampusEventLoginHref('https://outside.example/events');
  const url = new URL(href, 'https://campus.example');
  expect(url.pathname).toBe('/login');
  expect(url.searchParams.get('reconnect')).toBe('school');
  expect(url.searchParams.get('returnUrl')).toBe('/');
});

it('dedupe keys distinguish identical ids across sources', () => {
  expect(campusEventKey({ id: 'same', source: 'school-club-events' })).toBe(
    'school-club-events:same',
  );
  expect(campusEventKey({ id: 'same', source: 'legacy-events' })).toBe('legacy-events:same');
});

it('counts only this system registration totals', () => {
  const state = {
    count: 3,
    capacity: 10,
  } as EventRegistrationState;
  expect(campusEventRegistrationCountLabel(state)).toBe('本系統報名 3 / 10 人');
  expect(campusEventRegistrationCountLabel({ ...state, capacity: null })).toBe('本系統報名 3 人');
});

it('filters loaded items locally and hides raw English internals', () => {
  const event = {
    id: 'a',
    schoolId: 'nthu',
    title: 'AI 講座',
    description: '歡迎參加',
    startsAt: '2026-05-01T02:00:00.000Z',
    appRegistrationConfigured: false,
    source: 'school-events' as const,
  };
  expect(campusEventMatchesSearch(event, '講座')).toBe(true);
  expect(campusEventMatchesSearch(event, '無關字')).toBe(false);
  expect(userFacingCampusEventError(new Error('Event registration status not confirmed'), '後備')).toBe(
    '後備',
  );
  expect(userFacingCampusEventError(new Error('這次沒有存成報名紀錄'), '後備')).toBe(
    '這次沒有存成報名紀錄',
  );
});
