import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { orderFixture, orderSummary, readyOrder } from '@/features/food/foodTestFixtures';
import { loadFoodPending, saveFoodPending } from '@/features/food/foodPersistence';

const harness = vi.hoisted(() => ({
  account: 'pa_11111111-1111-4111-8111-111111111111' as string | null,
  context: 'session-a',
  loading: false,
  error: '',
  pendingLogout: false,
  legacyUid: null as string | null,
  schoolId: 'pu' as string | null,
  schoolName: '靜宜大學',
  campusStatus: 'ready',
  search: '',
  request: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  legacyRead: vi.fn(),
  legacyStop: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(harness.search),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children, title }: { children: ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({
    user: harness.legacyUid ? { uid: harness.legacyUid, isAnonymous: false } : null,
    loading: false,
    error: null,
  }),
}));
vi.mock('@/features/nuni/Session', () => ({
  useOptionalNuniSession: () => ({
    session: harness.account
      ? {
          platformAccountId: harness.account,
          context: harness.context,
        }
      : null,
    loading: harness.loading,
    error: harness.error,
    pendingLogout: harness.pendingLogout,
    refresh: harness.refresh,
    logout: harness.logout,
  }),
  browserRequest: harness.request,
}));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({
    status: harness.campusStatus,
    schoolId: harness.schoolId,
    schoolName: harness.schoolName,
    schoolSearch: `?campus=${harness.schoolId ?? 'all'}`,
  }),
}));
vi.mock('@/components/SchoolScopePlaceholder', () => ({
  SchoolScopePlaceholder: () => <p>先選擇要瀏覽的校園</p>,
}));
vi.mock('@/lib/myOrders', () => ({
  watchMyOrders: (...args: unknown[]) => harness.legacyRead(...args),
  watchMyOrder: vi.fn(),
}));
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,AA==') },
}));

import OrdersPage from './page';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'false');
  sessionStorage.clear();
  window.history.replaceState(null, '', '/orders?campus=pu');
  harness.account = 'pa_11111111-1111-4111-8111-111111111111';
  harness.context = 'session-a';
  harness.loading = false;
  harness.error = '';
  harness.pendingLogout = false;
  harness.legacyUid = null;
  harness.schoolId = 'pu';
  harness.schoolName = '靜宜大學';
  harness.campusStatus = 'ready';
  harness.search = '';
  harness.request.mockImplementation(async (path: string) => {
    if (path === 'food-order-realms') return { realms: [{ tenantId: 'pu', name: '靜宜大學' }] };
    if (path === 'realms/pu/food/orders') return { orders: [orderSummary(readyOrder())] };
    if (path === 'realms/pu/food/orders/order-1') return readyOrder();
    throw new Error(`Unexpected API path: ${path}`);
  });
  harness.legacyRead.mockImplementation((_uid, _schoolId, next) => {
    next(
      [
        {
          id: 'co_legacy',
          shop: 'App 餐廳',
          total: 100,
          status: 'ready',
          queueNumber: 7,
          createdAt: null,
          items: [],
          cancelledBy: null,
          cancelReason: null,
        },
      ],
      false,
    );
    return harness.legacyStop;
  });
});

it('Google-only accounts read real platform orders and receipts on /orders while public ordering stays off', async () => {
  render(<OrdersPage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看訂單：order-1' }));
  const receipt = await screen.findByRole('region', { name: '訂單紙本明細' });
  expect(within(receipt).getByText('蔬菜便當')).toBeTruthy();
  expect(screen.getByRole('button', { name: '出示取餐憑證' })).toBeTruthy();
  expect(harness.request).toHaveBeenCalledWith(
    'food-order-realms',
    'session-a',
    undefined,
    undefined,
    undefined,
  );
  expect(harness.request).toHaveBeenCalledWith(
    'realms/pu/food/orders/order-1',
    'session-a',
    undefined,
    undefined,
    undefined,
  );
  expect(harness.legacyRead).not.toHaveBeenCalled();
  expect(harness.request.mock.calls.every(([path]) => !String(path).includes('demo'))).toBe(true);
  expect(screen.queryByRole('button', { name: '我要點餐' })).toBeNull();
  expect(window.location.pathname).toBe('/orders');
  expect(new URLSearchParams(window.location.search).get('order')).toBe('order-1');
  fireEvent.click(screen.getByRole('button', { name: '返回訂單列表' }));
  expect(window.location.pathname).toBe('/orders');
  expect(new URLSearchParams(window.location.search).has('order')).toBe(false);
});

it('keeps Firebase-only history visible and lets an account with both sessions choose its order source', async () => {
  harness.account = null;
  harness.legacyUid = 'firebase-a';
  const view = render(<OrdersPage />);
  expect(screen.getByText('取餐號碼 7')).toBeTruthy();
  expect(harness.legacyRead).toHaveBeenCalledWith(
    'firebase-a',
    'pu',
    expect.any(Function),
    expect.any(Function),
  );
  expect(harness.request).not.toHaveBeenCalled();
  harness.account = 'pa_11111111-1111-4111-8111-111111111111';
  view.rerender(<OrdersPage />);
  await screen.findByRole('button', { name: '查看訂單：order-1' });
  expect(screen.queryByText('取餐號碼 7')).toBeNull();
  expect(harness.legacyStop).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'App 餐廳訂單' }));
  expect(screen.getByText('取餐號碼 7')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '查看訂單：order-1' })).toBeNull();
});

it('automatically shows Firebase history after the platform session finishes loading as signed out', () => {
  harness.account = null;
  harness.legacyUid = 'firebase-a';
  harness.loading = true;
  const view = render(<OrdersPage />);
  expect(screen.getByRole('status').textContent).toBe('正在確認 Google 帳號…');
  expect(harness.legacyRead).not.toHaveBeenCalled();

  harness.loading = false;
  view.rerender(<OrdersPage />);
  expect(screen.getByText('取餐號碼 7')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'App 餐廳訂單' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('link', { name: '登入' })).toBeNull();
  expect(harness.request).not.toHaveBeenCalled();
});

it('prioritizes a valid platform order link over an existing Firebase session', () => {
  harness.account = null;
  harness.legacyUid = 'firebase-a';
  harness.search = 'tenant=pu&order=order-1';
  render(<OrdersPage />);
  expect(screen.getByRole('button', { name: '站內點餐訂單' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('link', { name: '登入' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Forders%3Fcampus%3Dpu%26tenant%3Dpu%26order%3Dorder-1',
  );
  expect(harness.legacyRead).not.toHaveBeenCalled();
  expect(harness.request).not.toHaveBeenCalled();
});

it.each(['站內點餐訂單', 'App 餐廳訂單'])(
  'preserves an explicit %s choice when platform session loading changes',
  (source) => {
    harness.account = null;
    harness.legacyUid = 'firebase-a';
    harness.loading = true;
    const view = render(<OrdersPage />);
    fireEvent.click(screen.getByRole('button', { name: source }));

    harness.loading = false;
    view.rerender(<OrdersPage />);
    expect(screen.getByRole('button', { name: source }).getAttribute('aria-pressed')).toBe('true');
    if (source === '站內點餐訂單') {
      expect(screen.getByRole('link', { name: '登入' })).toBeTruthy();
      expect(screen.queryByText('取餐號碼 7')).toBeNull();
    } else {
      expect(screen.getByText('取餐號碼 7')).toBeTruthy();
      expect(screen.queryByRole('link', { name: '登入' })).toBeNull();
    }

    harness.loading = true;
    view.rerender(<OrdersPage />);
    expect(screen.getByRole('button', { name: source }).getAttribute('aria-pressed')).toBe('true');
    if (source === 'App 餐廳訂單') expect(screen.getByText('取餐號碼 7')).toBeTruthy();
    else expect(screen.getByRole('status').textContent).toBe('正在確認 Google 帳號…');
    expect(harness.request).not.toHaveBeenCalled();
  },
);

it('does not turn failed or malformed API results into an empty order list', async () => {
  harness.request.mockRejectedValueOnce(new NuniError(503, 'TEMPORARILY_UNAVAILABLE'));
  render(<OrdersPage />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText(/沒有訂單紀錄|這個條件下沒有訂單/)).toBeNull();
  harness.request.mockResolvedValueOnce({ unexpected: [] });
  fireEvent.click(screen.getByRole('button', { name: '重新確認訂單校園' }));
  await screen.findByRole('alert');
  expect(screen.queryByText(/沒有訂單紀錄|這個條件下沒有訂單/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新確認訂單校園' }));
  await screen.findByRole('button', { name: '查看訂單：order-1' });
});

it('only reports no history after the server confirms the account has no matching order realm', async () => {
  harness.schoolId = 'nthu';
  harness.schoolName = '國立清華大學';
  render(<OrdersPage />);
  expect(await screen.findByText('這個 Google 帳號在國立清華大學目前沒有訂單紀錄。')).toBeTruthy();
  expect(harness.request.mock.calls.map(([path]) => path)).toEqual(['food-order-realms']);
  expect(screen.queryByText('米飯店')).toBeNull();
});

it.each(['account', 'session context'] as const)(
  'ignores a late order response from the previous Google %s',
  async (change) => {
    const oldOrders = deferred<unknown>();
    harness.request.mockImplementation(async (path: string, context: string) => {
      if (path === 'food-order-realms') return { realms: [{ tenantId: 'pu', name: '靜宜大學' }] };
      if (path === 'realms/pu/food/orders' && context === 'session-a') return oldOrders.promise;
      if (path === 'realms/pu/food/orders' && context === 'session-b')
        return {
          orders: [{ ...orderSummary(readyOrder()), id: 'order-b', locationName: 'B 帳號門市' }],
        };
      throw new Error(`Unexpected API path: ${path}`);
    });
    const view = render(<OrdersPage />);
    await waitFor(() =>
      expect(harness.request.mock.calls.some(([path]) => path === 'realms/pu/food/orders')).toBe(
        true,
      ),
    );
    if (change === 'account') harness.account = 'pa_22222222-2222-4222-8222-222222222222';
    harness.context = 'session-b';
    view.rerender(<OrdersPage />);
    await screen.findByText('B 帳號門市');
    await act(async () =>
      oldOrders.resolve({
        orders: [{ ...orderSummary(readyOrder()), locationName: 'A 帳號舊門市' }],
      }),
    );
    expect(screen.queryByText('A 帳號舊門市')).toBeNull();
    expect(screen.getByText('B 帳號門市')).toBeTruthy();
  },
);

it('hides the previous campus and ignores its late response when the selected campus changes', async () => {
  const puOrders = deferred<unknown>();
  harness.request.mockImplementation(async (path: string) => {
    if (path === 'food-order-realms')
      return {
        realms: [
          { tenantId: 'pu', name: '靜宜大學' },
          { tenantId: 'nthu', name: '國立清華大學' },
        ],
      };
    if (path === 'realms/pu/food/orders') return puOrders.promise;
    if (path === 'realms/nthu/food/orders')
      return {
        orders: [{ ...orderSummary(readyOrder()), id: 'order-nthu', locationName: '清華門市' }],
      };
    throw new Error(`Unexpected API path: ${path}`);
  });
  const view = render(<OrdersPage />);
  await waitFor(() =>
    expect(harness.request.mock.calls.some(([path]) => path === 'realms/pu/food/orders')).toBe(
      true,
    ),
  );
  harness.schoolId = 'nthu';
  harness.schoolName = '國立清華大學';
  view.rerender(<OrdersPage />);
  await screen.findByText('清華門市');
  await act(async () =>
    puOrders.resolve({ orders: [{ ...orderSummary(readyOrder()), locationName: '靜宜舊門市' }] }),
  );
  expect(screen.queryByText('靜宜舊門市')).toBeNull();
  expect(screen.getByText('清華門市')).toBeTruthy();
});

it.each(['loading', 'error', 'pendingLogout'] as const)(
  'unmounts private order details during %s and preserves uncertain intent until confirmed sign-out',
  async (status) => {
    const scope = 'food:order:pu:order-1';
    const pending = {
      action: 'cancel',
      input: { reason: 'changed-mind', idempotencyKey: 'uncertain-order-cancel-key' },
    };
    const view = render(<OrdersPage />);
    fireEvent.click(await screen.findByRole('button', { name: '查看訂單：order-1' }));
    await screen.findByRole('region', { name: '訂單紙本明細' });
    saveFoodPending(harness.account!, scope, pending);
    if (status === 'error') {
      harness.error = 'session-unavailable';
      harness.account = null;
    } else harness[status] = true;
    view.rerender(<OrdersPage />);
    expect(screen.queryByRole('region', { name: '訂單紙本明細' })).toBeNull();
    expect(screen.queryByRole('button', { name: '出示取餐憑證' })).toBeNull();
    expect(loadFoodPending('pa_11111111-1111-4111-8111-111111111111', scope)).toEqual(
      status === 'pendingLogout' ? null : pending,
    );
  },
);

it.each([
  'tenant=shu&order=order-1',
  'tenant=pu&order=bad.id',
  'tenant=pu&order=one&order=two',
  'order=order-1',
])('rejects malformed or cross-campus platform links before fetching: %s', (search) => {
  harness.search = search;
  render(<OrdersPage />);
  expect(screen.getByRole('alert').textContent).toContain('訂單連結無效');
  expect(harness.request).not.toHaveBeenCalled();
});

it.each([
  ['tw-pu', 'pu'],
  ['pu', 'tw-pu'],
])(
  'matches the Providence alias %s only to the authorized realm %s',
  async (linkTenant, serverTenant) => {
    harness.search = `tenant=${linkTenant}&order=order-1`;
    harness.request.mockImplementation(async (path: string) => {
      if (path === 'food-order-realms')
        return { realms: [{ tenantId: serverTenant, name: '靜宜大學' }] };
      if (path === `realms/${serverTenant}/food/orders`)
        return { orders: [orderSummary(readyOrder())] };
      if (path === `realms/${serverTenant}/food/orders/order-1`) return readyOrder();
      throw new Error(`Unexpected API path: ${path}`);
    });
    render(<OrdersPage />);
    await screen.findByRole('region', { name: '訂單紙本明細' });
    expect(
      harness.request.mock.calls.some(
        ([path]) => path === `realms/${serverTenant}/food/orders/order-1`,
      ),
    ).toBe(true);
    expect(
      harness.request.mock.calls.some(([path]) => String(path).startsWith(`realms/${linkTenant}/`)),
    ).toBe(false);
  },
);

it('does not fetch private orders until a campus is selected', () => {
  harness.campusStatus = 'unselected';
  harness.schoolId = null;
  render(<OrdersPage />);
  expect(screen.getByText('先選擇要瀏覽的校園')).toBeTruthy();
  expect(harness.request).not.toHaveBeenCalled();
  expect(harness.legacyRead).not.toHaveBeenCalled();
});

it('keeps the platform order scope through Google sign-in while online ordering is off', () => {
  harness.account = null;
  harness.search = 'tenant=pu&order=order-1';
  render(<OrdersPage />);
  const href = screen.getByRole('link', { name: '登入' }).getAttribute('href');
  expect(href).toBe('/login?returnUrl=%2Forders%3Fcampus%3Dpu%26tenant%3Dpu%26order%3Dorder-1');
  expect(harness.request).not.toHaveBeenCalled();
});

it('uses the existing confirmed cancellation API and rereads the saved order receipt', async () => {
  let saved = orderFixture();
  harness.search = 'tenant=pu&order=order-1';
  harness.request.mockImplementation(async (path: string, _context: string, input: unknown) => {
    if (path === 'food-order-realms') return { realms: [{ tenantId: 'pu', name: '靜宜大學' }] };
    if (path === 'realms/pu/food/orders') return { orders: [orderSummary(saved)] };
    if (path === 'realms/pu/food/orders/order-1') return saved;
    if (path === 'realms/pu/food/orders/order-1/cancel') {
      expect(input).toMatchObject({ reason: 'changed-mind', idempotencyKey: expect.any(String) });
      saved = {
        ...saved,
        state: 'canceled',
        allowedActions: [],
        pickup: { ...saved.pickup, allowedActions: [] },
      };
      return { orderId: saved.id, state: 'canceled', updatedAt: saved.updatedAt, replayed: false };
    }
    throw new Error(`Unexpected API path: ${path}`);
  });
  render(<OrdersPage />);
  fireEvent.click(await screen.findByRole('checkbox', { name: '我確認要取消這筆訂單' }));
  fireEvent.click(screen.getByRole('button', { name: '確認取消訂單' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '確認取消訂單' })).toBeNull());
  expect(harness.request).toHaveBeenCalledWith(
    'realms/pu/food/orders/order-1/cancel',
    'session-a',
    expect.any(Object),
    undefined,
    undefined,
  );
  expect(await screen.findByRole('region', { name: '訂單紙本明細' })).toBeTruthy();
});
