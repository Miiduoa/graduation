import { afterEach, expect, it, vi } from 'vitest';
import {
  DIRECTORY_SEARCH_STORAGE_KEY,
  forgetDirectorySearch,
  internalSitePath,
  rememberDirectorySearch,
  restoreDirectorySearch,
} from './campusDirectorySearch';

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

it('keeps only in-site paths', () => {
  expect(internalSitePath('/library?schoolId=nthu')).toBe('/library?schoolId=nthu');
  expect(internalSitePath('/search?q=借書#results')).toBe('/search?q=借書#results');
  expect(internalSitePath('https://evil.test/library')).toBe('');
  expect(internalSitePath('//evil.test/library')).toBe('');
  expect(internalSitePath('/\\evil.test')).toBe('');
  expect(internalSitePath('javascript:alert(1)')).toBe('');
});

it('remembers a directory search and restores it only on the original in-site path', () => {
  rememberDirectorySearch('menu', {
    path: '/map?schoolId=nthu',
    destination: '/library?schoolId=nthu',
    query: '借書',
    category: 'campus',
    open: true,
  });
  expect(restoreDirectorySearch('menu', '/library')).toBeNull();
  expect(restoreDirectorySearch('menu', 'https://evil.test')).toBeNull();
  expect(restoreDirectorySearch('menu', '/map')).toEqual({
    path: '/map',
    destination: '/library?schoolId=nthu',
    query: '借書',
    category: 'campus',
    open: true,
  });
});

it('rejects a stored off-site destination and does not restore the query', () => {
  sessionStorage.setItem(
    DIRECTORY_SEARCH_STORAGE_KEY,
    JSON.stringify({
      menu: {
        path: '/map',
        destination: 'https://evil.test/library',
        query: '借書',
        category: 'campus',
        open: true,
      },
    }),
  );
  expect(restoreDirectorySearch('menu', '/map')).toBeNull();
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toBeNull();
});

it('does not store an off-site destination and forgets a source independently', () => {
  rememberDirectorySearch('quick', {
    path: '/',
    destination: 'javascript:alert(1)',
    query: '借書',
  });
  rememberDirectorySearch('search', {
    path: '/search',
    destination: '/library',
    query: '借書',
    category: 'campus',
  });
  expect(restoreDirectorySearch('quick', '/')).toBeNull();
  expect(restoreDirectorySearch('search', '/search')?.query).toBe('借書');
  forgetDirectorySearch('search');
  expect(restoreDirectorySearch('search', '/search')).toBeNull();
});

it('does not throw when sessionStorage rejects reads and writes', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(() =>
    rememberDirectorySearch('menu', {
      path: '/map',
      destination: '/library',
      query: '借書',
      category: 'campus',
      open: true,
    }),
  ).not.toThrow();
  expect(() => restoreDirectorySearch('menu', '/map')).not.toThrow();
  expect(restoreDirectorySearch('menu', '/map')).toBeNull();
  expect(() => forgetDirectorySearch('menu')).not.toThrow();
});

it('restores scoped searches only for the same account session and campus', () => {
  rememberDirectorySearch('quick', {
    path: '/',
    destination: '/library?schoolId=pu',
    query: '查我的借閱',
    scope: 'account-a:session-one:pu',
  });
  expect(restoreDirectorySearch('quick', '/', 'account-a:session-one:pu')?.query).toBe(
    '查我的借閱',
  );
  expect(restoreDirectorySearch('quick', '/', 'account-b:session-two:pu')).toBeNull();
  expect(restoreDirectorySearch('quick', '/', 'account-a:session-one:pu')).toBeNull();
});

it('does not treat legacy unscoped snapshots as belonging to a signed-in finder', () => {
  rememberDirectorySearch('search', {
    path: '/search',
    destination: '/library',
    query: '上一個使用者的需求',
  });
  expect(restoreDirectorySearch('search', '/search', 'account-a:pu')).toBeNull();
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toBeNull();
});

it('restores only known directory expansions and supports older snapshots', () => {
  rememberDirectorySearch('search', {
    path: '/search', destination: '/grades?tab=feedback', query: '', open: false,
    expanded: ['group:study', 'service:/grades?tab=semester', 'group:study', 'service:https://outside.test', 'arbitrary'],
  });
  expect(restoreDirectorySearch('search', '/search')?.expanded).toEqual([
    'group:study', 'service:/grades?tab=semester',
  ]);
  rememberDirectorySearch('search', { path: '/search', destination: '/map', query: '教室' });
  expect(restoreDirectorySearch('search', '/search')?.expanded).toBeUndefined();
});

it('restores expanded groups with the same session and clears them after an account switch', () => {
  rememberDirectorySearch('search', {
    path: '/search', destination: '/grades?tab=feedback', query: '回饋', category: 'study',
    scope: 'account-a:session-one:pu',
    expanded: ['group:study', 'service:/grades?tab=semester'],
  });
  expect(restoreDirectorySearch('search', '/search', 'account-a:session-one:pu')).toMatchObject({
    query: '回饋',
    scope: 'account-a:session-one:pu',
    expanded: ['group:study', 'service:/grades?tab=semester'],
  });
  expect(restoreDirectorySearch('search', '/search', 'account-b:session-two:pu')).toBeNull();
  expect(restoreDirectorySearch('search', '/search', 'account-a:session-one:pu')).toBeNull();
});

it.each(['quick', 'menu', 'search'] as const)('replaces the shared %s slot at every scope change', (source) => {
  const scopes = ['account-a:pu', 'account-a:nthu', 'guest:nthu', 'guest:pu', 'account-b:pu'];
  const draft = { path: '/map', destination: '/library', query: '借書' };
  for (const [index, scope] of scopes.entries()) {
    const query = `借書 ${index}`;
    rememberDirectorySearch(source, { ...draft, query, scope });
    expect(restoreDirectorySearch(source, draft.path, scope)).toMatchObject({ query, scope });
  }
  expect(restoreDirectorySearch(source, draft.path, scopes[0])).toBeNull();
  expect(restoreDirectorySearch(source, draft.path, scopes.at(-1))).toBeNull();
});

it('skips a draft write when the existing shared slots cannot be read', () => {
  const draft = { path: '/map', destination: '/library', query: '借書' };
  rememberDirectorySearch('search', draft);
  const stored = sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY);
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  try {
    rememberDirectorySearch('quick', draft);
  } finally {
    read.mockRestore();
  }
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toBe(stored);
});

it.each(['quick', 'search', 'menu'] as const)('binds a provisional %s draft on its first confirmed account', (source) => {
  const snapshot = { path: '/', destination: '/library', query: '借書' };
  rememberDirectorySearch(source, { ...snapshot, binding: { campus: 'pu' } });
  expect(restoreDirectorySearch(source, '/', 'first', { campus: 'pu', schoolOwner: 'a' }, false)?.query)
    .toBe(snapshot.query);

  const stored = sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY);
  expect(restoreDirectorySearch(source, '/', 'unknown', { campus: 'pu' }, false)).toBeNull();
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toBe(stored);
  expect(restoreDirectorySearch(source, '/', 'second', { campus: 'pu', schoolOwner: 'b' }, false)).toBeNull();
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toBeNull();
});

it('allows a confirmed source to save a new draft when the old draft has no matching source', () => {
  const snapshot = { path: '/', destination: '/library', query: '借書' };
  rememberDirectorySearch('quick', { ...snapshot, binding: { campus: 'pu', schoolOwner: 'a' } });
  const platform = { campus: 'pu', platformOwner: 'b' };
  expect(restoreDirectorySearch('quick', '/', 'platform', platform, false)).toBeNull();
  rememberDirectorySearch('quick', { ...snapshot, binding: platform, query: '公車' });
  expect(restoreDirectorySearch('quick', '/', 'platform', platform, false)?.query).toBe('公車');
});
