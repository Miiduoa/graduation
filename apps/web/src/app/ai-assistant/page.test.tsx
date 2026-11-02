import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import AssistantPage from './page';

const state = vi.hoisted(() => ({
  uid: 'alice' as string | null,
  query: '',
  loading: false,
  error: null as string | null,
  campus: {
    status: 'ready',
    schoolId: 'pu' as string | null,
    schoolName: '測試校園',
    schoolSearch: '?campus=pu',
  },
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(state.query) }));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({
    user: state.uid ? { uid: state.uid } : null,
    loading: state.loading,
    error: state.error,
  }),
}));
vi.mock('@/lib/useCampusBrowseContext', () => ({ useCampusBrowseContext: () => state.campus }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children, title }: { children: ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock('@/components/SchoolAccountRequired', () => ({
  SchoolAccountRequired: ({ returnUrl }: { returnUrl: string }) => <p>需要登入：{returnUrl}</p>,
}));
vi.mock('./CloudNavigationTask', () => ({
  CloudNavigationTask: ({
    userId,
    schoolId,
    initialDraft,
  }: {
    userId: string;
    schoolId: string;
    initialDraft: string;
  }) => <p data-testid="task">{JSON.stringify({ userId, schoolId, initialDraft })}</p>,
}));
beforeEach(() => {
  state.uid = 'alice';
  state.query = '';
  state.loading = false;
  state.error = null;
  state.campus = {
    status: 'ready',
    schoolId: 'pu',
    schoolName: '測試校園',
    schoolSearch: '?campus=pu',
  };
});
it('uses the selected school and only passes the URL query as a draft', () => {
  state.query = 'q=從圖書館到活動中心&courseId=private-course';
  render(<AssistantPage />);
  expect(JSON.parse(screen.getByTestId('task').textContent!)).toEqual({
    userId: 'alice',
    schoolId: 'pu',
    initialDraft: '從圖書館到活動中心',
  });
  expect(screen.getByRole('link', { name: '校園地圖' }).getAttribute('href')).toBe(
    '/map?campus=pu',
  );
});
it('requires login before mounting the task and preserves the return URL', () => {
  state.uid = null;
  state.query = 'q=library';
  render(<AssistantPage />);
  expect(screen.queryByTestId('task')).toBeNull();
  expect(screen.getByText('需要登入：/ai-assistant?q=library')).toBeTruthy();
});
it.each(['loading', 'error', 'unselected'])(
  'does not mount a task before campus resolution: %s',
  (status) => {
    state.campus.status = status;
    state.campus.schoolId = null;
    render(<AssistantPage />);
    expect(screen.queryByTestId('task')).toBeNull();
  },
);
it('waits for authentication and reports an auth error', () => {
  state.loading = true;
  const view = render(<AssistantPage />);
  expect(screen.getByText('正在確認登入狀態…')).toBeTruthy();
  expect(screen.queryByTestId('task')).toBeNull();
  state.loading = false;
  state.error = 'unavailable';
  view.rerender(<AssistantPage />);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByTestId('task')).toBeNull();
});
it('replaces the task scope when account or selected campus changes', () => {
  const view = render(<AssistantPage />);
  state.uid = 'bob';
  state.campus.schoolId = 'other';
  view.rerender(<AssistantPage />);
  expect(JSON.parse(screen.getByTestId('task').textContent!)).toMatchObject({
    userId: 'bob',
    schoolId: 'other',
  });
});
it('bounds shared link drafts to the public task limit', () => {
  state.query = `q=${'地'.repeat(500)}`;
  render(<AssistantPage />);
  expect(JSON.parse(screen.getByTestId('task').textContent!).initialDraft.length).toBe(240);
});
