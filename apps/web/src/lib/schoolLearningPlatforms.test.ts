import { expect, it } from 'vitest';
import { publicSchoolInfoDirectory } from '@campus/shared/src/publicSchoolInfo';
import { getSchoolLearningEntry, getSchoolTronClassEntry } from '@campus/shared/src/schoolLearningPlatforms';

it('offers every named MOE campus its own LMS or its exact listed school website', () => {
  const withPlatform = new Set<string>();
  for (const school of Object.values(publicSchoolInfoDirectory)) {
    const entry = getSchoolLearningEntry(school.id, school.name);
    expect(entry?.schoolName).toBe(school.name);
    if (entry?.kind === 'platform') {
      withPlatform.add(school.id);
      for (const link of entry.links) {
        const url = new URL(link.url);
        expect(url.protocol).toBe('https:');
        expect(url.hostname.endsWith('.' + school.id + '.edu.tw')).toBe(true);
      }
    } else {
      expect(entry?.links).toEqual([{ label: school.name + '官網', url: school.websiteUrl }]);
    }
  }
  expect([...withPlatform].sort()).toEqual(['fju', 'nchu', 'ncku', 'ncnu', 'ncu', 'ncue', 'nkust', 'nthu', 'ntu', 'nycu', 'pu', 'stu', 'thu']);
});

it.each([
  ['pu', '靜宜大學', 'https://tronclass.pu.edu.tw/'],
  ['tw-pu', '靜宜大學', 'https://tronclass.pu.edu.tw/'],
  ['ncue', '國立彰化師範大學', 'https://tronclass.ncue.edu.tw/'],
  ['stu', '樹德科技大學', 'https://tc.stu.edu.tw/'],
  ['fju', '輔仁大學', 'https://elearn2.fju.edu.tw/'],
  ['thu', '東海大學', 'https://ilearn.thu.edu.tw/'],
])('resolves the official TronClass destination for %s', (id, name, url) => {
  const entry = getSchoolTronClassEntry(id, name);
  expect(entry?.url).toBe(url);
  expect(getSchoolLearningEntry(id, name)?.links).toContainEqual(entry);
});

it('returns no TronClass destination for other platforms, unknown identities or mismatched names', () => {
  expect(getSchoolTronClassEntry('ncku', '國立成功大學')).toBeNull();
  expect(getSchoolTronClassEntry('tw-nchu', '國立中興大學')).toBeNull();
  expect(getSchoolTronClassEntry('tw-pu', '輔仁大學')).toBeNull();
  expect(getSchoolTronClassEntry(null, '靜宜大學')).toBeNull();
  for (const id of [null, undefined, '', 'all', 'unknown', 'tw-ncue', '__proto__', 'https://tronclass.pu.edu.tw/']) {
    expect(getSchoolTronClassEntry(id)).toBeNull();
  }
});

it('only accepts known campus identities and the confirmed public-contact alias', () => {
  expect(getSchoolLearningEntry('tw-pu', '靜宜大學')).toEqual(getSchoolLearningEntry('pu', '靜宜大學'));
  expect(getSchoolLearningEntry('tw-nchu', '國立中興大學')).toEqual(getSchoolLearningEntry('nchu', '國立中興大學'));
  expect(getSchoolLearningEntry('ntu', '靜宜大學')).toBeNull();
  for (const id of [null, undefined, 'all', 'unknown', 'constructor', '__proto__']) {
    expect(getSchoolLearningEntry(id)).toBeNull();
  }
});
