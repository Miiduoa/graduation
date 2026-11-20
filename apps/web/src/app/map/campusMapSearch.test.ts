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


it('limits the official library floor guide to the identified Providence library', async () => {
  const { hasOfficialProvidenceLibraryGuide, PROVIDENCE_LIBRARY_FLOOR_GUIDE_URL } =
    await import('@campus/shared/src/campusMapLookup');
  expect(hasOfficialProvidenceLibraryGuide('pu', { name: '蓋夏圖書館', category: '圖書館' })).toBe(true);
  expect(hasOfficialProvidenceLibraryGuide('nthu', { name: '蓋夏圖書館', category: '圖書館' })).toBe(false);
  expect(hasOfficialProvidenceLibraryGuide('pu', { name: '蓋夏咖啡', category: '餐飲' })).toBe(false);
  expect(PROVIDENCE_LIBRARY_FLOOR_GUIDE_URL).toMatch(/^https:\/\/b028\.pu\.edu\.tw\//);
});


it('returns only verified university-run maps for the selected school identity', async () => {
  const { getOfficialCampusMapUrl, PROVIDENCE_CAMPUS_MAP_URL } =
    await import('@campus/shared/src/campusMapLookup');
  expect(PROVIDENCE_CAMPUS_MAP_URL).toBe('https://gnl.pu.edu.tw/p/426-1007-8.php?Lang=zh-tw');
  expect(getOfficialCampusMapUrl('pu')).toBe(PROVIDENCE_CAMPUS_MAP_URL);
  expect(getOfficialCampusMapUrl('nthu')).toBe('https://www.nthu.edu.tw/campusmap');
  expect(getOfficialCampusMapUrl('ncu')).toBe('https://www.ncu.edu.tw/p/412-1000-105.php?Lang=zh-tw');
  expect(getOfficialCampusMapUrl('ntu')).toBe('https://www.ntu.edu.tw/about/map.html');
  expect(getOfficialCampusMapUrl('tw-nchu')).toBe('https://www.nchu.edu.tw/about/mid/869');
  expect(getOfficialCampusMapUrl('nchu')).toBe(getOfficialCampusMapUrl('tw-nchu'));
  expect(getOfficialCampusMapUrl('ncku')).toBe('https://web.ncku.edu.tw/p/412-1000-29366.php');
  expect(getOfficialCampusMapUrl('ntust')).toBe('https://www.ntust.edu.tw/p/412-1000-102.php?Lang=zh-tw');
  expect(getOfficialCampusMapUrl('nycu')).toContain('www.nycu.edu.tw/aa/ch/app/artwebsite/view');
  expect(getOfficialCampusMapUrl('tw-demo-uni')).toBeNull();
  expect(getOfficialCampusMapUrl('toString')).toBeNull();
  expect(getOfficialCampusMapUrl('__proto__')).toBeNull();
  expect(getOfficialCampusMapUrl()).toBeNull();
});
