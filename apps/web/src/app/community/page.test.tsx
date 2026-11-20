import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import CommunityPage from './page';

const privateReader = vi.hoisted(() => vi.fn());

vi.mock('@/lib/useBrowsingSchoolPageContext', () => ({
  useBrowsingSchoolPageContext: () => ({
    schoolId: 'unavailable-campus',
    schoolName: '',
    schoolSearch: '?campus=all',
    ready: false,
    requiresSchoolSelection: true,
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
