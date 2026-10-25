import { beforeEach, expect, it, vi } from 'vitest';
import {
  announcementListHref,
  readAnnouncementListState,
} from '@/app/announcements/announcementListState';
import { lostFoundListHref, readLostFoundListState } from './lostFoundListNavigation';
import { replaceServiceListQuery, serviceListSchoolQuery } from './serviceListNavigation';

beforeEach(() => {
  window.history.replaceState({}, '', '/announcements?schoolId=pu');
});

it('keeps Unicode search text encoded without accepting unknown filters or redirect parameters', () => {
  const input = {
    q: '選課\u0000 & 雨傘',
    category: 'admin',
    view: 'private',
    pinned: 'yes',
    page: '-9',
    returnUrl: '//other.example',
    token: 'private',
  };
  const href = announcementListHref('pu', readAnnouncementListState(input), input);
  expect(new URL(href, window.location.origin).searchParams.get('q')).toBe('選課 & 雨傘');
  expect(href).not.toMatch(/returnUrl|token|category|view|pinned|page/);
  expect(readAnnouncementListState({ q: ['first', 'second'], page: '999' })).toMatchObject({
    search: '',
    page: 100,
  });
  expect(
    readLostFoundListState({ type: 'admin', status: 'private', mine: 'true', page: '2.5' }),
  ).toMatchObject({ type: 'all', status: 'all', mine: false, page: 1 });
});

it('does not put a stale campus or school code back into a service return link', () => {
  const query = serviceListSchoolQuery('nthu', { schoolId: 'pu', campus: 'pu', school: 'PU' });
  expect(query.toString()).toBe('schoolId=nthu');
  expect(
    lostFoundListHref('nthu', { schoolId: 'pu', campus: 'pu', type: 'found', q: '鑰匙' }),
  ).toBe('/lost-found?schoolId=nthu&q=%E9%91%B0%E5%8C%99&type=found');
});

it('does not overwrite another campus or route when a list action completes after navigation', () => {
  window.history.replaceState({}, '', '/announcements?campus=nthu&schoolId=pu&q=清華');
  replaceServiceListQuery('/announcements', 'pu', ['q'], new URLSearchParams({ q: '靜宜' }));
  expect(new URLSearchParams(window.location.search).get('q')).toBe('清華');
  window.history.replaceState({}, '', '/events?schoolId=pu&q=活動');
  replaceServiceListQuery('/announcements', 'pu', ['q'], new URLSearchParams({ q: '靜宜' }));
  expect(window.location.pathname).toBe('/events');
  expect(new URLSearchParams(window.location.search).get('q')).toBe('活動');
});

it('leaves the list usable when browser history writes are denied', () => {
  const history = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
    throw new DOMException('Denied', 'SecurityError');
  });
  expect(() =>
    replaceServiceListQuery('/announcements', 'pu', ['q'], new URLSearchParams({ q: '活動' })),
  ).not.toThrow();
  history.mockRestore();
});

it('respects legacy school-code navigation and trimmed campus precedence before a list write', () => {
  for (const school of ['NTHU', 'unknown-campus']) {
    window.history.replaceState({}, '', `/announcements?school=${school}&q=original`);
    replaceServiceListQuery(
      '/announcements',
      'pu',
      ['q'],
      new URLSearchParams({ q: 'wrong-school' }),
    );
    expect(new URLSearchParams(window.location.search).get('q')).toBe('original');
    expect(new URLSearchParams(window.location.search).get('schoolId')).toBeNull();
  }
  window.history.replaceState(
    {},
    '',
    '/announcements?school=PU&campus=%20nthu%20&schoolId=pu&q=original',
  );
  replaceServiceListQuery(
    '/announcements',
    'pu',
    ['q'],
    new URLSearchParams({ q: 'wrong-school' }),
  );
  expect(new URLSearchParams(window.location.search).get('q')).toBe('original');
  replaceServiceListQuery(
    '/announcements',
    'nthu',
    ['q'],
    new URLSearchParams({ q: 'current-school' }),
  );
  expect(new URLSearchParams(window.location.search).get('q')).toBe('current-school');
  expect(new URLSearchParams(window.location.search).get('schoolId')).toBe('nthu');
});
