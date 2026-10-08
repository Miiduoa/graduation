import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import CoursePage from './page';
import { loadCourseWork } from '@/lib/courseWork';

const auth = vi.hoisted(() => ({
  user: { uid: 'alice' } as { uid: string } | null,
  loading: false,
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => auth,
}));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>Campus One</header> }));
vi.mock('@/components/PWAInstallBanner', () => ({ PWAInstallBanner: () => null }));
vi.mock('@/lib/courseWork', () => ({
  loadCourseWork: vi.fn(),
  submitCourseText: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { uid: 'alice' };
  auth.loading = false;
});

it('keeps guests outside coursework while showing its sign-in destination in the shared shell', async () => {
  auth.user = null;
  await act(async () => {
    render(<CoursePage params={Promise.resolve({ courseId: 'course' })} />);
  });
  expect(screen.getByRole('heading', { level: 1, name: '課程內容' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '登入帳號' }).getAttribute('href')).toBe(
    '/login?redirect=%2Fcourse%2Fcourse',
  );
  expect(screen.getByRole('navigation', { name: '網站資訊' })).toBeTruthy();
  expect(loadCourseWork).not.toHaveBeenCalled();
});

it('clears previously visible coursework when a server recheck rejects access', async () => {
  vi.mocked(loadCourseWork)
    .mockResolvedValueOnce({
      id: 'course',
      name: '資料結構',
      description: '僅限修課者',
      canTeach: false,
      assignments: [],
      modules: [
        {
          id: 'm1',
          title: '私人教材',
          description: '',
          order: 1,
          resourceUrl: null,
          resourceLabel: '教材',
        },
      ],
    })
    .mockRejectedValueOnce(new Error('permission-denied'));

  const params = Promise.resolve({ courseId: 'course' });
  let view: ReturnType<typeof render>;
  await act(async () => {
    view = render(<CoursePage params={params} />);
  });
  expect(await screen.findByText('私人教材')).toBeTruthy();

  auth.loading = true;
  await act(async () => {
    view.rerender(<CoursePage params={params} />);
  });
  expect(screen.queryByText('資料結構')).toBeNull();
  expect(screen.queryByText('僅限修課者')).toBeNull();
  expect(screen.queryByText('私人教材')).toBeNull();
  auth.loading = false;
  await act(async () => {
    view.rerender(<CoursePage params={params} />);
  });

  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('無法讀取課程'));
  expect(screen.queryByText('私人教材')).toBeNull();
  expect(screen.queryByText('僅限修課者')).toBeNull();
});
