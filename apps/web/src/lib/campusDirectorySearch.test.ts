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
