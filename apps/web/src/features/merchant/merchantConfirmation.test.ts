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

it('combines legacy list metadata with the operating state of a delayed versioned detail', () => {
  const confirmed = createMerchantConfirmations(new Map());
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
  const detailRevision = confirmed.beginRequest();
  confirmed.mergeWorkspaceList([legacyRow], confirmed.beginRequest());

  expect(confirmed.overview()?.workspaces).toEqual([legacyRow]);
  const suspendedRow = {
    ...legacyRow,
    merchantStatus: 'suspended',
    locationStatus: 'suspended',
    publicAccess: false,
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
  expect(confirmed.confirmApplication(receipt, delayedWrite)).toBe(false);
  expect(confirmed.overview()?.applications).toEqual([]);
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
