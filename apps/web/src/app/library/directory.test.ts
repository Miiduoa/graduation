import { expect, it } from 'vitest';
import {
  SCHOOL_LIBRARIES,
  getSchoolLibrary,
  librarySearchUrl,
} from '@campus/shared/src/libraryDirectory';

it('maps verified institutions to separate official sites, never Providence by default', () => {
  expect(Object.keys(SCHOOL_LIBRARIES).length).toBeGreaterThanOrEqual(20);
  expect(getSchoolLibrary('nthu')?.homepage).toBe('https://www.lib.nthu.edu.tw/');
  expect(getSchoolLibrary('thu')?.catalog).toBe('https://webpac.lib.thu.edu.tw/');
  expect(getSchoolLibrary('tw-nchu')?.homepage).toBe('https://www.lib.nchu.edu.tw/');
  expect(getSchoolLibrary('pu')?.homepage).toBe('https://library.pu.edu.tw/');
  expect(getSchoolLibrary('not-onboarded')).toBeNull();
  expect(getSchoolLibrary('all')).toBeNull();
  expect(getSchoolLibrary('tw-demo-uni', '示範大學')).toBeNull();
});

it('matches an exact official institution name when a tenant uses a separate identifier', () => {
  expect(getSchoolLibrary('tenant-a', '國立成功大學')?.schoolId).toBe('ncku');
  expect(getSchoolLibrary('tenant-a', '台灣大學')).toBeNull();
  expect(getSchoolLibrary('tenant-a', '國立成功大學（示範）')).toBeNull();
  expect(getSchoolLibrary('tenant-a', '清華大學附設學校')).toBeNull();
});

it('only builds a direct search when the institution has a confirmed query contract', () => {
  const pu = getSchoolLibrary('pu')!;
  const thu = getSchoolLibrary('thu')!;
  const url = new URL(librarySearchUrl(pu, '資料庫 & SQL', 'Title')!);
  expect(url.origin).toBe('https://webpacx.lib.pu.edu.tw');
  expect(url.pathname).toBe('/search');
  expect(url.searchParams.get('searchInput')).toBe('資料庫 & SQL');
  expect(url.searchParams.get('searchField')).toBe('Title');
  expect(librarySearchUrl(thu, '資料庫 & SQL')).toBeNull();
  expect(librarySearchUrl(pu, '   ')).toBeNull();
});
