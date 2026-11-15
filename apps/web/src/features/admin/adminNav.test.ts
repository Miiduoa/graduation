import { expect, it } from 'vitest';
import {
  parseAdminHash,
  serializeAdminHash,
  defaultAdminLocation,
  isAdminWorkbenchHash,
  tryParseAdminHash,
  resolveAdminLocation,
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

it.each(['school', 'tenantId'])(
  'preserves the school in a legacy operations link using %s',
  (key) => {
    expect(resolveAdminLocation('/admin/ops', `?tab=people&${key}=school-one`, '')).toMatchObject({
      section: 'people',
      schoolId: 'school-one',
      reviewId: null,
    });
  },
);

it('migrates old operation tabs and the separate review route into one workspace', () => {
  expect(resolveAdminLocation('/admin/ops', '?tab=merchants', '#schools').section).toBe(
    'merchants',
  );
  expect(resolveAdminLocation('/admin/ops', '', '#affiliation').section).toBe('affiliation');
  expect(resolveAdminLocation('/admin/school-review', '', '').section).toBe('school-review');
  expect(
    resolveAdminLocation('/admin/ops', '?tab=unknown&school=../../another', '').schoolId,
  ).toBeNull();
});

it.each(['#affiliation#affiliation', 'affiliation#affiliation'])(
  'preserves the requested legacy task in the stacked fragment %s',
  (hash) => {
    expect(resolveAdminLocation('/admin/ops', '', hash).section).toBe('affiliation');
    expect(resolveAdminLocation('/admin/ops', '?tab=unknown', hash).section).toBe('affiliation');
  },
);

it('keeps a valid legacy query tab and selected school ahead of a stacked fragment', () => {
  expect(
    resolveAdminLocation(
      '/admin/ops',
      '?tab=people&tenantId=school-one',
      '#affiliation#affiliation',
    ),
  ).toMatchObject({ section: 'people', schoolId: 'school-one', reviewId: null });
  expect(resolveAdminLocation('/admin/ops', '?tab=merchants', '#people#people').section).toBe(
    'merchants',
  );
});

it.each(['school-review', 'merchants', 'affiliation'] as const)(
  'round-trips a selected %s review without confusing it with a school',
  (section) => {
    const location = {
      ...defaultAdminLocation(),
      section,
      reviewId: 'application:school-one:case-one',
    };
    expect(parseAdminHash(serializeAdminHash(location))).toEqual(location);
  },
);

it('opens the requested section without throwing on a malformed encoded bookmark', () => {
  expect(parseAdminHash('#merchants/%E0%A4%A')).toMatchObject({
    section: 'merchants',
    reviewId: null,
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

it('round-trips the campus announcements section in the hash', () => {
  expect(serializeAdminHash({ ...defaultAdminLocation(), section: 'announcements' })).toBe(
    '#announcements',
  );
  expect(
    serializeAdminHash({
      ...defaultAdminLocation(),
      section: 'announcements',
      schoolId: 'pu',
    }),
  ).toBe('#announcements/pu');
  expect(parseAdminHash('#announcements/pu')).toMatchObject({
    section: 'announcements',
    schoolId: 'pu',
  });
  expect(isAdminWorkbenchHash('#announcements')).toBe(true);
});

it('round-trips the audit school scope separately from free-text search', () => {
  const location = {
    ...defaultAdminLocation(),
    section: 'audit' as const,
    auditTenantId: 'school-one',
    auditSchoolName: '第一學校',
    auditQuery: '聯絡資訊',
  };
  expect(parseAdminHash(serializeAdminHash(location))).toEqual(location);
  expect(parseAdminHash('#audit?tenantId=school-one')).toMatchObject({
    auditTenantId: 'school-one',
    auditSchoolName: '',
    auditQuery: '',
  });
});
