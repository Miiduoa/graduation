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
  window.history.replaceState({}, '', '/lost-found');
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
  expect(await screen.findByText('查看失物招領需要學校帳號。')).toBeTruthy();
  const login = screen.getByRole('link', { name: '連線學校帳號' });
  expect(login.getAttribute('href')).toBe(
    '/login?reconnect=school&returnUrl=%2Flost-found%3FschoolId%3Dpu',
  );
  expect(login.getAttribute('href')).not.toMatch(/google/i);
  expect(screen.queryByRole('link', { name: '登入' })).toBeNull();
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

it('preserves list filters across item, posting and browser history navigation', async () => {
  vi.mocked(listLostFoundItems).mockResolvedValue([
    {
      id: 'umbrella',
      type: 'lost',
      title: '黑色雨傘',
      description: '圖書館門口',
      category: 'other',
      location: '圖書館',
      date: '2026-10-20',
      status: 'open',
      reporterId: 'alice',
      userId: 'alice',
      createdAt: '2026-10-20T00:00:00.000Z',
      schoolId: 'pu',
      canonical: true,
    },
    {
      id: 'card',
      type: 'found',
      title: '拾獲學生證',
      description: '教室',
      category: 'other',
      location: '教室',
      date: '2026-10-20',
      status: 'open',
      reporterId: 'bob',
      userId: 'bob',
      createdAt: '2026-10-20T00:00:00.000Z',
      schoolId: 'pu',
      canonical: true,
    },
  ]);
  window.history.replaceState(
    { marker: 1 },
    '',
    '/lost-found?schoolId=pu&campus=pu&q=%E9%9B%A8%E5%82%98&type=lost&status=open&mine=1#list',
  );
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <LostFoundPage
          searchParams={Promise.resolve({
            schoolId: 'pu',
            campus: 'pu',
            q: '雨傘',
            type: 'lost',
            status: 'open',
            mine: '1',
          })}
        />
      </Suspense>,
    );
  });
  const umbrella = await screen.findByRole('link', { name: '黑色雨傘' });
  expect(screen.queryByRole('link', { name: '拾獲學生證' })).toBeNull();
  for (const link of [umbrella, screen.getByRole('link', { name: '刊登物品' })]) {
    const query = new URL(link.getAttribute('href')!, window.location.origin).searchParams;
    expect(Object.fromEntries(query)).toEqual({
      schoolId: 'pu',
      campus: 'pu',
      q: '雨傘',
      type: 'lost',
      status: 'open',
      mine: '1',
    });
  }
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  expect(screen.getByRole('link', { name: '拾獲學生證' })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByLabelText('搜尋'));
  expect(window.history.state).toEqual({ marker: 1 });
  expect(window.location.hash).toBe('#list');
  expect(new URLSearchParams(window.location.search).get('campus')).toBe('pu');
  act(() => {
    window.history.replaceState({}, '', '/lost-found?schoolId=pu&type=found');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(screen.queryByRole('link', { name: '黑色雨傘' })).toBeNull();
  expect(screen.getByRole('link', { name: '拾獲學生證' })).toBeTruthy();
  expect((screen.getByLabelText('類型') as HTMLSelectElement).value).toBe('found');
});

it('restores an expanded list after opening an item without losing the older records', async () => {
  window.history.replaceState({}, '', '/lost-found?schoolId=pu&page=2');
  vi.mocked(listLostFoundItems).mockResolvedValue(
    Array.from({ length: 80 }, (_, index) => ({
      id: `item-${index}`,
      type: 'lost',
      title: `物品 ${index}`,
      description: '說明',
      category: 'other',
      location: '圖書館',
      date: '2026-10-20',
      status: 'open',
      reporterId: 'alice',
      userId: 'alice',
      createdAt: '2026-10-20T00:00:00.000Z',
      schoolId: 'pu',
      canonical: true,
    })),
  );
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <LostFoundPage searchParams={Promise.resolve({ schoolId: 'pu', page: '2' })} />
      </Suspense>,
    );
  });
  await screen.findByRole('link', { name: '物品 79' });
  expect(screen.getAllByRole('listitem')).toHaveLength(80);
  expect(screen.getByRole('link', { name: '物品 79' }).getAttribute('href')).toContain('page=2');
  fireEvent.change(screen.getByLabelText('搜尋'), { target: { value: '物品 79' } });
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(new URLSearchParams(window.location.search).get('page')).toBeNull();
});
