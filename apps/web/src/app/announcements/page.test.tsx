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
function missingIndexError() {
  return Object.assign(new Error('The query requires an index.'), { code: 'failed-precondition' });
}
function productionEmptySchoolRead(schoolId: string) {
  return async (input: { path?: string }) => {
    const path = String(input?.path || '');
    if (path.includes('announcement-sources')) return snapshot();
    if (path === `schools/${schoolId}/announcements`) return snapshot();
    if (path === 'announcements') throw missingIndexError();
    return snapshot();
  };
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
  vi.unstubAllEnvs();
  account.user = { uid: 'alice' };
  account.loading = false;
  vi.mocked(isFirebaseConfigured).mockReturnValue(true);
  vi.mocked(getDocsFromServer).mockImplementation((async (input: { path?: string }) => {
    if (String(input?.path || '').includes('announcement-sources')) return snapshot();
    return snapshot(announcementDocument('校園公告實際內容'));
  }) as never);
  window.history.replaceState({}, '', '/announcements');
});

it('reads the public school source without requiring a signed-in account', async () => {
  account.user = null;
  render(<AnnouncementsPage />);
  await screen.findByText('校園公告實際內容');
  expect(screen.getByText('靜宜大學')).toBeTruthy();
  expect(getDocsFromServer).toHaveBeenCalledWith({
    path: 'schools/pu/announcements',
    constraints: [{ orderBy: 'publishedAt', direction: 'desc' }, { limit: 200 }],
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

function expectAnnouncementReadFailure() {
  expect(screen.getByRole('heading', { name: '暫時讀不到資料，請稍後再試' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '再試一次' })).toBeTruthy();
  expect(screen.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
  expect(screen.queryByText(/最近 0 則/)).toBeNull();
  expect(screen.queryByRole('link', { name: '教務處' })).toBeNull();
  expect(screen.queryByText('目前沒有公開公告')).toBeNull();
  expect(screen.queryByRole('article')).toBeNull();
}

it.each([
  [
    'permission-denied',
    Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }),
  ],
  ['unavailable', Object.assign(new Error('offline'), { code: 'unavailable' })],
])(
  'shows a retryable unread message when Firestore read fails with %s and there is no cached copy',
  async (_code, error) => {
    vi.mocked(getDocsFromServer).mockRejectedValueOnce(error);
    render(<AnnouncementsPage />);
    expect(await screen.findByRole('heading', { name: '暫時讀不到資料，請稍後再試' })).toBeTruthy();
    expectAnnouncementReadFailure();
    expect(screen.queryByText('請確認網路')).toBeNull();
    expect(screen.queryByText('暫時無法讀取公告')).toBeNull();
    expect(screen.queryByText('示範資料')).toBeNull();
    expect(getDocsFromServer).toHaveBeenCalledTimes(1);
    const pending = deferred();
    vi.mocked(getDocsFromServer).mockReturnValue(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: '再試一次' }));
    expectAnnouncementLoading();
    await act(async () => pending.resolve(snapshot(announcementDocument('校園公告實際內容'))));
    await screen.findByText('校園公告實際內容');
    expect(screen.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
    expect(screen.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
  },
);

it('shows a retryable unread message when Firebase is not configured and never reads demo content', async () => {
  vi.mocked(isFirebaseConfigured).mockReturnValue(false);
  render(<AnnouncementsPage />);
  expect(await screen.findByRole('heading', { name: '暫時讀不到資料，請稍後再試' })).toBeTruthy();
  expectAnnouncementReadFailure();
  expect(screen.queryByText('請確認網路')).toBeNull();
  expect(getDocsFromServer).not.toHaveBeenCalled();
});

it('does not display leftover root-collection rows when the school collection is empty', async () => {
  vi.mocked(getDocsFromServer).mockImplementation((async (input: { path?: string }) => {
    if (String(input?.path || '').includes('announcement-sources')) return snapshot();
    if (String(input?.path || '') === 'schools/pu/announcements') return snapshot();
    return snapshot(announcementDocument('既有來源公告', { schoolId: 'pu' }));
  }) as never);
  render(<AnnouncementsPage />);
  expect(await screen.findByRole('heading', { name: '本站還沒接上這間學校的公告。' })).toBeTruthy();
  expect(screen.queryByText('既有來源公告')).toBeNull();
  expect(screen.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
  expect(getDocsFromServer).not.toHaveBeenCalledWith(
    expect.objectContaining({ path: 'announcements' }),
  );
});

it('shows unpublished copy when the school collection is empty even if a root query would fail', async () => {
  vi.mocked(getDocsFromServer).mockImplementation(productionEmptySchoolRead('pu') as never);
  render(<AnnouncementsPage />);
  expect(await screen.findByRole('heading', { name: '本站還沒接上這間學校的公告。' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往學校官方公告' }).getAttribute('href')).toBe(
    'https://dorac.pu.edu.tw/p/403-1059-719-1.php',
  );
  expect(screen.getByRole('link', { name: '教務處' })).toBeTruthy();
  expect(screen.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
  expect(screen.queryByRole('button', { name: '再試一次' })).toBeNull();
  expect(getDocsFromServer).toHaveBeenCalledWith({
    path: 'schools/pu/announcements',
    constraints: [{ orderBy: 'publishedAt', direction: 'desc' }, { limit: 200 }],
  });
  expect(getDocsFromServer).not.toHaveBeenCalledWith(
    expect.objectContaining({ path: 'announcements' }),
  );
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

it('keeps older 學務處 and 住宿 announcements visible and searchable when other offices fill the recent list', async () => {
  const recent = Array.from({ length: 20 }, (_, index) =>
    announcementDocument(`教務處稿${index + 1}`, {
      sourceId: 'pu-acd',
      source: '教務處',
      office: '教務處',
      publishedAt: `2026-10-14T${String(index).padStart(2, '0')}:00:00.000Z`,
    }),
  );
  const osa = announcementDocument('學務處生活輔導', {
    sourceId: 'pu-osa',
    office: '學務處',
    publishedAt: '2026-09-01T00:00:00.000Z',
  });
  const dorms = Array.from({ length: 5 }, (_, index) =>
    announcementDocument(`住宿公告${index + 1}`, {
      sourceId: 'pu-dorm',
      source: '住宿',
      office: '住宿',
      publishedAt: `2026-09-0${index + 1}T00:00:00.000Z`,
    }),
  );
  vi.mocked(getDocsFromServer).mockImplementation((async (input: {
    path?: string;
    constraints?: Array<{ where?: string; value?: string; orderBy?: string }>;
  }) => {
    const path = String(input?.path || '');
    if (path.includes('announcement-sources')) {
      return {
        empty: false,
        docs: [
          {
            id: 'pu-acd',
            data: () => ({ sourceId: 'pu-acd', office: '教務處', status: 'healthy' }),
          },
          {
            id: 'pu-osa',
            data: () => ({ sourceId: 'pu-osa', office: '學務處', status: 'healthy' }),
          },
          {
            id: 'pu-dorm',
            data: () => ({ sourceId: 'pu-dorm', office: '住宿', status: 'healthy' }),
          },
        ],
      } as never;
    }
    const sourceId = input?.constraints?.find((item) => item.where === 'sourceId')?.value;
    if (sourceId === 'pu-osa') return snapshot(osa);
    if (sourceId === 'pu-dorm') return snapshot(...dorms);
    if (path === 'schools/nthu/announcements' || sourceId?.startsWith('nthu-')) return snapshot();
    if (input?.constraints?.some((item) => item.orderBy === 'publishedAt'))
      return snapshot(...recent);
    return snapshot();
  }) as never);
  render(<AnnouncementsPage />);
  await screen.findByText('學務處生活輔導');
  expect(screen.getByText('住宿公告1')).toBeTruthy();
  expect(screen.getByText('住宿公告5')).toBeTruthy();
  expect(screen.queryByText('清華偽裝')).toBeNull();
  fireEvent.change(screen.getByLabelText('搜尋公告'), { target: { value: '學務處' } });
  expect(screen.getByText('學務處生活輔導')).toBeTruthy();
  expect(screen.queryByText('教務處稿1')).toBeNull();
  expect(screen.queryByText('住宿公告1')).toBeNull();
  fireEvent.change(screen.getByLabelText('搜尋公告'), { target: { value: '住宿' } });
  expect(screen.getAllByRole('article')).toHaveLength(5);
  expect(screen.queryByText('學務處生活輔導')).toBeNull();
});

it('keeps cached announcements when a later Firestore read fails', async () => {
  render(<AnnouncementsPage />);
  await screen.findByText('校園公告實際內容');
  vi.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('permission-denied'));
  fireEvent.click(screen.getByRole('button', { name: '更新公告' }));
  await screen.findByText('校園公告實際內容');
  expect(screen.getByText(/最後更新 \d+\/\d+ \d{2}:\d{2}，暫時讀不到新公告/)).toBeTruthy();
  expect(screen.queryByText('學校網站暫時連不上')).toBeNull();
  expect(screen.queryByText('請確認網路')).toBeNull();
  expect(screen.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
});

function expectAnnouncementLoading() {
  expect(screen.getByText('正在讀取公告…')).toBeTruthy();
  expect(screen.queryByText(/最近 0 則/)).toBeNull();
  expect(screen.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
  expect(screen.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
  expect(screen.queryByText('目前沒有公開公告')).toBeNull();
  expect(screen.queryByText('目前沒有公告')).toBeNull();
  expect(screen.queryByRole('article')).toBeNull();
}

it('does not show an empty school state before the first feed returns', async () => {
  const pending = deferred();
  vi.mocked(getDocsFromServer).mockReturnValueOnce(pending.promise);
  render(<AnnouncementsPage />);
  expectAnnouncementLoading();
  await act(async () => pending.resolve(snapshot(announcementDocument('校園公告實際內容'))));
  await screen.findByText('校園公告實際內容');
  expect(screen.getByText(/最近 \d+ 則/)).toBeTruthy();
  expect(screen.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
});

it('shows unpublished copy only after an empty feed has finished loading', async () => {
  const pending = deferred();
  vi.mocked(getDocsFromServer).mockReturnValue(pending.promise);
  render(<AnnouncementsPage />);
  expectAnnouncementLoading();
  await act(async () => pending.resolve(snapshot()));
  expect(await screen.findByRole('heading', { name: '本站還沒接上這間學校的公告。' })).toBeTruthy();
});

it('returns to loading and hides the previous school while the next school feed is in flight', async () => {
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
  await screen.findByText('校園公告實際內容');
  const pending = deferred();
  vi.mocked(getDocsFromServer).mockReturnValue(pending.promise);
  await act(async () => {
    view.rerender(
      <Suspense fallback={<p>載入學校</p>}>
        <AnnouncementsPage searchParams={nthu} />
      </Suspense>,
    );
  });
  expect(screen.queryByText('校園公告實際內容')).toBeNull();
  expectAnnouncementLoading();
  await act(async () =>
    pending.resolve(snapshot(announcementDocument('清華公告', { schoolId: 'nthu' }))),
  );
  await screen.findByText('清華公告');
  expect(screen.queryByText('校園公告實際內容')).toBeNull();
  expect(screen.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
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

it('does not keep previous school announcements after switching when the next school read fails', async () => {
  const pu = Promise.resolve({ schoolId: 'pu' });
  const nthu = Promise.resolve({ campus: 'nthu' });
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <Suspense fallback={<p>載入學校</p>}>
        <AnnouncementsPage searchParams={pu} />
      </Suspense>,
    );
  });
  await screen.findByText('校園公告實際內容');
  vi.mocked(getDocsFromServer).mockRejectedValue(new Error('permission-denied'));
  await act(async () => {
    view.rerender(
      <Suspense fallback={<p>載入學校</p>}>
        <AnnouncementsPage searchParams={nthu} />
      </Suspense>,
    );
  });
  expect(screen.queryByText('校園公告實際內容')).toBeNull();
  expect(await screen.findByRole('heading', { name: '暫時讀不到資料，請稍後再試' })).toBeTruthy();
  expectAnnouncementReadFailure();
  expect(getDocsFromServer).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'schools/nthu/announcements' }),
  );
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
  expect(getDocsFromServer).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'schools/nthu/announcements' }),
  );
});

it('uses the announcement empty state when switching to a school with no announcements', async () => {
  const pu = Promise.resolve({ schoolId: 'pu' });
  const cgu = Promise.resolve({ schoolId: 'cgu', campus: 'cgu' });
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <Suspense fallback={<p>載入學校</p>}>
        <AnnouncementsPage searchParams={pu} />
      </Suspense>,
    );
  });
  await screen.findByText('校園公告實際內容');
  vi.mocked(getDocsFromServer).mockImplementation((async (input: { path?: string }) => {
    const path = String(input?.path || '');
    if (path.includes('cgu') || path === 'announcements') return snapshot();
    return snapshot(announcementDocument('靜宜舊公告'));
  }) as never);
  await act(async () => {
    view.rerender(
      <Suspense fallback={<p>載入學校</p>}>
        <AnnouncementsPage searchParams={cgu} />
      </Suspense>,
    );
  });
  expect(screen.queryByText('校園公告實際內容')).toBeNull();
  expect(screen.queryByText('靜宜舊公告')).toBeNull();
  expect(
    await screen.findByRole('heading', {
      name: '本站還沒接上這間學校的公告。',
    }),
  ).toBeTruthy();
  expect(screen.queryByRole('link', { name: '前往學校官方公告' })).toBeNull();
  expect(screen.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
  expect(getDocsFromServer).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'schools/cgu/announcements' }),
  );
});

it('does not render a record whose stored school differs from the selected school', async () => {
  vi.mocked(getDocsFromServer).mockImplementation((async (input: { path?: string }) => {
    if (String(input?.path || '').includes('announcement-sources')) return snapshot();
    return snapshot(announcementDocument('錯誤學校資料', { schoolId: 'nthu' }));
  }) as never);
  render(<AnnouncementsPage />);
  expect(
    await screen.findByRole('heading', {
      name: '本站還沒接上這間學校的公告。',
    }),
  ).toBeTruthy();
  expect(screen.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
  expect(screen.queryByText('錯誤學校資料')).toBeNull();
  expect(screen.queryByText('請確認網路')).toBeNull();
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

it('hides stale scrape rows when the school site is down and labels 暫時抓不到', async () => {
  vi.mocked(getDocsFromServer).mockImplementation((async (input: { path?: string }) => {
    if (String(input?.path || '').includes('announcement-sources')) {
      return {
        empty: false,
        docs: [
          {
            id: 'pu-acd',
            data: () => ({
              sourceId: 'pu-acd',
              office: '教務處',
              status: 'unavailable',
              lastSuccessAt: '2026-10-12T10:05:00.000Z',
              listUrl: 'https://acd.pu.edu.tw/p/403-1042-885-1.php',
            }),
          },
        ],
      } as never;
    }
    return snapshot(
      announcementDocument('過期稿', { origin: 'public_scrape', sourceId: 'pu-acd' }),
    );
  }) as never);
  render(<AnnouncementsPage />);
  expect(
    await screen.findByRole('heading', {
      name: '學校網站暫時連不上，可以先到學校網站看最新消息',
    }),
  ).toBeTruthy();
  expect(screen.getByText('暫時抓不到')).toBeTruthy();
  expect(screen.queryByText('過期稿')).toBeNull();
  expect(screen.queryByText('暫時讀不到新公告')).toBeNull();
});

it('links the office site when the school site is down and there is no cached copy', async () => {
  vi.mocked(getDocsFromServer).mockImplementation((async (input: { path?: string }) => {
    if (String(input?.path || '').includes('announcement-sources')) {
      return {
        empty: false,
        docs: [
          {
            id: 'pu-acd',
            data: () => ({
              sourceId: 'pu-acd',
              office: '教務處',
              status: 'unavailable',
              listUrl: 'https://acd.pu.edu.tw/p/403-1042-885-1.php',
            }),
          },
        ],
      } as never;
    }
    return snapshot();
  }) as never);
  render(<AnnouncementsPage />);
  expect(
    await screen.findByRole('heading', {
      name: '學校網站暫時連不上，可以先到學校網站看最新消息',
    }),
  ).toBeTruthy();
  expect(screen.getByRole('link', { name: '教務處' }).getAttribute('href')).toBe(
    'https://acd.pu.edu.tw/p/403-1042-885-1.php',
  );
  expect(screen.getByRole('link', { name: '教務處' }).getAttribute('rel')).toBe(
    'noopener noreferrer',
  );
  expect(screen.queryByText('目前沒有公開公告')).toBeNull();
  expect(screen.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
  expect(screen.getByText('暫時抓不到')).toBeTruthy();
});

it.each([
  ['ncku', '全校最新消息', 'https://web.ncku.edu.tw/p/422-1000-1026.php?Lang=zh-tw'],
  ['ntpu', '電子公文一般公告（含教務處）', 'https://fms.ntpu.edu.tw/km/24662'],
] as const)(
  'shows unpublished copy and the official %s announcement page when that school has no items',
  async (school, office, url) => {
    vi.mocked(getDocsFromServer).mockResolvedValue(snapshot());
    const params = Promise.resolve({ schoolId: school });
    await act(async () => {
      render(
        <Suspense fallback={<p>載入學校</p>}>
          <AnnouncementsPage searchParams={params} />
        </Suspense>,
      );
    });
    expect(await screen.findByRole('heading', { name: '本站還沒接上這間學校的公告。' })).toBeTruthy();
    expect(screen.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
    expect(screen.getByRole('link', { name: '前往學校官方公告' }).getAttribute('href')).toBe(url);
    expect(screen.getByRole('link', { name: office }).getAttribute('href')).toBe(url);
  },
);

it.each([
  ['ncku', '全校最新消息', 'https://web.ncku.edu.tw/p/422-1000-1026.php?Lang=zh-tw'],
  ['ntpu', '電子公文一般公告（含教務處）', 'https://fms.ntpu.edu.tw/km/24662'],
] as const)(
  'keeps unpublished copy for %s without querying the root announcements collection',
  async (school, office, url) => {
    vi.mocked(getDocsFromServer).mockImplementation(productionEmptySchoolRead(school) as never);
    const params = Promise.resolve({ schoolId: school });
    await act(async () => {
      render(
        <Suspense fallback={<p>載入學校</p>}>
          <AnnouncementsPage searchParams={params} />
        </Suspense>,
      );
    });
    expect(await screen.findByRole('heading', { name: '本站還沒接上這間學校的公告。' })).toBeTruthy();
    expect(screen.getByRole('link', { name: office }).getAttribute('href')).toBe(url);
    expect(screen.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
    expect(screen.queryByRole('button', { name: '再試一次' })).toBeNull();
    expect(getDocsFromServer).toHaveBeenCalledWith({
      path: `schools/${school}/announcements`,
      constraints: [{ orderBy: 'publishedAt', direction: 'desc' }, { limit: 200 }],
    });
    expect(getDocsFromServer).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: 'announcements' }),
    );
  },
);

it.each(['ncku', 'ntpu'] as const)(
  'still shows a retryable unread message when the canonical %s announcement query actually fails',
  async (school) => {
    vi.mocked(getDocsFromServer).mockRejectedValueOnce(missingIndexError());
    const params = Promise.resolve({ schoolId: school });
    await act(async () => {
      render(
        <Suspense fallback={<p>載入學校</p>}>
          <AnnouncementsPage searchParams={params} />
        </Suspense>,
      );
    });
    expect(await screen.findByRole('heading', { name: '暫時讀不到資料，請稍後再試' })).toBeTruthy();
    expectAnnouncementReadFailure();
    expect(getDocsFromServer).toHaveBeenCalledTimes(1);
  },
);

it('links catalog office sites when the school has never been fetched', async () => {
  vi.mocked(getDocsFromServer).mockResolvedValue(snapshot());
  render(<AnnouncementsPage />);
  expect(
    await screen.findByRole('heading', {
      name: '本站還沒接上這間學校的公告。',
    }),
  ).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往學校官方公告' }).getAttribute('href')).toBe(
    'https://dorac.pu.edu.tw/p/403-1059-719-1.php',
  );
  expect(screen.getByRole('link', { name: '教務處' }).getAttribute('href')).toBe(
    'https://acd.pu.edu.tw/p/403-1042-885-1.php',
  );
  expect(screen.getByRole('link', { name: '教務處' }).getAttribute('rel')).toBe(
    'noopener noreferrer',
  );
  expect(screen.getByRole('link', { name: '綜合業務組' })).toBeTruthy();
  expect(screen.queryByText('目前沒有公開公告')).toBeNull();
  expect(
    screen.queryByRole('heading', {
      name: '學校網站暫時連不上，可以先到學校網站看最新消息',
    }),
  ).toBeNull();
});

it('shows no public announcements only after a successful empty fetch', async () => {
  vi.mocked(getDocsFromServer).mockImplementation((async (input: { path?: string }) => {
    if (String(input?.path || '').includes('announcement-sources')) {
      return {
        empty: false,
        docs: [
          {
            id: 'pu-acd',
            data: () => ({
              sourceId: 'pu-acd',
              office: '教務處',
              status: 'healthy',
              lastSuccessAt: '2026-10-12T10:05:00.000Z',
              listUrl: 'https://acd.pu.edu.tw/p/403-1042-885-1.php',
            }),
          },
        ],
      } as never;
    }
    return snapshot();
  }) as never);
  render(<AnnouncementsPage />);
  expect(await screen.findByRole('heading', { name: '目前沒有學生日常公告。' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往學校官方公告' }).getAttribute('href')).toBe(
    'https://dorac.pu.edu.tw/p/403-1059-719-1.php',
  );
  expect(screen.getByRole('link', { name: '教務處' }).getAttribute('href')).toBe(
    'https://acd.pu.edu.tw/p/403-1042-885-1.php',
  );
  expect(screen.queryByText('學校網站暫時連不上')).toBeNull();
  expect(screen.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
});

it.each(['', 'staging', 'production'])(
  'hides cms-none demo schools when NEXT_PUBLIC_APP_ENV is %s',
  async (env) => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', env);
    const params = Promise.resolve({ schoolId: 'tw-demo-uni' });
    await act(async () => {
      render(
        <Suspense fallback={<p>載入學校</p>}>
          <AnnouncementsPage searchParams={params} />
        </Suspense>,
      );
    });
    expect(screen.queryByText('示範大學')).toBeNull();
    expect(screen.getByRole('heading', { name: '目前沒有公開公告' })).toBeTruthy();
    expect(screen.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
    expect(screen.queryByText('學校網站暫時連不上')).toBeNull();
    expect(getDocsFromServer).not.toHaveBeenCalled();
  },
);

it('hides cms-none demo schools when NEXT_PUBLIC_APP_ENV is unset', async () => {
  const params = Promise.resolve({ schoolId: 'tw-demo-uni' });
  await act(async () => {
    render(
      <Suspense fallback={<p>載入學校</p>}>
        <AnnouncementsPage searchParams={params} />
      </Suspense>,
    );
  });
  expect(screen.queryByText('示範大學')).toBeNull();
  expect(screen.getByRole('heading', { name: '目前沒有公開公告' })).toBeTruthy();
  expect(screen.queryByText('本站還沒接上這間學校的公告。')).toBeNull();
  expect(screen.queryByText('學校網站暫時連不上')).toBeNull();
  expect(getDocsFromServer).not.toHaveBeenCalled();
});

it.each(['development', 'preview', 'test'])(
  'shows cms-none demo schools when NEXT_PUBLIC_APP_ENV is %s',
  async (env) => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', env);
    const params = Promise.resolve({ schoolId: 'tw-demo-uni' });
    await act(async () => {
      render(
        <Suspense fallback={<p>載入學校</p>}>
          <AnnouncementsPage searchParams={params} />
        </Suspense>,
      );
    });
    await screen.findByText('校園公告實際內容');
    expect(screen.getByText('示範大學')).toBeTruthy();
    expect(getDocsFromServer).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'schools/tw-demo-uni/announcements' }),
    );
  },
);

it('keeps undated and future rows out of the student wall and 全部公告, and shows staff or security only in 全部公告', async () => {
  vi.mocked(getDocsFromServer).mockImplementation((async (input: { path?: string }) => {
    if (String(input?.path || '').includes('announcement-sources')) return snapshot();
    return snapshot(
      announcementDocument('日常選課', { publishedAt: '2026-10-08T00:00:00.000Z' }),
      announcementDocument('無日期稿', { publishedAt: '' }),
      announcementDocument('未來稿', { publishedAt: '2099-01-01T00:00:00.000Z' }),
      announcementDocument('【漏洞預警】Cisco License 存在重大資安漏洞', {
        publishedAt: '2026-10-08T00:00:00.000Z',
        office: '計算機與網路中心',
      }),
      announcementDocument('點名計分單(for教師)', { publishedAt: '2026-10-08T00:00:00.000Z' }),
    );
  }) as never);
  render(<AnnouncementsPage />);
  await screen.findByText('日常選課');
  expect(screen.getByText(/最近 1 則/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '全部公告' })).toBeTruthy();
  expect(screen.queryByText('無日期稿')).toBeNull();
  expect(screen.queryByText('未來稿')).toBeNull();
  expect(screen.queryByText(/Cisco/)).toBeNull();
  expect(screen.queryByText(/點名計分單/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '全部公告' }));
  expect(screen.getByText(/最近 3 則/)).toBeTruthy();
  expect(screen.getByText(/Cisco/)).toBeTruthy();
  expect(screen.getByText(/點名計分單/)).toBeTruthy();
  expect(screen.queryByText('無日期稿')).toBeNull();
  expect(screen.queryByText('未來稿')).toBeNull();
  expect(screen.queryByText('這間學校的公告還沒上架。')).toBeNull();
});
