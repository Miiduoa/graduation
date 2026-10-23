// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { parseMerchantWorkspaces } from '@campus/shared/src/nuniMerchant';
import {
  createMerchantOperations,
  parseMerchantInitialMenuReceipt,
  parseMerchantWorkspaceDetail,
  validateMerchantAvailabilityInput,
  validateMerchantInitialMenuInput,
  validateMerchantSettingsInput,
  validateMerchantWorkspaceIdentity,
} from '@campus/shared/src/nuniMerchantOperations';

const identity = {
  tenantId: 'school-one',
  locationId: 'food-location_11111111-1111-4111-8111-111111111111',
};
const path = `merchant-workspaces/${identity.tenantId}/${identity.locationId}`;
const legacy = {
  ...identity,
  tenantName: '靜宜',
  merchantName: '校園餐坊',
  locationName: '第一門市',
  campusName: '主校區',
  merchantStatus: 'suspended',
  locationStatus: 'suspended',
  publicAccess: false,
  activated: false,
  missingRequirements: ['settings', 'menu'],
};
const detail = {
  ...legacy,
  applicationId: 'fma_11111111-1111-4111-8111-111111111111',
  merchantId: 'merchant_11111111-1111-4111-8111-111111111111',
  campusId: 'main',
  serviceModes: ['pickup'],
  paymentMode: 'counter-only',
  onlinePaymentAvailable: false,
  paymentCapabilityState: 'not-requested',
  managerConfirmed: false,
  termsVersion: null,
  readinessVersion: 1,
  publishedMenuItems: 0,
  merchantMode: 'info_only',
  merchantModeLabel: '僅資訊',
  sourceLabel: '',
  sourceUpdatedAt: null,
  sourceLine: null,
};
const settings = {
  serviceModes: ['pickup', 'dine-in'],
  paymentMode: 'counter-only',
  termsVersion: 'merchant-terms-v1',
  expectedVersion: 1,
};
const configured = {
  ...detail,
  ...settings,
  managerConfirmed: true,
  readinessVersion: 2,
  missingRequirements: ['menu'],
};
// expectedVersion is a request field, not part of the provider's response.
delete (configured as Partial<typeof configured>).expectedVersion;
const item = { name: '飯糰', priceMinor: 65, initialStock: 20 };
const menu = { items: [item] };
const menuReceipt = {
  menuVersionId: 'food-menu_11111111-1111-4111-8111-111111111111',
  createdItems: 1,
};
const active = {
  ...configured,
  publishedMenuItems: 1,
  activated: true,
  readinessVersion: 3,
  merchantStatus: 'active',
  locationStatus: 'open',
  publicAccess: true,
  missingRequirements: [],
  merchantMode: 'full',
  merchantModeLabel: '可點餐',
};
const invalidInput = { status: 422, code: 'INVALID_INPUT' };
const invalidResponse = { status: 502, code: 'INVALID_RESPONSE' };

it('keeps minimal legacy merchant lists compatible while requiring complete operational details', () => {
  expect(parseMerchantWorkspaces({ workspaces: [legacy] })).toEqual([legacy]);
  expect(() => parseMerchantWorkspaceDetail(legacy)).toThrowError(NuniError);
  expect(parseMerchantWorkspaceDetail(detail, identity)).toEqual(detail);
});

it.each(Object.keys(detail))('rejects an incomplete detail missing %s', (key) => {
  const incomplete = { ...detail } as Record<string, unknown>;
  delete incomplete[key];
  expect(() => parseMerchantWorkspaceDetail(incomplete, identity)).toThrowError(NuniError);
});

it.each([
  { ...detail, locationId: 'another-location' },
  { ...detail, tenantId: 'another-school' },
  { ...detail, readinessVersion: 0 },
  { ...detail, publishedMenuItems: -1 },
  { ...detail, readinessVersion: 1.5 },
  { ...detail, onlinePaymentAvailable: 'false' },
  { ...detail, serviceModes: ['pickup', 'pickup'] },
  { ...detail, paymentMode: 'cash' },
  { ...detail, merchantMode: 'unknown' },
  { ...detail, sourceUpdatedAt: '2026-02-30' },
  { ...detail, sourceUpdatedAt: '2026-10-13T00:00:00Z' },
  { ...detail, role: 'manager' },
])('does not accept a malformed or unrelated detail %#', (value) => {
  expect(() => parseMerchantWorkspaceDetail(value, identity)).toThrowError(NuniError);
});

it('preserves a complete nullable and dated source projection', () => {
  expect(
    parseMerchantWorkspaceDetail({
      ...detail,
      campusId: null,
      sourceLabel: '校方',
      sourceUpdatedAt: '2026-10-13',
      sourceLine: '來源 校方',
    }).sourceUpdatedAt,
  ).toBe('2026-10-13');
});

it.each([
  { ...identity, tenantId: '../admin' },
  { ...identity, locationId: '../orders' },
  { ...identity, locationId: 'one/two' },
  { ...identity, locationId: 'x'.repeat(121) },
  { ...identity, locationId: 'x%2Forders' },
  { ...identity, tenantId: 'x' },
  { ...identity, accountId: 'someone-else' },
])('rejects an unsafe workspace identity before transport %#', async (value) => {
  expect(() => validateMerchantWorkspaceIdentity(value)).toThrowError(NuniError);
  const transport = vi.fn();
  if (!('accountId' in value)) {
    await expect(
      createMerchantOperations(transport).get(value.tenantId, value.locationId),
    ).rejects.toMatchObject(invalidInput);
    expect(transport).not.toHaveBeenCalled();
  }
});

it.each([
  { ...settings, expectedVersion: 0 },
  { ...settings, expectedVersion: '1' },
  { ...settings, expectedVersion: 1.5 },
  { ...settings, termsVersion: 'merchant-terms-v2' },
  { ...settings, serviceModes: [] },
  { ...settings, serviceModes: ['pickup', 'pickup'] },
  { ...settings, paymentMode: 'cash' },
  { ...settings, activated: true },
  { ...settings, idempotencyKey: 'not-supported-by-provider' },
])('rejects settings outside the actual provider contract %#', (value) => {
  expect(() => validateMerchantSettingsInput(value)).toThrowError(NuniError);
});

it('normalizes optional menu text without changing whole-TWD prices', () => {
  expect(validateMerchantInitialMenuInput(menu)).toEqual({
    items: [{ ...item, description: '', allergens: [] }],
  });
  expect(
    validateMerchantInitialMenuInput({ items: [{ ...item, name: ' 飯糰 ', allergens: [' 蛋 '] }] })
      .items[0],
  ).toMatchObject({ name: '飯糰', priceMinor: 65, allergens: ['蛋'] });
});

it('accepts exact menu boundaries and no monetary scaling', () => {
  const maximum = {
    name: '食'.repeat(200),
    description: '說'.repeat(1000),
    priceMinor: 10_000_000,
    initialStock: 100_000,
    allergens: Array(30).fill('敏'.repeat(80)),
  };
  expect(validateMerchantInitialMenuInput({ items: Array(100).fill(maximum) }).items).toHaveLength(
    100,
  );
  expect(
    validateMerchantInitialMenuInput({ items: [{ ...item, priceMinor: 1, initialStock: 1 }] })
      .items[0].priceMinor,
  ).toBe(1);
});

it.each([
  { items: [] },
  { items: Array(101).fill(item) },
  { items: [{ ...item, priceMinor: 0 }] },
  { items: [{ ...item, priceMinor: 65.5 }] },
  { items: [{ ...item, priceMinor: '65' }] },
  { items: [{ ...item, priceMinor: 10_000_001 }] },
  { items: [{ ...item, initialStock: 0 }] },
  { items: [{ ...item, initialStock: 100_001 }] },
  { items: [{ ...item, name: '食'.repeat(201) }] },
  { items: [{ ...item, description: '說'.repeat(1001) }] },
  { items: [{ ...item, allergens: Array(31).fill('蛋') }] },
  { items: [{ ...item, allergens: ['敏'.repeat(81)] }] },
  { items: [{ ...item, allergens: [' '] }] },
  { items: [{ ...item, locationId: 'another-location' }] },
  { ...menu, idempotencyKey: 'not-supported' },
])('rejects invalid menu payloads before any mutation %#', async (value) => {
  const transport = vi.fn();
  await expect(
    createMerchantOperations(transport).createInitialMenu(
      identity.tenantId,
      identity.locationId,
      value,
    ),
  ).rejects.toMatchObject(invalidInput);
  expect(transport).not.toHaveBeenCalled();
});

it.each([{ acceptingOrders: 'true' }, { acceptingOrders: true, expectedVersion: 1 }, {}, null])(
  'never adds an unsupported availability version or coerces its boolean %#',
  (value) => {
    expect(() => validateMerchantAvailabilityInput(value)).toThrowError(NuniError);
  },
);

it('connects the complete authorized opening flow with PUT only for settings', async () => {
  const paused = { ...active, locationStatus: 'closed', publicAccess: false };
  const transport = vi
    .fn()
    .mockResolvedValueOnce(detail)
    .mockResolvedValueOnce(configured)
    .mockResolvedValueOnce(menuReceipt)
    .mockResolvedValueOnce(active)
    .mockResolvedValueOnce(paused);
  const api = createMerchantOperations(transport);
  await expect(api.get(identity.tenantId, identity.locationId)).resolves.toEqual(detail);
  await expect(
    api.updateSettings(identity.tenantId, identity.locationId, settings),
  ).resolves.toEqual(configured);
  await expect(
    api.createInitialMenu(identity.tenantId, identity.locationId, menu),
  ).resolves.toEqual(menuReceipt);
  await expect(api.activate(identity.tenantId, identity.locationId)).resolves.toEqual(active);
  await expect(api.setAvailability(identity.tenantId, identity.locationId, false)).resolves.toEqual(
    paused,
  );
  expect(transport.mock.calls).toEqual([
    [path],
    [`${path}/settings`, settings, 'PUT'],
    [`${path}/initial-menu`, { items: [{ ...item, description: '', allergens: [] }] }],
    [`${path}/activate`, {}],
    [`${path}/availability`, { acceptingOrders: false }],
  ]);
});

it.each([
  { ...configured, tenantId: 'another-school' },
  { ...configured, readinessVersion: 1 },
  { ...configured, managerConfirmed: false },
  { ...configured, serviceModes: ['delivery'] },
  { ...configured, termsVersion: 'old-terms' },
  { ...configured, paymentMode: 'online-and-counter' },
])(
  'does not report saved settings when the receipt cannot confirm the request %#',
  async (receipt) => {
    const transport = vi.fn().mockResolvedValue(receipt);
    await expect(
      createMerchantOperations(transport).updateSettings(
        identity.tenantId,
        identity.locationId,
        settings,
      ),
    ).rejects.toMatchObject(invalidResponse);
    expect(transport).toHaveBeenCalledOnce();
  },
);

it.each([
  {},
  { ...menuReceipt, createdItems: 2 },
  { ...menuReceipt, menuVersionId: 'made-up' },
  { ...menuReceipt, createdItems: 0 },
  { ...menuReceipt, success: true },
])('rejects unverifiable menu success and does not automatically retry %#', async (receipt) => {
  const transport = vi.fn().mockResolvedValue(receipt);
  await expect(
    createMerchantOperations(transport).createInitialMenu(
      identity.tenantId,
      identity.locationId,
      menu,
    ),
  ).rejects.toMatchObject(invalidResponse);
  expect(transport).toHaveBeenCalledOnce();
});

it('propagates an unknown initial-menu result without retrying or fabricating a receipt', async () => {
  const offline = new Error('connection lost after send');
  const transport = vi.fn().mockRejectedValue(offline);
  await expect(
    createMerchantOperations(transport).createInitialMenu(
      identity.tenantId,
      identity.locationId,
      menu,
    ),
  ).rejects.toBe(offline);
  expect(transport).toHaveBeenCalledOnce();
});

it('preserves provider version and permission failures without retrying', async () => {
  const conflict = new NuniError(409, 'FOOD_MERCHANT_WORKSPACE_CHANGED');
  const transport = vi.fn().mockRejectedValue(conflict);
  await expect(
    createMerchantOperations(transport).updateSettings(
      identity.tenantId,
      identity.locationId,
      settings,
    ),
  ).rejects.toBe(conflict);
  expect(transport).toHaveBeenCalledOnce();
});

it('does not turn an incomplete activation receipt into success', async () => {
  await expect(
    createMerchantOperations(vi.fn().mockResolvedValue(detail)).activate(
      identity.tenantId,
      identity.locationId,
    ),
  ).rejects.toMatchObject(invalidResponse);
});

it('keeps the real paused state returned by a repeated activation', async () => {
  const paused = { ...active, locationStatus: 'closed', publicAccess: false };
  await expect(
    createMerchantOperations(vi.fn().mockResolvedValue(paused)).activate(
      identity.tenantId,
      identity.locationId,
    ),
  ).resolves.toMatchObject({ activated: true, locationStatus: 'closed', publicAccess: false });
});

it.each([
  { ...active, publicAccess: false },
  { ...active, locationStatus: 'closed' },
  { ...active, activated: false },
  { ...active, locationId: 'another-location' },
])(
  'requires the availability receipt to confirm the selected store and state %#',
  async (receipt) => {
    await expect(
      createMerchantOperations(vi.fn().mockResolvedValue(receipt)).setAvailability(
        identity.tenantId,
        identity.locationId,
        true,
      ),
    ).rejects.toMatchObject(invalidResponse);
  },
);

it('exports menu receipt validation independently for a bounded BFF', () => {
  expect(parseMerchantInitialMenuReceipt(menuReceipt, 1)).toEqual(menuReceipt);
});
