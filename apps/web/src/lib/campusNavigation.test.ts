import { expect, it } from 'vitest';
import { buildCampusNavigationSearch, campusServiceHref } from './campusNavigation';

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

it('does not turn the all-campuses selection into the previous campus', () => {
  const previous = new URLSearchParams('school=PU&schoolId=pu');
  expect(buildCampusNavigationSearch(previous, null, true)).toBe('campus=all');
  const dynamic = new URLSearchParams(buildCampusNavigationSearch(previous, { id: 'new-school' }, true));
  expect(dynamic.get('school')).toBeNull();
  expect(dynamic.get('schoolId')).toBe('new-school');
});
