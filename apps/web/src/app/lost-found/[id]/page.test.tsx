import { Suspense } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import LostFoundDetailPage from './page';
import {
  getLostFoundItem,
  resolveLostFoundItem,
  updateLostFoundItem,
  type LostFoundItem,
} from '@/lib/lostFound';

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
    getLostFoundItem: vi.fn(),
    updateLostFoundItem: vi.fn(),
    resolveLostFoundItem: vi.fn(),
  };
});

const owned: LostFoundItem = {
  id: 'item-1',
  type: 'lost',
  title: '黑色雨傘',
  description: '圖書館門口',
  category: 'other',
  location: '圖書館',
  date: '2026-10-20T00:00:00.000Z',
  status: 'open',
  reporterId: 'alice',
  userId: 'alice',
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T02:00:00.000Z',
  schoolId: 'pu',
  contactInfo: 'mail@school.test',
  canonical: true,
};

const legacy: LostFoundItem = {
  ...owned,
  id: 'legacy-1',
  userId: undefined,
  canonical: false,
};

async function renderDetail(id = 'item-1') {
  await act(async () => {
    render(
      <Suspense fallback={<p>載入</p>}>
        <LostFoundDetailPage
          params={Promise.resolve({ id })}
          searchParams={Promise.resolve({ schoolId: 'pu' })}
        />
      </Suspense>,
    );
  });
}

beforeEach(() => {
  localStorage.clear();
  state.user = { uid: 'alice' };
  vi.mocked(getLostFoundItem).mockReset().mockResolvedValue(owned);
  vi.mocked(updateLostFoundItem).mockReset();
  vi.mocked(resolveLostFoundItem).mockReset();
});

it('shows owner edit and confirm-resolve, and confirms authoritative resolve receipt', async () => {
  await renderDetail();
  expect(await screen.findByText('黑色雨傘')).toBeTruthy();
  expect(screen.getByText(/聯絡方式會顯示給所有已登入使用者/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '編輯' }));
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: '黑色折疊傘' } });
  vi.mocked(updateLostFoundItem).mockResolvedValueOnce({
    ...owned,
    title: '黑色折疊傘',
    updatedAt: '2026-10-20T03:00:00.000Z',
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存更新' }));
  await waitFor(() =>
    expect(updateLostFoundItem).toHaveBeenCalledWith(
      'item-1',
      'pu',
      '2026-10-20T02:00:00.000Z',
      expect.objectContaining({ title: '黑色折疊傘' }),
    ),
  );
  expect(await screen.findByText('已儲存更新。')).toBeTruthy();

  vi.mocked(getLostFoundItem).mockResolvedValue({
    ...owned,
    title: '黑色折疊傘',
    updatedAt: '2026-10-20T03:00:00.000Z',
  });
  fireEvent.click(screen.getByRole('button', { name: '標示已結案' }));
  vi.mocked(resolveLostFoundItem).mockResolvedValueOnce({
    ...owned,
    title: '黑色折疊傘',
    status: 'resolved',
    updatedAt: '2026-10-20T04:00:00.000Z',
  });
  fireEvent.click(screen.getByRole('button', { name: '確認結案' }));
  await waitFor(() =>
    expect(resolveLostFoundItem).toHaveBeenCalledWith('item-1', 'pu', '2026-10-20T03:00:00.000Z'),
  );
  expect(await screen.findByText('已確認結案。')).toBeTruthy();
});

it('keeps legacy reporterId-only records read-only without owner controls', async () => {
  vi.mocked(getLostFoundItem).mockResolvedValueOnce(legacy);
  await renderDetail('legacy-1');
  expect(await screen.findByText(/尚未完整遷移的舊版紀錄/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '編輯' })).toBeNull();
  expect(screen.queryByRole('button', { name: '標示已結案' })).toBeNull();
});

it('hides owner actions for another account and ignores late loads after switch', async () => {
  let finishAlice!: (value: LostFoundItem | null) => void;
  let finishBob!: (value: LostFoundItem | null) => void;
  vi.mocked(getLostFoundItem)
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
      <Suspense fallback={<p>載入</p>}>
        <LostFoundDetailPage
          params={Promise.resolve({ id: 'item-1' })}
          searchParams={Promise.resolve({ schoolId: 'pu' })}
        />
      </Suspense>,
    );
  });
  expect(await screen.findByText('正在讀取物品…')).toBeTruthy();
  state.user = { uid: 'bob' };
  await act(async () => {
    view.rerender(
      <Suspense fallback={<p>載入</p>}>
        <LostFoundDetailPage
          params={Promise.resolve({ id: 'item-1' })}
          searchParams={Promise.resolve({ schoolId: 'pu' })}
        />
      </Suspense>,
    );
  });
  expect(await screen.findByText('正在讀取物品…')).toBeTruthy();
  await act(async () => {
    finishAlice(owned);
  });
  expect(screen.queryByText('黑色雨傘')).toBeNull();
  await act(async () => {
    finishBob(owned);
  });
  expect(await screen.findByText('黑色雨傘')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '編輯' })).toBeNull();
});

it('retries after load failure', async () => {
  vi.mocked(getLostFoundItem)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(owned);
  await renderDetail();
  expect((await screen.findByRole('alert')).textContent).toContain('暫時無法讀取物品');
  fireEvent.click(screen.getByRole('button', { name: '再試一次' }));
  expect(await screen.findByText('黑色雨傘')).toBeTruthy();
});

it('reload preserves the original revision of an unsent edit draft', async () => {
  const { saveLostFoundDraft } = await import('@/lib/lostFoundDrafts');
  saveLostFoundDraft(
    { uid: 'alice', schoolId: 'pu', mode: 'edit', itemKey: 'item-1' },
    {
      version: 1,
      documentId: 'item-1',
      expectedUpdatedAt: '2026-10-20T01:00:00.000Z',
      type: 'lost',
      title: '舊草稿',
      description: '舊說明',
      category: 'other',
      location: '圖書館',
      date: '2026-10-20',
      contactInfo: '',
    },
  );
  await renderDetail();
  expect(await screen.findByDisplayValue('舊草稿')).toBeTruthy();
  expect(screen.getByText(/較早版本的草稿/)).toBeTruthy();
  vi.mocked(updateLostFoundItem).mockResolvedValueOnce({
    ...owned,
    title: '舊草稿',
    updatedAt: '2026-10-20T03:00:00.000Z',
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存更新' }));
  await waitFor(() =>
    expect(updateLostFoundItem).toHaveBeenCalledWith(
      'item-1',
      'pu',
      '2026-10-20T01:00:00.000Z',
      expect.objectContaining({ title: '舊草稿' }),
    ),
  );
});

it('an A -> B -> A account cycle invalidates an older edit completion', async () => {
  let finish!: (value: LostFoundItem) => void;
  vi.mocked(updateLostFoundItem).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const params = Promise.resolve({ id: 'item-1' });
  const searchParams = Promise.resolve({ schoolId: 'pu' });
  const tree = () => (
    <Suspense fallback={<p>載入</p>}>
      <LostFoundDetailPage params={params} searchParams={searchParams} />
    </Suspense>
  );
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(tree());
  });
  expect(await screen.findByText('黑色雨傘')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '編輯' }));
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: '舊請求完成' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存更新' }));

  const latest: LostFoundItem = {
    ...owned,
    title: '最新伺服器內容',
    updatedAt: '2026-10-20T04:00:00.000Z',
  };
  vi.mocked(getLostFoundItem).mockResolvedValue(latest);
  state.user = { uid: 'bob' };
  await act(async () => {
    view.rerender(tree());
  });
  state.user = { uid: 'alice' };
  await act(async () => {
    view.rerender(tree());
  });
  expect(await screen.findByRole('heading', { name: '最新伺服器內容' })).toBeTruthy();
  await act(async () => {
    finish({
      ...owned,
      title: '舊請求完成',
      updatedAt: '2026-10-20T03:00:00.000Z',
    });
  });
  expect(screen.getByRole('heading', { name: '最新伺服器內容' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '舊請求完成' })).toBeNull();
});

it('submits an explicit blank contact as a clear, not an omission', async () => {
  await renderDetail();
  fireEvent.click(await screen.findByRole('button', { name: '編輯' }));
  fireEvent.change(screen.getByLabelText('聯絡方式（選填）'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: '黑色折疊傘' } });
  vi.mocked(updateLostFoundItem).mockResolvedValueOnce({
    ...owned,
    title: '黑色折疊傘',
    contactInfo: undefined,
    updatedAt: '2026-10-20T03:00:00.000Z',
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存更新' }));
  await waitFor(() =>
    expect(updateLostFoundItem).toHaveBeenCalledWith(
      'item-1',
      'pu',
      '2026-10-20T02:00:00.000Z',
      expect.objectContaining({ title: '黑色折疊傘', contactInfo: '' }),
    ),
  );
});

it('returns to the filtered list using only the current school and supported list fields', async () => {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <LostFoundDetailPage
          params={Promise.resolve({ id: 'item-1' })}
          searchParams={Promise.resolve({
            schoolId: 'pu',
            campus: 'pu',
            q: '雨傘',
            type: 'lost',
            status: 'open',
            mine: '1',
            page: '2',
            returnUrl: 'https://unrelated.example',
            token: 'secret',
          })}
        />
      </Suspense>,
    );
  });
  await screen.findByText('黑色雨傘');
  const target = new URL(
    screen.getByRole('link', { name: '返回列表' }).getAttribute('href')!,
    window.location.origin,
  );
  expect(target.pathname).toBe('/lost-found');
  expect(Object.fromEntries(target.searchParams)).toEqual({
    schoolId: 'pu',
    campus: 'pu',
    q: '雨傘',
    type: 'lost',
    status: 'open',
    mine: '1',
    page: '2',
  });
});
