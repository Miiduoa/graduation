import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { FoodWorkspace } from './FoodWorkspace';
import { loadFoodPending, saveFoodPending } from './foodPersistence';
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
  SiteShell: ({
    title,
    subtitle,
    children,
  }: {
    title?: string;
    subtitle?: string;
    children: React.ReactNode;
  }) => (
    <main>
      {title ? <h1>{title}</h1> : null}
      {subtitle ? <p>{subtitle}</p> : null}
      {children}
    </main>
  ),
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
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  sessionStorage.clear();
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
  await waitFor(() =>
    expect(
      screen.queryByRole('region', { name: '點餐菜單' }) ||
        screen.queryByRole('button', { name: '查看菜單：米飯店' }),
    ).toBeTruthy(),
  );
  const store = screen.queryByRole('button', { name: '查看菜單：米飯店' });
  if (store) fireEvent.click(store);
  await screen.findByLabelText('蔬菜便當 數量');
  fireEvent.change(screen.getByLabelText('蔬菜便當 數量'), { target: { value: '1' } });
}

it('opens a focused menu and restores the same cart after returning to the store list', async () => {
  render(<FoodWorkspace />);
  fireEvent.click(await screen.findByRole('button', { name: '查看菜單：米飯店' }));
  await screen.findByLabelText('蔬菜便當 數量');
  expect(screen.queryByRole('button', { name: '查看菜單：米飯店' })).toBeNull();
  expect(screen.queryByLabelText('加飯（+NT$20）')).toBeNull();
  fireEvent.click(button('增加蔬菜便當'));
  fireEvent.click(screen.getByLabelText('加飯（+NT$20）'));
  expect(screen.getByText('餐點試算')).toBeTruthy();
  fireEvent.click(button('返回店家列表'));
  expect(screen.queryByRole('region', { name: '點餐菜單' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: '查看菜單：米飯店' }));
  const quantity = (await screen.findByLabelText('蔬菜便當 數量')) as HTMLInputElement;
  expect(quantity.value).toBe('1');
  expect((screen.getByLabelText('加飯（+NT$20）') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(button('減少蔬菜便當'));
  expect(quantity.value).toBe('0');
  expect(screen.queryByLabelText('加飯（+NT$20）')).toBeNull();
  expect(button('計算金額與確認庫存').disabled).toBe(true);
  expect(
    mocks.request.mock.calls.some(([path, , input]) => path.endsWith('/quotes') && input),
  ).toBe(false);
});

it.each(['-1', '1.5', '21'])(
  'rejects invalid meal quantity %s without changing the cart or submitting',
  async (quantity) => {
    render(<FoodWorkspace />);
    await choose();
    fireEvent.change(screen.getByLabelText('蔬菜便當 數量'), { target: { value: quantity } });
    expect(screen.getByRole('alert').textContent).toContain('0–20 之間的整數');
    expect((screen.getByLabelText('蔬菜便當 數量') as HTMLInputElement).value).toBe('1');
    expect(
      mocks.request.mock.calls.some(([path, , input]) => path.endsWith('/quotes') && input),
    ).toBe(false);
  },
);

it('invalidates a confirmed quote when the quantity changes and enforces stepper boundaries', async () => {
  render(<FoodWorkspace />);
  await quote();
  fireEvent.click(screen.getByLabelText('我已確認餐點、取餐時間與應付金額'));
  fireEvent.click(button('增加蔬菜便當'));
  expect(screen.queryByRole('region', { name: '送出前確認' })).toBeNull();
  expect((screen.getByLabelText('蔬菜便當 數量') as HTMLInputElement).value).toBe('2');
  fireEvent.change(screen.getByLabelText('蔬菜便當 數量'), { target: { value: '20' } });
  expect(button('增加蔬菜便當').disabled).toBe(true);
  fireEvent.click(button('清除已選餐點'));
  expect((screen.getByLabelText('蔬菜便當 數量') as HTMLInputElement).value).toBe('0');
  expect(button('減少蔬菜便當').disabled).toBe(true);
  expect(button('計算金額與確認庫存').disabled).toBe(true);
  expect(
    mocks.request.mock.calls.some(([path, , input]) => path.endsWith('/orders') && input),
  ).toBe(false);
});

it('replaces a single-choice option directly while preserving the other cart fields', async () => {
  const menu = menuFixture();
  menu.sections[0].items[0].optionGroups[0].options.push({
    id: 'regular',
    name: '一般份量',
    priceDelta: { amountMinor: 0, currency: 'TWD' },
    available: true,
  });
  mocks.request.mockImplementation((path, context, input) => {
    if (path.endsWith('/menu')) return Promise.resolve(menu);
    if (path.endsWith('/quotes')) {
      const result = quoteFixture(input.requestedPickupAt);
      const price = { amountMinor: 100, currency: 'TWD' as const };
      result.lines[0].selectedOptions = [
        {
          optionId: 'regular',
          nameSnapshot: '一般份量',
          priceDelta: { amountMinor: 0, currency: 'TWD' },
        },
      ];
      result.lines[0].unitPrice = price;
      result.lines[0].lineTotal = price;
      result.subtotal = price;
      result.total = price;
      return Promise.resolve(result);
    }
    return respond(path, context, input);
  });
  render(<FoodWorkspace />);
  await choose();
  fireEvent.click(screen.getByLabelText('加飯（+NT$20）'));
  fireEvent.click(screen.getByLabelText('一般份量（+NT$0）'));
  expect((screen.getByLabelText('加飯（+NT$20）') as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText('一般份量（+NT$0）') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(button('計算金額與確認庫存'));
  await screen.findByRole('region', { name: '送出前確認' });
  const payload = mocks.request.mock.calls.find(([path]) => path.endsWith('/quotes'))?.[2];
  expect(payload.items).toEqual([
    { menuItemId: 'rice', quantity: 1, selectedOptionIds: ['regular'] },
  ]);
});

it.each(['removed', 'unavailable'])(
  'requires correction when a selected optional choice is %s after refreshing',
  async (change) => {
    let menu = menuFixture();
    menu.sections[0].items[0].optionGroups[0].minimumSelections = 0;
    mocks.request.mockImplementation((path, context, input) =>
      path.endsWith('/menu') ? Promise.resolve(menu) : respond(path, context, input),
    );
    render(<FoodWorkspace />);
    await choose();
    fireEvent.click(screen.getByLabelText('加飯（+NT$20）'));
    menu = menuFixture();
    const group = menu.sections[0].items[0].optionGroups[0];
    group.minimumSelections = 0;
    if (change === 'removed') group.options = [];
    else group.options[0].available = false;
    fireEvent.click(button('更新菜單'));
    await screen.findByText('部分口味已變更或暫停供應，請重新選擇。');
    fireEvent.click(button('計算金額與確認庫存'));
    expect(screen.getByText('餐點選項已有更新，請重新選擇口味後再確認。')).toBeTruthy();
    expect(mocks.request.mock.calls.some(([path]) => path.endsWith('/quotes'))).toBe(false);
    fireEvent.click(button('重設蔬菜便當選項'));
    expect(screen.queryByText('部分口味已變更或暫停供應，請重新選擇。')).toBeNull();
    expect(screen.queryByText('餐點選項已有更新，請重新選擇口味後再確認。')).toBeNull();
    expect((screen.getByLabelText('蔬菜便當 數量') as HTMLInputElement).value).toBe('1');
  },
);

it('drops a removed single-choice ID when choosing its replacement and quotes only the new option', async () => {
  let menu = menuFixture();
  mocks.request.mockImplementation((path, context, input) => {
    if (path.endsWith('/menu')) return Promise.resolve(menu);
    if (path.endsWith('/quotes')) {
      const result = quoteFixture(input.requestedPickupAt);
      result.lines[0].selectedOptions = [
        {
          optionId: 'replacement',
          nameSnapshot: '新份量',
          priceDelta: { amountMinor: 20, currency: 'TWD' },
        },
      ];
      return Promise.resolve(result);
    }
    return respond(path, context, input);
  });
  render(<FoodWorkspace />);
  await choose();
  fireEvent.click(screen.getByLabelText('加飯（+NT$20）'));
  menu = menuFixture();
  menu.sections[0].items[0].optionGroups[0].options = [
    {
      id: 'replacement',
      name: '新份量',
      available: true,
      priceDelta: { amountMinor: 20, currency: 'TWD' },
    },
  ];
  fireEvent.click(button('更新菜單'));
  await screen.findByText('部分口味已變更或暫停供應，請重新選擇。');
  fireEvent.click(screen.getByLabelText('新份量（+NT$20）'));
  expect(screen.queryByText('部分口味已變更或暫停供應，請重新選擇。')).toBeNull();
  fireEvent.click(button('計算金額與確認庫存'));
  await screen.findByRole('region', { name: '送出前確認' });
  const payload = mocks.request.mock.calls.find(([path]) => path.endsWith('/quotes'))?.[2];
  expect(payload.items).toEqual([
    { menuItemId: 'rice', quantity: 1, selectedOptionIds: ['replacement'] },
  ]);
});

async function quote() {
  await choose();
  fireEvent.click(screen.getByLabelText('加飯（+NT$20）'));
  fireEvent.click(button('計算金額與確認庫存'));
  await screen.findByRole('region', { name: '送出前確認' });
  await waitFor(() => expect(screen.queryByText('正在讀取菜單…')).toBeNull());
}

it('omits confirm-to-submit copy on /food when online ordering is off', async () => {
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'false');
  render(<FoodWorkspace />);
  expect(screen.getByText('目前還不能線上點餐')).toBeTruthy();
  expect(screen.queryByText('確認後才送出訂單')).toBeNull();
  expect(screen.queryByText('先看菜單與金額，確認後才送出訂單。')).toBeNull();
});

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
  expect(screen.getByRole('link', { name: 'App 餐廳訂單' }).getAttribute('href')).toBe('/orders');
  expect(screen.queryByRole('region', { name: '訂單紀錄' })).toBeNull();
  expect(screen.getByRole('region', { name: '訂單詳情' })).toBeTruthy();
  expect(screen.getByText('付款尚未完成。請依畫面指示結帳，或到櫃檯向店員確認。')).toBeTruthy();
  expect(screen.queryByLabelText('選擇點餐校園')).toBeNull();
  expect(screen.queryByLabelText('選擇訂單校園')).toBeNull();
  expect(screen.getByText(/訂單校園：第一校園/)).toBeTruthy();
});

it('surfaces pickup as the next step for a ready order without inventing credentials', async () => {
  order = readyOrder();
  render(<FoodWorkspace initialTenant="campus-one" initialOrder="order-1" />);
  await screen.findByText('米飯店 · 可以取餐');
  const detail = screen.getByRole('region', { name: '訂單詳情' });
  expect(detail.textContent).toContain('餐點好了。請到店出示取餐憑證。');
  expect(screen.getByRole('button', { name: '出示取餐憑證' })).toBeTruthy();
  expect(screen.queryByLabelText('一次性取餐憑證')).toBeNull();
  expect(screen.queryByText('已結束的訂單')).toBeNull();
  expect(screen.getByText('進行中的訂單')).toBeTruthy();
});

it('hides the order history while a detail is open and restores the list on back', async () => {
  order = orderFixture();
  render(<FoodWorkspace initialTenant="campus-one" initialOrder="order-1" />);
  await screen.findByText('米飯店 · 待付款');
  expect(screen.queryByRole('region', { name: '訂單紀錄' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '返回訂單列表' }));
  const list = await screen.findByRole('region', { name: '訂單紀錄' });
  expect(list).toBeTruthy();
  expect(screen.getByText('查看訂單，確認付款進度與方式。')).toBeTruthy();
  expect(screen.queryByRole('region', { name: '訂單詳情' })).toBeNull();
});

it('shows summary-ready next step in the list without requiring credential fields', async () => {
  order = readyOrder();
  render(<FoodWorkspace initialTenant="campus-one" initialOrder="order-1" />);
  await screen.findByText('米飯店 · 可以取餐');
  fireEvent.click(screen.getByRole('button', { name: '返回訂單列表' }));
  await screen.findByRole('region', { name: '訂單紀錄' });
  expect(screen.getByText('餐點好了，查看訂單並出示取餐憑證。')).toBeTruthy();
  expect(screen.queryByLabelText('一次性取餐憑證')).toBeNull();
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
  const paper = screen.getByRole('region', { name: '訂單紙本明細' });
  expect(paper.textContent).not.toContain('t'.repeat(43));
  expect(within(paper).queryByLabelText('一次性取餐憑證')).toBeNull();
  mocks.request.mockRejectedValueOnce(new NuniError(403, 'FORBIDDEN'));
  fireEvent.click(button('更新這筆訂單'));
  await screen.findByText(/目前無法確認使用權限/);
  expect(screen.queryByLabelText('一次性取餐憑證')).toBeNull();
  expect(screen.queryByRole('region', { name: '訂單紙本明細' })).toBeNull();
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

it('keeps placed orders visible and does not invite a new order while online ordering is off', async () => {
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'false');
  render(<FoodWorkspace initialTenant="campus-one" initialOrder="order-1" />);
  expect(screen.getByText('目前還不能線上點餐')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '我要點餐' })).toBeNull();
  expect(screen.queryByRole('button', { name: '查看菜單：米飯店' })).toBeNull();
  expect(screen.queryByText('先看菜單與金額，確認後才送出訂單。')).toBeNull();
  await screen.findByText('米飯店 · 待付款');
  expect(screen.getByRole('link', { name: 'App 餐廳訂單' }).getAttribute('href')).toBe('/orders');
  expect(screen.queryByRole('button', { name: '我的訂單與取餐' })).toBeNull();
  expect(screen.getByRole('button', { name: '重新整理' })).toBeTruthy();
});

it('does not read private food data without a platform session', () => {
  mocks.auth.session = null;
  render(<FoodWorkspace />);
  expect(screen.getByRole('link', { name: '登入後點餐' })).toBeTruthy();
  expect(mocks.request).not.toHaveBeenCalled();
});

it('does not invite a second payment while authorization is still settling', async () => {
  order = {
    ...orderFixture(),
    allowedActions: ['create-payment-session', 'cancel'],
    paymentSession: {
      id: 'payment-1',
      orderId: 'order-1',
      method: 'credit-card',
      progress: 'authorized-awaiting-settlement',
      checkoutUrl: 'https://pay.example/checkout',
      expiresAt: future,
      allowedActions: [],
    },
  };
  render(<FoodWorkspace initialTenant="campus-one" initialOrder="order-1" />);
  await screen.findByText('付款確認中，請稍候或更新這筆訂單。');
  expect(screen.getByText('付款進度：等待入帳')).toBeTruthy();
  expect(screen.queryByText('付款進度：已入帳')).toBeNull();
  expect(screen.getByRole('region', { name: '訂單紙本明細' }).textContent).not.toMatch(
    /已付款|已入帳/,
  );
  expect(screen.queryByRole('button', { name: '信用卡結帳' })).toBeNull();
  expect(screen.queryByRole('link', { name: '前往安全付款頁面' })).toBeNull();
  expect(screen.queryByText(/請選擇付款方式/)).toBeNull();
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
  expect(
    loadFoodPending('account-a', 'food:cart:campus-one:store-1')?.input.idempotencyKey,
  ).toEqual(expect.any(String));
  mocks.auth.pendingLogout = true;
  view.rerender(<FoodWorkspace />);
  expect(screen.queryByRole('button', { name: '重試同一份操作' })).toBeNull();
  expect(loadFoodPending('account-a', 'food:cart:campus-one:store-1')).toBeNull();
  mocks.auth.pendingLogout = false;
  mocks.auth.session = { platformAccountId: 'account-a', context: 'after-logout' };
  view.rerender(<FoodWorkspace />);
  await choose();
  expect(screen.queryByRole('button', { name: '重試同一份操作' })).toBeNull();
  expect(screen.queryByRole('region', { name: '送出前確認' })).toBeNull();
});

it('restores the durable pending order key after a cold Map and keeps storage failure offline', async () => {
  const scope = 'food:cart:campus-one:store-1';
  const saved = {
    action: 'order',
    input: { quoteId: 'quote-1', idempotencyKey: 'food-cold-start-key-0001' },
  };
  saveFoodPending('account-a', scope, saved);
  render(<FoodWorkspace />);
  fireEvent.click(await screen.findByRole('button', { name: '查看菜單：米飯店' }));
  await screen.findByRole('button', { name: '重試同一份操作' });
  fireEvent.click(button('重試同一份操作'));
  await screen.findByText('米飯店 · 待付款');
  const writes = mocks.request.mock.calls.filter(
    ([path, , input]) => path.endsWith('/orders') && input,
  );
  expect(writes[0][2].idempotencyKey).toBe('food-cold-start-key-0001');

  mocks.request.mockClear();
  fireEvent.click(button('我要點餐'));
  await quote();
  fireEvent.click(screen.getByLabelText('我已確認餐點、取餐時間與應付金額'));
  const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  try {
    fireEvent.click(button('確認送出訂單'));
    await screen.findByText(/目前無法安全保存/);
    expect(
      mocks.request.mock.calls.some(([path, , input]) => path.endsWith('/orders') && input),
    ).toBe(false);
  } finally {
    blocked.mockRestore();
  }
});

it('quietly polls order detail to ready/fulfilled, drops the QR, and skips hidden polling', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  order = readyOrder();
  render(<FoodWorkspace initialTenant="campus-one" initialOrder="order-1" />);
  fireEvent.click(await screen.findByRole('button', { name: '出示取餐憑證' }));
  expect(screen.getByLabelText('一次性取餐憑證')).toBeTruthy();
  const before = mocks.request.mock.calls.filter(([path]) => path.endsWith('/order-1')).length;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'hidden',
  });
  document.dispatchEvent(new Event('visibilitychange'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(mocks.request.mock.calls.filter(([path]) => path.endsWith('/order-1')).length).toBe(
    before,
  );
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
  order = {
    ...readyOrder(),
    state: 'fulfilled',
    allowedActions: [],
    pickup: {
      state: 'fulfilled',
      displayCode: 'A101',
      readyAt: future,
      calls: [],
      callCount: 0,
      allowedActions: [],
    },
  };
  document.dispatchEvent(new Event('visibilitychange'));
  await screen.findByText('米飯店 · 已取餐');
  expect(screen.queryByLabelText('一次性取餐憑證')).toBeNull();
  expect(screen.queryByRole('button', { name: '出示取餐憑證' })).toBeNull();
  vi.useRealTimers();
});

it.each([
  {
    name: 'a restored platform session',
    session: { platformAccountId: 'account-a', context: 'context-a' },
    ready: '我要點餐',
  },
  {
    name: 'a signed-out account',
    session: null,
    ready: '登入後點餐',
  },
])(
  'hydrates /food against the server loading markup after resolving $name',
  async ({ session, ready }) => {
    mocks.auth.session = null;
    mocks.auth.loading = true;
    const app = <FoodWorkspace />;
    const container = document.createElement('div');
    container.innerHTML = renderToString(app);
    document.body.append(container);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('正在確認帳號…');
    mocks.auth.session = session;
    mocks.auth.loading = false;
    const onRecoverableError = vi.fn();
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, app, { onRecoverableError });
      });
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(screen.getByRole(session ? 'button' : 'link', { name: ready })).toBeTruthy();
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  },
);

it.each(['accepted', 'preparing', 'ready', 'fulfilled'] as const)(
  'shows the paper order detail without inventing payment confirmation for %s',
  async (state) => {
    order = { ...readyOrder(), state };
    render(<FoodWorkspace initialTenant="campus-one" initialOrder="order-1" />);
    const paper = await screen.findByRole('region', { name: '訂單紙本明細' });
    expect(within(paper).getByText('非統一發票')).toBeTruthy();
    expect(paper.textContent).toContain('NT$120');
    expect(paper.textContent).not.toMatch(/已付款|已入帳|付款成功/);
    expect(paper.textContent).not.toContain(order.pickup.credential!.token);
    expect(paper.querySelector('img, canvas, svg')).toBeNull();
    expect(screen.queryByText('付款進度：已入帳')).toBeNull();
  },
);
