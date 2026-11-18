import { randomBytes } from 'node:crypto';
import { fixtureAdapter, FIXTURE_SECRET } from '../../../apps/web/src/lib/nuni/assistantV2/fixtures';
import { V2Error } from '../../../apps/web/src/lib/nuni/assistantV2/contracts';
import { sessionContext, type PlatformSession } from '../../../apps/web/src/lib/nuni/server';
import { orderFixture, orderSummary } from '../../../apps/web/src/features/food/foodTestFixtures';
import { createNuniFoodClient } from '../../../packages/shared/src/nuniFood';

export const SCHOOL = 'fixture-school';
export const TENANT = 'selected-realm';
export const ORDER = 'selected-order';
export const SECRET = FIXTURE_SECRET;
let serial = 0;
const freshOrder = () => ({ ...orderFixture(), id: ORDER, state: 'preparing' as const,
  locationName: '合成午餐店', requestedPickupAt: '2099-10-13T04:00:00.000Z', allowedActions: [] });
function fresh() {
  const database = fixtureAdapter();
  const account = 'pa_50000000-0000-4000-8000-' + String(++serial).padStart(12, '0');
  const session = { sessionHandle: 'ps_' + randomBytes(32).toString('base64url'), expiresAt: Date.now() + 3600000 };
  const state = { database, account, session, context: sessionContext(session), order: freshOrder(),
    requests: [] as Record<string, unknown>[], operations: [] as Record<string, unknown>[],
    externalFetches: [] as string[], holdNextConfirmation: false, held: false, modelCalls: 0 };
  // Synthetic identity/order/database boundaries. Real planner/guards/actions and
  // receipt validation run in the HTTP handler; no production service is contacted.
  database.adapter.simulation = false;
  database.adapter.realms = async () => {
    state.operations.push({ operation: 'realms' });
    return [{ tenantId: 'another-realm', schoolId: SCHOOL }, { tenantId: TENANT, schoolId: SCHOOL }];
  };
  database.adapter.orders = async () => { throw new Error('Selected pickup must not enumerate latest orders'); };
  database.adapter.order = async (tenantId, orderId) => {
    state.operations.push({ operation: 'order', tenantId, orderId });
    if (tenantId !== TENANT || orderId !== ORDER) throw new V2Error(403, 'FORBIDDEN_SCOPE');
    return { id: state.order.id, state: state.order.state, locationId: state.order.locationId,
      location: state.order.locationName, requestedPickupAt: state.order.requestedPickupAt };
  };
  const ledger = database.adapter.ledger, write = database.adapter.write;
  database.adapter.ledger = async () => {
    state.operations.push({ operation: 'ledger' });
    return ledger();
  };
  database.adapter.write = async input => {
    state.operations.push({ operation: 'write', mutationId: input.mutationId });
    return write(input);
  };
  return state;
}
let state: ReturnType<typeof fresh>;
export function reset() { state = fresh(); return config(); }
export function current() { return state; }
export function config() { return { accountId: state.account, context: state.context, schoolId: SCHOOL, tenantId: TENANT, orderId: ORDER }; }
export function snapshot() {
  return { ...config(), requests: state.requests, operations: state.operations,
    writes: state.database.writes, ledger: state.database.snapshot(),
    externalFetches: state.externalFetches, modelCalls: state.modelCalls, held: state.held };
}
export function customerRead(path: string) {
  if (path === 'food-order-realms') return { realms: [
    { tenantId: 'another-realm', name: '合成第二工作區' }, { tenantId: TENANT, name: '合成取餐工作區' },
  ] };
  if (path === `realms/${TENANT}/food/orders`) return { orders: [orderSummary(state.order)] };
  if (path === `realms/${TENANT}/food/orders/${ORDER}`) return state.order;
  throw new Error('Unexpected synthetic customer read: ' + path);
}
/** Fail before browser startup if a synthetic projection drifts from the real client contract. */
export async function verifyCustomerFixtures() {
  const client = createNuniFoodClient(async path => customerRead(path));
  const realms = await client.listOrderRealms();
  const orders = await client.listOrders(TENANT, { limit: 30 });
  const order = await client.getOrder(TENANT, ORDER);
  if (realms.length !== 2 || !realms.some(realm => realm.tenantId === TENANT) ||
      orders.orders.length !== 1 || orders.orders[0].id !== ORDER || order.id !== ORDER)
    throw new Error('Synthetic customer projections do not contain the selected order');
}
export function createAdapter(session: PlatformSession, _school: string, signal: AbortSignal) {
  return { adapter: state.database.adapter, apiCalls: () => state.operations.length,
    principal: async () => {
      signal.throwIfAborted();
      if (session.sessionHandle !== state.session.sessionHandle) throw new V2Error(409, 'SESSION_CHANGED');
      return { platformAccountId: state.account, isPlatformOperator: false };
    } };
}
