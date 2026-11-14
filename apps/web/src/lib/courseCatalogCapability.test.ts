import { expect, it } from 'vitest';
import {
  hasIntegratedCourseCatalog,
  resolveCourseCatalogCapability,
  resolveOfficialCourseQueryLink,
  unsupportedCourseCatalogMessage,
} from '@campus/shared/src/courseCatalogCapability';

it.each(['ncnu', 'nthu'])('registers the verified public catalog for %s independently', (schoolId) => {
  const capability = resolveCourseCatalogCapability(schoolId);
  expect(capability).toMatchObject({ providerId: `${schoolId}-public`, schoolId });
  expect(hasIntegratedCourseCatalog(schoolId)).toBe(true);
  expect(resolveOfficialCourseQueryLink(schoolId)?.url).toBe(capability?.officialQueryUrl);
  expect(new URL(capability!.officialQueryUrl).hostname.endsWith(`.${schoolId}.edu.tw`)).toBe(true);
  expect(unsupportedCourseCatalogMessage(schoolId)).toContain(schoolId === 'nthu' ? '清大開課查詢' : '暨大開課查詢');
});

it('links the NTHU course-search guide and retains the Providence provider', () => {
  expect(resolveOfficialCourseQueryLink('nthu')).toEqual({
    label: '清華大學課程查詢系統',
    url: 'https://curricul.site.nthu.edu.tw/p/406-1208-290365,r7880.php?Lang=zh-tw',
  });
  expect(resolveCourseCatalogCapability('pu')?.providerId).toBe('pu-mypu');
  expect(resolveCourseCatalogCapability('tw-pu')).toEqual(resolveCourseCatalogCapability('pu'));
});

it.each(['all', 'tw-nthu', 'tenant-school', 'constructor', '__proto__', null, undefined])('keeps unknown or ambiguous identity %s without a catalog', (schoolId) => {
  expect(resolveCourseCatalogCapability(schoolId)).toBeNull();
  expect(hasIntegratedCourseCatalog(schoolId)).toBe(false);
  expect(resolveOfficialCourseQueryLink(schoolId)).toBeNull();
});
