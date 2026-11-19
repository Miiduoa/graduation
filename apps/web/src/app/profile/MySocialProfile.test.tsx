import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MySocialProfile } from './MySocialProfile';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  scope: { ready: true, schoolId: 'school-a', schoolName: 'A 大學' },
}));

vi.mock('@/lib/useBrowsingSchoolPageContext', () => ({
  useBrowsingSchoolPageContext: () => mocks.scope,
}));
vi.mock('@/lib/community/myPosts', () => ({
  loadOwnCampusPosts: mocks.load,
}));
vi.mock('next/image', () => ({
  default: ({ src, alt, ...other }: { src: string; alt: string; width?: number; height?: number; unoptimized?: boolean }) =>
    <img src={src} alt={alt} width={other.width} height={other.height} />,
}));

const base = {
  schoolId: 'school-a', authorUid: 'alice', anonymous: false, boardId: 'general',
  title: '社團活動紀錄', content: '今天分享了一場活動', likes: 3, commentCount: 2,
};
function page(posts: Record<string, unknown>[], cursor: object | null = null, hasMore = false) {
  return { items: posts, cursor, hasMore };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scope.ready = true;
  mocks.scope.schoolId = 'school-a';
  mocks.scope.schoolName = 'A 大學';
  mocks.load.mockResolvedValue(page([]));
});

it('shows an actual creator timeline, routes to author post and filters loaded photo posts', async () => {
  mocks.load.mockResolvedValue(page([
    { ...base, id: 'signed-1' },
    { ...base, id: 'photo-2', title: '我的照片', mediaUrls: ['https://example.test/photo.png'] },
  ]));
  render(<MySocialProfile uid="alice" name="小安" />);
  expect(await screen.findByText('社團活動紀錄')).toBeTruthy();
  expect(screen.getByRole('heading', { name: '小安' })).toBeTruthy();
  expect(screen.getByText(/已載入 2 則/)).toBeTruthy();
  expect(mocks.load).toHaveBeenCalledWith('school-a', 'alice');
  expect(screen.getByRole('link', { name: /社團活動紀錄/ }).getAttribute('href')).toBe(
    '/community/post/signed-1?schoolId=school-a',
  );
  expect(screen.getByRole('link', { name: '發表貼文' }).getAttribute('href')).toBe(
    '/community/post/new?schoolId=school-a&source=profile',
  );
  fireEvent.click(screen.getByRole('button', { name: '圖文作品' }));
  expect(screen.queryByText('社團活動紀錄')).toBeNull();
  expect(screen.getByText('我的照片')).toBeTruthy();
  expect(screen.getByRole('img', { name: '貼文附圖' })).toBeTruthy();
});

it('keeps earlier content during pagination failure and retries the exact cursor', async () => {
  const cursor = { id: 'first' };
  mocks.load.mockResolvedValueOnce(page([{ ...base, id: 'first' }], cursor, true))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(page([{ ...base, id: 'next', title: '下一篇' }]));
  render(<MySocialProfile uid="alice" name="小安" />);
  expect(await screen.findByText('社團活動紀錄')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '載入較早的貼文' }));
  expect(await screen.findByText(/載入較早貼文失敗/)).toBeTruthy();
  expect(screen.getByText('社團活動紀錄')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '載入較早的貼文' }));
  await screen.findByText('下一篇');
  expect(mocks.load).toHaveBeenNthCalledWith(2, 'school-a', 'alice', cursor);
  expect(mocks.load).toHaveBeenNthCalledWith(3, 'school-a', 'alice', cursor);
  expect(screen.getByText('社團活動紀錄')).toBeTruthy();
});

it('shows a retryable read error instead of pretending permission failure is an empty profile', async () => {
  mocks.load.mockRejectedValueOnce(new Error('permission-denied')).mockResolvedValueOnce(page([]));
  render(<MySocialProfile uid="alice" name="小安" />);
  await screen.findByRole('alert');
  expect(screen.queryByText('還沒有署名貼文')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  await screen.findByText('還沒有署名貼文');
});

it('does not show account A posts after changing the selected school', async () => {
  let resolveOld!: (result: ReturnType<typeof page>) => void;
  mocks.load.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
    .mockResolvedValueOnce(page([{ ...base, id: 'school-b-entry', title: 'B 校活動', schoolId: 'school-b' }]));
  const { rerender } = render(<MySocialProfile uid="alice" name="小安" />);
  mocks.scope.schoolId = 'school-b';
  mocks.scope.schoolName = 'B 大學';
  rerender(<MySocialProfile uid="alice" name="小安" />);
  await screen.findByText('B 校活動');
  await act(async () => resolveOld(page([{ ...base, id: 'old', title: 'A 校舊文' }])));
  await waitFor(() => expect(screen.queryByText('A 校舊文')).toBeNull());
  expect(screen.getByRole('link', { name: /B 校活動/ }).getAttribute('href')).toBe(
    '/community/post/school-b-entry?schoolId=school-b',
  );
});

it('does not query private campus content before a campus is selected', () => {
  mocks.scope.ready = false;
  render(<MySocialProfile uid="alice" name="小安" />);
  expect(screen.getByText(/選擇校園後/)).toBeTruthy();
  expect(mocks.load).not.toHaveBeenCalled();
});

it('keeps the supplied browsing campus through creator, message and settings links', async () => {
  mocks.load.mockResolvedValue(page([{ ...base, id: 'signed-1' }]));
  render(<MySocialProfile uid="alice" name="小安" navigationSearch="schoolId=school-a&campus=school-a&school=A" />);
  await screen.findByText('社團活動紀錄');
  for (const name of ['編輯資料', '發表貼文', /社團活動紀錄/, '看看校園動態', '私人訊息']) {
    const href = screen.getByRole('link', { name }).getAttribute('href')!;
    const target = new URL(href, 'https://campus.local');
    expect(target.searchParams.get('schoolId')).toBe('school-a');
    expect(target.searchParams.get('campus')).toBe('school-a');
    expect(target.searchParams.get('school')).toBe('A');
  }
  const compose = new URL(screen.getByRole('link', { name: '發表貼文' }).getAttribute('href')!, 'https://campus.local');
  expect(compose.searchParams.get('source')).toBe('profile');
});

it('keeps all-campus navigation explicit while asking the user to select a campus', () => {
  mocks.scope.ready = false;
  render(<MySocialProfile uid="alice" name="小安" navigationSearch="campus=all" />);
  expect(screen.getByRole('link', { name: '選擇校園' }).getAttribute('href')).toBe('/community?campus=all');
  expect(mocks.load).not.toHaveBeenCalled();
});
