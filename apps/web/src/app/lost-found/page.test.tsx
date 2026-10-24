import { Suspense } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import LostFoundPage from './page';
import { listLostFoundItems } from '@/lib/lostFound';

const state = vi.hoisted(() => ({
  user: { uid: 'alice' } as { uid: string } | null,
}));

vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: state.user, loading: false }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock('@/lib/pageContext', () => ({
  resolveSchoolPageContext: () => ({ schoolId: 'pu', schoolName: '靜宜大學' }),
}));
vi.mock('@/lib/lostFound', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lostFound')>('@/lib/lostFound');
  return {
    ...actual,
    listLostFoundItems: vi.fn(async () => []),
  };
});

beforeEach(() => {
  state.user = { uid: 'alice' };
  vi.mocked(listLostFoundItems).mockReset().mockResolvedValue([]);
});

it('shows a login prompt instead of a 404 when the visitor is unsigned', async () => {
  state.user = null;
  await act(async () => {
    render(
      <Suspense fallback={<p>載入失物招領</p>}>
        <LostFoundPage searchParams={Promise.resolve({ schoolId: 'pu' })} />
      </Suspense>,
    );
  });
  expect(await screen.findByText('登入後才能看失物招領和評論')).toBeTruthy();
  expect(screen.getByRole('link', { name: '登入' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Flost-found%3FschoolId%3Dpu',
  );
  expect(listLostFoundItems).not.toHaveBeenCalled();
  expect(screen.queryByText('找不到這個頁面')).toBeNull();
  expect(screen.queryByText('暫時無法讀取失物招領，請稍後再試。')).toBeNull();
});

it('offers posting, visible filter scope, and load-failure retry', async () => {
  vi.mocked(listLostFoundItems)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce([
      {
        id: 'item-1',
        type: 'lost',
        title: '黑色雨傘',
        description: '圖書館',
        category: 'other',
        location: '圖書館',
        date: '2026-10-20T00:00:00.000Z',
        status: 'open',
        reporterId: 'alice',
        userId: 'alice',
        createdAt: '2026-10-20T00:00:00.000Z',
        schoolId: 'pu',
        canonical: true,
      },
    ]);

  await act(async () => {
    render(
      <Suspense fallback={<p>載入失物招領</p>}>
        <LostFoundPage searchParams={Promise.resolve({ schoolId: 'pu' })} />
      </Suspense>,
    );
  });

  expect((await screen.findByRole('alert')).textContent).toContain('暫時無法讀取失物招領');
  fireEvent.click(screen.getByRole('button', { name: '再試一次' }));
  expect(await screen.findByRole('link', { name: '黑色雨傘' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '刊登物品' }).getAttribute('href')).toContain(
    '/lost-found/post',
  );
  expect(screen.getByText(/範圍：靜宜大學/)).toBeTruthy();

  fireEvent.change(screen.getByLabelText('類型'), { target: { value: 'found' } });
  await waitFor(() => expect(screen.getByText('沒有符合目前篩選條件的刊登')).toBeTruthy());
});

it('ignores a late list response after the account switches', async () => {
  let finishAlice!: (value: Awaited<ReturnType<typeof listLostFoundItems>>) => void;
  let finishBob!: (value: Awaited<ReturnType<typeof listLostFoundItems>>) => void;
  vi.mocked(listLostFoundItems)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishAlice = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishBob = resolve;
        }),
    );

  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <Suspense fallback={<p>載入失物招領</p>}>
        <LostFoundPage searchParams={Promise.resolve({ schoolId: 'pu' })} />
      </Suspense>,
    );
  });
  expect(await screen.findByText('正在讀取失物招領…')).toBeTruthy();
  state.user = { uid: 'bob' };
  await act(async () => {
    view.rerender(
      <Suspense fallback={<p>載入失物招領</p>}>
        <LostFoundPage searchParams={Promise.resolve({ schoolId: 'pu' })} />
      </Suspense>,
    );
  });
  expect(await screen.findByText('正在讀取失物招領…')).toBeTruthy();
  await act(async () => {
    finishAlice([
      {
        id: 'stale',
        type: 'lost',
        title: '不應顯示的舊回應',
        description: 'x',
        category: 'other',
        location: 'x',
        date: '2026-10-20T00:00:00.000Z',
        status: 'open',
        reporterId: 'alice',
        userId: 'alice',
        createdAt: '2026-10-20T00:00:00.000Z',
        schoolId: 'pu',
        canonical: true,
      },
    ]);
  });
  expect(screen.queryByText('不應顯示的舊回應')).toBeNull();
  await act(async () => {
    finishBob([]);
  });
  expect(await screen.findByText('目前沒有本校刊登資訊')).toBeTruthy();
});

it('discovers an owned item beyond the former silent top-100 window', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({
    id: `item-${index}`,
    type: 'lost' as const,
    title: index === 100 ? '我的第101則舊刊登' : `他人刊登 ${index}`,
    description: '說明',
    category: 'other',
    location: '圖書館',
    date: '2026-10-20T00:00:00.000Z',
    status: 'open' as const,
    reporterId: index === 100 ? 'alice' : 'bob',
    userId: index === 100 ? 'alice' : 'bob',
    createdAt: `2026-${String(10 - Math.floor(index / 28)).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    schoolId: 'pu',
    canonical: true,
  }));
  vi.mocked(listLostFoundItems).mockResolvedValueOnce(rows);

  await act(async () => {
    render(
      <Suspense fallback={<p>載入失物招領</p>}>
        <LostFoundPage searchParams={Promise.resolve({ schoolId: 'pu' })} />
      </Suspense>,
    );
  });

  expect(await screen.findByText(/符合條件 101 則/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText('只看我刊登的'));
  expect(await screen.findByRole('link', { name: '我的第101則舊刊登' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜尋'), { target: { value: '第101則' } });
  expect(screen.getByRole('link', { name: '我的第101則舊刊登' })).toBeTruthy();
});
