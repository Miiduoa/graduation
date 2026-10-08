import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CommunityAccess } from './CommunityAccess';

const state = vi.hoisted(() => ({
  auth: { user: null as { uid: string } | null, loading: false, error: null as Error | null },
  path: '/community/post/new',
  params: new URLSearchParams('boardId=course&schoolId=pu'),
  read: vi.fn(),
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => state.auth }));
vi.mock('next/navigation', () => ({ usePathname: () => state.path, useSearchParams: () => state.params }));

function Draft() {
  const [value, setValue] = useState('');
  const [privateData, setPrivateData] = useState('');
  useEffect(() => { void state.read().then(setPrivateData); }, []);
  return <><input aria-label="貼文草稿" value={value} onChange={(event) => setValue(event.target.value)} /><p>{privateData}</p></>;
}

beforeEach(() => {
  state.auth = { user: null, loading: false, error: null };
  state.read.mockReset().mockResolvedValue('');
});

it('does not mount private readers before login and retains the complete return URL', () => {
  render(<CommunityAccess><Draft /></CommunityAccess>);
  expect(state.read).not.toHaveBeenCalled();
  const login = new URL(screen.getByRole('link', { name: '登入帳號' }).getAttribute('href')!, 'https://campus.example');
  expect(login.searchParams.get('returnUrl')).toBe('/community/post/new?boardId=course&schoolId=pu');
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
  expect(state.read).not.toHaveBeenCalled();
});
