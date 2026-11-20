import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CommunityAccess } from './CommunityAccess';

const state = vi.hoisted(() => ({
  auth: { user: null as { uid: string } | null, loading: false, error: null as Error | null },
  platform: {
    session: null as { platformAccountId: string; context: string } | null,
    loading: false,
    error: '',
    pendingLogout: false,
  },
  path: '/community/post/new',
  params: new URLSearchParams('boardId=course&schoolId=pu'),
  read: vi.fn(),
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => state.auth }));
vi.mock('@/features/nuni/Session', () => ({ useOptionalNuniSession: () => state.platform }));
vi.mock('@/components/SelectedSchoolProvider', () => ({ useOptionalSelectedSchool: () => null }));
vi.mock('next/navigation', () => ({ usePathname: () => state.path, useSearchParams: () => state.params }));

function Draft() {
  const [value, setValue] = useState('');
  const [privateData, setPrivateData] = useState('');
  useEffect(() => { void state.read().then(setPrivateData); }, []);
  return <><input aria-label="貼文草稿" value={value} onChange={(event) => setValue(event.target.value)} /><p>{privateData}</p></>;
}

beforeEach(() => {
  state.auth = { user: null, loading: false, error: null };
  state.platform = { session: null, loading: false, error: '', pendingLogout: false };
  state.path = '/community/post/new';
  state.params = new URLSearchParams('boardId=course&schoolId=pu');
  state.read.mockReset().mockResolvedValue('');
});

it('does not mount private readers before login and retains the complete return URL', () => {
  render(<CommunityAccess><Draft /></CommunityAccess>);
  expect(state.read).not.toHaveBeenCalled();
  const login = new URL(screen.getByRole('link', { name: '連線學校帳號' }).getAttribute('href')!, 'https://campus.example');
  expect(login.searchParams.get('returnUrl')).toBe('/community/post/new?boardId=course&schoolId=pu');
  expect(login.searchParams.get('reconnect')).toBe('school');
});

it('offers public exchange for a Google-only account without mounting school readers', () => {
  state.platform.session = { platformAccountId: 'platform-a', context: 'context-a' };
  render(<CommunityAccess><Draft /></CommunityAccess>);
  expect(screen.getByText(/Google 帳號已登入/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往公開交流' }).getAttribute('href')).toBe('/social?schoolId=pu');
  expect(screen.queryByRole('textbox', { name: '貼文草稿' })).toBeNull();
  expect(state.read).not.toHaveBeenCalled();
});

it('carries only campus browsing context to public exchange while retaining the private task separately', () => {
  state.params = new URLSearchParams('campus=all&schoolId=pu&boardId=private&token=secret&returnUrl=https%3A%2F%2Fattacker.example');
  render(<CommunityAccess><Draft /></CommunityAccess>);
  const target = new URL(screen.getByRole('link', { name: '前往公開交流' }).getAttribute('href')!, 'https://campus.example');
  expect(target.origin).toBe('https://campus.example');
  expect(target.pathname).toBe('/social');
  expect(target.searchParams.get('campus')).toBe('all');
  expect([...target.searchParams.keys()].sort()).toEqual(['campus', 'schoolId']);
  expect(state.read).not.toHaveBeenCalled();
});

it.each([
  { loading: true, error: '', pendingLogout: false },
  { loading: false, error: 'unavailable', pendingLogout: false },
  { loading: false, error: '', pendingLogout: true },
])('does not present an unconfirmed platform account as signed in: %j', (status) => {
  state.platform = { session: { platformAccountId: 'platform-a', context: 'context-a' }, ...status };
  render(<CommunityAccess><Draft /></CommunityAccess>);
  expect(screen.queryByText(/Google 帳號已登入/)).toBeNull();
  expect(screen.getByRole('link', { name: '前往公開交流' })).toBeTruthy();
  expect(state.read).not.toHaveBeenCalled();
});

it('clears the previous account draft immediately and ignores its delayed private response', async () => {
  let finishOld!: (value: string) => void;
  state.auth.user = { uid: 'first' };
  state.read.mockImplementationOnce(() => new Promise<string>((resolve) => { finishOld = resolve; })).mockResolvedValue('第二個帳號的資料');
  const view = render(<CommunityAccess><Draft /></CommunityAccess>);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '第一個帳號的草稿' } });
  state.auth.user = { uid: 'second' };
  view.rerender(<CommunityAccess><Draft /></CommunityAccess>);
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
  await screen.findByText('第二個帳號的資料');
  await act(async () => finishOld('第一個帳號的私密資料'));
  expect(screen.queryByText('第一個帳號的私密資料')).toBeNull();
  state.auth.user = null;
  view.rerender(<CommunityAccess><Draft /></CommunityAccess>);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByText('第二個帳號的資料')).toBeNull();
});

it('keeps readers unmounted while authentication is loading or unavailable', () => {
  state.auth = { user: { uid: 'first' }, loading: true, error: null };
  const view = render(<CommunityAccess><Draft /></CommunityAccess>);
  expect(screen.getByRole('status')).toBeTruthy();
  state.auth = { user: { uid: 'first' }, loading: false, error: new Error('unavailable') };
  view.rerender(<CommunityAccess><Draft /></CommunityAccess>);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往公開交流' })).toBeTruthy();
  expect(state.read).not.toHaveBeenCalled();
});
