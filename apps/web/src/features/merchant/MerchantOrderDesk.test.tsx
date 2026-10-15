import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import type {
  NuniFoodShiftProjection,
  NuniFoodStaffOrderQueueItem,
} from '@campus/shared/src/nuniFood';
import { future, money, queueFixture, shiftFixture } from '@/features/food/foodTestFixtures';
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
