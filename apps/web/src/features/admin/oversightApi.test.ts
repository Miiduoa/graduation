import { expect, it } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import {
  applicationStateLabel,
  createPeopleParser,
  parseOversightMerchants,
  parseOversightPeople,
} from './oversightApi';

const peopleOk = {
  tenantId: 'school-one',
  displayName: '第一學校',
  tenantState: 'open',
  hasRoleAdmin: true,
  roleAdmins: [{ personId: 'p-admin', displayName: '王管理員' }],
  people: [
    {
      personId: 'p-admin',
      displayName: '王管理員',
      email: 'admin@one.edu.tw',
      role: 'school_admin',
      roleLabel: '學校管理員',
      state: 'active',
      stateLabel: '使用中',
    },
  ],
  honesty: '可以隨時再加一位老師或職員。',
};

const merchantsOk = {
  interest: [
    {
      id: 'interest-1',
      brandName: '意向咖啡',
      schoolName: '第一學校',
      contactName: '店長',
      contactEmail: 'interest@example.test',
      note: null,
      state: 'submitted',
      createdAt: '2026-01-02T03:04:05.000Z',
      decidedAt: null,
    },
  ],
  applications: [
    {
      tenantId: 'school-one',
      tenantName: '第一學校',
      applicationId: 'app-1',
      brandName: '進件食堂',
      locationName: '一樓窗口',
      contactName: '負責人',
      contactEmail: 'app@example.test',
      state: 'submitted',
      version: 1,
      submittedAt: '2026-01-03T03:04:05.000Z',
    },
  ],
  catalog: [
    {
      tenantId: 'school-one',
      tenantName: '第一學校',
      locationId: 'loc-1',
      locationName: '資訊展示店',
      merchantMode: 'info_only',
      merchantModeLabel: '僅資訊',
      sourceLabel: '平台建檔',
      sourceUpdatedAt: null,
      published: true,
      locationStatus: 'open',
      publicAccess: true,
    },
  ],
  honesty: '意向與進件都要先審過才能往下。',
};

it('accepts a well-formed school people payload for the selected tenant', () => {
  expect(createPeopleParser('school-one')(peopleOk)).toMatchObject({
    tenantId: 'school-one',
    hasRoleAdmin: true,
    people: [{ personId: 'p-admin', role: 'school_admin' }],
  });
});

it('rejects a people payload that belongs to another school', () => {
  expect(() => createPeopleParser('school-two')(peopleOk)).toThrow(NuniError);
  try {
    createPeopleParser('school-two')(peopleOk);
  } catch (error) {
    expect(error).toMatchObject({ status: 502, code: 'INVALID_RESPONSE' });
  }
});

it('rejects partial or contradictory people payloads', () => {
  expect(() => parseOversightPeople({ ...peopleOk, people: 'nope' })).toThrow(NuniError);
  expect(() =>
    parseOversightPeople({
      ...peopleOk,
      hasRoleAdmin: false,
      roleAdmins: peopleOk.roleAdmins,
    }),
  ).toThrow(NuniError);
  expect(() =>
    parseOversightPeople({
      ...peopleOk,
      people: [{ ...peopleOk.people[0], role: 'student' }],
    }),
  ).toThrow(NuniError);
});

it('accepts merchant oversight payloads and localizes known application states', () => {
  const parsed = parseOversightMerchants(merchantsOk);
  expect(parsed.catalog[0].merchantMode).toBe('info_only');
  expect(parsed.interest[0].state).toBe('submitted');
  expect(applicationStateLabel('submitted')).toEqual({ label: '待審核', unknown: false });
  expect(applicationStateLabel('brand-new-state')).toEqual({ label: '待確認', unknown: true });
});

it('rejects malformed merchant catalog rows', () => {
  expect(() =>
    parseOversightMerchants({
      ...merchantsOk,
      catalog: [{ ...merchantsOk.catalog[0], merchantMode: 'order_everything' }],
    }),
  ).toThrow(NuniError);
  expect(() =>
    parseOversightMerchants({
      ...merchantsOk,
      applications: [{ ...merchantsOk.applications[0], version: 0 }],
    }),
  ).toThrow(NuniError);
});
