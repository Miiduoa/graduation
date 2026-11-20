import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useBoardCreationAccess } from './useBoardCreationAccess';

type MemberSnapshot = {
  exists: () => boolean;
  data: () => Record<string, unknown>;
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
};
type Subscription = {
  path: string[];
  receive: (snapshot: MemberSnapshot) => void;
  fail: (error: Error) => void;
  stop: ReturnType<typeof vi.fn>;
};
const mocks = vi.hoisted(() => ({
  auth: { user: { uid: 'alice' } as { uid: string } | null, loading: false, error: null as Error | null },
  firebaseAuth: { currentUser: { uid: 'alice' } as { uid: string } | null },
  configured: true,
  subscriptions: [] as Subscription[],
  watch: vi.fn(),
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/firebase', () => ({
  getAuth: () => mocks.firebaseAuth,
  getDb: () => 'db',
  isFirebaseConfigured: () => mocks.configured,
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path,
  onSnapshot: mocks.watch,
}));

function snapshot(
  member: Record<string, unknown> | null = { status: 'active', role: 'editor' },
  metadata: Partial<MemberSnapshot['metadata']> = {},
): MemberSnapshot {
  return {
    exists: () => member !== null,
    data: () => member ?? {},
    metadata: { fromCache: false, hasPendingWrites: false, ...metadata },
  };
}

beforeEach(() => {
  mocks.auth.user = { uid: 'alice' };
  mocks.auth.loading = false;
  mocks.auth.error = null;
  mocks.firebaseAuth.currentUser = { uid: 'alice' };
  mocks.configured = true;
  mocks.subscriptions = [];
  mocks.watch.mockReset().mockImplementation((path, options, receive, fail) => {
    expect(options).toEqual({ includeMetadataChanges: true });
    const stop = vi.fn();
    mocks.subscriptions.push({ path, receive, fail, stop });
    return stop;
  });
});

it.each(['admin', 'editor'])('allows only a confirmed active %s in the selected school', (role) => {
  const { result } = renderHook(() => useBoardCreationAccess('ncku'));
  expect(mocks.subscriptions[0].path).toEqual(['schools', 'ncku', 'members', 'alice']);
  expect(result.current.status).toBe('loading');
  expect(result.current.isAuthorized()).toBe(false);
  act(() => mocks.subscriptions[0].receive(snapshot({ status: 'active', role })));
  expect(result.current.status).toBe('allowed');
  expect(result.current.isAuthorized()).toBe(true);
});

it.each([
  null,
  { role: 'admin' },
  { status: 'inactive', role: 'admin' },
  { status: 'active', role: 'student' },
  { status: 'active', role: 'teacher' },
  { status: 'active', role: 'owner' },
  { status: 'active', role: 'moderator' },
])('denies a missing or non-editor membership: %j', (member) => {
  const { result } = renderHook(() => useBoardCreationAccess('pu'));
  act(() => mocks.subscriptions[0].receive(snapshot(member)));
  expect(result.current.status).toBe('denied');
  expect(result.current.isAuthorized()).toBe(false);
});

it.each([{ fromCache: true }, { hasPendingWrites: true }])('never authorizes unconfirmed metadata %j', (metadata) => {
  const { result } = renderHook(() => useBoardCreationAccess('pu'));
  act(() => mocks.subscriptions[0].receive(snapshot(undefined, metadata)));
  expect(result.current.status).toBe('error');
  expect(result.current.isAuthorized()).toBe(false);
  act(() => mocks.subscriptions[0].receive(snapshot()));
  expect(result.current.isAuthorized()).toBe(true);
  const captured = result.current.isAuthorized;
  act(() => {
    mocks.subscriptions[0].receive(snapshot(undefined, metadata));
    expect(captured()).toBe(false);
  });
  act(() => mocks.subscriptions[0].receive(snapshot()));
  expect(result.current.isAuthorized()).toBe(true);
  expect(captured()).toBe(false);
});

it('revokes captured authorization synchronously and never revives it after a regrant', () => {
  const { result } = renderHook(() => useBoardCreationAccess('pu'));
  act(() => mocks.subscriptions[0].receive(snapshot()));
  const captured = result.current.isAuthorized;
  const epoch = result.current.authorizationEpoch;
  act(() => {
    mocks.subscriptions[0].receive(snapshot({ status: 'inactive', role: 'editor' }));
    expect(captured()).toBe(false);
  });
  expect(result.current.authorizationEpoch).toBeGreaterThan(epoch);
  act(() => mocks.subscriptions[0].receive(snapshot()));
  expect(result.current.isAuthorized()).toBe(true);
  expect(captured()).toBe(false);
});

it('keeps authorization stable for repeated confirmed allowed snapshots', () => {
  const { result } = renderHook(() => useBoardCreationAccess('pu'));
  act(() => mocks.subscriptions[0].receive(snapshot()));
  const captured = result.current.isAuthorized;
  const epoch = result.current.authorizationEpoch;
  act(() => mocks.subscriptions[0].receive(snapshot()));
  expect(result.current.authorizationEpoch).toBe(epoch);
  expect(captured()).toBe(true);
});

it('isolates school changes and ignores an old subscription even after switching back', () => {
  const { result, rerender } = renderHook(({ schoolId }) => useBoardCreationAccess(schoolId), {
    initialProps: { schoolId: 'pu' },
  });
  act(() => mocks.subscriptions[0].receive(snapshot()));
  const first = result.current.isAuthorized;
  rerender({ schoolId: 'ncku' });
  expect(mocks.subscriptions[0].stop).toHaveBeenCalledOnce();
  expect(result.current.status).toBe('loading');
  expect(first()).toBe(false);
  act(() => mocks.subscriptions[0].receive(snapshot()));
  expect(result.current.isAuthorized()).toBe(false);
  rerender({ schoolId: 'pu' });
  act(() => {
    mocks.subscriptions[0].receive(snapshot());
    mocks.subscriptions[1].fail(new Error('late failure'));
  });
  expect(result.current.status).toBe('loading');
  act(() => mocks.subscriptions[2].receive(snapshot()));
  expect(result.current.isAuthorized()).toBe(true);
  expect(first()).toBe(false);
});

it('isolates account changes and denies an outdated Firebase auth identity', () => {
  const { result, rerender } = renderHook(() => useBoardCreationAccess('pu'));
  act(() => mocks.subscriptions[0].receive(snapshot()));
  const alice = result.current.isAuthorized;
  mocks.firebaseAuth.currentUser = { uid: 'bob' };
  expect(alice()).toBe(false);
  mocks.auth.user = { uid: 'bob' };
  rerender();
  expect(mocks.subscriptions[1].path).toEqual(['schools', 'pu', 'members', 'bob']);
  act(() => mocks.subscriptions[0].receive(snapshot()));
  expect(result.current.isAuthorized()).toBe(false);
  act(() => mocks.subscriptions[1].receive(snapshot()));
  expect(result.current.isAuthorized()).toBe(true);
  expect(alice()).toBe(false);
  mocks.auth.user = { uid: 'alice' };
  mocks.firebaseAuth.currentUser = { uid: 'alice' };
  rerender();
  act(() => {
    mocks.subscriptions[0].receive(snapshot());
    mocks.subscriptions[1].fail(new Error('late failure'));
  });
  expect(result.current.status).toBe('loading');
  act(() => mocks.subscriptions[2].receive(snapshot()));
  expect(result.current.isAuthorized()).toBe(true);
  expect(alice()).toBe(false);
});

it('fails closed when auth has an error even if it still supplies a user', () => {
  const { result, rerender } = renderHook(() => useBoardCreationAccess('pu'));
  act(() => mocks.subscriptions[0].receive(snapshot()));
  const captured = result.current.isAuthorized;
  mocks.auth.error = new Error('auth unavailable');
  rerender();
  expect(result.current.status).toBe('error');
  expect(mocks.subscriptions[0].stop).toHaveBeenCalledOnce();
  expect(captured()).toBe(false);
  act(() => mocks.subscriptions[0].receive(snapshot()));
  expect(result.current.status).toBe('error');
  act(() => result.current.retry());
  expect(mocks.watch).toHaveBeenCalledOnce();
  expect(result.current.isAuthorized()).toBe(false);
});

it('invalidates on retry before restarting the watcher and ignores its late callbacks', () => {
  const { result } = renderHook(() => useBoardCreationAccess('pu'));
  act(() => mocks.subscriptions[0].receive(snapshot()));
  const captured = result.current.isAuthorized;
  act(() => {
    result.current.retry();
    expect(captured()).toBe(false);
    mocks.subscriptions[0].receive(snapshot());
  });
  expect(result.current.status).toBe('loading');
  expect(mocks.subscriptions[0].stop).toHaveBeenCalledOnce();
  act(() => mocks.subscriptions[1].receive(snapshot()));
  expect(result.current.isAuthorized()).toBe(true);
  expect(captured()).toBe(false);
});

it('fails closed on watch errors and can recover through retry', () => {
  const { result } = renderHook(() => useBoardCreationAccess('pu'));
  act(() => mocks.subscriptions[0].receive(snapshot()));
  const captured = result.current.isAuthorized;
  act(() => {
    mocks.subscriptions[0].fail(new Error('permission-denied'));
    expect(captured()).toBe(false);
  });
  expect(result.current.status).toBe('error');
  act(() => mocks.subscriptions[0].receive(snapshot()));
  expect(result.current.status).toBe('error');
  act(() => result.current.retry());
  act(() => mocks.subscriptions[1].receive(snapshot()));
  expect(result.current.status).toBe('allowed');
  expect(captured()).toBe(false);
});

it('does not subscribe while signed out, auth is loading, or the school path is invalid', () => {
  mocks.auth.loading = true;
  const { result, rerender } = renderHook(({ schoolId }) => useBoardCreationAccess(schoolId), {
    initialProps: { schoolId: 'pu' },
  });
  expect(result.current.status).toBe('loading');
  expect(mocks.watch).not.toHaveBeenCalled();
  mocks.auth.loading = false;
  mocks.auth.user = null;
  mocks.firebaseAuth.currentUser = null;
  rerender({ schoolId: 'pu' });
  expect(result.current.status).toBe('denied');
  mocks.auth.user = { uid: 'alice' };
  mocks.firebaseAuth.currentUser = { uid: 'alice' };
  rerender({ schoolId: 'pu/members/bob' });
  expect(result.current.status).toBe('denied');
  expect(mocks.watch).not.toHaveBeenCalled();
});

it('removes authorization and unsubscribes on logout or unmount', () => {
  const { result, rerender, unmount } = renderHook(() => useBoardCreationAccess('pu'));
  act(() => mocks.subscriptions[0].receive(snapshot()));
  const captured = result.current.isAuthorized;
  mocks.auth.user = null;
  mocks.firebaseAuth.currentUser = null;
  rerender();
  expect(result.current.status).toBe('denied');
  expect(mocks.subscriptions[0].stop).toHaveBeenCalledOnce();
  expect(captured()).toBe(false);
  unmount();
  act(() => mocks.subscriptions[0].receive(snapshot()));
  expect(captured()).toBe(false);
});

it('invalidates captured authorization and ignores the watcher after unmount', () => {
  const { result, unmount } = renderHook(() => useBoardCreationAccess('pu'));
  act(() => mocks.subscriptions[0].receive(snapshot()));
  const captured = result.current.isAuthorized;
  const retry = result.current.retry;
  unmount();
  expect(mocks.subscriptions[0].stop).toHaveBeenCalledOnce();
  act(() => {
    mocks.subscriptions[0].receive(snapshot());
    mocks.subscriptions[0].fail(new Error('late failure'));
    retry();
  });
  expect(captured()).toBe(false);
  expect(mocks.watch).toHaveBeenCalledOnce();
});

it.each(['unconfigured', 'identity mismatch', 'watch throws'])('fails closed when initialization is %s', (failure) => {
  if (failure === 'unconfigured') mocks.configured = false;
  if (failure === 'identity mismatch') mocks.firebaseAuth.currentUser = { uid: 'bob' };
  if (failure === 'watch throws') mocks.watch.mockImplementation(() => { throw new Error('offline'); });
  const { result } = renderHook(() => useBoardCreationAccess('pu'));
  expect(result.current.status).toBe('error');
  expect(result.current.isAuthorized()).toBe(false);
});
