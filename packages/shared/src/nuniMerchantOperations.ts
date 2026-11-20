import { NuniError } from './nuni';
import { parseMerchantWorkspaces, type NuniMerchantWorkspace } from './nuniMerchant';

export const NUNI_MERCHANT_TERMS_VERSION = 'merchant-terms-v1' as const;
export type NuniMerchantServiceMode = 'pickup' | 'dine-in' | 'delivery';
export type NuniMerchantPaymentMode = 'counter-only' | 'online-and-counter';
export type NuniMerchantWorkspaceIdentity = { tenantId: string; locationId: string };
export type NuniMerchantWorkspaceDetail = NuniMerchantWorkspace & {
  applicationId: string;
  merchantId: string;
  campusId: string | null;
  serviceModes: NuniMerchantServiceMode[];
  paymentMode: NuniMerchantPaymentMode;
  onlinePaymentAvailable: boolean;
  paymentCapabilityState: 'not-requested' | 'pending' | 'active' | 'restricted';
  managerConfirmed: boolean;
  termsVersion: string | null;
  readinessVersion: number;
  publishedMenuItems: number;
  merchantMode: 'full' | 'showcase_link' | 'info_only';
  merchantModeLabel: string;
  sourceLabel: string;
  sourceUpdatedAt: string | null;
  sourceLine: string | null;
};
export type NuniMerchantSettingsInput = {
  serviceModes: NuniMerchantServiceMode[];
  paymentMode: NuniMerchantPaymentMode;
  termsVersion: typeof NUNI_MERCHANT_TERMS_VERSION;
  expectedVersion: number;
};
export type NuniMerchantInitialMenuInput = {
  items: {
    name: string;
    description?: string;
    /** The existing merchant interface sends whole TWD units; do not multiply by 100. */
    priceMinor: number;
    initialStock: number;
    allergens?: string[];
  }[];
};
export type NuniMerchantInitialMenuReceipt = { menuVersionId: string; createdItems: number };
export type NuniMerchantAvailabilityInput = { acceptingOrders: boolean };
export type NuniMerchantOperationsTransport = (
  path: string,
  input?: Record<string, unknown>,
  method?: 'PUT',
) => Promise<unknown>;

const invalidInput = (): never => {
  throw new NuniError(422, 'INVALID_INPUT');
};
const invalidResponse = (): never => {
  throw new NuniError(502, 'INVALID_RESPONSE');
};
type Fail = () => never;
const serviceModes = ['pickup', 'dine-in', 'delivery'] as const;
const paymentModes = ['counter-only', 'online-and-counter'] as const;

function record(value: unknown, fields: readonly string[], fail: Fail) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !fields.includes(key))) return fail();
  return row;
}
function text(value: unknown, min: number, max: number, fail: Fail, trim = false): string {
  if (typeof value !== 'string') return fail();
  const result = trim ? value.trim() : value;
  if (result.length > max || result.trim().length < min) return fail();
  return result;
}
function integer(value: unknown, min: number, max: number, fail: Fail): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) return fail();
  return Number(value);
}
function boolean(value: unknown, fail: Fail): boolean {
  if (typeof value !== 'boolean') return fail();
  return value;
}
function choice<T extends string>(value: unknown, values: readonly T[], fail: Fail): T {
  if (!values.includes(value as T)) return fail();
  return value as T;
}
function modes(value: unknown, fail: Fail): NuniMerchantServiceMode[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return fail();
  const result = value.map((item) => choice(item, serviceModes, fail));
  if (new Set(result).size !== result.length) return fail();
  return result;
}

export function validateMerchantWorkspaceIdentity(value: unknown): NuniMerchantWorkspaceIdentity {
  const row = record(value, ['tenantId', 'locationId'], invalidInput);
  const tenantId = text(row.tenantId, 2, 200, invalidInput);
  const locationId = text(row.locationId, 1, 120, invalidInput);
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(tenantId)) return invalidInput();
  // Dedicated platform paths accept opaque IDs, never user-controlled path segments.
  if (!/^[A-Za-z0-9_-]+$/.test(locationId)) return invalidInput();
  return { tenantId, locationId };
}

export function validateMerchantSettingsInput(value: unknown): NuniMerchantSettingsInput {
  const row = record(
    value,
    ['serviceModes', 'paymentMode', 'termsVersion', 'expectedVersion'],
    invalidInput,
  );
  return {
    serviceModes: modes(row.serviceModes, invalidInput),
    paymentMode: choice(row.paymentMode, paymentModes, invalidInput),
    termsVersion: choice(row.termsVersion, [NUNI_MERCHANT_TERMS_VERSION], invalidInput),
    expectedVersion: integer(row.expectedVersion, 1, Number.MAX_SAFE_INTEGER, invalidInput),
  };
}

export function validateMerchantInitialMenuInput(value: unknown): NuniMerchantInitialMenuInput {
  const row = record(value, ['items'], invalidInput);
  if (!Array.isArray(row.items) || row.items.length < 1 || row.items.length > 100)
    return invalidInput();
  return {
    items: row.items.map((value) => {
      const item = record(
        value,
        ['name', 'description', 'priceMinor', 'initialStock', 'allergens'],
        invalidInput,
      );
      const allergens = item.allergens === undefined ? [] : item.allergens;
      if (!Array.isArray(allergens) || allergens.length > 30) return invalidInput();
      return {
        name: text(item.name, 1, 200, invalidInput, true),
        description:
          item.description === undefined ? '' : text(item.description, 0, 1000, invalidInput, true),
        priceMinor: integer(item.priceMinor, 1, 10_000_000, invalidInput),
        initialStock: integer(item.initialStock, 1, 100_000, invalidInput),
        allergens: allergens.map((allergen) => text(allergen, 1, 80, invalidInput, true)),
      };
    }),
  };
}

export function validateMerchantAvailabilityInput(value: unknown): NuniMerchantAvailabilityInput {
  const row = record(value, ['acceptingOrders'], invalidInput);
  return { acceptingOrders: boolean(row.acceptingOrders, invalidInput) };
}

export function parseMerchantWorkspaceDetail(
  value: unknown,
  identity?: NuniMerchantWorkspaceIdentity,
): NuniMerchantWorkspaceDetail {
  const row = record(
    value,
    [
      'tenantId',
      'tenantName',
      'applicationId',
      'merchantId',
      'merchantName',
      'merchantStatus',
      'locationId',
      'locationName',
      'locationStatus',
      'publicAccess',
      'campusId',
      'campusName',
      'serviceModes',
      'paymentMode',
      'onlinePaymentAvailable',
      'paymentCapabilityState',
      'managerConfirmed',
      'termsVersion',
      'activated',
      'readinessVersion',
      'publishedMenuItems',
      'merchantMode',
      'merchantModeLabel',
      'sourceLabel',
      'sourceUpdatedAt',
      'sourceLine',
      'missingRequirements',
    ],
    invalidResponse,
  );
  const base = parseMerchantWorkspaces({ workspaces: [row] })[0];
  if (identity && (base.tenantId !== identity.tenantId || base.locationId !== identity.locationId))
    return invalidResponse();
  choice(base.merchantStatus, ['active', 'suspended'], invalidResponse);
  choice(base.locationStatus, ['open', 'closed', 'suspended'], invalidResponse);
  if (
    base.missingRequirements.some((item) => !['settings', 'menu', 'online-payment'].includes(item))
  )
    return invalidResponse();
  const sourceUpdatedAt =
    row.sourceUpdatedAt === null ? null : text(row.sourceUpdatedAt, 10, 10, invalidResponse);
  if (
    sourceUpdatedAt !== null &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(sourceUpdatedAt) ||
      !Number.isFinite(Date.parse(sourceUpdatedAt)) ||
      new Date(sourceUpdatedAt).toISOString().slice(0, 10) !== sourceUpdatedAt)
  )
    return invalidResponse();
  return {
    ...base,
    applicationId: text(row.applicationId, 1, 100, invalidResponse),
    merchantId: text(row.merchantId, 1, 120, invalidResponse),
    campusId: row.campusId === null ? null : text(row.campusId, 1, 64, invalidResponse),
    serviceModes: modes(row.serviceModes, invalidResponse),
    paymentMode: choice(row.paymentMode, paymentModes, invalidResponse),
    onlinePaymentAvailable: boolean(row.onlinePaymentAvailable, invalidResponse),
    paymentCapabilityState: choice(
      row.paymentCapabilityState,
      ['not-requested', 'pending', 'active', 'restricted'],
      invalidResponse,
    ),
    managerConfirmed: boolean(row.managerConfirmed, invalidResponse),
    termsVersion: row.termsVersion === null ? null : text(row.termsVersion, 1, 40, invalidResponse),
    readinessVersion: integer(row.readinessVersion, 1, Number.MAX_SAFE_INTEGER, invalidResponse),
    publishedMenuItems: integer(
      row.publishedMenuItems,
      0,
      Number.MAX_SAFE_INTEGER,
      invalidResponse,
    ),
    merchantMode: choice(row.merchantMode, ['full', 'showcase_link', 'info_only'], invalidResponse),
    merchantModeLabel: text(row.merchantModeLabel, 1, 100, invalidResponse),
    sourceLabel: text(row.sourceLabel, 0, 1000, invalidResponse),
    sourceUpdatedAt,
    sourceLine: row.sourceLine === null ? null : text(row.sourceLine, 0, 1200, invalidResponse),
  };
}

export function parseMerchantInitialMenuReceipt(
  value: unknown,
  expectedItems?: number,
): NuniMerchantInitialMenuReceipt {
  const row = record(value, ['menuVersionId', 'createdItems'], invalidResponse);
  const menuVersionId = text(row.menuVersionId, 1, 100, invalidResponse);
  if (
    !/^food-menu_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(menuVersionId)
  )
    return invalidResponse();
  const createdItems = integer(row.createdItems, 1, 100, invalidResponse);
  if (expectedItems !== undefined && createdItems !== expectedItems) return invalidResponse();
  return { menuVersionId, createdItems };
}

export function createMerchantOperations(transport: NuniMerchantOperationsTransport) {
  function scope(tenantId: string, locationId: string) {
    const identity = validateMerchantWorkspaceIdentity({ tenantId, locationId });
    return { identity, path: `merchant-workspaces/${identity.tenantId}/${identity.locationId}` };
  }
  return {
    async get(tenantId: string, locationId: string) {
      const { identity, path } = scope(tenantId, locationId);
      return parseMerchantWorkspaceDetail(await transport(path), identity);
    },
    async updateSettings(tenantId: string, locationId: string, value: unknown) {
      const { identity, path } = scope(tenantId, locationId);
      const input = validateMerchantSettingsInput(value);
      const receipt = parseMerchantWorkspaceDetail(
        await transport(`${path}/settings`, input, 'PUT'),
        identity,
      );
      if (
        !receipt.managerConfirmed ||
        receipt.termsVersion !== input.termsVersion ||
        receipt.paymentMode !== input.paymentMode ||
        receipt.readinessVersion !== input.expectedVersion + 1 ||
        receipt.serviceModes.length !== input.serviceModes.length ||
        input.serviceModes.some((mode) => !receipt.serviceModes.includes(mode))
      )
        return invalidResponse();
      return receipt;
    },
    async createInitialMenu(tenantId: string, locationId: string, value: unknown) {
      const { path } = scope(tenantId, locationId);
      const input = validateMerchantInitialMenuInput(value);
      // The provider has no idempotency key here. Callers must read the workspace after an unknown result.
      return parseMerchantInitialMenuReceipt(
        await transport(`${path}/initial-menu`, input),
        input.items.length,
      );
    },
    async activate(tenantId: string, locationId: string) {
      const { identity, path } = scope(tenantId, locationId);
      const receipt = parseMerchantWorkspaceDetail(
        await transport(`${path}/activate`, {}),
        identity,
      );
      // A repeated activation returns the current workspace, including a subsequently paused store.
      if (!receipt.activated) return invalidResponse();
      return receipt;
    },
    async setAvailability(tenantId: string, locationId: string, acceptingOrders: boolean) {
      const { identity, path } = scope(tenantId, locationId);
      const input = validateMerchantAvailabilityInput({ acceptingOrders });
      const receipt = parseMerchantWorkspaceDetail(
        await transport(`${path}/availability`, input),
        identity,
      );
      if (
        !receipt.activated ||
        receipt.publicAccess !== input.acceptingOrders ||
        receipt.locationStatus !== (input.acceptingOrders ? 'open' : 'closed')
      )
        return invalidResponse();
      return receipt;
    },
  };
}
