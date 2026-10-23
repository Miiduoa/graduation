import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import FriendsPage from './page';
import {
  findByHandle,
  listAcceptedFriends,
  listPendingRequests,
  loadMyHandle,
  publishHandle,
  sentRequestState,
  unpublishHandle,
  type FriendRow,
} from '@/lib/timetable/friends';
import { listMyMeetups } from '@/lib/timetable/store';

const session = vi.hoisted(() => ({
  user: { uid: 'alice' } as { uid: string } | null,
  loading: false,
}));
const school = vi.hoisted(() => ({ selectedSchoolId: 'pu' as string | null, loading: false }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => session }));
vi.mock('@/components/SelectedSchoolProvider', () => ({ useSelectedSchool: () => school }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock('@/components/SchoolScopePlaceholder', () => ({
  SchoolScopePlaceholder: () => <p role="status">選擇校園</p>,
}));
vi.mock('@/components/SchoolAccountRequired', () => ({
  SchoolAccountRequired: () => <p>請登入學校帳號</p>,
}));
vi.mock('@/lib/timetable/friends', () => ({
  acceptFriendRequest: vi.fn(),
  cancelFriendRequest: vi.fn(),
  declineFriendRequest: vi.fn(),
  findByHandle: vi.fn(),
  isValidHandle: (value: string) => /^[a-z0-9_.-]{3,32}$/.test(value),
  listAcceptedFriends: vi.fn(),
  listPendingRequests: vi.fn(),
  loadMyHandle: vi.fn(),
  normalizeHandle: (value: string) => value.trim().replace(/^@/, '').toLowerCase(),
  publishHandle: vi.fn(),
  sendFriendRequest: vi.fn(),
  sentRequestState: vi.fn(),
  unpublishHandle: vi.fn(),
}));
vi.mock('@/lib/timetable/store', () => ({ listMyMeetups: vi.fn(), respondMeetup: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const friend = (name: string): FriendRow => ({
  id: name,
  uid: name,
  name,
  status: 'accepted',
  incoming: false,
});

beforeEach(() => {
  vi.resetAllMocks();
  session.user = { uid: 'alice' };
  session.loading = false;
  school.selectedSchoolId = 'pu';
  school.loading = false;
  vi.mocked(listAcceptedFriends).mockResolvedValue([]);
  vi.mocked(listPendingRequests).mockResolvedValue([]);
  vi.mocked(listMyMeetups).mockResolvedValue([]);
  vi.mocked(loadMyHandle).mockImplementation(async (_school, uid) => ({
    handle: `${uid}_handle`,
    name: uid,
  }));
  vi.mocked(sentRequestState).mockResolvedValue({ kind: 'none' });
  vi.mocked(unpublishHandle).mockResolvedValue(undefined);
  vi.mocked(publishHandle).mockResolvedValue('alice_new');
});

it('keeps the removal action available after failure and only confirms the successful retry', async () => {
  vi.mocked(unpublishHandle).mockRejectedValueOnce(new Error('unavailable'));
  render(<FriendsPage />);
  fireEvent.click(await screen.findByRole('button', { name: '關掉代號' }));
  expect((await screen.findByRole('alert')).textContent).toContain('同學可能仍找得到你');
  expect(screen.queryByText('已關掉，同學查不到你的代號了。')).toBeNull();
  expect(screen.getByText('同學輸入 @alice_handle 就能找到你。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '關掉代號' }));
  expect(await screen.findByText('已關掉，同學查不到你的代號了。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '關掉代號' })).toBeNull();
  expect(unpublishHandle).toHaveBeenNthCalledWith(1, 'pu', 'alice');
  expect(unpublishHandle).toHaveBeenCalledTimes(2);
});

it('locks duplicate mutations and keeps the entered alias when renaming fails', async () => {
  const pending = deferred<string>();
  vi.mocked(publishHandle).mockReturnValue(pending.promise);
  render(<FriendsPage />);
  await screen.findByRole('button', { name: '更新代號' });
  fireEvent.change(screen.getByRole('textbox', { name: '代號' }), {
    target: { value: 'alice_new' },
  });
  const save = screen.getByRole('button', { name: '更新代號' });
  fireEvent.click(save);
  fireEvent.click(save);
  expect(publishHandle).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('button', { name: '關掉代號' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await act(async () => pending.reject(new Error('unavailable')));
  expect(screen.getByRole('alert').textContent).toContain('原本輸入已保留');
  expect((screen.getByRole('textbox', { name: '代號' }) as HTMLInputElement).value).toBe(
    'alice_new',
  );
  expect((screen.getByRole('button', { name: '更新代號' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});

it('shows a retry instead of claiming an empty friend list after a failed initial read', async () => {
  vi.mocked(loadMyHandle).mockRejectedValueOnce(new Error('unavailable'));
  render(<FriendsPage />);
  fireEvent.click(await screen.findByRole('button', { name: '重新讀取' }));
  expect(await screen.findByRole('button', { name: '關掉代號' })).toBeTruthy();
  expect(loadMyHandle).toHaveBeenCalledTimes(2);
});

it('discards delayed data from the previous account on the same campus', async () => {
  const oldFriends = deferred<FriendRow[]>();
  vi.mocked(listAcceptedFriends).mockImplementation(async (_school, uid) =>
    uid === 'alice' ? oldFriends.promise : [friend('Bob 的同學')],
  );
  const view = render(<FriendsPage />);
  session.user = { uid: 'bob' };
  view.rerender(<FriendsPage />);
  expect(await screen.findByText('Bob 的同學')).toBeTruthy();
  await act(async () => oldFriends.resolve([friend('Alice 的同學')]));
  expect(screen.queryByText('Alice 的同學')).toBeNull();
  expect(screen.getByText('同學輸入 @bob_handle 就能找到你。')).toBeTruthy();
  expect(screen.queryByText('同學輸入 @alice_handle 就能找到你。')).toBeNull();
});

it('clears visible private data synchronously during auth loading and ignores a completed old action', async () => {
  const pending = deferred<void>();
  vi.mocked(unpublishHandle).mockReturnValue(pending.promise);
  vi.mocked(listAcceptedFriends).mockResolvedValue([friend('Alice 私人好友')]);
  const view = render(<FriendsPage />);
  fireEvent.click(await screen.findByRole('button', { name: '關掉代號' }));
  session.loading = true;
  view.rerender(<FriendsPage />);
  expect(screen.queryByText('Alice 私人好友')).toBeNull();
  expect(screen.queryByRole('textbox', { name: '代號' })).toBeNull();
  await act(async () => pending.resolve());
  expect(screen.queryByText('已關掉，同學查不到你的代號了。')).toBeNull();
});

it('discards a delayed lookup after switching campuses', async () => {
  const oldSearch = deferred<{ uid: string; name: string; handle: string }>();
  vi.mocked(findByHandle).mockReturnValue(oldSearch.promise);
  const view = render(<FriendsPage />);
  await screen.findByRole('button', { name: '關掉代號' });
  fireEvent.change(screen.getByRole('textbox', { name: '同學的找人代號' }), {
    target: { value: '@friend_pu' },
  });
  fireEvent.click(screen.getByRole('button', { name: '查詢' }));
  school.selectedSchoolId = 'nthu';
  view.rerender(<FriendsPage />);
  await waitFor(() => expect(loadMyHandle).toHaveBeenCalledWith('nthu', 'alice'));
  await act(async () =>
    oldSearch.resolve({ uid: 'pu-person', name: '舊校園搜尋結果', handle: 'friend_pu' }),
  );
  expect(screen.queryByText('舊校園搜尋結果')).toBeNull();
  expect((screen.getByRole('textbox', { name: '同學的找人代號' }) as HTMLInputElement).value).toBe(
    '',
  );
});

it('ignores older search results after the input changes', async () => {
  const oldSearch = deferred<{ uid: string; name: string; handle: string }>();
  vi.mocked(findByHandle)
    .mockReturnValueOnce(oldSearch.promise)
    .mockResolvedValueOnce({ uid: 'new-person', name: '新同學', handle: 'new_friend' });
  render(<FriendsPage />);
  await screen.findByRole('button', { name: '關掉代號' });
  const input = screen.getByRole('textbox', { name: '同學的找人代號' });
  fireEvent.change(input, { target: { value: '@old_friend' } });
  fireEvent.click(screen.getByRole('button', { name: '查詢' }));
  fireEvent.change(input, { target: { value: '@new_friend' } });
  fireEvent.click(screen.getByRole('button', { name: '查詢' }));
  expect(await screen.findByText('新同學')).toBeTruthy();
  await act(async () =>
    oldSearch.resolve({ uid: 'old-person', name: '舊同學', handle: 'old_friend' }),
  );
  expect(screen.queryByText('舊同學')).toBeNull();
  expect(screen.getByText('新同學')).toBeTruthy();
});
