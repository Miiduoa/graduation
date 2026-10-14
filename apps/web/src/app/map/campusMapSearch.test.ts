import { expect, it } from 'vitest';
import { buildCampusMapSearchUrl } from '@campus/shared/src/campusMapLookup';

it('encodes a university name as a search query without treating it as coordinates', () => {
  const url = new URL(buildCampusMapSearchUrl(' 國立清華大學 & 陽明交通 ')!);
  expect(url.origin).toBe('https://www.google.com');
  expect(url.pathname).toBe('/maps/search/');
  expect(url.searchParams.get('api')).toBe('1');
  expect(url.searchParams.get('query')).toBe('國立清華大學 & 陽明交通 校園');
  expect(url.searchParams.has('destination')).toBe(false);
});

it('never searches generic or absent campus identities', () => {
  for (const name of [undefined, '', '  ', '請先選擇校園', '所選校園尚未接入', '所選校園（campus-b）', '學校\n名稱']) {
    expect(buildCampusMapSearchUrl(name)).toBeNull();
  }
});
