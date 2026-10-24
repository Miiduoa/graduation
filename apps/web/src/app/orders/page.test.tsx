import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  uid: 'alice' as string | null,
  rows: [] as Array<{ id: string; data: Record<string, unknown> }>,
  emitters: [] as Array<{ path: string; emit: () => void; stop: () => void }>,
  paths: [] as string[],
  stopped: [] as string[],
  campus: {
    status: 'ready' as 'ready' | 'loading' | 'error' | 'unselected',
    schoolId: 'pu' as string | null,
    schoolName: '靜宜大學',
    schoolSearch: '?schoolId=pu&campus=pu',
  },
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: state.uid ? { uid: state.uid } : null, loading: false, error: null }),
}));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => state.campus,
}));
vi.mock('@/components/SchoolScopePlaceholder', () => ({
  SchoolScopePlaceholder: () => <p>先選擇要瀏覽的校園</p>,
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({
    children,
    title,
    subtitle,
    schoolName,
  }: {
    children: ReactNode;
    title?: string;
    subtitle?: string;
    schoolName?: string;
  }) => (
    <main>
      {schoolName ? <p data-testid="school-heading">{schoolName}</p> : null}
      {title && <h1>{title}</h1>}
      {subtitle && <p>{subtitle}</p>}
      {children}
    </main>
  ),
}));
vi.mock('@/lib/firebase', () => ({ getDb: () => ({}), isFirebaseConfigured: () => true }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (ref: { path: string }) => ref,
  orderBy: () => null,
  limit: () => null,
  onSnapshot: (ref: { path: string }, next: (snapshot: unknown) => void) => {
    state.paths.push(ref.path);
    const emit = () =>
      next({ docs: state.rows.map((row) => ({ id: row.id, data: () => row.data })) });
    const entry = {
      path: ref.path,
      emit,
      stop: () => {
        state.stopped.push(ref.path);
      },
    };
    state.emitters.push(entry);
    emit();
    return entry.stop;
  },
}));

import OrdersPage from './page';

const placed = { toDate: () => new Date('2026-10-13T04:05:00.000Z') };
beforeEach(() => {
  vi.unstubAllEnvs();
  state.uid = 'alice';
  state.paths = [];
  state.stopped = [];
  state.emitters = [];
  state.campus = {
    status: 'ready',
    schoolId: 'pu',
    schoolName: '靜宜大學',
    schoolSearch: '?schoolId=pu&campus=pu',
  };
  state.rows = [
    {
      id: 'co_numbered_aaa111',
      data: {
        status: 'ready',
        queueNumber: 7,
        cafeteria: '校園餐廳',
        total: 100,
        createdAt: placed,
        items: [{ name: '雞腿飯', quantity: 1 }],
      },
    },
    {
      id: 'co_waiting_bbb222',
      data: {
        status: 'pending',
        queueNumber: null,
        cafeteria: '校園餐廳',
        total: 60,
        createdAt: placed,
        items: [{ name: '紅茶', quantity: 2 }],
      },
    },
    {
      id: 'co_cancel_ccc333',
      data: {
        status: 'cancelled',
        queueNumber: null,
        cancelledQueueNumber: 5,
        cancelledBy: 'merchant',
        cafeteria: '校園餐廳',
        createdAt: placed,
        items: [],
      },
    },
  ];
});

it('我的訂單（網頁）：讀伺服器上學生自己的訂單，號碼、待給號碼兩行、店家取消都照實顯示', () => {
  render(<OrdersPage />);
  expect(state.paths).toEqual(['users/alice/schools/pu/orders']);
  expect(screen.getByText('取餐號碼 7')).toBeTruthy();
  expect(screen.getByText('號碼還沒拿到，請到櫃台確認。')).toBeTruthy();
  expect(screen.getByText('10 月 13 日（二）12:05・紅茶 ×2')).toBeTruthy();
  expect(screen.getByText('狀態：待給號碼')).toBeTruthy();
  expect(screen.getByText('這張單店家取消了')).toBeTruthy();
  expect(screen.queryByText('取餐號碼 5')).toBeNull();
  expect(screen.getAllByText('訂單末 6 碼 AAA111').length).toBeGreaterThan(0);
  expect(screen.queryByText(/待確認/)).toBeNull();
});

it('店家給號碼或取消後即時更新', async () => {
  render(<OrdersPage />);
  state.rows = state.rows.map((row) =>
    row.id === 'co_waiting_bbb222'
      ? { ...row, data: { ...row.data, status: 'confirmed', queueNumber: 9 } }
      : row,
  );
  await act(async () => state.emitters.forEach((entry) => entry.emit()));
  expect(screen.getByText('取餐號碼 9')).toBeTruthy();
  expect(screen.queryByText('號碼還沒拿到，請到櫃台確認。')).toBeNull();
});

it('切換校園時取消舊訂閱，忽略遲到的 A 校回呼，並改讀 B 校標題與路徑', async () => {
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  const view = render(<OrdersPage />);
  expect(state.paths).toEqual(['users/alice/schools/pu/orders']);
  expect(screen.getByTestId('school-heading').textContent).toBe('靜宜大學');
  const schoolA = state.emitters[0];

  state.campus = {
    status: 'ready',
    schoolId: 'nthu',
    schoolName: '國立清華大學',
    schoolSearch: '?schoolId=nthu&campus=nthu',
  };
  state.rows = [
    {
      id: 'co_nthu_ddd444',
      data: {
        status: 'ready',
        queueNumber: 3,
        cafeteria: '清華小吃',
        total: 80,
        createdAt: placed,
        items: [{ name: '滷肉飯', quantity: 1 }],
      },
    },
  ];
  view.rerender(<OrdersPage />);

  expect(state.stopped).toEqual(['users/alice/schools/pu/orders']);
  expect(state.paths.at(-1)).toBe('users/alice/schools/nthu/orders');
  expect(screen.getByTestId('school-heading').textContent).toBe('國立清華大學');
  expect(screen.getByText('取餐號碼 3')).toBeTruthy();
  expect(screen.getByText(/清華小吃/)).toBeTruthy();

  state.rows = [
    {
      id: 'co_stale_pu',
      data: {
        status: 'ready',
        queueNumber: 99,
        cafeteria: '遲到的靜宜訂單',
        total: 1,
        createdAt: placed,
        items: [],
      },
    },
  ];
  await act(async () => schoolA.emit());
  expect(screen.queryByText('取餐號碼 99')).toBeNull();
  expect(screen.queryByText(/遲到的靜宜訂單/)).toBeNull();
  expect(screen.getByText('取餐號碼 3')).toBeTruthy();
});

it('尚未選校、載入中或目錄錯誤時不訂閱訂單', () => {
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  state.campus = {
    status: 'unselected',
    schoolId: null,
    schoolName: '',
    schoolSearch: '?campus=all',
  };
  const view = render(<OrdersPage />);
  expect(screen.getByText('先選擇要瀏覽的校園')).toBeTruthy();
  expect(state.paths).toEqual([]);

  state.campus = { status: 'loading', schoolId: null, schoolName: '', schoolSearch: '?campus=all' };
  view.rerender(<OrdersPage />);
  expect(screen.getByText('正在確認所選校園…')).toBeTruthy();
  expect(state.paths).toEqual([]);

  state.campus = { status: 'error', schoolId: null, schoolName: '', schoolSearch: '?campus=all' };
  view.rerender(<OrdersPage />);
  expect(screen.getByText('無法取得校園目錄，請稍後再試。')).toBeTruthy();
  expect(state.paths).toEqual([]);
});

it('沒登入、線上點餐還沒開：標題、副標題、內文都只寫「目前還不能線上點餐」，不叫人登入', () => {
  state.uid = null;
  render(<OrdersPage />);
  expect(screen.getAllByText('目前還不能線上點餐').length).toBeGreaterThanOrEqual(3);
  expect(screen.queryByTestId('school-heading')).toBeNull();
  expect(screen.queryByText('登入後查看訂單')).toBeNull();
  expect(screen.queryByText(/會自動更新/)).toBeNull();
  expect(screen.queryByRole('link', { name: '登入' })).toBeNull();
  expect(state.paths).toEqual([]);
});

it('沒有訂單、線上點餐還沒開：保留既有訂單入口，不叫學生去點餐', () => {
  state.rows = [];
  render(<OrdersPage />);
  expect(screen.getAllByRole('heading', { name: '目前還不能線上點餐' }).length).toBeGreaterThan(0);
  expect(screen.queryByText(/還沒有訂單|要點餐|會自動更新/)).toBeNull();
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: '訂單與取餐進度' }).getAttribute('href')).toBe('/food');
});

it('線上點餐打開、沒登入：請先登入，不讀訂單', () => {
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  state.uid = null;
  render(<OrdersPage />);
  expect(screen.getByRole('heading', { name: '我的訂單' })).toBeTruthy();
  expect(screen.getByText('取餐號碼和訂單狀態以店家那邊為準，會自動更新。')).toBeTruthy();
  expect(screen.getByText('登入後查看訂單')).toBeTruthy();
  expect(screen.getByRole('link', { name: '登入' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Forders%3Fcampus%3Dpu',
  );
  expect(state.paths).toEqual([]);
});

it('preserves the selected school through sign-in and reads that school after sign-in', () => {
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  state.campus = {
    status: 'ready',
    schoolId: 'nthu',
    schoolName: '國立清華大學',
    schoolSearch: '?schoolId=nthu&campus=nthu',
  };
  state.uid = null;
  const view = render(<OrdersPage />);
  expect(screen.getByRole('link', { name: '登入' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Forders%3Fcampus%3Dnthu',
  );
  expect(state.paths).toEqual([]);
  state.uid = 'alice';
  view.rerender(<OrdersPage />);
  expect(state.paths).toEqual(['users/alice/schools/nthu/orders']);
});

it('does not classify an unknown server status as finished', () => {
  state.rows = [{ id: 'co_unknown', data: { status: 'awaiting-review', items: [] } }];
  render(<OrdersPage />);
  expect(screen.getByRole('heading', { name: /進行中/ })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /已結束/ })).toBeNull();
  expect(screen.getByText('訂單進度尚待確認。')).toBeTruthy();
});

it('線上點餐打開、有訂單：區分進行中與已結束，並標明 App 訂單與站內點餐路徑', () => {
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  render(<OrdersPage />);
  expect(screen.getByRole('heading', { name: /進行中/ })).toBeTruthy();
  expect(screen.getByRole('heading', { name: /已結束/ })).toBeTruthy();
  expect(screen.getByText('餐點好了，請到店取餐。')).toBeTruthy();
  expect(screen.getByText('等待店家提供取餐號碼')).toBeTruthy();
  expect(screen.getByRole('link', { name: '點餐與取餐' }).getAttribute('href')).toBe('/food');
  expect(screen.getByRole('link', { name: '餐廳資訊' }).getAttribute('href')).toBe(
    '/cafeteria?schoolId=pu',
  );
  expect(screen.getByText(/此頁是 App「餐廳」留下的訂單/)).toBeTruthy();
});
