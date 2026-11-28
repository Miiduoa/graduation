import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CampusBrowseContext } from '@/lib/useCampusBrowseContext';
import CampusEventsPage from './page';

const browse = vi.hoisted(() =>
  vi.fn((): CampusBrowseContext => ({
    status: 'ready',
    schoolId: 'nthu',
    schoolName: '國立清華大學',
    schoolSearch: '?schoolId=nthu&campus=nthu',
  })),
);

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children, title }: { children: ReactNode; title?: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: null, loading: false }) }));

vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => browse(),
}));

vi.mock('@/components/events/EventList', () => ({
  EventList: ({ schoolId }: { schoolId: string }) => (
    <div data-testid="event-list">{schoolId}</div>
  ),
}));

it('requires a selected school before listing events', () => {
  browse.mockReturnValueOnce({
    status: 'unselected',
    schoolId: null,
    schoolName: '',
    schoolSearch: '?campus=all',
  });
  render(<CampusEventsPage />);
  expect(screen.getByRole('heading', { name: '先選擇一所學校' })).toBeTruthy();
  expect(screen.queryByTestId('event-list')).toBeNull();
});

it('renders the school-scoped list when browse context is ready', () => {
  render(<CampusEventsPage />);
  expect(screen.getByRole('heading', { name: '校園活動' })).toBeTruthy();
  expect(screen.getByTestId('event-list').textContent).toBe('nthu');
});

beforeEach(() => {
  window.history.replaceState(null, '', '/events?schoolId=nthu');
});

it('opens the saved view from saved=1 without waiting for or fetching the browse list', async () => {
  window.history.replaceState(null, '', '/events?schoolId=nthu&campus=nthu&saved=1');
  await act(async () => {
    render(<CampusEventsPage searchParams={Promise.resolve({ schoolId: 'nthu', campus: 'nthu', saved: '1' })} />);
  });
  expect(screen.getByRole('region', { name: '我的收藏活動' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /我的收藏/ }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByTestId('event-list')).toBeNull();
  fireEvent.click(within(screen.getByRole('group', { name: '活動檢視' })).getByRole('button', { name: '瀏覽活動' }));
  expect(screen.getByTestId('event-list').textContent).toBe('nthu');
  expect(new URLSearchParams(window.location.search).has('saved')).toBe(false);
  expect(new URLSearchParams(window.location.search).get('campus')).toBe('nthu');
});
