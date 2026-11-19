import { Suspense } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ClubPage from './page';
const state = vi.hoisted(() => ({ user: { uid: 'student' } as { uid: string } | null }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ ...state, loading: false }) }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/SchoolScopePlaceholder', () => ({
  SchoolScopePlaceholder: () => <p>選學校中</p>,
}));
vi.mock('@/lib/useBrowsingSchoolPageContext', () => ({
  useBrowsingSchoolPageContext: () => ({ ready: true, school: { id: 'pu', name: '靜宜' } }),
}));
vi.mock('../../ClubPortal', () => ({
  ClubPortal: ({ uid, schoolId, groupId }: { uid: string; schoolId: string; groupId: string }) => (
    <p>{`${uid}:${schoolId}:${groupId}`}</p>
  ),
}));
afterEach(cleanup);
it('mounts the official club portal inside shell and hides legacy admin copy', async () => {
  await act(async () => {
    render(
      <Suspense>
        <ClubPage params={Promise.resolve({ groupId: 'club' })} />
      </Suspense>,
    );
  });
  expect(await screen.findByText('student:pu:club')).toBeTruthy();
  expect(screen.queryByText('既有後台')).toBeNull();
  expect(screen.queryByText('這所學校還沒開放社團管理。')).toBeNull();
});
it('does not mount club forms for visitors', async () => {
  state.user = null;
  await act(async () => {
    render(
      <Suspense>
        <ClubPage params={Promise.resolve({ groupId: 'club' })} />
      </Suspense>,
    );
  });
  expect(await screen.findByText('登入學校帳號')).toBeTruthy();
  expect(screen.queryByText('student:pu:club')).toBeNull();
});
