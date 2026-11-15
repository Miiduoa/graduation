import { Suspense } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ClubPage from './page';
const state = vi.hoisted(() => ({ user: { uid: 'student' } as { uid: string } | null }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => state }));
vi.mock('@/lib/useBrowsingSchoolPageContext', () => ({
  useBrowsingSchoolPageContext: () => ({ ready: true, school: { id: 'pu' } }),
}));
vi.mock('../../ClubAdmin', () => ({ ClubAdmin: () => <p>既有社團後台</p> }));
vi.mock('../../ClubPortal', () => ({
  ClubPortal: ({ uid, schoolId, groupId }: { uid: string; schoolId: string; groupId: string }) => (
    <p>{`${uid}:${schoolId}:${groupId}`}</p>
  ),
}));
afterEach(cleanup);
it('mounts the primary club portal and preserves the existing admin', async () => {
  await act(async () => {
    render(
      <Suspense>
        <ClubPage params={Promise.resolve({ groupId: 'club' })} />
      </Suspense>,
    );
  });
  expect(await screen.findByText('student:pu:club')).toBeTruthy();
  expect(screen.getByText('既有社團後台')).toBeTruthy();
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
  expect(await screen.findByText('既有社團後台')).toBeTruthy();
  expect(screen.queryByText('student:pu:club')).toBeNull();
});
