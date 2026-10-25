import { expect, it } from 'vitest';
import {
  parseAdminHash,
  serializeAdminHash,
  defaultAdminLocation,
  isAdminWorkbenchHash,
  tryParseAdminHash,
} from './adminNav';

it('round-trips section, selection and loaded-scope filters in the hash', () => {
  const location = {
    ...defaultAdminLocation(),
    section: 'schools' as const,
    schoolId: 'school-one',
    schoolQuery: '第一',
    schoolLifecycle: 'provisioned' as const,
  };
  expect(serializeAdminHash(location)).toBe(
    '#schools/school-one?q=%E7%AC%AC%E4%B8%80&lifecycle=provisioned',
  );
  expect(parseAdminHash('#schools/school-one?q=第一&lifecycle=provisioned')).toMatchObject({
    section: 'schools',
    schoolId: 'school-one',
    schoolQuery: '第一',
    schoolLifecycle: 'provisioned',
  });
});

it('ignores ordinary content anchors used by skip links', () => {
  expect(isAdminWorkbenchHash('#page-content')).toBe(false);
  expect(tryParseAdminHash('#page-content')).toBeNull();
  expect(isAdminWorkbenchHash('#schools/school-one')).toBe(true);
  expect(tryParseAdminHash('#schools/school-one')).toMatchObject({
    section: 'schools',
    schoolId: 'school-one',
  });
});
