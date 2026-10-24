import { Suspense, type ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { cleanCourse, cleanMeta } from '@campus/shared';
import SharedTimetablePage from './page';
import { loadSharedTimetable } from '@/lib/timetable/store';

const browse = vi.hoisted(() => ({ selectedSchoolId: 'pu' }));

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children, title }: { children: ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useSelectedSchool: () => ({ selectedSchoolId: browse.selectedSchoolId, loading: false }),
  useOptionalSelectedSchool: () => ({
    selectedSchoolId: browse.selectedSchoolId,
    selectedSchool: { id: browse.selectedSchoolId, name: '瀏覽校' },
    loading: false,
    catalogStatus: 'ready',
  }),
}));
vi.mock('@/lib/timetable/store', () => ({ loadSharedTimetable: vi.fn() }));

type SharePayload = Awaited<ReturnType<typeof loadSharedTimetable>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function share(partial: Partial<SharePayload> = {}): SharePayload {
  return {
    name: '分享課表',
    courses: [cleanCourse({ id: 'c1', name: '演算法', day: 1, start: 1, end: 2, room: 'A101' })],
    meta: cleanMeta({ title: '分享課表' }),
    expiresAt: '2099-12-31T00:00:00.000Z',
    schoolId: null,
    ...partial,
  };
}

function subject(token: string) {
  return (
    <Suspense fallback={<p>載入網址</p>}>
      <SharedTimetablePage params={Promise.resolve({ token })} />
    </Suspense>
  );
}

async function mount(token = 'tok-a') {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(subject(token));
  });
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  browse.selectedSchoolId = 'pu';
  vi.mocked(loadSharedTimetable).mockResolvedValue(share({ schoolId: 'ncku' }));
});

it('renders NCKU period 15 as 21:05–21:55 from the snapshot school profile', async () => {
  vi.mocked(loadSharedTimetable).mockResolvedValue(
    share({
      schoolId: 'ncku',
      courses: [cleanCourse({ id: 'd', name: '夜間課', day: 1, start: 15, end: 15 })],
    }),
  );
  await mount();
  expect(await screen.findByText('21:05–21:55')).toBeTruthy();
});

it('does not invent PU 08:10 when the snapshot school profile is missing or unknown', async () => {
  vi.mocked(loadSharedTimetable).mockResolvedValue(
    share({
      schoolId: null,
      courses: [cleanCourse({ id: 'c1', name: '未知校課', day: 1, start: 1, end: 2 })],
    }),
  );
  await mount();
  expect(await screen.findByText('第 1–2 節，時間待確認')).toBeTruthy();
  expect(screen.queryByText('08:10–10:00')).toBeNull();
  expect(screen.queryByText(/08:10/)).toBeNull();

  vi.mocked(loadSharedTimetable).mockResolvedValue(
    share({
      schoolId: 'ntu',
      courses: [cleanCourse({ id: 'c2', name: '未支援校', day: 2, start: 1, end: 1 })],
    }),
  );
  await act(async () => {
    render(subject('tok-unknown'));
  });
  expect(await screen.findByText('第 1 節，時間待確認')).toBeTruthy();
  expect(screen.queryByText('08:10–09:00')).toBeNull();
});

it('uses the loaded snapshot schoolId even when browse selection differs', async () => {
  browse.selectedSchoolId = 'pu';
  vi.mocked(loadSharedTimetable).mockResolvedValue(
    share({
      schoolId: 'ncku',
      courses: [cleanCourse({ id: 'd', name: '成大課', day: 1, start: 15, end: 15 })],
    }),
  );
  const view = await mount();
  expect(await screen.findByText('21:05–21:55')).toBeTruthy();
  browse.selectedSchoolId = 'ntpu';
  await act(async () => { view.rerender(subject('tok-a')); });
  expect(screen.getByText('21:05–21:55')).toBeTruthy();
  expect(loadSharedTimetable).toHaveBeenCalledExactlyOnceWith('tok-a');
  expect(screen.queryByText('08:10')).toBeNull();
  expect(screen.queryByText(/20:50|21:40/)).toBeNull();
});

it('keeps out-of-range periods unconfirmed even for a known school', async () => {
  vi.mocked(loadSharedTimetable).mockResolvedValue(share({
    schoolId: 'pu',
    courses: [cleanCourse({ id: 'invalid', name: '節次待確認', day: 1, start: 15, end: 15 })],
  }));
  await mount();
  expect(await screen.findByText('第 15 節，時間待確認')).toBeTruthy();
  expect(screen.queryByText(/08:10|21:05/)).toBeNull();
});

it('hides token A ready content immediately when switching to pending token B', async () => {
  const pendingB = deferred<SharePayload>();
  vi.mocked(loadSharedTimetable)
    .mockResolvedValueOnce(
      share({
        schoolId: 'ncku',
        courses: [cleanCourse({ id: 'a', name: 'A 課表課程', day: 1, start: 15, end: 15 })],
      }),
    )
    .mockReturnValueOnce(pendingB.promise);

  const view = await mount('token-a');
  expect(await screen.findByText('A 課表課程')).toBeTruthy();
  expect(screen.getByText('21:05–21:55')).toBeTruthy();

  await act(async () => {
    view.rerender(subject('token-b'));
  });
  expect(screen.queryByText('A 課表課程')).toBeNull();
  expect(screen.queryByText('21:05–21:55')).toBeNull();
  expect(screen.getByText('正在讀取分享課表…')).toBeTruthy();
});

it('ignores a late token A response after token B has already loaded', async () => {
  const pendingA = deferred<SharePayload>();
  const pendingB = deferred<SharePayload>();
  vi.mocked(loadSharedTimetable)
    .mockReturnValueOnce(pendingA.promise)
    .mockReturnValueOnce(pendingB.promise);

  const view = await mount('token-a');
  expect(screen.getByText('正在讀取分享課表…')).toBeTruthy();

  await act(async () => {
    view.rerender(subject('token-b'));
  });
  expect(screen.getByText('正在讀取分享課表…')).toBeTruthy();

  await act(async () => {
    pendingB.resolve(
      share({
        schoolId: 'ncku',
        courses: [cleanCourse({ id: 'b', name: 'B 已載入', day: 1, start: 15, end: 15 })],
      }),
    );
  });
  expect(await screen.findByText('B 已載入')).toBeTruthy();

  await act(async () => {
    pendingA.resolve(
      share({
        schoolId: 'pu',
        courses: [cleanCourse({ id: 'a', name: 'A 遲到回應', day: 1, start: 1, end: 1 })],
      }),
    );
  });
  await waitFor(() => {
    expect(screen.getByText('B 已載入')).toBeTruthy();
  });
  expect(screen.queryByText('A 遲到回應')).toBeNull();
  expect(screen.queryByText('08:10–09:00')).toBeNull();
});

it('keeps expired and revoked friendly copy', async () => {
  vi.mocked(loadSharedTimetable).mockRejectedValueOnce(new Error('expired'));
  await mount('expired');
  expect((await screen.findByRole('alert')).textContent).toBe('這份分享已過期。');

  vi.mocked(loadSharedTimetable).mockRejectedValueOnce(new Error('revoked'));
  await act(async () => {
    render(subject('revoked'));
  });
  expect(await screen.findByText('這份分享已經關掉了。')).toBeTruthy();
});
