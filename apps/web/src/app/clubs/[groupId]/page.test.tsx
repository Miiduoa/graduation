import { Suspense } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ClubDetailPage from './page';

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
vi.mock('../../groups/ClubPortal', () => ({
  ClubPortal: ({
    uid,
    schoolId,
    groupId,
    listHref,
  }: {
    uid: string;
    schoolId: string;
    groupId: string;
    listHref?: string;
  }) => <p>{`${uid}:${schoolId}:${groupId}:${listHref}`}</p>,
}));

afterEach(cleanup);

it.each(['discover', 'mine', undefined])(
  'returns detail opened from %s to the directory',
  async (tab) => {
    await act(async () => {
      render(
        <Suspense>
          <ClubDetailPage
            params={Promise.resolve({ groupId: 'club' })}
            searchParams={Promise.resolve({ schoolId: 'pu', tab })}
          />
        </Suspense>,
      );
    });
    expect(await screen.findByText('student:pu:club:/clubs?schoolId=pu&tab=discover')).toBeTruthy();
  },
);
