import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
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
