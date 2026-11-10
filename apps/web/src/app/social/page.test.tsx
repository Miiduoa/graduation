import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import SocialPage from './page';

const state = vi.hoisted(() => ({
  authenticated: true,
  request: vi.fn(),
  params: new URLSearchParams('campus=pu'),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => state.params,
  redirect: vi.fn(),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/SchoolSelector', () => ({ SchoolSelector: () => <p>選擇瀏覽校園</p> }));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useSelectedSchool: () => ({ selectedSchoolId: 'pu' }),
}));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => ({
    session: state.authenticated
      ? { platformAccountId: 'google-account', context: 'platform-session' }
      : null,
    loading: false,
    pendingLogout: false,
    error: '',
    refresh: vi.fn(),
  }),
}));
vi.mock('@/features/social/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/social/api')>()),
  socialRequest: (...args: unknown[]) => state.request(...args),
}));

beforeEach(() => {
  state.authenticated = true;
  state.params = new URLSearchParams('campus=pu');
  state.request.mockReset().mockImplementation(async (path: string) => {
    if (path === 'boards') return { items: [] };
    if (path === 'feed?tenantId=pu') return {
      items: [{
        id: 'public-post',
        tenantId: 'pu',
        tenantName: '靜宜大學',
        communityId: 'open-board',
        communityName: '校際交流',
        text: '公開的校際活動消息',
        author: { displayName: '小林', isSelf: false },
        publishedAt: '2026-11-07T08:00:00Z',
        version: 1,
      }],
      nextCursor: null,
    };
    throw new Error(`Unexpected social path: ${path}`);
  });
});

it('opens the public feed from /social using only the Google platform session', async () => {
  render(<SocialPage />);
  expect(await screen.findByText('公開的校際活動消息')).toBeTruthy();
  expect(state.request.mock.calls.map(([path]) => path).sort()).toEqual(['boards', 'feed?tenantId=pu']);
  expect(state.request.mock.calls.every(([, context]) => context === 'platform-session')).toBe(true);
  expect(screen.queryByText('用 Google 帳號參與公開交流')).toBeNull();
});

it('lets a guest sign in to the public route without redirecting into school-only community', () => {
  state.authenticated = false;
  state.params = new URLSearchParams('campus=all');
  render(<SocialPage />);
  expect(screen.getByRole('heading', { name: '登入後參與公開交流' })).toBeTruthy();
  const login = new URL(screen.getByRole('link', { name: '登入帳號' }).getAttribute('href')!, 'https://campus.example');
  expect(login.searchParams.get('returnUrl')).toBe('/social?campus=all');
  expect(state.request).not.toHaveBeenCalled();
});
