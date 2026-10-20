import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { getDocs, setDoc } from 'firebase/firestore';
import { NotificationsProvider, useNotifications } from '../../state/notifications';

const mockAuth: { user: { uid: string } | null } = { user: { uid: 'a' } };
const mockCommit = jest.fn();
const mockUpdate = jest.fn();
const mockReport = jest.fn();
jest.mock('../../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../../firebase', () => ({
  getDb: () => ({}),
  hasUsableFirebaseConfig: () => true,
}));
jest.mock('../../services/aiBrain', () => ({
  aiBrain: { reportToolOutcome: (...args: unknown[]) => mockReport(...args) },
}));
jest.mock('../../services/companionEngine', () => ({
  recordCompanionFeatureSignal: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  query: (ref: unknown) => ref,
  orderBy: jest.fn(),
  limit: jest.fn(),
  getDocs: jest.fn(),
  setDoc: jest.fn(),
  serverTimestamp: () => 'server-time',
  writeBatch: () => ({ update: mockUpdate, commit: mockCommit }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function snapshot(id: string, read = false) {
  return { docs: [{ id, data: () => ({ title: id, read }) }] };
}
type Context = ReturnType<typeof useNotifications>;
let latest: Context;
let renders: Array<{ uid: string | null; ids: string[]; unread: number; loading: boolean }>;
function Probe() {
  latest = useNotifications();
  renders.push({
    uid: mockAuth.user?.uid ?? null,
    ids: latest.notifications.map((row) => row.id),
    unread: latest.unreadCount,
    loading: latest.loading,
  });
  return <Text>{latest.notifications.map((row) => row.title).join(',') || 'empty'}</Text>;
}
function tree() {
  return (
    <NotificationsProvider>
      <Probe />
    </NotificationsProvider>
  );
}
function changeAccount(view: ReturnType<typeof render>, uid: string | null) {
  mockAuth.user = uid ? { uid } : null;
  view.rerender(tree());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.user = { uid: 'a' };
  renders = [];
  jest.mocked(getDocs).mockResolvedValue(snapshot('a-notice') as never);
  jest.mocked(setDoc).mockResolvedValue(undefined);
  mockCommit.mockResolvedValue(undefined);
});

test('every B render hides A rows and unread count while B loads, fails, then retries', async () => {
  const b = deferred<ReturnType<typeof snapshot>>();
  jest
    .mocked(getDocs)
    .mockResolvedValueOnce(snapshot('a-private') as never)
    .mockReturnValueOnce(b.promise as never)
    .mockResolvedValueOnce(snapshot('b-private') as never);
  const view = render(tree());
  await view.findByText('a-private');
  expect(latest.unreadCount).toBe(1);
  changeAccount(view, 'b');
  expect(latest.loading).toBe(true);
  expect(latest.notifications).toEqual([]);
  expect(latest.unreadCount).toBe(0);
  await act(async () => b.reject(new Error('B offline')));
  expect(latest.error).toBe('B offline');
  expect(latest.loading).toBe(false);
  expect(
    renders
      .filter((row) => row.uid === 'b')
      .every((row) => row.ids.length === 0 && row.unread === 0),
  ).toBe(true);
  await act(async () => latest.reload());
  await view.findByText('b-private');
  expect(latest.unreadCount).toBe(1);
  expect(getDocs).toHaveBeenLastCalledWith('users/b/notifications');
});

test('a delayed A response cannot replace the current B notifications', async () => {
  const a = deferred<ReturnType<typeof snapshot>>();
  jest
    .mocked(getDocs)
    .mockReturnValueOnce(a.promise as never)
    .mockResolvedValueOnce(snapshot('b-private') as never);
  const view = render(tree());
  changeAccount(view, 'b');
  await view.findByText('b-private');
  await act(async () => a.resolve(snapshot('a-private')));
  expect(latest.notifications.map((row) => row.id)).toEqual(['b-private']);
  expect(latest.unreadCount).toBe(1);
  expect(
    renders.filter((row) => row.uid === 'b').some((row) => row.ids.includes('a-private')),
  ).toBe(false);
});

test('logout immediately removes rows, unread counts and stale mutation callbacks', async () => {
  const view = render(tree());
  await view.findByText('a-notice');
  const old = latest;
  changeAccount(view, null);
  expect(latest.notifications).toEqual([]);
  expect(latest.unreadCount).toBe(0);
  expect(latest.loading).toBe(false);
  expect(latest.error).toBeNull();
  await act(async () => {
    await old.markAsRead('a-notice');
    await old.markAllAsRead();
    old.reload();
  });
  expect(setDoc).not.toHaveBeenCalled();
  expect(mockCommit).not.toHaveBeenCalled();
  expect(getDocs).toHaveBeenCalledTimes(1);
  expect(
    renders
      .filter((row) => row.uid === null)
      .every((row) => !row.ids.length && row.unread === 0 && !row.loading),
  ).toBe(true);
});

test('a read that completes after logout stays hidden, including after A logs in again', async () => {
  const oldA = deferred<ReturnType<typeof snapshot>>();
  jest
    .mocked(getDocs)
    .mockReturnValueOnce(oldA.promise as never)
    .mockResolvedValueOnce(snapshot('new-a') as never);
  const view = render(tree());
  changeAccount(view, null);
  await act(async () => oldA.resolve(snapshot('old-a')));
  expect(latest.notifications).toEqual([]);
  expect(latest.loading).toBe(false);
  changeAccount(view, 'a');
  await view.findByText('new-a');
  expect(latest.notifications.map((row) => row.id)).toEqual(['new-a']);
});

test.each(['single', 'all'] as const)(
  'a failed A %s-read write cannot roll back a same-ID notification or report success for B',
  async (mode) => {
    const pending = deferred<void>();
    jest
      .mocked(getDocs)
      .mockResolvedValueOnce(snapshot('shared-id') as never)
      .mockResolvedValueOnce(snapshot('shared-id', true) as never);
    if (mode === 'single') jest.mocked(setDoc).mockReturnValueOnce(pending.promise);
    else mockCommit.mockReturnValueOnce(pending.promise);
    const view = render(tree());
    await view.findByText('shared-id');
    const old = latest;
    let write!: Promise<void>;
    act(() => {
      write = mode === 'single' ? latest.markAsRead('shared-id') : latest.markAllAsRead();
    });
    expect(latest.unreadCount).toBe(0);
    changeAccount(view, 'b');
    await waitFor(() => expect(latest.loading).toBe(false));
    expect(latest.notifications[0]?.read).toBe(true);
    await act(async () => {
      await old.markAsRead('shared-id');
      await old.markAllAsRead();
      pending.reject(new Error('old write failed'));
      await write;
    });
    expect(latest.notifications[0]?.read).toBe(true);
    expect(latest.unreadCount).toBe(0);
    expect(mockReport).not.toHaveBeenCalled();
    expect(mode === 'single' ? setDoc : mockCommit).toHaveBeenCalledTimes(1);
    if (mode === 'single') {
      expect(setDoc).toHaveBeenCalledWith(
        'users/a/notifications/shared-id',
        { read: true, readAt: 'server-time' },
        { merge: true },
      );
    } else {
      expect(mockUpdate).toHaveBeenCalledWith('users/a/notifications/shared-id', {
        read: true,
        readAt: 'server-time',
      });
    }
  },
);

test('failed same-account writes restore unread state and allow a successful retry', async () => {
  jest.mocked(setDoc).mockRejectedValueOnce(new Error('offline'));
  const view = render(tree());
  await view.findByText('a-notice');
  await act(async () => latest.markAsRead('a-notice'));
  expect(latest.notifications[0]?.read).toBe(false);
  expect(latest.unreadCount).toBe(1);
  await act(async () => latest.markAllAsRead());
  expect(latest.notifications[0]?.read).toBe(true);
  expect(latest.unreadCount).toBe(0);
  expect(mockCommit).toHaveBeenCalledTimes(1);
});
