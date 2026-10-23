import { NuniError } from './nuni';
import type * as T from './nuniFoodTypes';
export * from './nuniFoodTypes';

export type NuniFoodTransport = (
  path: string,
  input?: Record<string, unknown>,
  query?: Record<string, string>,
) => Promise<unknown>;
export const NUNI_FOOD_LIMITS = {
  maxQuoteLines: 20,
  maxQuantityPerLine: 20,
  maxOptions: 20,
} as const;

type Fail = () => never;
type Parser<T> = (value: unknown, fail: Fail) => T;
const invalidInput: Fail = () => {
  throw new NuniError(422, 'INVALID_INPUT');
};
const invalidResponse: Fail = () => {
  throw new NuniError(502, 'INVALID_RESPONSE');
};
function string(min = 0, max = 8000, trim = false): Parser<string> {
  return (value, fail) => {
    if (typeof value !== 'string') return fail();
    const parsed = trim ? value.trim() : value;
    if (parsed.length < min || parsed.length > max || (min > 0 && !parsed.trim())) return fail();
    return parsed;
  };
}
function integer(min = 0, max = Number.MAX_SAFE_INTEGER): Parser<number> {
  return (value, fail) =>
    Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
      ? Number(value)
      : fail();
}
const bool: Parser<boolean> = (value, fail) => (typeof value === 'boolean' ? value : fail());
function choice<const V extends readonly string[]>(values: V): Parser<V[number]> {
  return (value, fail) => (typeof value === 'string' && values.includes(value) ? value : fail());
}
function optional<V>(parser: Parser<V>): Parser<V | undefined> {
  return (value, fail) => (value === undefined ? undefined : parser(value, fail));
}
function nullable<V>(parser: Parser<V>): Parser<V | null> {
  return (value, fail) => (value === null ? null : parser(value, fail));
}
function array<V>(parser: Parser<V>, max = 5000, min = 0): Parser<V[]> {
  return (value, fail) => {
    if (!Array.isArray(value) || value.length < min || value.length > max) return fail();
    return value.map((item) => parser(item, fail));
  };
}
function object<V>(fields: Record<string, Parser<unknown>>): Parser<V> {
  return (value, fail) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some((key) => !Object.hasOwn(fields, key))) return fail();
    const result: Record<string, unknown> = {};
    for (const [key, parser] of Object.entries(fields)) {
      const parsed = parser(row[key], fail);
      if (parsed !== undefined) result[key] = parsed;
    }
    return result as V;
  };
}
const id = string(1, 100);
const pathId: Parser<string> = (value, fail) => {
  const parsed = id(value, fail);
  return /^[A-Za-z0-9_-]+$/.test(parsed) ? parsed : fail();
};
const tenantId: Parser<string> = (value, fail) => {
  const parsed = string(2, 200)(value, fail);
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(parsed) ? parsed : fail();
};
const inputDate: Parser<string> = (value, fail) => {
  const parsed = string(20, 40)(value, fail);
  return /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
    parsed,
  ) &&
    day(parsed.slice(0, 10), fail) &&
    Number.isFinite(Date.parse(parsed))
    ? parsed
    : fail();
};
const date: Parser<string> = (value, fail) => {
  // The API also projects PostgreSQL ::text timestamps. Normalize those explicitly for Hermes.
  const parsed = string(20, 40)(value, fail);
  const postgres =
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d{1,6})?([+-]\d{2})(?::(\d{2}))?$/.exec(parsed);
  if (!postgres) return inputDate(parsed, fail);
  const iso = `${postgres[1]}T${postgres[2]}${postgres[3] ?? ''}${postgres[4]}:${postgres[5] ?? '00'}`;
  return new Date(inputDate(iso, fail)).toISOString();
};
const day: Parser<string> = (value, fail) => {
  const parsed = string(10, 10)(value, fail);
  return /^\d{4}-\d{2}-\d{2}$/.test(parsed) &&
    Number.isFinite(Date.parse(parsed)) &&
    new Date(parsed).toISOString().slice(0, 10) === parsed
    ? parsed
    : fail();
};
const url: Parser<string> = (value, fail) => {
  const parsed = string(1, 4000)(value, fail);
  try {
    const url = new URL(parsed);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return fail();
    return parsed;
  } catch {
    return fail();
  }
};
const token: Parser<string> = (value, fail) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{32,512}$/.test(value) ? value : fail();
const key = string(8, 100);
const orderStates = [
  'payment-pending',
  'paid',
  'accepted',
  'cancellation-pending-refund',
  'rejection-pending-refund',
  'rejected',
  'preparing',
  'ready',
  'fulfilled',
  'canceled',
  'payment-expired',
] as const;
const queueStates = [
  'payment-pending',
  'paid',
  'accepted',
  'preparing',
  'ready',
  'cancellation-pending-refund',
  'rejection-pending-refund',
] as const;
const cancelReasons = [
  'ordered-by-mistake',
  'changed-mind',
  'pickup-time-no-longer-works',
  'other',
] as const;
const rejectReasons = [
  'item-unavailable',
  'location-closed',
  'preparation-capacity',
  'payment-problem',
  'other',
] as const;
const customerActions = ['create-payment-session', 'cancel', 'show-pickup-credential'] as const;
const staffActions = [
  'record-counter-payment',
  'accept',
  'reject',
  'confirm-counter-refund',
  'start-preparation',
  'cancel-accepted',
  'mark-ready',
  'fulfill-pickup',
] as const;
const station = choice(['hot', 'cold', 'drinks', 'combo']);
const money = object<T.NuniFoodMoney>({ amountMinor: integer(), currency: choice(['TWD']) });
const cursor = optional(string(1, 500));
const realm = object<T.NuniFoodRealm>({
  tenantId,
  name: string(1),
  services: array(choice(['food', 'social']), 2),
});
const orderRealm = object<T.NuniFoodOrderRealm>({ tenantId, name: string(1) });
const location = object<T.NuniFoodLocationSummary>({
  id,
  campusId: string(0, 100),
  name: string(1),
  description: string(),
  zoneLabel: string(),
  timeZone: choice(['Asia/Taipei']),
  state: choice(['open', 'paused', 'closed']),
  earliestPickupAt: optional(date),
  latestPickupAt: optional(date),
  merchantMode: choice(['full', 'showcase_link', 'info_only']),
  sourceLabel: string(),
  sourceUpdatedAt: nullable(day),
  sourceUrl: optional(url),
  externalOrderUrl: optional(url),
  allowedActions: array(choice(['view-menu']), 1),
});
const nutrition: Parser<T.NuniFoodNutrition> = (value, fail) => {
  if (!value || typeof value !== 'object') return fail();
  if ((value as Record<string, unknown>).declared === false) {
    return object<T.NuniFoodNutrition>({ declared: (v, f) => (v === false ? false : f()) })(
      value,
      fail,
    );
  }
  return object<T.NuniFoodNutrition>({
    declared: (v, f) => (v === true ? true : f()),
    basis: choice(['per-serving']),
    caloriesKcal: integer(0, 10000),
    proteinMg: integer(0, 1000000),
    fatMg: integer(0, 1000000),
    carbohydrateMg: integer(0, 1000000),
    sodiumMg: integer(0, 1000000),
    sugarMg: integer(0, 1000000),
    declaredAt: date,
  })(value, fail);
};
const option = object<T.NuniFoodMenuOption>({
  id,
  name: string(1),
  priceDelta: money,
  available: bool,
});
const optionGroup: Parser<T.NuniFoodMenuOptionGroup> = (value, fail) => {
  const parsed = object<T.NuniFoodMenuOptionGroup>({
    id,
    name: string(1),
    minimumSelections: integer(),
    maximumSelections: integer(),
    options: array(option),
  })(value, fail);
  if (parsed.minimumSelections > parsed.maximumSelections) return fail();
  return parsed;
};
const menuItem = object<T.NuniFoodMenuItem>({
  id,
  name: string(1),
  description: string(),
  imageUrl: optional(url),
  basePrice: money,
  available: bool,
  dietaryTags: array(string()),
  allergenTags: array(string()),
  nutrition,
  optionGroups: array(optionGroup),
  allowedActions: array(choice(['add-to-quote']), 1),
});
const lineFields = {
  menuItemId: id,
  nameSnapshot: string(1),
  quantity: integer(1, 20),
  customerNote: optional(string(0, 300)),
  selectedOptions: array(object({ optionId: id, nameSnapshot: string(1), priceDelta: money }), 20),
  unitPrice: money,
  lineTotal: money,
};
const line: Parser<T.NuniFoodQuoteLine> = (value, fail) => {
  const parsed = object<T.NuniFoodQuoteLine>(lineFields)(value, fail);
  if (parsed.unitPrice.amountMinor * parsed.quantity !== parsed.lineTotal.amountMinor)
    return fail();
  return parsed;
};
const quote = object<T.NuniFoodQuoteProjection>({
  id,
  locationId: id,
  menuVersion: id,
  state: choice(['active', 'expired', 'consumed']),
  requestedPickupAt: date,
  tableSessionId: optional(id),
  tableCode: optional(string(1, 32)),
  lines: array(line, 20, 1),
  subtotal: money,
  fees: array(object({ code: string(1), label: string(1), amount: money })),
  total: money,
  expiresAt: date,
  allowedActions: array(choice(['create-order', 'refresh-quote']), 2),
});
const paymentFields = object<T.NuniFoodPaymentSessionProjection>({
  id,
  orderId: id,
  progress: choice([
    'opening',
    'awaiting-payment',
    'awaiting-offline-payment',
    'authorized-awaiting-settlement',
    'paid',
    'refunding',
    'refunded',
    'failed',
    'canceled',
    'expired',
  ]),
  method: choice(['credit-card', 'mobile-pay']),
  checkoutUrl: (value, fail) => (value === '' ? '' : url(value, fail)),
  expiresAt: date,
  failureReason: optional(string(1)),
  allowedActions: array(choice(['open-checkout', 'start-over']), 2),
});
const payment: Parser<T.NuniFoodPaymentSessionProjection> = (value, fail) => {
  const result = paymentFields(value, fail);
  if (
    result.allowedActions.includes('open-checkout') &&
    (!result.checkoutUrl || result.progress !== 'awaiting-payment')
  )
    return fail();
  return result;
};
const paymentMethods = object<T.NuniFoodPaymentMethodsProjection>({
  methods: array(
    object({
      method: choice(['credit-card', 'mobile-pay']),
      label: string(1),
      available: bool,
      unavailableMessage: optional(string(1)),
      refundRoute: choice(['in-app', 'staff-handled', 'none']),
      settlesImmediately: bool,
    }),
    2,
  ),
  unavailableMessage: optional(string(1)),
});
const pickup: Parser<T.NuniFoodPickupProjection> = (value, fail) => {
  const parsed = object<T.NuniFoodPickupProjection>({
    state: choice(['awaiting-preparation', 'preparing', 'ready', 'fulfilled']),
    displayCode: string(1, 100),
    readyAt: optional(date),
    fulfilledAt: optional(date),
    credential: optional(object({ kind: choice(['one-time-token']), token, expiresAt: date })),
    calls: array(object({ sequence: integer(1), calledAt: date }), 20),
    callCount: integer(),
    lastCalledAt: optional(date),
    allowedActions: array(choice(['present-one-time-token']), 1),
  })(value, fail);
  if (
    parsed.callCount < parsed.calls.length ||
    (parsed.callCount === 0) !== (parsed.lastCalledAt === undefined)
  )
    return fail();
  if (
    parsed.credential &&
    (parsed.state !== 'ready' || !parsed.allowedActions.includes('present-one-time-token'))
  )
    return fail();
  if (parsed.allowedActions.includes('present-one-time-token') && !parsed.credential) return fail();
  return parsed;
};
const summaryFields = {
  id,
  locationId: id,
  locationName: string(),
  state: choice(orderStates),
  requestedPickupAt: date,
  itemCount: integer(1, 400),
  total: money,
  createdAt: date,
  updatedAt: date,
  allowedActions: array(choice(customerActions), 3),
};
const summary = object<T.NuniFoodCustomerOrderSummary>(summaryFields);
const detail = object<T.NuniFoodCustomerOrderDetail>({
  ...summaryFields,
  quoteId: id,
  lines: array(line, 20, 1),
  paymentSession: optional(payment),
  pickup,
  // cancelAcceptedOrder persists a staff reason in the same cancellation history projection.
  cancellation: optional(
    object({
      reason: choice([...cancelReasons, ...rejectReasons]),
      reasonDetail: optional(string()),
      requestedAt: date,
    }),
  ),
  rejection: optional(
    object({ reason: choice(rejectReasons), reasonDetail: optional(string()), decidedAt: date }),
  ),
  refund: optional(
    object({
      state: choice(['pending', 'completed']),
      amount: money,
      requestedAt: date,
      completedAt: optional(date),
    }),
  ),
});
const ticket = object<T.NuniFoodKitchenTicketProjection>({
  id,
  station,
  state: choice(['queued', 'preparing', 'ready', 'fulfilled', 'cancelled']),
  allowedActions: array(choice(['start-preparation', 'mark-ready']), 2),
});
const queueFields = {
  id,
  kitchenTicketId: optional(id),
  kitchenTickets: optional(array(ticket)),
  locationId: id,
  tableSessionId: optional(id),
  tableCode: optional(string(1, 32)),
  shiftId: optional(id),
  origin: optional(choice(['customer', 'pos'])),
  state: choice(queueStates),
  requestedPickupAt: date,
  pickupDisplayCode: string(1, 100),
  allowedActions: array(choice(staffActions), 9),
};
const queueItem: Parser<T.NuniFoodStaffOrderQueueItem> = (value, fail) => {
  if (!value || typeof value !== 'object') return fail();
  if ((value as Record<string, unknown>).viewerScope === 'kitchen') {
    return object<T.NuniFoodKitchenOrderQueueItem>({
      ...queueFields,
      viewerScope: choice(['kitchen']),
      lines: array(
        object({
          menuItemId: id,
          nameSnapshot: string(1),
          quantity: integer(1, 20),
          selectedOptions: array(object({ optionId: id, nameSnapshot: string(1) }), 20),
          customerNote: optional(string(0, 300)),
        }),
        20,
        1,
      ),
    })(value, fail);
  }
  return object<T.NuniFoodCashRegisterOrderQueueItem>({
    ...queueFields,
    viewerScope: choice(['cash-register']),
    lines: array(line, 20, 1),
    total: money,
    paidAt: optional(date),
    paymentChannel: optional(choice(['cash', 'campus-ledger', 'counter', 'demo', 'online'])),
    qualificationDiscount: optional(object({ label: choice(['資格折扣']), amount: money })),
  })(value, fail);
};
const command = object<T.NuniFoodOrderCommandResult>({
  orderId: id,
  state: choice(orderStates),
  updatedAt: date,
  replayed: bool,
});
const acceptReceipt = object<T.NuniFoodAcceptReceipt>({
  orderId: id,
  state: choice(['accepted']),
  updatedAt: date,
  replayed: bool,
  kitchenTicketId: id,
});
const fulfillment = object<T.NuniFoodPickupFulfillmentResult>({
  orderId: id,
  state: choice(['fulfilled']),
  fulfilledAt: date,
  replayed: bool,
});
const shift = object<T.NuniFoodShiftProjection>({
  id,
  locationId: id,
  state: choice(['open', 'closed']),
  openedAt: date,
  closedAt: optional(date),
  openingCash: money,
  countedCash: optional(money),
  expectedCash: optional(money),
  campusLedgerTotal: money,
  allowedActions: array(choice(['handover', 'view']), 2),
});

export function parseNuniFoodMoney(value: unknown) {
  return money(value, invalidResponse);
}
export function parseNuniFoodRealms(value: unknown) {
  return object<{ realms: T.NuniFoodRealm[] }>({ realms: array(realm) })(value, invalidResponse)
    .realms;
}
export function parseNuniFoodOrderRealms(value: unknown) {
  return object<{ realms: T.NuniFoodOrderRealm[] }>({ realms: array(orderRealm) })(
    value,
    invalidResponse,
  ).realms;
}
export function parseNuniFoodLocations(value: unknown) {
  return object<T.NuniFoodLocationListResponse>({
    locations: array(location, 100),
    nextCursor: cursor,
  })(value, invalidResponse);
}
export function parseNuniFoodMenu(value: unknown, expectedLocationId?: string) {
  const result = object<T.NuniFoodMenuProjection>({
    location,
    menuVersion: id,
    generatedAt: date,
    sections: array(object({ id, name: string(1), items: array(menuItem) })),
  })(value, invalidResponse);
  if (expectedLocationId !== undefined && result.location.id !== expectedLocationId)
    return invalidResponse();
  return result;
}
export function parseNuniFoodQuote(value: unknown, expectedLocationId?: string) {
  const result = quote(value, invalidResponse);
  if (expectedLocationId !== undefined && result.locationId !== expectedLocationId)
    return invalidResponse();
  if (
    result.lines.reduce((sum, item) => sum + item.lineTotal.amountMinor, 0) !==
    result.subtotal.amountMinor
  )
    return invalidResponse();
  return result;
}
export function parseNuniFoodPaymentMethods(value: unknown) {
  return paymentMethods(value, invalidResponse);
}
export function parseNuniFoodPayment(value: unknown, expectedOrderId?: string) {
  const result = payment(value, invalidResponse);
  if (expectedOrderId !== undefined && result.orderId !== expectedOrderId) return invalidResponse();
  return result;
}
export function parseNuniFoodOrders(value: unknown) {
  return object<T.NuniFoodCustomerOrderListResponse>({
    orders: array(summary, 100),
    nextCursor: cursor,
  })(value, invalidResponse);
}
export function parseNuniFoodOrder(value: unknown, expectedOrderId?: string) {
  const result = detail(value, invalidResponse);
  if (expectedOrderId !== undefined && result.id !== expectedOrderId) return invalidResponse();
  if (result.paymentSession && result.paymentSession.orderId !== result.id)
    return invalidResponse();
  if (result.itemCount !== result.lines.reduce((sum, item) => sum + item.quantity, 0))
    return invalidResponse();
  return result;
}
export function parseNuniFoodMerchantOrders(value: unknown, expectedLocationId?: string) {
  const result = object<T.NuniFoodStaffOrderQueueResponse>({
    orders: array(queueItem, 100),
    nextCursor: cursor,
  })(value, invalidResponse);
  if (
    expectedLocationId !== undefined &&
    result.orders.some((order) => order.locationId !== expectedLocationId)
  )
    return invalidResponse();
  return result;
}
export function parseNuniFoodOrderCommand(value: unknown, expectedOrderId?: string) {
  const result = command(value, invalidResponse);
  if (expectedOrderId !== undefined && result.orderId !== expectedOrderId) return invalidResponse();
  return result;
}
export function parseNuniFoodAcceptReceipt(value: unknown, expectedOrderId?: string) {
  const result = acceptReceipt(value, invalidResponse);
  if (expectedOrderId !== undefined && result.orderId !== expectedOrderId) return invalidResponse();
  return result;
}
export function parseNuniFoodShift(value: unknown, expectedLocationId?: string) {
  const result = shift(value, invalidResponse);
  if (expectedLocationId !== undefined && result.locationId !== expectedLocationId)
    return invalidResponse();
  if (
    result.state === 'closed' &&
    (!result.closedAt || !result.countedCash || !result.expectedCash)
  )
    return invalidResponse();
  return result;
}

export function validateNuniFoodKeyInput(value: unknown) {
  return object<T.NuniFoodKeyInput>({ idempotencyKey: key })(value, invalidInput);
}
export function validateNuniFoodQuoteInput(value: unknown) {
  return object<T.NuniFoodQuoteInput>({
    locationId: pathId,
    requestedPickupAt: inputDate,
    tableCode: optional(string(1, 32, true)),
    idempotencyKey: key,
    items: array(
      object({
        menuItemId: pathId,
        quantity: integer(1, 20),
        selectedOptionIds: (v, f) => (v === undefined ? [] : array(pathId, 20)(v, f)),
        customerNote: optional(string(0, 300, true)),
      }),
      20,
      1,
    ),
  })(value, invalidInput);
}
export function validateNuniFoodCreateOrderInput(value: unknown) {
  return object<T.NuniFoodCreateOrderInput>({ quoteId: pathId, idempotencyKey: key })(
    value,
    invalidInput,
  );
}
function reasonInput<R extends T.NuniFoodCustomerCancelReason | T.NuniFoodStaffRejectReason>(
  value: unknown,
  reasons: readonly R[],
) {
  const result = object<{ reason: R; reasonDetail?: string; idempotencyKey: string }>({
    reason: choice(reasons),
    reasonDetail: optional(string(3, 500, true)),
    idempotencyKey: key,
  })(value, invalidInput);
  if (result.reason === 'other' && !result.reasonDetail) return invalidInput();
  return result;
}
export function validateNuniFoodCancelInput(value: unknown): T.NuniFoodCancelInput {
  return reasonInput(value, cancelReasons);
}
export function validateNuniFoodRejectInput(value: unknown): T.NuniFoodRejectInput {
  return reasonInput(value, rejectReasons);
}
export function validateNuniFoodPaymentInput(value: unknown) {
  return object<T.NuniFoodPaymentInput>({
    method: choice(['credit-card', 'mobile-pay']),
    idempotencyKey: key,
  })(value, invalidInput);
}
export function validateNuniFoodOpenShiftInput(value: unknown) {
  return object<T.NuniFoodOpenShiftInput>({
    openingCashMinor: integer(0, 10000000),
    idempotencyKey: key,
  })(value, invalidInput);
}
export function validateNuniFoodHandoverInput(value: unknown) {
  const result = object<T.NuniFoodHandoverInput>({
    countedCashMinor: integer(0, 10000000),
    note: optional(string(1, 300, true)),
    openNext: bool,
    nextOpeningCashMinor: optional(integer(0, 10000000)),
    idempotencyKey: key,
  })(value, invalidInput);
  if (result.openNext && result.nextOpeningCashMinor === undefined) return invalidInput();
  return result;
}
export function validateNuniFoodFulfillInput(value: unknown) {
  return object<T.NuniFoodFulfillInput>({ pickupToken: token, idempotencyKey: key })(
    value,
    invalidInput,
  );
}
const queryLimit = optional<number>((value, fail) => {
  if (typeof value === 'string' && /^[1-9]\d{0,2}$/.test(value))
    return integer(1, 100)(Number(value), fail);
  return integer(1, 100)(value, fail);
});
const queryBoolean = optional<boolean>((value, fail) =>
  value === 'true' ? true : value === 'false' ? false : bool(value, fail),
);
function queryRecord(
  value: unknown,
  fields: Record<string, Parser<unknown>>,
): Record<string, string> {
  const parsed = object<Record<string, unknown>>({ limit: queryLimit, cursor, ...fields })(
    value ?? {},
    invalidInput,
  );
  // The provider uses z.coerce.boolean(): the string "false" becomes true. Omit false.
  return Object.fromEntries(
    Object.entries(parsed)
      .filter(([, v]) => v !== false)
      .map(([key, v]) => [key, String(v)]),
  );
}
export function validateNuniFoodLocationQuery(value: unknown) {
  return queryRecord(value, { campusId: optional(pathId) });
}
export function validateNuniFoodOrderQuery(value: unknown) {
  return queryRecord(value, { state: optional(choice(orderStates)) });
}
export function validateNuniFoodMerchantOrderQuery(value: unknown) {
  return queryRecord(value, {
    state: optional(choice(queueStates)),
    station: optional(station),
    shiftId: optional(pathId),
    currentShiftOnly: queryBoolean,
  });
}

/** One request per call. An uncertain mutation must be retried with the original key and payload. */
export function createNuniFoodClient(transport: NuniFoodTransport) {
  const realmPath = (tenant: string) => `realms/${tenantId(tenant, invalidInput)}/food`;
  const merchantPath = (tenant: string, location: string) =>
    `merchant-workspaces/${tenantId(tenant, invalidInput)}/${pathId(location, invalidInput)}`;
  async function mutateOrder(
    path: string,
    input: Record<string, unknown>,
    expectedOrderId: string | undefined,
    states: readonly T.NuniFoodOrderState[],
  ) {
    const result = parseNuniFoodOrderCommand(await transport(path, input), expectedOrderId);
    if (!states.includes(result.state)) return invalidResponse();
    return result;
  }
  const orderPath = (tenant: string, location: string, order: string) =>
    `${merchantPath(tenant, location)}/orders/${pathId(order, invalidInput)}`;
  return {
    async listRealms() {
      return parseNuniFoodRealms(await transport('realms'));
    },
    async listOrderRealms() {
      return parseNuniFoodOrderRealms(await transport('food-order-realms'));
    },
    async listLocations(tenant: string, query?: unknown) {
      return parseNuniFoodLocations(
        await transport(
          `${realmPath(tenant)}/locations`,
          undefined,
          validateNuniFoodLocationQuery(query),
        ),
      );
    },
    async getMenu(tenant: string, location: string) {
      return parseNuniFoodMenu(
        await transport(`${realmPath(tenant)}/locations/${pathId(location, invalidInput)}/menu`),
        location,
      );
    },
    async getPaymentMethods(tenant: string, location: string) {
      return parseNuniFoodPaymentMethods(
        await transport(
          `${realmPath(tenant)}/locations/${pathId(location, invalidInput)}/payment-methods`,
        ),
      );
    },
    async createQuote(tenant: string, value: unknown) {
      const path = `${realmPath(tenant)}/quotes`;
      const input = validateNuniFoodQuoteInput(value);
      const result = parseNuniFoodQuote(await transport(path, input), input.locationId);
      if (
        Date.parse(result.requestedPickupAt) !== Date.parse(input.requestedPickupAt) ||
        result.lines.length !== input.items.length
      )
        return invalidResponse();
      for (let i = 0; i < input.items.length; i++) {
        const sent = input.items[i];
        const received = result.lines[i];
        if (
          sent.menuItemId !== received.menuItemId ||
          sent.quantity !== received.quantity ||
          (sent.customerNote ?? '') !== (received.customerNote ?? '') ||
          JSON.stringify([...(sent.selectedOptionIds ?? [])].sort()) !==
            JSON.stringify(received.selectedOptions.map((v) => v.optionId).sort())
        )
          return invalidResponse();
      }
      return result;
    },
    async createOrder(tenant: string, value: unknown) {
      return mutateOrder(
        `${realmPath(tenant)}/orders`,
        validateNuniFoodCreateOrderInput(value),
        undefined,
        ['payment-pending'],
      );
    },
    async listOrders(tenant: string, query?: unknown) {
      return parseNuniFoodOrders(
        await transport(
          `${realmPath(tenant)}/orders`,
          undefined,
          validateNuniFoodOrderQuery(query),
        ),
      );
    },
    async getOrder(tenant: string, order: string) {
      return parseNuniFoodOrder(
        await transport(`${realmPath(tenant)}/orders/${pathId(order, invalidInput)}`),
        order,
      );
    },
    async cancelOrder(tenant: string, order: string, value: unknown) {
      return mutateOrder(
        `${realmPath(tenant)}/orders/${pathId(order, invalidInput)}/cancel`,
        validateNuniFoodCancelInput(value),
        order,
        ['canceled', 'cancellation-pending-refund'],
      );
    },
    async createPaymentSession(tenant: string, order: string, value: unknown) {
      const input = validateNuniFoodPaymentInput(value);
      const result = parseNuniFoodPayment(
        await transport(
          `${realmPath(tenant)}/orders/${pathId(order, invalidInput)}/payment-session`,
          input,
        ),
        order,
      );
      if (result.method !== input.method) return invalidResponse();
      return result;
    },
    async listMerchantOrders(tenant: string, location: string, query?: unknown) {
      return parseNuniFoodMerchantOrders(
        await transport(
          `${merchantPath(tenant, location)}/orders`,
          undefined,
          validateNuniFoodMerchantOrderQuery(query),
        ),
        location,
      );
    },
    async getShift(tenant: string, location: string) {
      const result = parseNuniFoodShift(
        await transport(`${merchantPath(tenant, location)}/shift`),
        location,
      );
      if (result.state !== 'open') return invalidResponse();
      return result;
    },
    async openShift(tenant: string, location: string, value: unknown) {
      const path = `${merchantPath(tenant, location)}/shift`;
      const input = validateNuniFoodOpenShiftInput(value);
      const result = parseNuniFoodShift(await transport(path, input), location);
      if (result.state !== 'open' || result.openingCash.amountMinor !== input.openingCashMinor)
        return invalidResponse();
      return result;
    },
    async handoverShift(tenant: string, location: string, value: unknown) {
      const path = `${merchantPath(tenant, location)}/shift/handover`;
      const input = validateNuniFoodHandoverInput(value);
      const result = object<T.NuniFoodHandoverReceipt>({ closed: shift, next: optional(shift) })(
        await transport(path, input),
        invalidResponse,
      );
      parseNuniFoodShift(result.closed, location);
      if (
        result.closed.state !== 'closed' ||
        result.closed.countedCash?.amountMinor !== input.countedCashMinor ||
        Boolean(result.next) !== input.openNext
      )
        return invalidResponse();
      if (
        result.next &&
        (result.next.locationId !== location ||
          result.next.state !== 'open' ||
          result.next.id === result.closed.id ||
          result.next.openingCash.amountMinor !== input.nextOpeningCashMinor)
      )
        return invalidResponse();
      return result;
    },
    async recordCounterPayment(tenant: string, location: string, order: string, value: unknown) {
      return mutateOrder(
        `${orderPath(tenant, location, order)}/counter-payment`,
        validateNuniFoodKeyInput(value),
        order,
        ['paid'],
      );
    },
    async acceptOrder(tenant: string, location: string, order: string, value: unknown) {
      return parseNuniFoodAcceptReceipt(
        await transport(
          `${orderPath(tenant, location, order)}/accept`,
          validateNuniFoodKeyInput(value),
        ),
        order,
      );
    },
    async rejectOrder(tenant: string, location: string, order: string, value: unknown) {
      return mutateOrder(
        `${orderPath(tenant, location, order)}/reject`,
        validateNuniFoodRejectInput(value),
        order,
        ['rejected', 'rejection-pending-refund'],
      );
    },
    async cancelAcceptedOrder(tenant: string, location: string, order: string, value: unknown) {
      return mutateOrder(
        `${orderPath(tenant, location, order)}/cancel-accepted`,
        validateNuniFoodRejectInput(value),
        order,
        ['canceled', 'cancellation-pending-refund'],
      );
    },
    async confirmCounterRefund(tenant: string, location: string, order: string, value: unknown) {
      return mutateOrder(
        `${orderPath(tenant, location, order)}/confirm-counter-refund`,
        validateNuniFoodKeyInput(value),
        order,
        ['canceled', 'rejected'],
      );
    },
    async startTicket(
      tenant: string,
      location: string,
      order: string | undefined,
      ticket: string,
      value: unknown,
    ) {
      if (order !== undefined) pathId(order, invalidInput);
      return mutateOrder(
        `${merchantPath(tenant, location)}/kitchen-tickets/${pathId(ticket, invalidInput)}/start`,
        validateNuniFoodKeyInput(value),
        order,
        ['preparing'],
      );
    },
    async readyTicket(
      tenant: string,
      location: string,
      order: string | undefined,
      ticket: string,
      value: unknown,
    ) {
      if (order !== undefined) pathId(order, invalidInput);
      return mutateOrder(
        `${merchantPath(tenant, location)}/kitchen-tickets/${pathId(ticket, invalidInput)}/ready`,
        validateNuniFoodKeyInput(value),
        order,
        ['preparing', 'ready'],
      );
    },
    async fulfillOrder(tenant: string, location: string, order: string, value: unknown) {
      const result = fulfillment(
        await transport(
          `${orderPath(tenant, location, order)}/fulfill`,
          validateNuniFoodFulfillInput(value),
        ),
        invalidResponse,
      );
      if (result.orderId !== order) return invalidResponse();
      return result;
    },
  };
}

export type NuniFoodClient = ReturnType<typeof createNuniFoodClient>;
