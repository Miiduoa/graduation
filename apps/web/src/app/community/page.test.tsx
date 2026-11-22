import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import CommunityPage from './page';

const { privateReader, route } = vi.hoisted(() => ({
  privateReader: vi.fn(({ children }: { children: ReactNode }) => children),
  route: { ready: false, tab: 'feed' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams({ tab: route.tab }),
}));
vi.mock('./_components/FeedTab', () => ({ FeedTab: () => null }));
vi.mock('./_components/StudyBuddyTab', () => ({
  StudyBuddyTab: () => {
    const [draft, setDraft] = useState('');
    return (
      <button type="button" onClick={() => setDraft('保留的草稿')}>
        草稿{draft}
      </button>
    );
  },
}));

vi.mock('@/lib/useBrowsingSchoolPageContext', () => ({
  useBrowsingSchoolPageContext: () => ({
    schoolId: 'unavailable-campus',
    schoolName: '',
    schoolSearch: '?campus=all',
    ready: route.ready,
    requiresSchoolSelection: !route.ready,
  }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/SchoolScopePlaceholder', () => ({
  SchoolScopePlaceholder: () => <p>選擇校內交流的校園</p>,
}));
vi.mock('./_components/CommunityAccess', () => ({ CommunityAccess: privateReader }));

it('offers cross-campus public exchange before choosing a school without opening private readers', () => {
  render(<CommunityPage />);
  expect(screen.getByRole('link', { name: '前往公開交流' }).getAttribute('href')).toBe('/social?campus=all');
  expect(screen.getByText('選擇校內交流的校園')).toBeTruthy();
  expect(privateReader).not.toHaveBeenCalled();
});

it('unmounts the learning tab across community tab changes', () => {
  route.ready = true;
  route.tab = 'buddy';
  const view = render(<CommunityPage />);
  fireEvent.click(screen.getByRole('button', { name: '草稿' }));
  route.tab = 'feed';
  view.rerender(<CommunityPage />);
  expect(screen.queryByText('草稿保留的草稿')).toBeNull();
  route.tab = 'buddy';
  view.rerender(<CommunityPage />);
  expect(screen.getByRole('button', { name: '草稿' })).toBeTruthy();
});
