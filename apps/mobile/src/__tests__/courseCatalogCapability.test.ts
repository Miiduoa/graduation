import {
  hasIntegratedCourseCatalog,
  resolveCourseCatalogCapability,
  resolveOfficialCourseQueryLink,
  unsupportedCourseCatalogMessage,
} from '@campus/shared/src';
import { queryCatalog } from '../services/courseCatalogClient';

test.each(['pu', 'tw-pu'])('integrated catalog resolves for Providence alias %s', (schoolId) => {
  const capability = resolveCourseCatalogCapability(schoolId);
  expect(capability?.providerId).toBe('pu-mypu');
  expect(capability?.schoolId).toBe('pu');
  expect(hasIntegratedCourseCatalog(schoolId)).toBe(true);
  // Public official course entry comes from schoolPublicServices (alcat), distinct from myPU API.
  expect(resolveOfficialCourseQueryLink(schoolId)?.url).toContain('alcat.pu.edu.tw');
  expect(capability?.officialQueryUrl).toContain('mypu.pu.edu.tw');
});

test.each(['ncku', 'ntpu', 'ntu'])(
  'verified public course link exists without integrated catalog for %s',
  (schoolId) => {
    expect(resolveCourseCatalogCapability(schoolId)).toBeNull();
    expect(hasIntegratedCourseCatalog(schoolId)).toBe(false);
    expect(resolveOfficialCourseQueryLink(schoolId)?.url).toBeTruthy();
  },
);

test.each(['nthu', 'tenant-school-12', '', null])(
  'unknown school has neither integrated catalog nor public course link: %s',
  (schoolId) => {
    expect(resolveCourseCatalogCapability(schoolId)).toBeNull();
    expect(hasIntegratedCourseCatalog(schoolId)).toBe(false);
    expect(resolveOfficialCourseQueryLink(schoolId)).toBeNull();
  },
);

test('unsupported copy is truthful Traditional Chinese without inventing data', () => {
  const message = unsupportedCourseCatalogMessage('ncku', '國立成功大學');
  expect(message).toContain('國立成功大學');
  expect(message).toContain('尚未接入');
  expect(message).toContain('成大課程資訊及選課系統');
  expect(message).not.toMatch(/靜宜大學課綱查詢系統/);
  expect(message).not.toMatch(/已同步|查詢成功/);
});

test.each(['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'])(
  'adversarial id %s never resolves as integrated catalog or official PU provider',
  async (schoolId) => {
    expect(resolveCourseCatalogCapability(schoolId)).toBeNull();
    expect(hasIntegratedCourseCatalog(schoolId)).toBe(false);
    // May still resolve a public course link only if it aliases a real school — these do not.
    expect(resolveOfficialCourseQueryLink(schoolId)).toBeNull();
    const result = await queryCatalog({ semester: '1151' }, { schoolId, forceRefresh: true });
    expect(result.courses).toEqual([]);
    expect(result.error).toMatch(/尚未接入/);
    expect(result.source).toBe('sample');
  },
);
