import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { FoodWorkspace } from './FoodWorkspace';
import {
  future,
  menuFixture,
  orderFixture,
  orderSummary,
  quoteFixture,
  readyOrder,
} from './foodTestFixtures';
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  auth: {
    session: { platformAccountId: 'account-a', context: 'context-a' } as {
      platformAccountId: string;
      context: string;
    } | null,
    loading: false,
    error: '',
    pendingLogout: false,
    refresh: vi.fn(),
  },
}));
vi.mock('@/features/nuni/Session', () => ({
  browserRequest: mocks.request,
  useNuniSession: () => mocks.auth,
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/NuniSignIn', () => ({
  NuniSignIn: ({ returnUrl }: { returnUrl: string }) => <a href={returnUrl}>登入後點餐</a>,
}));
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,AA==') },
}));
let order = orderFixture();
let publicOpen = true;
async function respond(path: string, _context: string, input?: Record<string, unknown>) {
  if (path === 'realms')
    return {
      realms: publicOpen ? [{ tenantId: 'campus-one', name: '第一校園', services: ['food'] }] : [],
    };
  if (path === 'food-order-realms')
    return { realms: [{ tenantId: 'campus-one', name: '第一校園' }] };
  if (path.endsWith('/locations')) return { locations: [menuFixture().location] };
  if (path.endsWith('/menu')) return menuFixture();
  if (path.endsWith('/quotes')) return quoteFixture(input?.requestedPickupAt as string);
  if (path.endsWith('/orders') && input)
    return { orderId: order.id, state: 'payment-pending', updatedAt: future, replayed: false };
  if (path.endsWith('/orders')) return { orders: [orderSummary(order)] };
  if (path.endsWith('/cancel')) {
    order = { ...order, state: 'canceled', allowedActions: [] };
    return { orderId: order.id, state: 'canceled', updatedAt: future, replayed: false };
  }
  if (path.endsWith('/order-1')) return order;
  throw new Error(`Unexpected ${path}`);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.session = { platformAccountId: 'account-a', context: 'context-a' };
  mocks.auth.error = '';
  mocks.auth.loading = false;
  mocks.auth.pendingLogout = false;
  order = orderFixture();
  publicOpen = true;
  mocks.request.mockImplementation(respond);
  window.history.replaceState(null, '', '/food');
});
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
async function choose() {
  fireEvent.click(await screen.findByRole('button', { name: '查看菜單：米飯店' }));
  await screen.findByLabelText('蔬菜便當 數量');
  fireEvent.change(screen.getByLabelText('蔬菜便當 數量'), { target: { value: '1' } });
}
async function quote() {
  await choose();
  fireEvent.click(screen.getByLabelText('加飯（+NT$20）'));
  fireEvent.click(button('計算金額與確認庫存'));
  await screen.findByRole('region', { name: '送出前確認' });
  await waitFor(() => expect(screen.queryByText('正在讀取菜單…')).toBeNull());
}

it('requires options and final confirmation, then shows the actual order and keeps legacy entrances', async () => {
  render(<FoodWorkspace />);
  await choose();
  fireEvent.click(button('計算金額與確認庫存'));
  await screen.findByText(/請選擇餐點/);
  expect(mocks.request.mock.calls.some(([path]) => path.endsWith('/quotes'))).toBe(false);
  fireEvent.click(screen.getByLabelText('加飯（+NT$20）'));
  fireEvent.click(button('計算金額與確認庫存'));
  await screen.findByText('應付 NT$120');
  await waitFor(() => expect(screen.queryByText('正在讀取菜單…')).toBeNull());
  expect(button('確認送出訂單').disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('我已確認餐點、取餐時間與應付金額'));
  fireEvent.click(button('確認送出訂單'));
  await screen.findByText('米飯店 · 待付款');
  expect(window.location.search).toContain('order=order-1');
  const payload = mocks.request.mock.calls.find(([path]) => path.endsWith('/quotes'))?.[2];
  expect(payload.items).toEqual([
    { menuItemId: 'rice', quantity: 1, selectedOptionIds: ['large'] },
  ]);
  expect(screen.getByRole('link', { name: '原有餐廳訂單' }).getAttribute('href')).toBe('/orders');
});

it('retries the identical order after an unknown result and transient account error, without a second key', async () => {
  let attempts = 0;
  mocks.request.mockImplementation((path, context, input) =>
    path.endsWith('/orders') && input && ++attempts === 1
      ? Promise.reject(new NuniError(0, 'NETWORK_ERROR'))
      : respond(path, context, input),
  );
  const view = render(<FoodWorkspace />);
  await quote();
  fireEvent.click(screen.getByLabelText('我已確認餐點、取餐時間與應付金額'));
  fireEvent.click(button('確認送出訂單'));
  await screen.findByText(/尚未確認這次操作的結果/);
  mocks.auth.session = null;
  mocks.auth.error = '暫時離線';
  view.rerender(<FoodWorkspace />);
  expect(screen.queryByLabelText('蔬菜便當 數量')).toBeNull();
  mocks.auth.session = { platformAccountId: 'account-a', context: 'context-renewed' };
  mocks.auth.error = '';
  view.rerender(<FoodWorkspace />);
  await screen.findByRole('button', { name: '重試同一份操作' });
  fireEvent.click(button('重試同一份操作'));
  await screen.findByText('米飯店 · 待付款');
  const writes = mocks.request.mock.calls.filter(
    ([path, , input]) => path.endsWith('/orders') && input,
  );
  expect(writes).toHaveLength(2);
  expect(writes[1][2]).toEqual(writes[0][2]);
  expect(writes[1][1]).toBe('context-renewed');
});

it('clears the cart when switching verified accounts and ignores the prior quote response', async () => {
  let finish!: (value: unknown) => void;
  mocks.request.mockImplementation((path, context, input) =>
    path.endsWith('/quotes')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : respond(path, context, input),
  );
  const view = render(<FoodWorkspace />);
  await choose();
  fireEvent.click(screen.getByLabelText('加飯（+NT$20）'));
  fireEvent.click(button('計算金額與確認庫存'));
  mocks.auth.session = { platformAccountId: 'account-b', context: 'context-b' };
  view.rerender(<FoodWorkspace />);
  fireEvent.click(await screen.findByRole('button', { name: '查看菜單：米飯店' }));
  await screen.findByLabelText('蔬菜便當 數量');
  await act(async () => finish(quoteFixture()));
  expect((screen.getByLabelText('蔬菜便當 數量') as HTMLInputElement).value).toBe('0');
  expect(screen.queryByRole('region', { name: '送出前確認' })).toBeNull();
});

it('keeps historical orders available after all public locations pause and only reveals a permitted live token', async () => {
  publicOpen = false;
  order = readyOrder();
  render(<FoodWorkspace initialTenant="campus-one" initialOrder="order-1" />);
  await screen.findByText('米飯店 · 可以取餐');
  expect(screen.queryByLabelText('一次性取餐憑證')).toBeNull();
  fireEvent.click(button('出示取餐憑證'));
  expect(screen.getByLabelText('一次性取餐憑證').textContent).toBe('t'.repeat(43));
  mocks.request.mockRejectedValueOnce(new NuniError(403, 'FORBIDDEN'));
  fireEvent.click(button('更新這筆訂單'));
  await screen.findByText(/目前無法確認使用權限/);
  expect(screen.queryByLabelText('一次性取餐憑證')).toBeNull();
  expect(mocks.request).toHaveBeenCalledWith(
    'food-order-realms',
    'context-a',
    undefined,
    undefined,
    undefined,
  );
});

it('never shows an already expired pickup credential', async () => {
  order = readyOrder();
  order.pickup.credential!.expiresAt = '2000-01-01T00:00:00.000Z';
  render(<FoodWorkspace initialTenant="campus-one" initialOrder="order-1" />);
  await screen.findByText('米飯店 · 可以取餐');
  expect(screen.queryByRole('button', { name: '出示取餐憑證' })).toBeNull();
  expect(screen.queryByLabelText('一次性取餐憑證')).toBeNull();
});

it('requires cancellation confirmation and preserves the same cancellation after a timeout', async () => {
  let attempts = 0;
  mocks.request.mockImplementation((path, context, input) =>
    path.endsWith('/cancel') && ++attempts === 1
      ? Promise.reject(new NuniError(502, 'UPSTREAM_ERROR'))
      : respond(path, context, input),
  );
  render(<FoodWorkspace initialTenant="campus-one" initialOrder="order-1" />);
  await screen.findByText('米飯店 · 待付款');
  expect(button('確認取消訂單').disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('我確認要取消這筆訂單'));
  fireEvent.click(button('確認取消訂單'));
  await screen.findByText(/尚未確認這次操作的結果/);
  fireEvent.click(button('重試同一份操作'));
  await screen.findByText('米飯店 · 已取消');
  const writes = mocks.request.mock.calls.filter(([path]) => path.endsWith('/cancel'));
  expect(writes[1][2]).toEqual(writes[0][2]);
});

it('rereads a rejected quote and keeps editable cart contents without offering stale confirmation', async () => {
  mocks.request.mockImplementation((path, context, input) =>
    path.endsWith('/quotes')
      ? Promise.reject(new NuniError(409, 'FOOD_STOCK_CHANGED'))
      : respond(path, context, input),
  );
  render(<FoodWorkspace />);
  await choose();
  fireEvent.click(screen.getByLabelText('加飯（+NT$20）'));
  fireEvent.click(button('計算金額與確認庫存'));
  await screen.findByText(/訂單或班別已有變更/);
  await waitFor(() => expect(button('計算金額與確認庫存').disabled).toBe(false));
  expect((screen.getByLabelText('蔬菜便當 數量') as HTMLInputElement).value).toBe('1');
  expect(screen.queryByRole('button', { name: '確認送出訂單' })).toBeNull();
});

it('does not read private food data without a platform session', () => {
  mocks.auth.session = null;
  render(<FoodWorkspace />);
  expect(screen.getByRole('link', { name: '登入後點餐' })).toBeTruthy();
  expect(mocks.request).not.toHaveBeenCalled();
});

it('uses only offered payment methods and never treats a failed checkout session as paid', async () => {
  order.allowedActions = ['cancel', 'create-payment-session'];
  mocks.request.mockImplementation((path, context, input) => {
    if (path.endsWith('/payment-methods'))
      return {
        methods: [
          {
            method: 'credit-card',
            label: '信用卡結帳',
            available: true,
            refundRoute: 'in-app',
            settlesImmediately: false,
          },
          {
            method: 'mobile-pay',
            label: '行動支付',
            available: false,
            unavailableMessage: '尚未開通',
            refundRoute: 'none',
            settlesImmediately: false,
          },
        ],
      };
    if (path.endsWith('/payment-session'))
      return {
        id: 'payment-1',
        orderId: 'order-1',
        method: 'credit-card',
        progress: 'failed',
        checkoutUrl: '',
        expiresAt: future,
        failureReason: '付款服務暫時無法使用',
        allowedActions: ['start-over'],
      };
    return respond(path, context, input);
  });
  render(<FoodWorkspace initialTenant="campus-one" initialOrder="order-1" />);
  await screen.findByRole('button', { name: '信用卡結帳' });
  expect(button('行動支付').disabled).toBe(true);
  fireEvent.click(button('信用卡結帳'));
  await screen.findByText('付款進度：付款未完成');
  expect(screen.getByText('米飯店 · 待付款')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '前往安全付款頁面' })).toBeNull();
});

it('hides an already revealed token as soon as its lifetime ends', async () => {
  order = readyOrder();
  order.pickup.credential!.expiresAt = new Date(Date.now() + 60_000).toISOString();
  render(<FoodWorkspace initialTenant="campus-one" initialOrder="order-1" />);
  fireEvent.click(await screen.findByRole('button', { name: '出示取餐憑證' }));
  expect(screen.getByLabelText('一次性取餐憑證')).toBeTruthy();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
  try {
    await waitFor(() => expect(screen.queryByLabelText('一次性取餐憑證')).toBeNull(), {
      timeout: 1600,
    });
  } finally {
    clock.mockRestore();
  }
});

it('discards an uncertain order when the user logs out and then signs in again', async () => {
  mocks.request.mockImplementation((path, context, input) =>
    path.endsWith('/orders') && input
      ? Promise.reject(new NuniError(0, 'NETWORK_ERROR'))
      : respond(path, context, input),
  );
  const view = render(<FoodWorkspace />);
  await quote();
  fireEvent.click(screen.getByLabelText('我已確認餐點、取餐時間與應付金額'));
  fireEvent.click(button('確認送出訂單'));
  await screen.findByText(/尚未確認這次操作的結果/);
  mocks.auth.pendingLogout = true;
  view.rerender(<FoodWorkspace />);
  expect(screen.queryByRole('button', { name: '重試同一份操作' })).toBeNull();
  mocks.auth.pendingLogout = false;
  mocks.auth.session = { platformAccountId: 'account-a', context: 'after-logout' };
  view.rerender(<FoodWorkspace />);
  await choose();
  expect(screen.queryByRole('button', { name: '重試同一份操作' })).toBeNull();
  expect(screen.queryByRole('region', { name: '送出前確認' })).toBeNull();
});
