import { Suspense } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { getDocFromServer } from 'firebase/firestore';
import AnnouncementDetailPage from './page';

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
vi.mock('@/lib/firebase', () => ({ getDb: () => ({}), isFirebaseConfigured: () => true }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDocFromServer: vi.fn(),
  collection: vi.fn(),
  getDocsFromServer: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
}));
function snapshot(values: Record<string, unknown> | null = {}) {
  return {
    id: 'notice-1',
    exists: () => values !== null,
    data: () =>
      values === null
        ? undefined
        : {
            title: '實際公告詳情',
            body: '這是發布單位提供的全文。',
            schoolId: 'pu',
            publishedAt: { toDate: () => new Date('2026-10-08T02:00:00Z') },
            ...values,
          },
  } as unknown as Awaited<ReturnType<typeof getDocFromServer>>;
}
function deferred() {
  let resolve!: (value: ReturnType<typeof snapshot>) => void;
  const promise = new Promise<ReturnType<typeof snapshot>>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
function props(id = 'notice-1', schoolId = 'pu') {
  return { params: Promise.resolve({ id }), searchParams: Promise.resolve({ schoolId }) };
}
function subject(input: ReturnType<typeof props>) {
  return (
    <Suspense fallback={<p>載入網址</p>}>
      <AnnouncementDetailPage {...input} />
    </Suspense>
  );
}
async function mount(input = props()) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(subject(input));
  });
  return { view, input };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDocFromServer).mockReset().mockResolvedValue(snapshot());
  account.user = { uid: 'alice' };
  account.loading = false;
});

it('opens the real public document and does not read a course collection or demo association', async () => {
  account.user = null;
  vi.mocked(getDocFromServer).mockResolvedValue(snapshot({ relatedCourseId: 'private-course' }));
  await mount();
  await screen.findByText('實際公告詳情');
  expect(screen.getByText('這是發布單位提供的全文。')).toBeTruthy();
  expect(getDocFromServer).toHaveBeenCalledExactlyOnceWith({
    path: 'schools/pu/announcements/notice-1',
  });
  expect(screen.queryByRole('link', { name: /前往.*課程/ })).toBeNull();
  expect(screen.getByRole('link', { name: '← 返回公告列表' }).getAttribute('href')).toBe(
    '/announcements?schoolId=pu',
  );
});

it('ignores stored demo administrator rights, edits and takedowns', async () => {
  localStorage.setItem('demoRole', 'admin');
  localStorage.setItem(
    'demoStore',
    JSON.stringify({
      announcementEdits: { 'notice-1': { title: '假編輯' } },
      takenDownAnnouncementIds: ['notice-1'],
    }),
  );
  await mount();
  await screen.findByText('實際公告詳情');
  expect(screen.queryByText('假編輯')).toBeNull();
  expect(screen.queryByRole('button', { name: /編輯|下架|發布|核准/ })).toBeNull();
  expect(screen.queryByText(/王大明|黃主任/)).toBeNull();
});

it('uses the existing legacy document only after confirmed canonical absence and matching school', async () => {
  vi.mocked(getDocFromServer)
    .mockResolvedValueOnce(snapshot(null))
    .mockResolvedValueOnce(snapshot({ title: '舊集合真實公告' }));
  await mount();
  await screen.findByText('舊集合真實公告');
  expect(getDocFromServer).toHaveBeenNthCalledWith(2, { path: 'announcements/notice-1' });
});

it.each(['nthu', undefined])(
  'does not reveal a legacy document belonging to another or unspecified school (%s)',
  async (schoolId) => {
    vi.mocked(getDocFromServer)
      .mockResolvedValueOnce(snapshot(null))
      .mockResolvedValueOnce(snapshot({ title: '不屬於此學校', schoolId }));
    await mount();
    await screen.findByText('找不到這則公告');
    expect(screen.queryByText('不屬於此學校')).toBeNull();
  },
);

it('renders not-found only after both public documents are confirmed absent', async () => {
  vi.mocked(getDocFromServer).mockResolvedValue(snapshot(null));
  await mount();
  await screen.findByText('找不到這則公告');
  expect(getDocFromServer).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('does not turn a canonical permission or network failure into absence or a legacy fallback', async () => {
  vi.mocked(getDocFromServer).mockRejectedValue(new Error('permission-denied'));
  await mount();
  await screen.findByRole('alert');
  expect(screen.queryByText('找不到這則公告')).toBeNull();
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
});

it('reports a legacy source failure separately from a missing document', async () => {
  vi.mocked(getDocFromServer)
    .mockResolvedValueOnce(snapshot(null))
    .mockRejectedValueOnce(new Error('unavailable'));
  await mount();
  await screen.findByRole('alert');
  expect(screen.queryByText('找不到這則公告')).toBeNull();
});

it('rejects inconsistent canonical school metadata', async () => {
  vi.mocked(getDocFromServer).mockResolvedValue(snapshot({ schoolId: 'nthu', title: '錯校公告' }));
  await mount();
  await screen.findByRole('alert');
  expect(screen.queryByText('錯校公告')).toBeNull();
});

it('never uses a crafted announcement ID as a Firestore subcollection path', async () => {
  await mount(props('notice-1/private/secret'));
  await screen.findByText('找不到這則公告');
  expect(getDocFromServer).not.toHaveBeenCalled();
});

it('hides the previous detail immediately when changing to another account', async () => {
  const { view, input } = await mount();
  await screen.findByText('實際公告詳情');
  const next = deferred();
  vi.mocked(getDocFromServer).mockReturnValueOnce(next.promise);
  account.user = { uid: 'bob' };
  view.rerender(subject(input));
  expect(screen.queryByText('實際公告詳情')).toBeNull();
  expect(screen.getByText('正在讀取公告…')).toBeTruthy();
  await act(async () => next.resolve(snapshot({ title: '重新讀取的公告' })));
  await screen.findByText('重新讀取的公告');
});

it('discards the late school response after navigating to another school', async () => {
  const old = deferred();
  vi.mocked(getDocFromServer).mockReturnValueOnce(old.promise);
  const { view } = await mount();
  vi.mocked(getDocFromServer).mockResolvedValueOnce(
    snapshot({ schoolId: 'nthu', title: '清華公告詳情' }),
  );
  await act(async () => {
    view.rerender(subject(props('notice-1', 'nthu')));
  });
  await screen.findByText('清華公告詳情');
  await act(async () => old.resolve(snapshot({ title: '舊學校晚回應' })));
  expect(screen.queryByText('舊學校晚回應')).toBeNull();
  expect(getDocFromServer).toHaveBeenLastCalledWith({
    path: 'schools/nthu/announcements/notice-1',
  });
});

it('discards responses from before logout even when the same UID signs back in', async () => {
  const old = deferred();
  vi.mocked(getDocFromServer).mockReturnValueOnce(old.promise);
  const { view, input } = await mount();
  account.user = null;
  view.rerender(subject(input));
  await screen.findByText('實際公告詳情');
  account.user = { uid: 'alice' };
  view.rerender(subject(input));
  await screen.findByText('實際公告詳情');
  await act(async () => old.resolve(snapshot({ title: '登出前晚回應' })));
  expect(screen.queryByText('登出前晚回應')).toBeNull();
});

it('clears stale content during refresh and can recover from a failed request', async () => {
  await mount();
  await screen.findByText('實際公告詳情');
  vi.mocked(getDocFromServer).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: '更新公告' }));
  expect(screen.queryByText('實際公告詳情')).toBeNull();
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  await screen.findByText('實際公告詳情');
});
