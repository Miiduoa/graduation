import { expect, it } from 'vitest';
import type { NuniMerchantWorkspace } from '@campus/shared/src/nuniMerchant';
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
