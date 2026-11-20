import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import MemberCreatorPage from './page';
import MyCreatorPage from '../../me/page';

const mock = vi.hoisted(() => ({
  query: 'schoolId=other',
  uid: 'bob',
  schoolId: 'pu',
  ready: true,
  user: { uid: 'alice' } as { uid: string } | null,
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ uid: mock.uid }),
  useSearchParams: () => new URLSearchParams(mock.query),
}));
vi.mock('@/lib/useBrowsingSchoolPageContext', () => ({
  useBrowsingSchoolPageContext: () => ({
    schoolId: mock.schoolId,
    schoolName: '靜宜大學',
    ready: mock.ready,
  }),
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: mock.user }) }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/SchoolScopePlaceholder', () => ({
  SchoolScopePlaceholder: () => <p>選擇校園</p>,
}));
vi.mock('../../_components/CommunityAccess', () => ({
  CommunityAccess: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));
vi.mock('../../_components/CreatorProfile', () => ({
  CreatorProfile: ({ schoolId, memberUid }: { schoolId: string; memberUid: string }) =>
    <p>作者：{memberUid}，校園：{schoolId}</p>,
}));

beforeEach(() => {
  mock.query = 'schoolId=other';
  mock.uid = 'bob';
  mock.schoolId = 'pu';
  mock.ready = true;
  mock.user = { uid: 'alice' };
});

it('blocks someone else’s profile when the shared link refers to another campus', () => {
  render(<MemberCreatorPage />);
  expect(screen.getByRole('alert').textContent).toMatch(/先切換到連結中的學校/);
  expect(screen.queryByText(/作者：bob/)).toBeNull();
});

it('allows the matching campus profile and preserves author identity', () => {
  mock.query = 'schoolId=pu';
  render(<MemberCreatorPage />);
  expect(screen.getByText('作者：bob，校園：pu')).toBeTruthy();
});

it('prevents own deep link from silently switching to unrelated school data', () => {
  render(<MyCreatorPage />);
  expect(screen.getByRole('alert').textContent).toMatch(/目前選擇的學校不同/);
  expect(screen.queryByText(/作者：alice/)).toBeNull();
  mock.query = 'schoolId=pu';
  render(<MyCreatorPage />);
  expect(screen.getByText('作者：alice，校園：pu')).toBeTruthy();
});
