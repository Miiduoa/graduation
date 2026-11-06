import { expect, it } from 'vitest';
import { publicSchoolInfoDirectory } from '@campus/shared/src/publicSchoolInfo';
import { getSchoolLearningEntry } from '@campus/shared/src/schoolLearningPlatforms';

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
  expect([...withPlatform].sort()).toEqual(['fju', 'nchu', 'ncku', 'ncu', 'nkust', 'nthu', 'ntu', 'nycu', 'pu', 'thu']);
});

it('only accepts known campus identities and the confirmed public-contact alias', () => {
  expect(getSchoolLearningEntry('tw-pu', '靜宜大學')).toEqual(getSchoolLearningEntry('pu', '靜宜大學'));
  expect(getSchoolLearningEntry('tw-nchu', '國立中興大學')).toEqual(getSchoolLearningEntry('nchu', '國立中興大學'));
  expect(getSchoolLearningEntry('ntu', '靜宜大學')).toBeNull();
  for (const id of [null, undefined, 'all', 'unknown', 'constructor', '__proto__']) {
    expect(getSchoolLearningEntry(id)).toBeNull();
  }
});
