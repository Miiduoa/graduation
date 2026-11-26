import { useMemo, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { NuniError } from '../../../packages/shared/src/nuni';
import type { NuniMerchantWorkspaceDetail } from '../../../packages/shared/src/nuniMerchantOperations';
import type {
  NuniFoodOrderState,
  NuniFoodShiftProjection,
  NuniFoodStaffOrderQueueItem,
} from '../../../packages/shared/src/nuniFood';

// Data, authentication and Next's router are synthetic. Every merchant component,
// permission check, input, confirmation and stylesheet comes from product code.
export const fixtureOptions = new URLSearchParams(location.search);
const initialRoute =
  fixtureOptions.get('path') ||
  (location.pathname === '/' || location.pathname === '/index.html'
    ? '/merchant/workspace'
    : location.pathname);
const initialSearch = new URLSearchParams(fixtureOptions);
for (const key of ['path', 'theme', 'text', 'motion', 'account']) initialSearch.delete(key);
history.replaceState(
  history.state,
  '',
  initialRoute + (initialSearch.size ? `?${initialSearch}` : ''),
);

type FixtureState = {
  account: 'account-a' | 'account-b' | 'guest';
  revoked: boolean;
  delayReads: boolean;
  pendingReads: number;
  route: string;
  revision: number;
};
let state: FixtureState = {
  account: fixtureOptions.get('account') === 'guest' ? 'guest' : 'account-a',
  revoked: false,
  delayReads: false,
  pendingReads: 0,
  route: location.pathname + location.search,
  revision: 0,
};
const listeners = new Set<() => void>();
const queuedReads: Array<() => void> = [];
const ledger = {
  requests: [] as Array<{ path: string; context: string; mutation: boolean }>,
  navigations: [] as string[],
  externalRequests: [] as string[],
  writes: [] as Array<{ path: string; input: Record<string, unknown> }>,
};
function update(patch: Partial<FixtureState>) {
  state = { ...state, ...patch, revision: state.revision + 1 };
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useFixtureState = () =>
  useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
export const switchFixtureAccount = (account: FixtureState['account']) => update({ account });
export const toggleFixturePermission = () => update({ revoked: !state.revoked });
export const toggleReadDelay = () => update({ delayReads: !state.delayReads });
export function releaseFixtureReads() {
  const pending = queuedReads.splice(0);
  update({ pendingReads: 0, delayReads: false });
  pending.forEach((resolve) => resolve());
}

export function navigate(href: string, replace = false) {
  const url = new URL(href, location.origin);
  if (url.origin !== location.origin) throw new Error('Fixture navigation must remain local');
  const next = url.pathname + url.search + url.hash;
  ledger.navigations.push(next);
  if (next !== location.pathname + location.search + location.hash) {
    history[replace ? 'replaceState' : 'pushState'](history.state, '', next);
  }
  update({ route: location.pathname + location.search });
  // Native-history product subscriptions receive the same observable location.
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
}
window.addEventListener('popstate', () => update({ route: location.pathname + location.search }));
window.addEventListener('nuni-merchant-workspace-navigation', () =>
  update({ route: location.pathname + location.search }),
);
export default function Link({
  href = '/',
  onClick,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      props.download ||
      (props.target && props.target !== '_self')
    )
      return;
    event.preventDefault();
    navigate(String(href));
  }
  return (
    <a {...props} href={href} onClick={follow}>
      {children}
    </a>
  );
}
export const usePathname = () => new URL(useFixtureState().route, location.origin).pathname;
export const useSearchParams = () => {
  const route = useFixtureState().route;
  return useMemo(() => new URL(route, location.origin).searchParams, [route]);
};
export const useRouter = () => ({
  push: navigate,
  replace: (href: string) => navigate(href, true),
});
export const useAuth = () => ({
  user: null,
  loading: false,
  error: null,
  signOutUser: async () => {},
});
const refresh = async () => update({ revision: state.revision + 1 });
const logout = async () => switchFixtureAccount('guest');
export const useNuniSession = () => {
  const current = useFixtureState();
  return {
    session:
      current.account === 'guest'
        ? null
        : {
            platformAccountId: current.account,
            context: `synthetic-${current.account}`,
            isPlatformOperator: false,
          },
    loading: false,
    error: '',
    pendingLogout: false,
    refresh,
    logout,
  };
};
export const useOptionalNuniSession = useNuniSession;
const schools = [{ id: 'pu', code: 'PU', name: '靜宜大學', shortName: '靜宜', status: 'open' }];
export const useSelectedSchool = () => ({
  schools,
  selectedSchool: schools[0],
  selectedSchoolId: 'pu',
  selectSchool: () => {},
  loading: false,
  catalogStatus: 'ready',
  selectionError: null,
  requestedUnavailable: false,
});
export const useOptionalSelectedSchool = useSelectedSchool;
export const isFirebaseConfigured = () => false;
const unavailableFirebase = () => {
  throw new Error('Firebase is disabled in the merchant fixture');
};
export const getAuth = unavailableFirebase;
export const getDb = unavailableFirebase;
export const getFunctionsInstance = unavailableFirebase;
export const getCloudFunctionUrl = unavailableFirebase;
export const fetchAssistantWritePermissions = unavailableFirebase;
export const watchAccountNotifications = () => () => {};
export const notificationDestination = () => null;
export const usePersonalTodayRecords = unavailableFirebase;
export const interpretCampusRequest = unavailableFirebase;

const timestamp = '2026-11-23T04:20:00.000Z';
const money = (amountMinor = 120) => ({ amountMinor, currency: 'TWD' as const });
const initialLocation = (id: string, activated: boolean): NuniMerchantWorkspaceDetail => ({
  tenantId: 'campus-one',
  tenantName: '靜宜校園生活',
  applicationId: `application-${id}`,
  merchantId: 'merchant-rice',
  merchantName: '日常食堂',
  locationId: id,
  locationName: activated ? '學生活動中心一樓' : '圖書館旁外帶門市',
  merchantStatus: activated ? 'active' : 'suspended',
  locationStatus: activated ? 'open' : 'suspended',
  publicAccess: activated,
  campusId: 'main',
  campusName: '主校區',
  serviceModes: ['pickup'],
  paymentMode: 'counter-only',
  onlinePaymentAvailable: false,
  paymentCapabilityState: 'not-requested',
  managerConfirmed: activated,
  termsVersion: activated ? 'merchant-terms-v1' : null,
  activated,
  readinessVersion: 1,
  publishedMenuItems: activated ? 8 : 0,
  merchantMode: activated ? 'full' : 'info_only',
  merchantModeLabel: activated ? '完整服務' : '資訊展示',
  sourceLabel: '',
  sourceUpdatedAt: null,
  sourceLine: null,
  missingRequirements: activated ? [] : ['settings', 'menu'],
});
const stores = new Map([
  ['store-a', initialLocation('store-a', true)],
  ['store-b', initialLocation('store-b', false)],
]);
function queueItem(
  id: string,
  state: NuniFoodStaffOrderQueueItem['state'],
  code: string,
): NuniFoodStaffOrderQueueItem {
  const allowedActions: NuniFoodStaffOrderQueueItem['allowedActions'] =
    state === 'payment-pending'
      ? ['record-counter-payment']
      : state === 'paid'
        ? ['accept', 'reject']
        : state === 'preparing'
          ? ['mark-ready']
          : ['fulfill-pickup'];
  return {
    id,
    locationId: 'store-a',
    state,
    requestedPickupAt: timestamp,
    pickupDisplayCode: code,
    viewerScope: 'cash-register',
    allowedActions,
    lines: [
      {
        menuItemId: 'rice',
        nameSnapshot: id === 'order-4' ? '香烤蔬菜雞腿飯（少飯、醬汁另外放）' : '香烤蔬菜雞腿飯',
        quantity: 1,
        selectedOptions: [],
        unitPrice: money(),
        lineTotal: money(),
      },
    ],
    total: money(),
    kitchenTickets:
      state === 'preparing'
        ? [
            {
              id: `ticket-${id}`,
              station: 'hot',
              state: 'preparing',
              allowedActions: ['mark-ready'],
            },
          ]
        : [],
  };
}
let orders = [
  queueItem('order-1', 'payment-pending', 'A101'),
  queueItem('order-2', 'paid', 'A102'),
  queueItem('order-3', 'preparing', 'A103'),
  queueItem('order-4', 'ready', 'A104'),
];
let shift: NuniFoodShiftProjection | null = {
  id: 'shift-a',
  locationId: 'store-a',
  state: 'open',
  openedAt: timestamp,
  openingCash: money(500),
  campusLedgerTotal: money(0),
  allowedActions: ['handover', 'view'],
};
const writeReceipts = new Map<string, unknown>();
function requireStore(context: string, locationId: string) {
  if (context !== 'synthetic-account-a' || (state.revoked && locationId === 'store-a')) {
    throw new NuniError(403, 'FORBIDDEN');
  }
  const store = stores.get(locationId);
  if (!store) throw new NuniError(404, 'NOT_FOUND');
  return store;
}
function readResponse(path: string, context: string): unknown {
  if (path === 'account-demo') return { demo: null };
  if (path === 'sign-in-options') return { google: true };
  if (path === 'merchant-onboarding-programs') return { programs: [] };
  if (path === 'merchant-applications') return { applications: [] };
  if (path === 'merchant-workspaces')
    return {
      workspaces:
        context === 'synthetic-account-a'
          ? [...stores.values()].filter(
              (store) => !(state.revoked && store.locationId === 'store-a'),
            )
          : [],
    };
  const match = /^merchant-workspaces\/campus-one\/([^/]+)(?:\/(orders|shift))?$/.exec(path);
  if (match) {
    const store = requireStore(context, match[1]);
    if (match[2] === 'orders') return { orders: store.locationId === 'store-a' ? orders : [] };
    if (match[2] === 'shift') {
      if (!shift || store.locationId !== 'store-a')
        throw new NuniError(404, 'FOOD_SHIFT_NOT_FOUND');
      return shift;
    }
    return store;
  }
  throw new Error(`Unhandled synthetic read: ${path}`);
}
function mutationResponse(path: string, context: string, input: Record<string, unknown>) {
  const match = /^merchant-workspaces\/campus-one\/([^/]+)\/(.+)$/.exec(path);
  if (!match) throw new Error(`Unhandled synthetic mutation: ${path}`);
  let store = requireStore(context, match[1]);
  const action = match[2];
  if (action === 'settings') {
    store = {
      ...store,
      serviceModes: input.serviceModes as typeof store.serviceModes,
      paymentMode: input.paymentMode as typeof store.paymentMode,
      managerConfirmed: true,
      termsVersion: 'merchant-terms-v1',
      readinessVersion: store.readinessVersion + 1,
      missingRequirements: store.publishedMenuItems ? [] : ['menu'],
    };
  } else if (action === 'initial-menu') {
    const count = (input.items as unknown[]).length;
    stores.set(store.locationId, {
      ...store,
      publishedMenuItems: count,
      missingRequirements: store.managerConfirmed ? [] : ['settings'],
    });
    return { menuVersionId: 'food-menu_12345678-1234-1234-1234-123456789abc', createdItems: count };
  } else if (action === 'activate') {
    store = {
      ...store,
      activated: true,
      publicAccess: true,
      merchantStatus: 'active',
      locationStatus: 'open',
      merchantMode: 'full',
      merchantModeLabel: '完整服務',
      readinessVersion: store.readinessVersion + 1,
    };
  } else if (action === 'availability') {
    store = {
      ...store,
      locationStatus: input.acceptingOrders ? 'open' : 'closed',
      publicAccess: Boolean(input.acceptingOrders),
      readinessVersion: store.readinessVersion + 1,
    };
  } else if (action === 'shift') {
    shift = {
      id: 'shift-fixture-next',
      locationId: store.locationId,
      state: 'open',
      openedAt: timestamp,
      openingCash: money(Number(input.openingCashMinor)),
      campusLedgerTotal: money(0),
      allowedActions: ['handover', 'view'],
    };
    return shift;
  } else if (action === 'shift/handover') {
    if (!shift) throw new NuniError(409, 'FOOD_SHIFT_NOT_FOUND');
    const closed = {
      ...shift,
      state: 'closed',
      closedAt: timestamp,
      expectedCash: money(620),
      countedCash: money(Number(input.countedCashMinor)),
      allowedActions: ['view'],
    };
    shift = input.openNext
      ? {
          ...shift,
          id: 'shift-fixture-next',
          openingCash: money(Number(input.nextOpeningCashMinor)),
        }
      : null;
    return { closed, ...(shift ? { next: shift } : {}) };
  } else {
    const command = /^(?:orders\/([^/]+)|kitchen-tickets\/ticket-([^/]+))\/(.+)$/.exec(action);
    if (!command) throw new Error(`Unhandled synthetic action: ${action}`);
    const id = command[1] || command[2];
    const order = orders.find((item) => item.id === id);
    if (!order) throw new NuniError(404, 'ORDER_NOT_FOUND');
    const operation = command[3];
    const nextState: NuniFoodOrderState =
      operation === 'counter-payment'
        ? 'paid'
        : operation === 'accept'
          ? 'accepted'
          : operation === 'start'
            ? 'preparing'
            : operation === 'ready'
              ? 'ready'
              : operation === 'fulfill'
                ? 'fulfilled'
                : operation === 'reject'
                  ? 'rejected'
                  : operation === 'cancel-accepted'
                    ? 'canceled'
                    : operation === 'confirm-counter-refund'
                      ? 'rejected'
                      : order.state;
    if (nextState === order.state)
      throw new Error(`Unhandled synthetic order action: ${operation}`);
    const allowedActions: NuniFoodStaffOrderQueueItem['allowedActions'] =
      nextState === 'paid'
        ? ['accept', 'reject']
        : nextState === 'accepted'
          ? ['start-preparation']
          : nextState === 'preparing'
            ? ['mark-ready']
            : nextState === 'ready'
              ? ['fulfill-pickup']
              : [];
    if (nextState === 'fulfilled' || nextState === 'rejected' || nextState === 'canceled') {
      orders = orders.filter((item) => item.id !== id);
    } else
      orders = orders.map((item) =>
        item.id !== id
          ? item
          : {
              ...item,
              state: nextState,
              allowedActions,
              kitchenTickets:
                nextState === 'accepted'
                  ? [
                      {
                        id: `ticket-${id}`,
                        station: 'hot',
                        state: 'queued',
                        allowedActions: ['start-preparation'],
                      },
                    ]
                  : nextState === 'preparing'
                    ? [
                        {
                          id: `ticket-${id}`,
                          station: 'hot',
                          state: 'preparing',
                          allowedActions: ['mark-ready'],
                        },
                      ]
                    : [],
            },
      );
    return operation === 'fulfill'
      ? { orderId: id, state: 'fulfilled', fulfilledAt: timestamp, replayed: false }
      : {
          orderId: id,
          state: nextState,
          updatedAt: timestamp,
          replayed: false,
          ...(operation === 'accept' ? { kitchenTicketId: `ticket-${id}` } : {}),
        };
  }
  stores.set(store.locationId, store);
  return store;
}
export async function browserRequest(path: string, context = '', input?: Record<string, unknown>) {
  ledger.requests.push({ path, context, mutation: input !== undefined });
  if (input !== undefined) {
    ledger.writes.push({ path, input: structuredClone(input) });
    const receiptKey =
      typeof input.idempotencyKey === 'string'
        ? JSON.stringify([context, path, input.idempotencyKey])
        : null;
    if (receiptKey && writeReceipts.has(receiptKey))
      return structuredClone(writeReceipts.get(receiptKey));
    const result = structuredClone(mutationResponse(path, context, input));
    if (receiptKey) writeReceipts.set(receiptKey, result);
    return result;
  }
  // Capture the response before a delayed read. Releasing after an account change
  // deliberately exercises the product's stale-response protection.
  const response = structuredClone(readResponse(path, context));
  if (state.delayReads && path.startsWith('merchant-')) {
    await new Promise<void>((resolve) => {
      queuedReads.push(resolve);
      update({ pendingReads: queuedReads.length });
    });
  }
  return response;
}

window.fetch = async (input) => {
  ledger.externalRequests.push(String(input));
  throw new Error(`External network is disabled in the merchant fixture: ${String(input)}`);
};
document.addEventListener('submit', (event) => {
  if (
    event.target instanceof HTMLFormElement &&
    event.target.action.includes('/auth/platform/start')
  ) {
    event.preventDefault();
    throw new Error('OAuth is unavailable in this local synthetic fixture');
  }
});
Object.assign(window, {
  __merchantQA: {
    snapshot: () => structuredClone({ state, ledger, stores: [...stores.values()], orders }),
    switchAccount: switchFixtureAccount,
    togglePermission: toggleFixturePermission,
    delayReads: toggleReadDelay,
    releaseReads: releaseFixtureReads,
  },
});
