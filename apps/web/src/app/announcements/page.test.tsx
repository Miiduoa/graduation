import { Suspense } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { getDocsFromServer } from 'firebase/firestore';
import { isFirebaseConfigured } from '@/lib/firebase';
import AnnouncementsPage from './page';

const account = vi.hoisted(() => ({
  user: { uid: 'alice' } as { uid: string } | null,
  loading: false,
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => account }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children, schoolName }: { children: React.ReactNode; schoolName: string }) => (
    <main>
      <p>{schoolName}</p>
      {children}
    </main>
  ),
}));
vi.mock('@/lib/firebase', () => ({ getDb: () => ({}), isFirebaseConfigured: vi.fn(() => true) }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  orderBy: (field: string, direction: string) => ({ orderBy: field, direction }),
  limit: (count: number) => ({ limit: count }),
  where: (field: string, operator: string, value: string) => ({ where: field, operator, value }),
  query: (collection: object, ...constraints: object[]) => ({ ...collection, constraints }),
  getDocsFromServer: vi.fn(),
}));

function announcementDocument(id: string, values: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      title: id,
      body: '學校發布的內容',
      publishedAt: '2026-10-08T02:00:00.000Z',
      ...values,
    }),
  };
}
function snapshot(...docs: ReturnType<typeof announcementDocument>[]) {
  return { empty: docs.length === 0, docs } as unknown as Awaited<
    ReturnType<typeof getDocsFromServer>
  >;
}
function deferred() {
  let resolve!: (value: ReturnType<typeof snapshot>) => void;
  const promise = new Promise<ReturnType<typeof snapshot>>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  account.user = { uid: 'alice' };
  account.loading = false;
  vi.mocked(isFirebaseConfigured).mockReturnValue(true);
  vi.mocked(getDocsFromServer).mockResolvedValue(
    snapshot(announcementDocument('校園公告實際內容')),
  );
  window.history.replaceState({}, '', '/announcements');
});

it('reads the public school source without requiring a signed-in account', async () => {
  account.user = null;
  render(<AnnouncementsPage />);
  await screen.findByText('校園公告實際內容');
  expect(screen.getByText('靜宜大學')).toBeTruthy();
  expect(getDocsFromServer).toHaveBeenCalledWith({
    path: 'schools/pu/announcements',
    constraints: [{ orderBy: 'publishedAt', direction: 'desc' }, { limit: 20 }],
  });
  expect(screen.queryByText('示範資料')).toBeNull();
  expect(screen.queryByText('重要')).toBeNull();
  expect(screen.queryByText('NEW')).toBeNull();
});

it.each(['teacher', 'department_head', 'admin'])(
  'does not grant publisher rights from old %s demoRole storage or compose links',
  async (role) => {
    localStorage.setItem('demoRole', role);
    localStorage.setItem(
      'demoPendingAnnouncements',
      JSON.stringify([{ id: 'fake', title: '假待審公告' }]),
    );
    window.history.replaceState({}, '', '/announcements?compose=1');
    render(<AnnouncementsPage />);
    await screen.findByText('校園公告實際內容');
    expect(screen.queryByRole('button', { name: /發布|核准|退回|送出/ })).toBeNull();
    expect(screen.queryByText('假待審公告')).toBeNull();
    expect(screen.queryByText(/王大明|黃主任|待審核|自己發的/)).toBeNull();
  },
);

it('shows failure without demo fallback or hiding a failed canonical read behind the legacy collection', async () => {
  vi.mocked(getDocsFromServer).mockRejectedValue(new Error('permission-denied'));
  render(<AnnouncementsPage />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText('暫時無法讀取公告')).toBeTruthy();
  expect(screen.queryByText('目前沒有公開公告')).toBeNull();
  expect(screen.queryByText('示範資料')).toBeNull();
  expect(screen.queryByRole('article')).toBeNull();
  expect(getDocsFromServer).toHaveBeenCalledTimes(1);
});

it('shows unavailable when Firebase is not configured and never reads demo content', async () => {
  vi.mocked(isFirebaseConfigured).mockReturnValue(false);
  render(<AnnouncementsPage />);
  await screen.findByRole('alert');
  expect(getDocsFromServer).not.toHaveBeenCalled();
  expect(screen.queryByRole('article')).toBeNull();
});

it('retains the existing school-filtered legacy source when the canonical collection is empty', async () => {
  vi.mocked(getDocsFromServer)
    .mockResolvedValueOnce(snapshot())
    .mockResolvedValueOnce(snapshot(announcementDocument('既有來源公告', { schoolId: 'pu' })));
  render(<AnnouncementsPage />);
  await screen.findByText('既有來源公告');
  expect(getDocsFromServer).toHaveBeenLastCalledWith({
    path: 'announcements',
    constraints: [
      { where: 'schoolId', operator: '==', value: 'pu' },
      { orderBy: 'publishedAt', direction: 'desc' },
      { limit: 20 },
    ],
  });
});

it('distinguishes a legacy source failure from a successfully empty announcement feed', async () => {
  vi.mocked(getDocsFromServer)
    .mockResolvedValueOnce(snapshot())
    .mockRejectedValueOnce(new Error('offline'));
  render(<AnnouncementsPage />);
  await screen.findByRole('alert');
  vi.mocked(getDocsFromServer).mockResolvedValue(snapshot());
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  await screen.findByText('目前沒有公開公告');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps server categories, pinned flags and search functional without invented importance', async () => {
  vi.mocked(getDocsFromServer).mockResolvedValue(
    snapshot(
      announcementDocument('課務消息', {
        category: 'academic',
        body: '選課開放',
        source: '課務組',
        pinned: true,
      }),
      announcementDocument('展覽消息', { category: 'event' }),
      announcementDocument('場地維護', { category: 'general' }),
    ),
  );
  render(<AnnouncementsPage />);
  await screen.findByText('課務消息');
  fireEvent.click(screen.getByRole('button', { name: '活動' }));
  expect(screen.getByText('展覽消息')).toBeTruthy();
  expect(screen.queryByText('課務消息')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '全部' }));
  fireEvent.change(screen.getByLabelText('搜尋公告'), { target: { value: '課務組' } });
  expect(screen.getByText('課務消息')).toBeTruthy();
  expect(screen.queryByText('展覽消息')).toBeNull();
  fireEvent.change(screen.getByLabelText('搜尋公告'), { target: { value: '' } });
  fireEvent.click(screen.getByLabelText('只看置頂'));
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByText('置頂')).toBeTruthy();
});

it('clears old records on refresh failure and lets the reader retry', async () => {
  render(<AnnouncementsPage />);
  await screen.findByText('校園公告實際內容');
  vi.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: '更新公告' }));
  expect(screen.queryByText('校園公告實際內容')).toBeNull();
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  await screen.findByText('校園公告實際內容');
});

it('removes the prior account list and filters synchronously when the account changes', async () => {
  const view = render(<AnnouncementsPage />);
  await screen.findByText('校園公告實際內容');
  fireEvent.change(screen.getByLabelText('搜尋公告'), { target: { value: '沒有的搜尋' } });
  const next = deferred();
  vi.mocked(getDocsFromServer).mockReturnValueOnce(next.promise);
  account.user = { uid: 'bob' };
  view.rerender(<AnnouncementsPage />);
  expect(screen.queryByText('校園公告實際內容')).toBeNull();
  expect(screen.getByText('正在讀取公告…')).toBeTruthy();
  await act(async () => next.resolve(snapshot(announcementDocument('新帳號重新讀取'))));
  await screen.findByText('新帳號重新讀取');
  expect((screen.getByLabelText('搜尋公告') as HTMLInputElement).value).toBe('');
});

it('ignores a late response after logout and signing back into the same account', async () => {
  const old = deferred();
  vi.mocked(getDocsFromServer).mockReturnValueOnce(old.promise);
  const view = render(<AnnouncementsPage />);
  account.user = null;
  view.rerender(<AnnouncementsPage />);
  await screen.findByText('校園公告實際內容');
  account.user = { uid: 'alice' };
  view.rerender(<AnnouncementsPage />);
  await screen.findByText('校園公告實際內容');
  await act(async () => old.resolve(snapshot(announcementDocument('舊帳號晚回應'))));
  expect(screen.queryByText('舊帳號晚回應')).toBeNull();
});

it('discards the old school response when the selected school changes', async () => {
  const old = deferred();
  vi.mocked(getDocsFromServer).mockReturnValueOnce(old.promise);
  const pu = Promise.resolve({ schoolId: 'pu' });
  const nthu = Promise.resolve({ schoolId: 'nthu' });
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <Suspense fallback={<p>載入學校</p>}>
        <AnnouncementsPage searchParams={pu} />
      </Suspense>,
    );
  });
  await waitFor(() => expect(getDocsFromServer).toHaveBeenCalledTimes(1));
  vi.mocked(getDocsFromServer).mockResolvedValueOnce(
    snapshot(announcementDocument('清華公告', { schoolId: 'nthu' })),
  );
  await act(async () => {
    view.rerender(
      <Suspense fallback={<p>載入學校</p>}>
        <AnnouncementsPage searchParams={nthu} />
      </Suspense>,
    );
  });
  await screen.findByText('清華公告');
  await act(async () =>
    old.resolve(snapshot(announcementDocument('靜宜晚回應', { schoolId: 'pu' }))),
  );
  expect(screen.queryByText('靜宜晚回應')).toBeNull();
  expect(getDocsFromServer).toHaveBeenLastCalledWith(
    expect.objectContaining({ path: 'schools/nthu/announcements' }),
  );
});

it('does not render a record whose stored school differs from the selected school', async () => {
  vi.mocked(getDocsFromServer).mockResolvedValue(
    snapshot(announcementDocument('錯誤學校資料', { schoolId: 'nthu' })),
  );
  render(<AnnouncementsPage />);
  await screen.findByRole('alert');
  expect(screen.queryByText('錯誤學校資料')).toBeNull();
});

it('copies the real announcement detail link only after the clipboard operation succeeds', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<AnnouncementsPage />);
  await screen.findByText('校園公告實際內容');
  fireEvent.click(screen.getByRole('button', { name: '分享公告：校園公告實際內容' }));
  await screen.findByText('已複製公告連結。');
  const url = new URL(writeText.mock.calls[0][0]);
  expect(decodeURIComponent(url.pathname)).toBe('/announcements/校園公告實際內容');
  expect(url.searchParams.get('schoolId')).toBe('pu');
  expect(screen.getByRole('link', { name: '校園公告實際內容' }).getAttribute('href')).toBe(
    `${url.pathname}${url.search}`,
  );
});
