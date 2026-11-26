import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import type {
  NuniFoodShiftProjection,
  NuniFoodStaffOrderQueueItem,
} from '@campus/shared/src/nuniFood';
import { future, money, queueFixture, shiftFixture } from '@/features/food/foodTestFixtures';
import { loadFoodPending } from '@/features/food/foodPersistence';
import { merchantWorkspaceHref } from '@/lib/merchantWorkspaceNavigation';
import { MerchantOrderDesk } from './MerchantOrderDesk';
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  session: {
    platformAccountId: 'account-a',
    context: 'context-a',
  } as { platformAccountId: string; context: string } | null,
}));
vi.mock('@/features/nuni/Session', () => ({
  browserRequest: mocks.request,
  useNuniSession: () => ({
    session: mocks.session,
    loading: false,
    error: '',
    pendingLogout: false,
    refresh: vi.fn(),
  }),
}));
vi.mock('./PickupScanner', () => ({
  PickupScanner: ({
    onToken,
    disabled,
  }: {
    onToken: (token: string) => void;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={() => onToken('t'.repeat(43))}>
      測試掃描帶入
    </button>
  ),
}));
let shift: NuniFoodShiftProjection | null;
let queue: NuniFoodStaffOrderQueueItem[];
function receipt(state: string) {
  return { orderId: 'order-1', state, updatedAt: future, replayed: false };
}
async function respond(path: string, _context: string, input?: Record<string, unknown>) {
  if (path.endsWith('/orders')) return { orders: queue };
  if (path.endsWith('/shift')) {
    if (input) {
      shift = { ...shiftFixture(), openingCash: money(input.openingCashMinor as number) };
      return shift;
    }
    if (!shift) throw new NuniError(404, 'FOOD_SHIFT_NOT_FOUND');
    return shift;
  }
  if (path.endsWith('/counter-payment')) {
    queue = [{ ...queue[0]!, state: 'paid', allowedActions: ['accept', 'reject'] }];
    return receipt('paid');
  }
  if (path.endsWith('/accept')) {
    queue = [
      {
        ...queue[0]!,
        state: 'accepted',
        allowedActions: ['start-preparation'],
        kitchenTickets: [
          {
            id: 'ticket-1',
            station: 'hot',
            state: 'queued',
            allowedActions: ['start-preparation'],
          },
        ],
      },
    ];
    return { ...receipt('accepted'), kitchenTicketId: 'ticket-1' };
  }
  if (path.endsWith('/start')) {
    queue = [
      {
        ...queue[0]!,
        state: 'preparing',
        allowedActions: ['mark-ready'],
        kitchenTickets: [
          { id: 'ticket-1', station: 'hot', state: 'preparing', allowedActions: ['mark-ready'] },
        ],
      },
    ];
    return receipt('preparing');
  }
  if (path.endsWith('/ready')) {
    queue = [
      {
        ...queue[0]!,
        state: 'ready',
        allowedActions: ['fulfill-pickup'],
        kitchenTickets: [{ id: 'ticket-1', station: 'hot', state: 'ready', allowedActions: [] }],
      },
    ];
    return receipt('ready');
  }
  if (path.endsWith('/fulfill')) {
    queue = [];
    return { orderId: 'order-1', state: 'fulfilled', fulfilledAt: future, replayed: false };
  }
  if (path.endsWith('/handover')) {
    const closed = {
      ...shift!,
      state: 'closed',
      closedAt: future,
      countedCash: money(input!.countedCashMinor as number),
      expectedCash: money(620),
      allowedActions: ['view'],
    };
    shift = input!.openNext
      ? {
          ...shiftFixture(),
          id: 'shift-2',
          openingCash: money(input!.nextOpeningCashMinor as number),
        }
      : null;
    return { closed, ...(shift ? { next: shift } : {}) };
  }
  if (path.endsWith('/reject')) {
    queue = [
      {
        ...queue[0]!,
        state: 'rejection-pending-refund',
        allowedActions: ['confirm-counter-refund'],
      },
    ];
    return receipt('rejection-pending-refund');
  }
  if (path.endsWith('/confirm-counter-refund')) {
    queue = [];
    return receipt('rejected');
  }
  throw new Error(`Unexpected ${path}`);
}
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.session = { platformAccountId: 'account-a', context: 'context-a' };
  shift = shiftFixture();
  queue = [queueFixture()];
  mocks.request.mockImplementation(respond);
});
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
async function quietRefresh() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
}
function mount(cache = new Map<string, unknown>(), context = 'context-a', locationId = 'store-1') {
  return render(
    <MerchantOrderDesk
      key={`${context}:${locationId}`}
      context={context}
      tenantId="campus-one"
      locationId={locationId}
      cache={cache}
    />,
  );
}
async function confirm(name: string, label: string) {
  fireEvent.click(await screen.findByRole('button', { name: `${name}：A101` }));
  expect(button(`確認：${name}`).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(button(`確認：${name}`));
}

it('requires a new cash confirmation when polling finds a different shift', async () => {
  mount();
  await screen.findByText('目前收銀班別');
  fireEvent.change(screen.getByLabelText('交班實點現金（元）'), { target: { value: '620' } });
  fireEvent.click(screen.getByLabelText('我已清點現金，確認交班內容'));
  expect(button('確認交班').disabled).toBe(false);
  shift = { ...shift!, id: 'shift-replacement' };
  await quietRefresh();
  await waitFor(() => expect(button('確認交班').disabled).toBe(true));
  expect((screen.getByLabelText('我已清點現金，確認交班內容') as HTMLInputElement).checked).toBe(
    false,
  );
  expect((screen.getByLabelText('交班實點現金（元）') as HTMLInputElement).value).toBe('620');
  expect(mocks.request.mock.calls.some(([path]) => path.endsWith('/handover'))).toBe(false);
});

it('does not restore a previous handover confirmation after permissions are revoked and granted again', async () => {
  mount();
  await screen.findByText('目前收銀班別');
  fireEvent.change(screen.getByLabelText('交班實點現金（元）'), { target: { value: '620' } });
  fireEvent.click(screen.getByLabelText('我已清點現金，確認交班內容'));
  shift = { ...shift!, allowedActions: ['view'] };
  await quietRefresh();
  await waitFor(() => expect(screen.queryByLabelText('我已清點現金，確認交班內容')).toBeNull());
  shift = { ...shift!, allowedActions: ['view', 'handover'] };
  await quietRefresh();
  expect((screen.getByLabelText('我已清點現金，確認交班內容') as HTMLInputElement).checked).toBe(
    false,
  );
  expect(button('確認交班').disabled).toBe(true);
});

it('does not carry an open-shift confirmation into a shift opened elsewhere', async () => {
  shift = null;
  mount();
  await screen.findByText('開始收銀');
  fireEvent.click(screen.getByLabelText('我已清點這一班的期初現金'));
  expect(button('確認開班').disabled).toBe(false);
  shift = shiftFixture();
  await quietRefresh();
  await screen.findByText('目前收銀班別');
  expect((screen.getByLabelText('我已清點現金，確認交班內容') as HTMLInputElement).checked).toBe(
    false,
  );
});

it('retains an uncertain handover with its original key when a newer shift is observed', async () => {
  mocks.request.mockImplementation((path, context, input) =>
    path.endsWith('/handover')
      ? Promise.reject(new NuniError(0, 'NETWORK_ERROR'))
      : respond(path, context, input),
  );
  mount();
  await screen.findByText('目前收銀班別');
  fireEvent.change(screen.getByLabelText('交班實點現金（元）'), { target: { value: '620' } });
  fireEvent.click(screen.getByLabelText('我已清點現金，確認交班內容'));
  fireEvent.click(button('確認交班'));
  await screen.findByText(/尚未確認這次操作的結果/);
  const original = loadFoodPending('account-a', 'merchant-food:campus-one:store-1');
  expect(original?.action).toBe('handover');
  shift = { ...shift!, id: 'shift-replacement' };
  await quietRefresh();
  expect(loadFoodPending('account-a', 'merchant-food:campus-one:store-1')).toEqual(original);
  expect(screen.getByRole('button', { name: '重試同一份操作' })).toBeTruthy();
  expect(mocks.request.mock.calls.filter(([path]) => path.endsWith('/handover'))).toHaveLength(1);
});

it('keeps unpaid counter work under desk confirmation before moving prep into the active lane', async () => {
  mount();
  const incoming = await screen.findByLabelText('待收款與確認');
  expect(incoming.textContent).toContain('先登記櫃檯已收款項');
  expect(screen.queryByLabelText('進行中訂單')).toBeNull();
  await confirm('登記櫃檯收款', '我已實際收到這筆訂單的款項');
  await screen.findByText('取餐 A101 · 已付款，待店家接單');
  expect(screen.getByLabelText('待收款與確認').textContent).toContain('確認是否接單');
  await confirm('接單', '我已確認這筆訂單與處理內容');
  await screen.findByLabelText('進行中訂單');
  expect(screen.queryByLabelText('待收款與確認')).toBeNull();
  expect(screen.getByLabelText('進行中訂單').textContent).toMatch(/開始備餐|備餐/);
});

it('completes real cashier, preparation, token handoff and counted-cash handover with explicit confirmations', async () => {
  shift = null;
  mount();
  await screen.findByText('開始收銀');
  fireEvent.change(screen.getByLabelText('期初現金（元）'), { target: { value: '500' } });
  expect(button('確認開班').disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('我已清點這一班的期初現金'));
  fireEvent.click(button('確認開班'));
  await screen.findByText('目前收銀班別');
  await confirm('登記櫃檯收款', '我已實際收到這筆訂單的款項');
  await screen.findByText('取餐 A101 · 已付款，待店家接單');
  await confirm('接單', '我已確認這筆訂單與處理內容');
  fireEvent.click(await screen.findByRole('button', { name: '開始備餐：ticket-1' }));
  fireEvent.click(await screen.findByRole('button', { name: '餐點已備妥：ticket-1' }));
  fireEvent.click(await screen.findByRole('button', { name: '核對憑證並交付餐點：A101' }));
  fireEvent.click(button('測試掃描帶入'));
  expect((screen.getByLabelText('顧客的一次性取餐憑證') as HTMLInputElement).value).toBe(
    't'.repeat(43),
  );
  expect(mocks.request.mock.calls.some(([path]) => path.endsWith('/fulfill'))).toBe(false);
  expect(button('確認：核對憑證並交付餐點').disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('我已核對憑證，準備把這份餐交給顧客'));
  fireEvent.click(button('確認：核對憑證並交付餐點'));
  await screen.findByText('訂單 order-1：已取餐。');
  fireEvent.change(screen.getByLabelText('交班實點現金（元）'), { target: { value: '620' } });
  fireEvent.click(screen.getByLabelText('交班後開啟下一班'));
  fireEvent.change(screen.getByLabelText('下一班期初現金（元）'), { target: { value: '500' } });
  fireEvent.click(screen.getByLabelText('我已清點現金，確認交班內容'));
  fireEvent.click(button('確認交班'));
  await screen.findByText('交班已完成。應有現金 NT$620，實點 NT$620。下一班已開啟。');
  const writes = mocks.request.mock.calls.filter(([, , input]) => input);
  expect(writes).toHaveLength(7);
  expect(new Set(writes.map(([, , input]) => input.idempotencyKey)).size).toBe(7);
  expect(writes[0][2].openingCashMinor).toBe(500);
  expect(writes.at(-1)![2]).toMatchObject({
    countedCashMinor: 620,
    openNext: true,
    nextOpeningCashMinor: 500,
  });
});

it('keeps an uncertain cash receipt across unmount/context renewal and retries the exact key and payload', async () => {
  const cache = new Map<string, unknown>();
  let attempts = 0;
  mocks.request.mockImplementation((path, context, input) =>
    path.endsWith('/counter-payment') && ++attempts === 1
      ? Promise.reject(new NuniError(0, 'NETWORK_ERROR'))
      : respond(path, context, input),
  );
  const view = mount(cache);
  await confirm('登記櫃檯收款', '我已實際收到這筆訂單的款項');
  await screen.findByText(/尚未確認這次操作的結果/);
  view.unmount();
  mount(cache, 'context-renewed');
  await screen.findByText('目前收銀班別');
  fireEvent.click(button('重試同一份操作'));
  await screen.findByText('取餐 A101 · 已付款，待店家接單');
  const writes = mocks.request.mock.calls.filter(([path]) => path.endsWith('/counter-payment'));
  expect(writes).toHaveLength(2);
  expect(writes[1][2]).toEqual(writes[0][2]);
  expect(writes[1][1]).toBe('context-renewed');
});

it('does not accept a display code as a pickup token and scanning never fulfills by itself', async () => {
  queue = [{ ...queueFixture(), state: 'ready', allowedActions: ['fulfill-pickup'] }];
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '核對憑證並交付餐點：A101' }));
  fireEvent.change(screen.getByLabelText('顧客的一次性取餐憑證'), { target: { value: 'A101' } });
  fireEvent.click(screen.getByLabelText('我已核對憑證，準備把這份餐交給顧客'));
  expect(button('確認：核對憑證並交付餐點').disabled).toBe(true);
  fireEvent.click(button('測試掃描帶入'));
  expect(button('確認：核對憑證並交付餐點').disabled).toBe(true);
  expect(mocks.request.mock.calls.some(([path]) => path.endsWith('/fulfill'))).toBe(false);
});

it('only exposes allowed actions and removes all operation controls when reread loses authorization', async () => {
  queue = [{ ...queueFixture(), allowedActions: [] }];
  mount();
  await screen.findByText('取餐 A101 · 待付款');
  expect(screen.queryByRole('button', { name: '登記櫃檯收款：A101' })).toBeNull();
  mocks.request.mockRejectedValue(new NuniError(403, 'FORBIDDEN'));
  fireEvent.click(button('更新工作台'));
  await screen.findByText(/目前無法確認使用權限/);
  expect(screen.queryByLabelText('交班實點現金（元）')).toBeNull();
  expect(screen.queryByText('取餐 A101 · 待付款')).toBeNull();
});

it('refreshes a 409 state and does not pretend cash was received', async () => {
  mocks.request.mockImplementation((path, context, input) =>
    path.endsWith('/counter-payment')
      ? Promise.reject(new NuniError(409, 'FOOD_SHIFT_NOT_FOUND'))
      : respond(path, context, input),
  );
  mount();
  await confirm('登記櫃檯收款', '我已實際收到這筆訂單的款項');
  await screen.findByText(/訂單或班別已有變更/);
  await waitFor(() => expect(screen.queryByText('正在核對訂單與班別…')).toBeNull());
  expect(screen.getByText('取餐 A101 · 待付款')).toBeTruthy();
  expect(screen.queryByText('訂單 order-1：已付款，待店家接單。')).toBeNull();
  expect(screen.queryByRole('button', { name: '重試同一份操作' })).toBeNull();
});

it('keeps another location separate and ignores a pending write resolving after leaving', async () => {
  let finish!: (value: unknown) => void;
  const cache = new Map<string, unknown>();
  mocks.request.mockImplementation((path, context, input) =>
    path.endsWith('/counter-payment')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : respond(path, context, input),
  );
  const view = mount(cache);
  await confirm('登記櫃檯收款', '我已實際收到這筆訂單的款項');
  view.unmount();
  mocks.request.mockImplementation(async (path) =>
    path.endsWith('/orders') ? { orders: [] } : { ...shiftFixture(), locationId: 'store-2' },
  );
  mount(cache, 'context-a', 'store-2');
  await screen.findByText('目前收銀班別');
  await act(async () => finish(receipt('paid')));
  expect(screen.queryByText('訂單 order-1：已付款，待店家接單。')).toBeNull();
  expect(screen.queryByRole('button', { name: '重試同一份操作' })).toBeNull();
  expect(cache.has('merchant-food:campus-one:store-1:pending')).toBe(true);
});

it('requires an actual refund acknowledgment and a meaningful other rejection reason', async () => {
  queue = [{ ...queueFixture(), state: 'paid', allowedActions: ['reject'] }];
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '無法接單：A101' }));
  fireEvent.change(screen.getByLabelText('店家處理原因'), { target: { value: 'other' } });
  fireEvent.click(screen.getByLabelText('我已確認這筆訂單與處理內容'));
  expect(button('確認：無法接單').disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('店家原因說明'), { target: { value: '設備臨時故障' } });
  fireEvent.click(screen.getByLabelText('我已確認這筆訂單與處理內容'));
  fireEvent.click(button('確認：無法接單'));
  await screen.findByText('取餐 A101 · 未接單，待退款');
  await confirm('確認已退還款項', '我已實際退還這筆款項');
  await screen.findByText('訂單 order-1：店家未接單。');
  expect(mocks.request.mock.calls.find(([path]) => path.endsWith('/reject'))?.[2]).toMatchObject({
    reason: 'other',
    reasonDetail: '設備臨時故障',
  });
});

it('quietly polls the merchant queue without clearing an open confirm panel, and ignores background ticks', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '登記櫃檯收款：A101' }));
  fireEvent.click(screen.getByLabelText('我已實際收到這筆訂單的款項'));
  expect(button('確認：登記櫃檯收款').disabled).toBe(false);
  const before = mocks.request.mock.calls.filter(([path]) => path.endsWith('/orders')).length;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'hidden',
  });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(mocks.request.mock.calls.filter(([path]) => path.endsWith('/orders')).length).toBe(before);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
  queue = [{ ...queueFixture(), state: 'paid', allowedActions: ['accept', 'reject'] }];
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await screen.findByText('取餐 A101 · 已付款，待店家接單');
  await waitFor(() => expect(screen.queryByLabelText('我已實際收到這筆訂單的款項')).toBeNull());
  expect(screen.getByRole('button', { name: '接單：A101' })).toBeTruthy();
  vi.useRealTimers();
});

it('persists an uncertain cash write across a new Map and rejects storage failure before the network', async () => {
  let attempts = 0;
  mocks.request.mockImplementation((path, context, input) =>
    path.endsWith('/counter-payment') && ++attempts === 1
      ? Promise.reject(new NuniError(0, 'NETWORK_ERROR'))
      : respond(path, context, input),
  );
  const first = mount(new Map());
  await confirm('登記櫃檯收款', '我已實際收到這筆訂單的款項');
  await screen.findByText(/尚未確認這次操作的結果/);
  const original = mocks.request.mock.calls.find(([path]) => path.endsWith('/counter-payment'))![2];
  // Cold start with an empty Map; durable sessionStorage must restore the same key.
  first.unmount();
  const second = mount(new Map(), 'context-renewed');
  await screen.findByText('目前收銀班別');
  fireEvent.click(button('重試同一份操作'));
  await screen.findByText('取餐 A101 · 已付款，待店家接單');
  const writes = mocks.request.mock.calls.filter(([path]) => path.endsWith('/counter-payment'));
  expect(writes[1][2]).toEqual(original);

  second.unmount();
  queue = [queueFixture()];
  mocks.request.mockClear();
  mount(new Map());
  await screen.findByText('目前收銀班別');
  fireEvent.click(await screen.findByRole('button', { name: '登記櫃檯收款：A101' }));
  fireEvent.click(screen.getByLabelText('我已實際收到這筆訂單的款項'));
  const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  try {
    fireEvent.click(button('確認：登記櫃檯收款'));
    await screen.findByText(/目前無法安全保存/);
    expect(mocks.request.mock.calls.some(([path]) => path.endsWith('/counter-payment'))).toBe(
      false,
    );
  } finally {
    blocked.mockRestore();
  }
});

it.each([401, 403, 409])(
  'retains an unknown cash operation after retry returns %s, including context renewal',
  async (status) => {
    const cache = new Map<string, unknown>();
    let attempts = 0;
    mocks.request.mockImplementation((path, context, input) => {
      if (path.endsWith('/counter-payment')) {
        attempts++;
        if (attempts === 1) return Promise.reject(new NuniError(0, 'NETWORK_ERROR'));
        if (attempts === 2) return Promise.reject(new NuniError(status, 'TEMPORARILY_UNAVAILABLE'));
      }
      return respond(path, context, input);
    });
    const view = mount(cache);
    await confirm('登記櫃檯收款', '我已實際收到這筆訂單的款項');
    await screen.findByText(/尚未確認這次操作的結果/);
    fireEvent.click(button('重試同一份操作'));
    await waitFor(() => expect(attempts).toBe(2));
    await waitFor(() => expect(button('重試同一份操作').disabled).toBe(false));
    expect(button('登記櫃檯收款：A101').disabled).toBe(true);
    view.unmount();
    mount(cache, 'renewed-context');
    await screen.findByText('目前收銀班別');
    fireEvent.click(button('重試同一份操作'));
    await screen.findByText('取餐 A101 · 已付款，待店家接單');
    const writes = mocks.request.mock.calls.filter(([path]) => path.endsWith('/counter-payment'));
    expect(writes).toHaveLength(3);
    expect(writes[1][2]).toEqual(writes[0][2]);
    expect(writes[2][2]).toEqual(writes[0][2]);
  },
);

function activeQueueOrder(): NuniFoodStaffOrderQueueItem {
  return {
    ...queueFixture(),
    id: 'order-2',
    pickupDisplayCode: 'B202',
    state: 'ready',
    allowedActions: ['fulfill-pickup'],
  };
}

it('filters this page through real links without writes and keeps focused filters stable during polling', async () => {
  queue = [queueFixture(), activeQueueOrder()];
  mount();
  const filters = await screen.findByRole('navigation', { name: '訂單篩選' });
  expect(
    within(filters).getByRole('link', { name: '全部，本頁 2 筆' }).getAttribute('aria-current'),
  ).toBe('page');
  expect(within(filters).getByRole('link', { name: '待收款與確認，本頁 1 筆' })).toBeTruthy();
  const active = within(filters).getByRole('link', { name: '備餐與取餐，本頁 1 筆' });
  expect(active.getAttribute('href')).toBe(
    '/merchant/workspace?tenant=campus-one&location=store-1&section=orders&queue=active',
  );
  active.focus();
  fireEvent.click(active);
  expect(active.getAttribute('aria-current')).toBe('page');
  expect(screen.queryByText('取餐 A101 · 待付款')).toBeNull();
  expect(screen.getByText('取餐 B202 · 可以取餐')).toBeTruthy();
  expect(screen.getByLabelText('收銀班別')).toBeTruthy();
  expect(screen.getByText('數字只包含目前這一頁已載入的訂單。')).toBeTruthy();
  expect(mocks.request.mock.calls.filter(([, , input]) => input)).toHaveLength(0);
  queue = [
    queueFixture(),
    activeQueueOrder(),
    { ...activeQueueOrder(), id: 'order-3', pickupDisplayCode: 'B203' },
  ];
  await quietRefresh();
  expect(document.activeElement).toBe(active);
  expect(active.getAttribute('aria-label')).toBe('備餐與取餐，本頁 2 筆');
  expect(screen.queryByText('取餐 A101 · 待付款')).toBeNull();
  expect(mocks.request.mock.calls.filter(([, , input]) => input)).toHaveLength(0);
});

it('explains an empty page filter and clears it without pretending the store has no orders', async () => {
  mount();
  fireEvent.click(await screen.findByRole('link', { name: '備餐與取餐，本頁 0 筆' }));
  expect(screen.getByText('這一頁沒有備餐與取餐的訂單。')).toBeTruthy();
  expect(screen.queryByText('取餐 A101 · 待付款')).toBeNull();
  const clear = screen.getByRole('link', { name: '清除篩選，查看本頁全部訂單' });
  expect(clear.getAttribute('href')).toBe(
    '/merchant/workspace?tenant=campus-one&location=store-1&section=orders',
  );
  fireEvent.click(clear);
  expect(screen.getByText('取餐 A101 · 待付款')).toBeTruthy();
  expect(screen.queryByText('這一頁沒有備餐與取餐的訂單。')).toBeNull();
  expect(mocks.request.mock.calls.filter(([, , input]) => input)).toHaveLength(0);
});

it('invalidates an unsent confirmation when switching filters and requires fresh confirmation for another order', async () => {
  queue = [queueFixture(), activeQueueOrder()];
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '登記櫃檯收款：A101' }));
  fireEvent.click(screen.getByLabelText('我已實際收到這筆訂單的款項'));
  expect(button('確認：登記櫃檯收款').disabled).toBe(false);
  fireEvent.click(screen.getByRole('link', { name: '備餐與取餐，本頁 1 筆' }));
  expect(screen.queryByRole('region', { name: '確認訂單操作' })).toBeNull();
  fireEvent.click(button('核對憑證並交付餐點：B202'));
  expect(
    (screen.getByLabelText('我已核對憑證，準備把這份餐交給顧客') as HTMLInputElement).checked,
  ).toBe(false);
  expect(button('確認：核對憑證並交付餐點').disabled).toBe(true);
  fireEvent.click(screen.getByRole('link', { name: '待收款與確認，本頁 1 筆' }));
  fireEvent.click(button('登記櫃檯收款：A101'));
  expect((screen.getByLabelText('我已實際收到這筆訂單的款項') as HTMLInputElement).checked).toBe(
    false,
  );
  expect(button('確認：登記櫃檯收款').disabled).toBe(true);
  expect(mocks.request.mock.calls.filter(([, , input]) => input)).toHaveLength(0);
});

it('keeps submitted and uncertain operations visible across filters and retries only the original payload', async () => {
  let rejectWrite!: (reason: unknown) => void;
  let attempts = 0;
  mocks.request.mockImplementation((path, context, input) =>
    path.endsWith('/counter-payment') && ++attempts === 1
      ? new Promise((_resolve, reject) => {
          rejectWrite = reject;
        })
      : respond(path, context, input),
  );
  mount();
  await confirm('登記櫃檯收款', '我已實際收到這筆訂單的款項');
  await screen.findByText('正在確認這次操作…');
  const original = loadFoodPending('account-a', 'merchant-food:campus-one:store-1');
  fireEvent.click(screen.getByRole('link', { name: '備餐與取餐，本頁 0 筆' }));
  expect(screen.getByRole('region', { name: '確認訂單操作' }).textContent).toContain('取餐 A101');
  expect(button('確認：登記櫃檯收款').disabled).toBe(true);
  expect(loadFoodPending('account-a', 'merchant-food:campus-one:store-1')).toEqual(original);
  expect(attempts).toBe(1);
  await act(async () => rejectWrite(new NuniError(0, 'NETWORK_ERROR')));
  await screen.findByText(/尚未確認這次操作的結果/);
  expect(screen.getByRole('region', { name: '確認訂單操作' })).toBeTruthy();
  expect(button('重試同一份操作').disabled).toBe(false);
  expect(attempts).toBe(1);
  fireEvent.click(button('重試同一份操作'));
  await screen.findByText('訂單 order-1：已付款，待店家接單。');
  const writes = mocks.request.mock.calls.filter(([path]) => path.endsWith('/counter-payment'));
  expect(writes).toHaveLength(2);
  expect(writes[1][2]).toEqual(writes[0][2]);
  expect(screen.queryByRole('region', { name: '確認訂單操作' })).toBeNull();
});

it('keeps parent-controlled filters in sync and forwards modified clicks without changing the current queue', async () => {
  queue = [queueFixture(), activeQueueOrder()];
  const change = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) => event.preventDefault());
  const props = {
    context: 'context-a',
    tenantId: 'campus-one',
    locationId: 'store-1',
    cache: new Map<string, unknown>(),
    onQueueChange: change,
    queueHref: (value: 'all' | 'incoming' | 'active') =>
      merchantWorkspaceHref({
        tenantId: 'campus-one',
        locationId: 'store-1',
        section: 'orders',
        queue: value,
      }),
  };
  const view = render(<MerchantOrderDesk {...props} queue="incoming" />);
  const active = await screen.findByRole('link', { name: '備餐與取餐，本頁 1 筆' });
  fireEvent.click(active, { metaKey: true });
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ metaKey: true }), 'active');
  expect(screen.getByText('取餐 A101 · 待付款')).toBeTruthy();
  expect(screen.queryByText('取餐 B202 · 可以取餐')).toBeNull();
  fireEvent.click(active);
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ metaKey: false }), 'active');
  expect(screen.queryByText('取餐 B202 · 可以取餐')).toBeNull();
  view.rerender(<MerchantOrderDesk {...props} queue="active" />);
  expect(screen.getByText('取餐 B202 · 可以取餐')).toBeTruthy();
  expect(screen.queryByText('取餐 A101 · 待付款')).toBeNull();
  expect(mocks.request.mock.calls.filter(([, , input]) => input)).toHaveLength(0);
});

it.each(['ctrlKey', 'metaKey'] as const)(
  'does not close an unsent confirmation on %s link clicks',
  async (modifier) => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '登記櫃檯收款：A101' }));
    fireEvent.click(screen.getByLabelText('我已實際收到這筆訂單的款項'));
    const active = screen.getByRole('link', { name: '備餐與取餐，本頁 0 筆' });
    // Prevent jsdom's unsupported navigation only after the component's click handler ran.
    const preventNavigation = (event: Event) => event.preventDefault();
    window.addEventListener('click', preventNavigation, { once: true });
    fireEvent.click(active, { [modifier]: true });
    expect(screen.getByRole('link', { name: '全部，本頁 1 筆' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(button('確認：登記櫃檯收款').disabled).toBe(false);
    expect(screen.queryByText('這一頁沒有備餐與取餐的訂單。')).toBeNull();
    expect(mocks.request.mock.calls.filter(([, , input]) => input)).toHaveLength(0);
  },
);

it('restores the same-page cursor from its workspace cache and leaves other stores on their own page', async () => {
  const cache = new Map<string, unknown>();
  mocks.request.mockImplementation(async (path, context, input, _unused, query) => {
    if (path.endsWith('/orders')) {
      return {
        orders: path.includes('/store-2/')
          ? queue.map((order) => ({ ...order, locationId: 'store-2' }))
          : queue,
        ...(query?.cursor ? {} : { nextCursor: 'page-2' }),
      };
    }
    if (path.includes('/store-2/') && path.endsWith('/shift'))
      return { ...shiftFixture(), locationId: 'store-2' };
    return respond(path, context, input);
  });
  const first = mount(cache);
  fireEvent.click(await screen.findByRole('button', { name: '下一頁待處理訂單' }));
  await screen.findByRole('button', { name: '回到第一頁待處理訂單' });
  expect(cache.get('merchant-food:campus-one:store-1:cursor')).toBe('page-2');
  first.unmount();
  mocks.request.mockClear();
  const returned = mount(cache);
  await screen.findByRole('button', { name: '回到第一頁待處理訂單' });
  expect(mocks.request.mock.calls.find(([path]) => path.endsWith('/orders'))?.[4]).toMatchObject({
    cursor: 'page-2',
  });
  returned.unmount();
  mocks.request.mockClear();
  mount(cache, 'context-a', 'store-2');
  await screen.findByText('目前收銀班別');
  expect(
    mocks.request.mock.calls.find(([path]) => path.endsWith('/orders'))?.[4]?.cursor,
  ).toBeUndefined();
  expect(screen.queryByRole('button', { name: '回到第一頁待處理訂單' })).toBeNull();
  expect(cache.get('merchant-food:campus-one:store-1:cursor')).toBe('page-2');
});

it('offers first-page recovery when a restored cursor is no longer accepted', async () => {
  const cache = new Map<string, unknown>([
    ['merchant-food:campus-one:store-1:cursor', 'expired-page'],
  ]);
  mocks.request.mockImplementation((path, context, input, _unused, query) => {
    if (path.endsWith('/orders') && query?.cursor)
      return Promise.reject(new NuniError(422, 'INVALID_INPUT'));
    return respond(path, context, input);
  });
  mount(cache);
  await screen.findByRole('alert');
  expect(screen.queryByText('取餐 A101 · 待付款')).toBeNull();
  fireEvent.click(button('回到第一頁待處理訂單'));
  await screen.findByText('取餐 A101 · 待付款');
  expect(cache.get('merchant-food:campus-one:store-1:cursor')).toBeUndefined();
  const reads = mocks.request.mock.calls.filter(([path]) => path.endsWith('/orders'));
  expect(reads[0][4]).toMatchObject({ cursor: 'expired-page' });
  expect(reads.at(-1)?.[4]?.cursor).toBeUndefined();
  expect(mocks.request.mock.calls.filter(([, , input]) => input)).toHaveLength(0);
});
