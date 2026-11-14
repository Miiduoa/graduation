import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ConnectPage from './page';

const state = vi.hoisted(() => ({
  auth: { user: null as { uid: string } | null, loading: false, error: null as unknown },
  platform: {
    session: null as { platformAccountId: string } | null,
    loading: false,
    error: '',
    pendingLogout: false,
  },
  school: { selectedSchool: { id: 'nthu' }, loading: false, catalogStatus: 'ready' },
  hydrated: true,
  query: '',
}));

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => state.auth }));
vi.mock('@/features/nuni/Session', () => ({ useOptionalNuniSession: () => state.platform }));
vi.mock('@/lib/useClientHydrated', () => ({ useClientHydrated: () => state.hydrated }));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => state.school,
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(state.query) }));

beforeEach(() => {
  window.history.replaceState({}, '', '/connect');
});
afterEach(() => {
  cleanup();
  state.auth = { user: null, loading: false, error: null };
  state.platform = { session: null, loading: false, error: '', pendingLogout: false };
  state.school = { selectedSchool: { id: 'nthu' }, loading: false, catalogStatus: 'ready' };
  state.hydrated = true;
  state.query = '';
});

it('把私人對話與服務通知分開，保留同一個已選校園', () => {
  render(<ConnectPage />);
  for (const [name, pathname] of [
    ['訊息', '/dms'],
    ['通知', '/messages'],
    ['公告', '/announcements'],
  ]) {
    const href = new URL(
      screen.getByRole('link', { name }).getAttribute('href')!,
      'https://campus.example',
    );
    expect(href.pathname).toBe(pathname);
    expect(href.searchParams.get('schoolId')).toBe('nthu');
    expect(href.searchParams.get('campus')).toBe('nthu');
  }
  expect(screen.getByText('接續已建立的對話')).toBeTruthy();
  expect(screen.getByText('查看本人收到的服務通知')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('共 6 項服務');
});

it('訪客能直接選公開公告，校內與跨校交流清楚標示各自帳號需求', () => {
  render(<ConnectPage />);
  expect(within(screen.getByRole('link', { name: '公告' })).getByText('可直接瀏覽')).toBeTruthy();
  expect(
    within(screen.getByRole('link', { name: '跨校公開交流' })).getByText('Google 帳號'),
  ).toBeTruthy();
  expect(within(screen.getByRole('link', { name: '校園交流' })).getByText('學校帳號')).toBeTruthy();
  expect(screen.queryByText('從這裡開始')).toBeNull();
});

it('Google 帳號先引導公開交流，不標示校內社群已可用', () => {
  state.platform.session = { platformAccountId: 'platform-a' };
  render(<ConnectPage />);
  const social = screen.getByRole('link', { name: '跨校公開交流' });
  expect(within(social).getByText('從這裡開始')).toBeTruthy();
  expect(
    within(screen.getByRole('link', { name: '校園交流' })).queryByText('從這裡開始'),
  ).toBeNull();
  expect(
    screen.getByText('從跨校公開交流開始。校內話題、訊息與好友會另外確認學校帳號。'),
  ).toBeTruthy();
  expect(new URL(social.getAttribute('href')!, 'https://campus.example').pathname).toBe('/social');
});

it('學校帳號可從校內動態開始，公開交流仍保留', () => {
  state.auth.user = { uid: 'student-a' };
  render(<ConnectPage />);
  expect(
    within(screen.getByRole('link', { name: '校園交流' })).getByText('從這裡開始'),
  ).toBeTruthy();
  expect(screen.getByRole('link', { name: '跨校公開交流' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '找人' })).toBeTruthy();
});

it.each(['loading', 'error', 'pendingLogout'] as const)('平台 %s 狀態不沿用舊帳號推薦', (mode) => {
  state.platform.session = { platformAccountId: 'platform-a' };
  if (mode === 'error') state.platform.error = 'session expired';
  else state.platform[mode] = true;
  render(<ConnectPage />);
  expect(screen.queryByText('從這裡開始')).toBeNull();
  expect(screen.getByRole('link', { name: '公告' })).toBeTruthy();
});

it('尚未 hydration 或學校狀態未確認時，不推論舊的學校登入仍有效', () => {
  state.auth.user = { uid: 'old-user' };
  state.hydrated = false;
  const view = render(<ConnectPage />);
  expect(screen.queryByText('從這裡開始')).toBeNull();
  state.hydrated = true;
  state.auth.loading = true;
  view.rerender(<ConnectPage />);
  expect(screen.queryByText('從這裡開始')).toBeNull();
});

it('可依需求找到好友，清空分類後能搜尋 Google 公開話題', () => {
  render(<ConnectPage />);
  fireEvent.click(screen.getByRole('button', { name: '找人與聊天' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '好友' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: '找人' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '顯示全部服務' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Google' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: '跨校公開交流' })).toBeTruthy();
});
