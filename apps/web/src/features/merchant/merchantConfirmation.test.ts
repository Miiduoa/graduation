import { NuniError } from '@campus/shared/src/nuni';
import { expect, it } from 'vitest';
import type { NuniMerchantWorkspace } from '@campus/shared/src/nuniMerchant';
import type { NuniMerchantWorkspaceDetail } from '@campus/shared/src/nuniMerchantOperations';
import { createMerchantConfirmations } from './merchantConfirmation';

it('renders the newer menu requirement after a list previously confirmed the menu', () => {
  const confirmed = createMerchantConfirmations(new Map());
  const row: NuniMerchantWorkspace = {
    tenantId: 'campus-one',
    tenantName: '第一校園',
    locationId: 'store-a',
    locationName: '一樓',
    merchantName: '餐坊',
    campusName: '主校區',
    merchantStatus: 'suspended',
    locationStatus: 'suspended',
    activated: false,
    publicAccess: false,
    readinessVersion: 1,
    missingRequirements: [],
  };
  confirmed.mergeWorkspaceList([row], confirmed.beginRequest());
  expect(confirmed.overview()?.workspaces).toEqual([row]);

  const missingMenu = { ...row, missingRequirements: ['menu'] };
  confirmed.mergeWorkspaceList([missingMenu], confirmed.beginRequest());
  expect(confirmed.overview()?.workspaces).toEqual([missingMenu]);
});

function workspaceFixture() {
  const legacyRow: NuniMerchantWorkspace = {
    tenantId: 'campus-one',
    tenantName: '第一校園',
    locationId: 'store-a',
    locationName: '一樓',
    merchantName: '餐坊',
    campusName: '主校區',
    merchantStatus: 'active',
    locationStatus: 'open',
    activated: true,
    publicAccess: true,
    missingRequirements: ['menu'],
  };
  const detail: NuniMerchantWorkspaceDetail = {
    ...legacyRow,
    merchantStatus: 'suspended',
    locationStatus: 'suspended',
    publicAccess: false,
    missingRequirements: [],
    applicationId: 'application-1',
    merchantId: 'merchant-1',
    campusId: 'main-campus',
    serviceModes: ['pickup'],
    paymentMode: 'counter-only',
    onlinePaymentAvailable: false,
    paymentCapabilityState: 'not-requested',
    managerConfirmed: true,
    termsVersion: 'merchant-terms-v1',
    readinessVersion: 7,
    publishedMenuItems: 3,
    merchantMode: 'full',
    merchantModeLabel: '接單服務',
    sourceLabel: '',
    sourceUpdatedAt: null,
    sourceLine: null,
  };
  return { legacyRow, detail };
}

it.each(['merge', 'denial', 'omitted requirements'] as const)('reconciles legacy lists and versioned detail ($0)', (scenario) => {
  const confirmed = createMerchantConfirmations(new Map());
  const { legacyRow, detail } = workspaceFixture();
  if (scenario === 'omitted requirements') {
    delete detail.missingRequirements;
    confirmed.confirmDetail(detail, confirmed.beginRequest(), true);
    for (const verifiesAccess of [false, true]) {
      for (const missingRequirements of [[], ['settings'], ['settings', 'menu']]) {
        const result = confirmed.confirmDetail(
          { ...detail, missingRequirements }, confirmed.beginRequest(), verifiesAccess,
        );
        expect(result?.won).toBe(true);
        expect(result?.detail.missingRequirements).toBeUndefined();
      }
    }
    return;
  }
  if (scenario === 'denial') {
    const key = 'campus-one:store-a';
    confirmed.mergeWorkspaceList([detail], confirmed.beginRequest());
    const writeRevision = confirmed.beginRequest();
    const deniedListRevision = confirmed.beginRequest();
    const readRevision = confirmed.beginRequest();
    confirmed.confirmDetail(detail, readRevision, true);

    const receipt = { ...detail, readinessVersion: 8 };
    expect(confirmed.confirmDetail(receipt, writeRevision, false)?.won).toBe(true);
    confirmed.rejectWorkspaceList(true, deniedListRevision);
    expect(confirmed.overview()?.workspaces).toMatchObject([receipt]);
    expect(confirmed.detailFor(key)).toEqual(receipt);

    confirmed.rejectWorkspaceList(true, confirmed.beginRequest());
    expect(confirmed.detailFor(key)).toBeNull();
    expect(confirmed.overview()?.workspaces ?? []).toEqual([]);
    return;
  }

  const detailRevision = confirmed.beginRequest();
  confirmed.mergeWorkspaceList([legacyRow], confirmed.beginRequest());

  expect(confirmed.overview()?.workspaces).toEqual([legacyRow]);
  const suspendedRow = {
    ...legacyRow,
    merchantStatus: 'suspended',
    locationStatus: 'suspended',
    publicAccess: false,
    missingRequirements: [],
  };
  expect(confirmed.confirmDetail(detail, detailRevision, true)).toEqual({ detail, won: false });
  expect(confirmed.overview()?.workspaces).toEqual([suspendedRow]);

  const lowerVersion = { ...detail, readinessVersion: 6 };
  expect(confirmed.confirmDetail(lowerVersion, confirmed.beginRequest(), true)).toBeNull();
  expect(confirmed.verifiedDetails().get('campus-one:store-a')).toEqual(detail);
  expect(confirmed.overview()?.workspaces).toEqual([suspendedRow]);

  const sameVersion = { ...detail, missingRequirements: ['settings'] };
  expect(confirmed.confirmDetail(sameVersion, confirmed.beginRequest(), true))
    .toEqual({ detail: sameVersion, won: true });
  expect(confirmed.overview()?.workspaces).toMatchObject([sameVersion]);
});

it('preserves a newer application receipt through older list responses until a subsequent denial', () => {
  const confirmed = createMerchantConfirmations(new Map());
  const receipt = {
    tenantId: 'campus-one',
    applicationId: 'application-1',
    brandName: '餐坊',
    locationName: '一樓',
    state: 'submitted' as const,
    reviewerNote: '',
    submittedAt: '2026-10-09T02:00:00.000Z',
  };

  const listed = {
    ...receipt,
    applicationId: 'older-application',
    state: 'under-review' as const,
    reviewerNote: '請補營業登記資料',
  };
  confirmed.mergeApplications([listed], confirmed.beginRequest());
  const earlierList = confirmed.beginRequest();
  const deniedList = confirmed.beginRequest();
  const write = confirmed.beginRequest();
  expect(confirmed.confirmApplication(receipt, write)).toBe(true);
  expect(confirmed.overview()?.applications).toEqual([receipt, listed]);
  expect(confirmed.rejectApplications(deniedList)).toBe(true);
  expect(confirmed.hasApplicationList()).toBe(false);
  expect(confirmed.overview()?.applications).toEqual([receipt]);
  confirmed.mergeApplications([listed], earlierList);
  expect(confirmed.hasApplicationList()).toBe(false);
  expect(confirmed.overview()?.applications).toEqual([receipt]);

  expect(confirmed.rejectApplications(confirmed.beginRequest())).toBe(true);
  expect(confirmed.overview()).toBeNull();
  expect(confirmed.confirmApplication(receipt, write)).toBe(false);

  const delayedWrite = confirmed.beginRequest();
  confirmed.mergeApplications([], confirmed.beginRequest());
  expect(confirmed.confirmApplication(receipt, delayedWrite)).toBe(true);
  expect(confirmed.overview()?.applications).toEqual([receipt]);
});

it('keeps newer application receipt status and notes until a later list confirms them', () => {
  const confirmed = createMerchantConfirmations(new Map());
  const receipt = {
    tenantId: 'campus-one',
    applicationId: 'application-1',
    brandName: '餐坊',
    locationName: '一樓',
    state: 'under-review' as const,
    reviewerNote: '',
    submittedAt: '2026-10-09T02:00:00.000Z',
  };
  const staleRow = {
    ...receipt,
    state: 'needs-information' as const,
    reviewerNote: '請補營業登記資料',
  };
  const earlyList = confirmed.beginRequest();
  expect(confirmed.confirmApplication(receipt, confirmed.beginRequest())).toBe(true);
  confirmed.mergeApplications([staleRow], earlyList);
  expect(confirmed.overview()?.applications).toEqual([receipt]);

  const updatedRow = { ...staleRow, reviewerNote: '請補最新的食品業者登錄資料' };
  confirmed.mergeApplications([updatedRow], confirmed.beginRequest());
  expect(confirmed.overview()?.applications).toEqual([updatedRow]);
});

const readSources = [
  { name: 'list', source: undefined },
  { name: 'foreground detail', source: 'detail' },
  { name: 'background detail', source: 'detail' },
  { name: 'order queue', source: 'orders' },
  { name: 'shift', source: 'orders' },
] as const;
const readOutcomes = [
  { status: 401, code: 'UNAUTHORIZED', kind: 'expired' },
  { status: 409, code: 'SESSION_CHANGED', kind: 'expired' },
  { status: 403, code: 'FORBIDDEN', kind: 'denied' },
  { status: 404, code: 'NOT_FOUND', kind: 'denied' },
  { status: 503, code: 'UNAVAILABLE', kind: 'unavailable' },
] as const;
const readMatrix = readSources.flatMap(({ name, source }) =>
  readOutcomes.flatMap((outcome) =>
    ['visible', 'navigated', 'cleared'].map((lifetime) => ({ name, source, ...outcome, lifetime })),
  ),
);

it.each(readMatrix)('$name $status $code while $lifetime', ({ source, status, code, kind, lifetime }) => {
  const { detail } = workspaceFixture();
  const key = 'campus-one:store-a';
  const confirmed = createMerchantConfirmations(new Map());
  const list = (row = detail) => confirmed.mergeWorkspaceList([row], confirmed.beginRequest());
  const read = (row = detail) => confirmed.confirmDetail(row, confirmed.beginRequest(), true);
  list();
  read();
  const round = source === 'orders' ? confirmed.beginOrderRead(key) : undefined;
  const revision = round?.revision ?? confirmed.beginRequest();
  let session = 0;
  const capturedSession = session;
  const clear = () => {
    session++;
    confirmed.clearSession();
  };
  if (lifetime === 'cleared') {
    clear();
    list();
  }

  const result = confirmed.rejectRead(
    () => session === capturedSession,
    new NuniError(status, code),
    revision,
    clear,
    source && { key, source },
  );

  if (lifetime === 'cleared' || kind === 'expired') {
    expect(result.kind).toBe(lifetime === 'cleared' ? 'retired' : 'expired');
    round?.settle();
    list();
    expect(confirmed.accessFloor(key)).toBe(0);
    expect(confirmed.canEnterWorkspace(key)).toBe(true);
    expect(confirmed.detailReadConfirmation(key)).toBeUndefined();
    return;
  }

  expect(result.kind).toBe(kind);
  expect(confirmed.accessFloor(key)).toBe(revision);
  expect(confirmed.canEnterWorkspace(key)).toBe(false);
  if (source || kind === 'unavailable') {
    list();
    expect(confirmed.canEnterWorkspace(key)).toBe(false);
  }

  // A version-changing receipt cannot establish the GET confirmation.
  const newer = { ...detail, readinessVersion: detail.readinessVersion + 1 };
  if (kind === 'unavailable') {
    const write = confirmed.beginRequest();
    confirmed.recordWrite(key, write);
    confirmed.confirmDetail(newer, write, false);
    expect(confirmed.canEnterWorkspace(key)).toBe(false);
  }
  read(newer);
  if (round && kind === 'unavailable') expect(confirmed.canEnterWorkspace(key)).toBe(false);
  round?.settle();
  expect(confirmed.detailReadConfirmation(key)?.version).toBe(newer.readinessVersion);
  expect(confirmed.canEnterWorkspace(key)).toBe(true);
  expect(confirmed.confirmDetail(detail, confirmed.beginRequest(), true)).toBeNull();
  expect(confirmed.canEnterWorkspace(key)).toBe(true);
});
