import { expect, it } from 'vitest';
import {
  buildCampusNavigationSearch,
  campusServiceHref,
  campusServiceMatches,
} from './campusNavigation';

it('retains legacy scoped links when no selection provider is available', () => {
  const search = new URLSearchParams(
    'school=PU&schoolId=pu&campus=pu&token=private&returnUrl=%2Fadmin',
  );
  expect(buildCampusNavigationSearch(search)).toBe('school=PU&schoolId=pu&campus=pu');
});

it('replaces stale campus parameters and does not carry credentials or old school codes', () => {
  const previous = new URLSearchParams('school=PU&schoolId=pu&campus=pu&token=private');
  const scoped = buildCampusNavigationSearch(previous, { id: 'nthu' }, true);
  const href = new URL(campusServiceHref('/library', scoped), 'https://campus.example');
  expect(href.pathname).toBe('/library');
  expect(href.searchParams.get('schoolId')).toBe('nthu');
  expect(href.searchParams.get('campus')).toBe('nthu');
  expect(href.searchParams.get('school')).toBe('NTHU');
  expect(href.searchParams.has('token')).toBe(false);
});

it('keeps an existing tab query when attaching campus context', () => {
  const href = new URL(
    campusServiceHref('/grades?tab=feedback', 'schoolId=nthu&campus=nthu'),
    'https://campus.example',
  );
  expect(href.pathname).toBe('/grades');
  expect(href.searchParams.get('tab')).toBe('feedback');
  expect(href.searchParams.get('schoolId')).toBe('nthu');
  expect(href.searchParams.get('campus')).toBe('nthu');
});

it('keeps the exact anchor after existing filters and appended campus context', () => {
  const href = campusServiceHref('/grades?tab=feedback#assignment-week%203', '?campus=nthu');
  const destination = new URL(href, 'https://campus.example');
  expect(destination.pathname).toBe('/grades');
  expect(destination.searchParams.get('tab')).toBe('feedback');
  expect(destination.searchParams.get('campus')).toBe('nthu');
  expect(destination.hash).toBe('#assignment-week%203');
  expect(campusServiceHref('/timetable#week', 'campus=all')).toBe('/timetable?campus=all#week');
});

it('keeps an explicitly scoped destination and encodes values without moving them into a hash', () => {
  const destination = new URL(
    campusServiceHref('/map?campus=nthu&q=北門#detail', 'campus=pu&school=PU+Main'),
    'https://campus.example',
  );
  expect(destination.searchParams.get('campus')).toBe('nthu');
  expect(destination.searchParams.get('q')).toBe('北門');
  expect(destination.searchParams.get('school')).toBe('PU Main');
  expect(destination.hash).toBe('#detail');
});

it('matches the feedback service only on its selected tab and respects route boundaries', () => {
  expect(
    campusServiceMatches('/grades?tab=feedback', '/grades', new URLSearchParams('tab=feedback')),
  ).toBe(true);
  expect(campusServiceMatches('/grades?tab=feedback', '/grades', new URLSearchParams())).toBe(
    false,
  );
  expect(campusServiceMatches('/cafeteria', '/cafeteria/restaurant-1', null)).toBe(true);
  expect(campusServiceMatches('/cafeteria', '/cafeteria-old', null)).toBe(false);
});

it('does not turn the all-campuses selection into the previous campus', () => {
  const previous = new URLSearchParams('school=PU&schoolId=pu');
  expect(buildCampusNavigationSearch(previous, null, true)).toBe('campus=all');
  const dynamic = new URLSearchParams(
    buildCampusNavigationSearch(previous, { id: 'new-school' }, true),
  );
  expect(dynamic.get('school')).toBeNull();
  expect(dynamic.get('schoolId')).toBe('new-school');
});
