import { describe, expect, it } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import {
  parseAffiliationApplication,
  parseAffiliationApplications,
  parseSchoolApplication,
  parseSchoolApplications,
} from './reviewApi';

const stamp = '2026-11-06T08:00:00.000Z';
const school = {
  id: 'soa_11111111-1111-4111-8111-111111111111',
  state: 'pending',
  displayName: '範例學校',
  proposedTenantId: 'example-school',
  proposedEmailDomain: 'example.edu.tw',
  contactName: '校方承辦人',
  contactEmail: 'school@example.test',
  justification: '申請建立校園服務',
  tenantId: null,
  tenantState: null,
  createdAt: stamp,
  decidedAt: null,
};
const affiliation = {
  id: 'cwaa_22222222-2222-4222-8222-222222222222',
  workspaceId: 'cw_33333333-3333-4333-8333-333333333333',
  workspaceTitle: '資訊管理課班',
  tenantId: 'example-school',
  sectionId: null,
  justification: '請將課班連結至本校',
  state: 'pending',
  createdAt: stamp,
  decidedAt: null,
  decisionReason: null,
};

describe.each([
  ['school applications', parseSchoolApplications, school],
  ['class affiliations', parseAffiliationApplications, affiliation],
] as const)('%s', (_name, parse, row) => {
  it('reads the existing API projection and preserves an actual empty queue', () => {
    expect(parse({ applications: [row], operatorHonesty: '既有 API 說明' })).toEqual([row]);
    expect(parse({ applications: [] })).toEqual([]);
  });

  it.each([null, undefined, [], {}, { items: [] }, { applications: null }, { applications: {} }])(
    'rejects an unavailable or malformed queue instead of returning zero: %j',
    (value) => {
      expect(() => parse(value)).toThrow(NuniError);
    },
  );

  it.each([null, [], {}, { id: 'incomplete' }])(
    'does not silently drop a damaged case: %j',
    (bad) => {
      expect(() => parse({ applications: [row, bad] })).toThrow(NuniError);
    },
  );

  it('rejects duplicated cases that would inflate counts or mix decision forms', () => {
    expect(() => parse({ applications: [row, { ...row }] })).toThrow(NuniError);
  });

  it.each([
    { id: '' },
    { id: '../another-case' },
    { state: 'unknown' },
    { createdAt: 'not-a-date' },
    { state: 'approved', decidedAt: null },
    { state: 'pending', decidedAt: stamp },
  ])('does not present malformed identifiers or review states as actionable: %j', (patch) => {
    expect(() => parse({ applications: [{ ...row, ...patch }] })).toThrow(NuniError);
  });
});

it('reads a confirmed school approval with its actual tenant for the next management step', () => {
  const approved = {
    ...school,
    state: 'approved',
    tenantId: 'approved-school',
    tenantState: 'provisioned',
    decidedAt: stamp,
  };
  expect(parseSchoolApplication(approved)).toEqual(approved);
  expect(() => parseSchoolApplication({ ...approved, tenantId: null })).toThrow(NuniError);
  expect(() => parseSchoolApplication({ ...approved, tenantState: null })).toThrow(NuniError);
});

it('retains a decided affiliation without treating it as a pending application', () => {
  const rejected = {
    ...affiliation,
    state: 'rejected',
    decidedAt: stamp,
    decisionReason: '課班與申請學校不一致',
  };
  expect(parseAffiliationApplication(rejected)).toEqual(rejected);
});

it('requires an explicit school on affiliations rather than inventing a destination', () => {
  expect(() => parseAffiliationApplication({ ...affiliation, tenantId: undefined })).toThrow(
    NuniError,
  );
  expect(() => parseAffiliationApplication({ ...affiliation, tenantId: '../other' })).toThrow(
    NuniError,
  );
});
