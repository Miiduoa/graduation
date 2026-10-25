import { Suspense } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import LostFoundPostPage from './page';
import { createLostFoundItem, getLostFoundItem, newLostFoundItemId } from '@/lib/lostFound';
import {
  loadLostFoundDraft,
  loadLostFoundPending,
  lostFoundPendingStorageKey,
} from '@/lib/lostFoundDrafts';

const state = vi.hoisted(() => ({
  user: { uid: 'alice' } as { uid: string } | null,
  replace: vi.fn(),
  push: vi.fn(),
  id: 0,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: state.replace, push: state.push }),
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
    newLostFoundItemId: vi.fn(() => 'stable-draft'),
    createLostFoundItem: vi.fn(),
    getLostFoundItem: vi.fn(),
  };
});

beforeEach(() => {
  localStorage.clear();
  state.user = { uid: 'alice' };
  state.id = 0;
  state.replace.mockReset();
  state.push.mockReset();
  vi.mocked(newLostFoundItemId).mockImplementation(() => 'stable-draft');
  vi.mocked(getLostFoundItem).mockReset().mockResolvedValue(null);
  vi.mocked(createLostFoundItem).mockReset().mockResolvedValue({
    id: 'stable-draft',
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
    schoolId: 'pu',
    canonical: true,
  });
});

async function renderPost() {
  await act(async () => {
    render(
      <Suspense fallback={<p>載入</p>}>
        <LostFoundPostPage searchParams={Promise.resolve({ schoolId: 'pu' })} />
      </Suspense>,
    );
  });
  await screen.findByLabelText('標題');
}

it('submits a create with the stable document id and keeps that id on uncertain retry', async () => {
  await renderPost();
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: '黑色雨傘' } });
  fireEvent.change(screen.getByLabelText('說明'), { target: { value: '圖書館門口' } });
  fireEvent.change(screen.getByLabelText('地點'), { target: { value: '圖書館' } });
  fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-10-20' } });

  const { LostFoundWriteUnconfirmedError } = await import('@/lib/lostFound');
  vi.mocked(createLostFoundItem).mockRejectedValueOnce(new LostFoundWriteUnconfirmedError());

  fireEvent.click(screen.getByRole('button', { name: '送出刊登' }));
  expect(await screen.findByText(/無法讀回確認/)).toBeTruthy();
  expect(createLostFoundItem).toHaveBeenCalledWith(
    'pu',
    'stable-draft',
    expect.objectContaining({ title: '黑色雨傘' }),
  );

  vi.mocked(createLostFoundItem).mockResolvedValueOnce({
    id: 'stable-draft',
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
    schoolId: 'pu',
    canonical: true,
  });
  fireEvent.click(screen.getByRole('button', { name: '重試同一則刊登' }));
  await waitFor(() => expect(state.replace).toHaveBeenCalled());
  expect(createLostFoundItem).toHaveBeenLastCalledWith(
    'pu',
    'stable-draft',
    expect.objectContaining({ title: '黑色雨傘' }),
  );
  expect(new Set(vi.mocked(createLostFoundItem).mock.calls.map((call) => call[1])).size).toBe(1);
});

it('blocks replacing an uncertain create with different draft content', async () => {
  await renderPost();
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: '黑色雨傘' } });
  fireEvent.change(screen.getByLabelText('說明'), { target: { value: '圖書館門口' } });
  fireEvent.change(screen.getByLabelText('地點'), { target: { value: '圖書館' } });
  fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-10-20' } });

  const { LostFoundWriteUnconfirmedError } = await import('@/lib/lostFound');
  vi.mocked(createLostFoundItem).mockRejectedValueOnce(new LostFoundWriteUnconfirmedError());
  fireEvent.click(screen.getByRole('button', { name: '送出刊登' }));
  await screen.findByText(/無法讀回確認/);

  fireEvent.change(screen.getByLabelText('標題'), { target: { value: '另一把傘' } });
  await waitFor(() =>
    expect((screen.getByLabelText('標題') as HTMLInputElement).value).toBe('黑色雨傘'),
  );
  expect(screen.getByText(/未確認的刊登結果/)).toBeTruthy();
});

it('two open create tabs do not lose an unresolved pending create on reload', async () => {
  vi.mocked(newLostFoundItemId).mockImplementation(() => `review-id-${++state.id}`);
  const { LostFoundWriteUnconfirmedError } = await import('@/lib/lostFound');
  vi.mocked(createLostFoundItem).mockRejectedValue(new LostFoundWriteUnconfirmedError());

  let first!: ReturnType<typeof render>;
  let second!: ReturnType<typeof render>;
  await act(async () => {
    first = render(
      <Suspense fallback={<p>載入</p>}>
        <LostFoundPostPage searchParams={Promise.resolve({ schoolId: 'pu' })} />
      </Suspense>,
    );
  });
  await within(first.container).findByLabelText('標題');
  await act(async () => {
    second = render(
      <Suspense fallback={<p>載入</p>}>
        <LostFoundPostPage searchParams={Promise.resolve({ schoolId: 'pu' })} />
      </Suspense>,
    );
  });
  await within(second.container).findByLabelText('標題');

  fireEvent.change(within(first.container).getByLabelText('標題'), {
    target: { value: 'A 未確認刊登' },
  });
  fireEvent.change(within(first.container).getByLabelText('說明'), {
    target: { value: '說明 A' },
  });
  fireEvent.change(within(first.container).getByLabelText('地點'), {
    target: { value: '圖書館' },
  });
  fireEvent.change(within(first.container).getByLabelText('日期'), {
    target: { value: '2026-10-20' },
  });
  fireEvent.click(within(first.container).getByRole('button', { name: '送出刊登' }));
  await within(first.container).findByText(/無法讀回確認/);
  expect(
    loadLostFoundPending({
      uid: 'alice',
      schoolId: 'pu',
      mode: 'create',
      itemKey: 'review-id-1',
    }),
  ).toBeTruthy();

  fireEvent.change(within(second.container).getByLabelText('標題'), {
    target: { value: 'B 尚未送出草稿' },
  });

  first.unmount();
  second.unmount();

  await act(async () => {
    render(
      <Suspense fallback={<p>載入</p>}>
        <LostFoundPostPage searchParams={Promise.resolve({ schoolId: 'pu' })} />
      </Suspense>,
    );
  });
  expect(await screen.findByDisplayValue('A 未確認刊登')).toBeTruthy();
  expect(screen.getByText(/另有 1 則尚未完成/)).toBeTruthy();
});

it('recovery: corrupt unresolved create does not silently open a fresh writable create', async () => {
  localStorage.setItem(
    lostFoundPendingStorageKey({
      uid: 'alice',
      schoolId: 'pu',
      mode: 'create',
      itemKey: 'unknown-outcome-id',
    }),
    '{broken',
  );
  await act(async () => {
    render(
      <Suspense fallback={<p>載入</p>}>
        <LostFoundPostPage searchParams={Promise.resolve({ schoolId: 'pu' })} />
      </Suspense>,
    );
  });
  expect(screen.queryByLabelText('標題')).toBeNull();
  expect(screen.getByRole('alert').textContent).toMatch(/損毀|無法讀取|未確認/);
  expect(screen.getByRole('button', { name: '查詢此則刊登狀態' })).toBeTruthy();
  expect(
    localStorage.getItem(
      lostFoundPendingStorageKey({
        uid: 'alice',
        schoolId: 'pu',
        mode: 'create',
        itemKey: 'unknown-outcome-id',
      }),
    ),
  ).toBe('{broken');
});

it('recovery: retry storage button recovers after initial storage denial ends', async () => {
  const deny = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('temporary denial');
  });
  await act(async () => {
    render(
      <Suspense fallback={<p>載入</p>}>
        <LostFoundPostPage searchParams={Promise.resolve({ schoolId: 'pu' })} />
      </Suspense>,
    );
  });
  expect(screen.queryByLabelText('標題')).toBeNull();
  expect(screen.getByRole('button', { name: '重新確認本機儲存' })).toBeTruthy();
  deny.mockRestore();
  vi.mocked(newLostFoundItemId).mockClear();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '重新確認本機儲存' }));
  });
  expect(await screen.findByLabelText('標題')).toBeTruthy();
  expect(newLostFoundItemId).toHaveBeenCalled();
});

it('recovery: inspect then rebuild keeps the same corrupt document id', async () => {
  localStorage.setItem(
    lostFoundPendingStorageKey({
      uid: 'alice',
      schoolId: 'pu',
      mode: 'create',
      itemKey: 'unknown-outcome-id',
    }),
    '{broken',
  );
  vi.mocked(getLostFoundItem).mockResolvedValue(null);
  await act(async () => {
    render(
      <Suspense fallback={<p>載入</p>}>
        <LostFoundPostPage searchParams={Promise.resolve({ schoolId: 'pu' })} />
      </Suspense>,
    );
  });
  await screen.findByRole('button', { name: '查詢此則刊登狀態' });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '查詢此則刊登狀態' }));
  });
  await screen.findByRole('button', { name: '在同一編號重建草稿' });
  expect(getLostFoundItem).toHaveBeenCalledWith('unknown-outcome-id', 'pu');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '在同一編號重建草稿' }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '確定在同一編號重建' }));
  });
  expect(await screen.findByLabelText('標題')).toBeTruthy();
  expect(
    loadLostFoundDraft({
      uid: 'alice',
      schoolId: 'pu',
      mode: 'create',
      itemKey: 'unknown-outcome-id',
    })?.documentId,
  ).toBe('unknown-outcome-id');
  expect(
    localStorage.getItem(
      lostFoundPendingStorageKey({
        uid: 'alice',
        schoolId: 'pu',
        mode: 'create',
        itemKey: 'unknown-outcome-id',
      }),
    ),
  ).toBeNull();
});

it('recovery: inspect adopt-server clears damaged metadata only after confirmation', async () => {
  localStorage.setItem(
    lostFoundPendingStorageKey({
      uid: 'alice',
      schoolId: 'pu',
      mode: 'create',
      itemKey: 'unknown-outcome-id',
    }),
    '{broken',
  );
  vi.mocked(getLostFoundItem).mockResolvedValue({
    id: 'unknown-outcome-id',
    type: 'lost',
    title: '伺服器雨傘',
    description: '已刊登',
    category: 'other',
    location: '圖書館',
    date: '2026-10-20T00:00:00.000Z',
    status: 'open',
    reporterId: 'alice',
    userId: 'alice',
    createdAt: '2026-10-20T00:00:00.000Z',
    schoolId: 'pu',
    canonical: true,
  });
  await act(async () => {
    render(
      <Suspense fallback={<p>載入</p>}>
        <LostFoundPostPage searchParams={Promise.resolve({ schoolId: 'pu' })} />
      </Suspense>,
    );
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole('button', { name: '查詢此則刊登狀態' }));
  });
  await screen.findByRole('button', { name: '採用伺服器紀錄並清除損毀資料' });
  expect(
    localStorage.getItem(
      lostFoundPendingStorageKey({
        uid: 'alice',
        schoolId: 'pu',
        mode: 'create',
        itemKey: 'unknown-outcome-id',
      }),
    ),
  ).toBe('{broken');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '採用伺服器紀錄並清除損毀資料' }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '確定採用伺服器紀錄' }));
  });
  await waitFor(() =>
    expect(
      localStorage.getItem(
        lostFoundPendingStorageKey({
          uid: 'alice',
          schoolId: 'pu',
          mode: 'create',
          itemKey: 'unknown-outcome-id',
        }),
      ),
    ).toBeNull(),
  );
  expect(state.replace).toHaveBeenCalledWith('/lost-found/unknown-outcome-id?schoolId=pu');
});

it('recovery: storage retry persists current in-memory fields, not older draft bytes', async () => {
  await renderPost();
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: '記憶體標題' } });
  fireEvent.change(screen.getByLabelText('說明'), { target: { value: '記憶體說明' } });
  fireEvent.change(screen.getByLabelText('地點'), { target: { value: '活動中心' } });
  fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-10-21' } });

  const deny = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: '更新後記憶體標題' } });
  expect(await screen.findByText(/無法安全保存|目前無法/)).toBeTruthy();
  deny.mockRestore();

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '重新確認本機儲存' }));
  });
  await waitFor(() =>
    expect((screen.getByLabelText('標題') as HTMLInputElement).value).toBe('更新後記憶體標題'),
  );
  expect(
    loadLostFoundDraft({
      uid: 'alice',
      schoolId: 'pu',
      mode: 'create',
      itemKey: 'stable-draft',
    })?.title,
  ).toBe('更新後記憶體標題');
});

it('preserves the filtered list when cancelling and after a confirmed publication', async () => {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <LostFoundPostPage
          searchParams={Promise.resolve({
            schoolId: 'pu',
            campus: 'pu',
            q: '雨傘',
            type: 'lost',
            mine: '1',
            page: '2',
          })}
        />
      </Suspense>,
    );
  });
  await screen.findByLabelText('標題');
  const expectedQuery = {
    schoolId: 'pu',
    campus: 'pu',
    q: '雨傘',
    type: 'lost',
    mine: '1',
    page: '2',
  };
  const back = new URL(
    screen.getByRole('link', { name: '返回列表' }).getAttribute('href')!,
    window.location.origin,
  );
  expect(Object.fromEntries(back.searchParams)).toEqual(expectedQuery);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(state.push).toHaveBeenCalledWith(`${back.pathname}${back.search}`);
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: '黑色雨傘' } });
  fireEvent.change(screen.getByLabelText('說明'), { target: { value: '圖書館門口' } });
  fireEvent.change(screen.getByLabelText('地點'), { target: { value: '圖書館' } });
  fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-10-20' } });
  fireEvent.click(screen.getByRole('button', { name: '送出刊登' }));
  await waitFor(() => expect(state.replace).toHaveBeenCalled());
  const destination = new URL(state.replace.mock.calls[0][0], window.location.origin);
  expect(destination.pathname).toBe('/lost-found/stable-draft');
  expect(Object.fromEntries(destination.searchParams)).toEqual(expectedQuery);
});
