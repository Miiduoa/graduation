import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import CoursePage from './page';
import { loadCourseWork } from '@/lib/courseWork';

vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: { uid: 'alice' }, loading: false }),
}));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>Campus One</header> }));
vi.mock('@/lib/courseWork', () => ({
  loadCourseWork: vi.fn(),
  submitCourseText: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

it('clears previously visible coursework when a server recheck rejects access', async () => {
  vi.mocked(loadCourseWork)
    .mockResolvedValueOnce({
      id: 'course',
      name: '資料結構',
      description: '僅限修課者',
      canTeach: false,
      assignments: [],
      modules: [{ id: 'm1', title: '私人教材', description: '', order: 1,
        resourceUrl: null, resourceLabel: '教材' }],
    })
    .mockRejectedValueOnce(new Error('permission-denied'));

  await act(async () => {
    render(<CoursePage params={Promise.resolve({ courseId: 'course' })} />);
  });
  expect(await screen.findByText('私人教材')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('無法讀取課程'));
  expect(screen.queryByText('私人教材')).toBeNull();
  expect(screen.queryByText('僅限修課者')).toBeNull();
});
