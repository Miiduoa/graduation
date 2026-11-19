import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useSchoolRole, useSchoolRoleState } from './useSchoolRole';

const state = vi.hoisted(() => ({
  configured: true,
  listeners: [] as Array<{
    path: string[];
    next: (snapshot: unknown) => void;
    error: () => void;
    unsubscribe: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('@/lib/firebase', () => ({
  getDb: () => 'db',
  isFirebaseConfigured: () => state.configured,
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path,
  onSnapshot: (
    path: string[],
    options: unknown,
    next: (snapshot: unknown) => void,
    error: () => void,
  ) => {
    expect(options).toEqual({ includeMetadataChanges: true });
    const unsubscribe = vi.fn();
    state.listeners.push({ path, next, error, unsubscribe });
    return unsubscribe;
  },
}));

const snapshot = (member: unknown, fromCache = false, hasPendingWrites = false) => ({
  exists: () => member !== null,
  data: () => member,
  metadata: { fromCache, hasPendingWrites },
});

beforeEach(() => {
  state.configured = true;
  state.listeners = [];
});

it('updates work navigation when an active membership is revoked or changed', () => {
  const { result } = renderHook(() => useSchoolRole('account-a', 'school-a'));
  expect(result.current).toBeNull();
  act(() => state.listeners[0].next(snapshot({ role: 'teacher', status: 'active' })));
  expect(result.current).toBe('teacher');
  act(() => state.listeners[0].next(snapshot({ role: 'teacher', status: 'inactive' })));
  expect(result.current).toBeNull();
  act(() => state.listeners[0].next(snapshot({ role: 'student', status: 'active' })));
  expect(result.current).toBe('student');
  act(() => state.listeners[0].error());
  expect(result.current).toBeNull();
});

it('does not expose a work role from pending, missing, cached, or locally edited membership', () => {
  const { result } = renderHook(() => useSchoolRole('account-a', 'school-a'));
  for (const entry of [
    snapshot(null),
    snapshot({ role: 'admin', status: 'pending' }),
    snapshot({ role: 'admin', status: 'active' }, true),
    snapshot({ role: 'admin', status: 'active' }, false, true),
  ]) {
    act(() => state.listeners[0].next(entry));
    expect(result.current).toBeNull();
  }
  act(() => state.listeners[0].next(snapshot({ role: 'admin', status: 'active' })));
  expect(result.current).toBe('admin');
});

it.each(['admin', 'editor', 'teacher', 'student'])(
  'preserves the server-confirmed legacy %s role while honoring explicit revocation',
  (role) => {
    const { result } = renderHook(() => useSchoolRoleState('account-a', 'school-a'));
    act(() => state.listeners[0].next(snapshot({ role }, true)));
    expect(result.current).toMatchObject({ status: 'loading', role: null });
    act(() => state.listeners[0].next(snapshot({ role }, false, true)));
    expect(result.current).toMatchObject({ status: 'loading', role: null });
    act(() => state.listeners[0].next(snapshot({ role })));
    expect(result.current).toMatchObject({ status: 'ready', role });
    for (const status of ['inactive', 'pending', 'disabled', 'deleted', 'suspended']) {
      act(() => state.listeners[0].next(snapshot({ role, status })));
      expect(result.current).toMatchObject({ status: 'ready', role: null });
    }
    act(() => state.listeners[0].next(snapshot({ role, status: 'active' })));
    expect(result.current).toMatchObject({ status: 'ready', role });
    act(() => state.listeners[0].next(snapshot(null)));
    expect(result.current).toMatchObject({ status: 'ready', role: null });
  },
);

it('disposes the previous account and school subscription and ignores its late response', () => {
  const { result, rerender, unmount } = renderHook(
    ({ uid, school }: { uid: string | null; school: string }) => useSchoolRole(uid, school),
    { initialProps: { uid: 'account-a' as string | null, school: 'school-a' } },
  );
  act(() => state.listeners[0].next(snapshot({ role: 'admin', status: 'active' })));
  rerender({ uid: 'account-b', school: 'school-b' });
  expect(state.listeners[0].unsubscribe).toHaveBeenCalledOnce();
  expect(result.current).toBeNull();
  expect(state.listeners[1].path).toEqual(['schools', 'school-b', 'members', 'account-b']);
  act(() => state.listeners[0].next(snapshot({ role: 'admin', status: 'active' })));
  expect(result.current).toBeNull();
  act(() => state.listeners[1].next(snapshot({ role: 'student', status: 'active' })));
  expect(result.current).toBe('student');
  rerender({ uid: null, school: 'school-b' });
  expect(result.current).toBeNull();
  expect(state.listeners[1].unsubscribe).toHaveBeenCalledOnce();
  unmount();
});

it('does not revive a previous role on A to B to A before either new subscription confirms', () => {
  const { result, rerender } = renderHook(({ school }) => useSchoolRole('account-a', school), {
    initialProps: { school: 'school-a' },
  });
  act(() => state.listeners[0].next(snapshot({ role: 'admin', status: 'active' })));
  expect(result.current).toBe('admin');
  rerender({ school: 'school-b' });
  expect(result.current).toBeNull();
  rerender({ school: 'school-a' });
  expect(result.current).toBeNull();
  act(() => state.listeners[0].next(snapshot({ role: 'admin', status: 'active' })));
  expect(result.current).toBeNull();
  act(() => state.listeners[2].next(snapshot({ role: 'student', status: 'active' })));
  expect(result.current).toBe('student');
});

it('distinguishes server-confirmed non-membership from an unconfirmed cached membership', () => {
  const { result } = renderHook(() => useSchoolRoleState('account-a', 'school-a'));
  expect(result.current).toMatchObject({ status: 'loading', role: null });
  act(() => state.listeners[0].next(snapshot({ role: 'admin', status: 'active' }, true)));
  expect(result.current).toMatchObject({ status: 'loading', role: null });
  act(() => state.listeners[0].next(snapshot(null)));
  expect(result.current).toMatchObject({ status: 'ready', role: null });
  act(() => state.listeners[0].next(snapshot({ role: 'admin', status: 'active' })));
  expect(result.current).toMatchObject({ status: 'ready', role: 'admin' });
  act(() => state.listeners[0].next(snapshot({ role: 'admin', status: 'inactive' })));
  expect(result.current).toMatchObject({ status: 'ready', role: null });
});

it('retries a failed listener without accepting late callbacks or retries from its previous attempt', () => {
  const { result } = renderHook(() => useSchoolRoleState('account-a', 'school-a'));
  act(() => state.listeners[0].error());
  expect(result.current).toMatchObject({ status: 'error', role: null });
  const previousRetry = result.current.retry;
  act(() => result.current.retry());
  expect(result.current).toMatchObject({ status: 'loading', role: null });
  expect(state.listeners[0].unsubscribe).toHaveBeenCalledOnce();
  expect(state.listeners[1].path).toEqual(['schools', 'school-a', 'members', 'account-a']);
  act(() => {
    state.listeners[0].next(snapshot({ role: 'admin', status: 'active' }));
    state.listeners[0].error();
    previousRetry();
  });
  expect(result.current).toMatchObject({ status: 'loading', role: null });
  expect(state.listeners).toHaveLength(2);
  act(() => state.listeners[1].next(snapshot({ role: 'editor', status: 'active' })));
  expect(result.current).toMatchObject({ status: 'ready', role: 'editor' });
});

it('recovers from a subscription setup failure through an explicit retry', async () => {
  state.configured = false;
  const { result } = renderHook(() => useSchoolRoleState('account-a', 'school-a'));
  await waitFor(() => expect(result.current).toMatchObject({ status: 'error', role: null }));
  expect(state.listeners).toHaveLength(0);
  state.configured = true;
  act(() => result.current.retry());
  expect(result.current).toMatchObject({ status: 'loading', role: null });
  act(() => state.listeners[0].next(snapshot({ role: 'admin', status: 'active' })));
  expect(result.current).toMatchObject({ status: 'ready', role: 'admin' });
});

it('ignores a retry from an older account scope even after returning to the same account', () => {
  const { result, rerender } = renderHook(({ uid }) => useSchoolRoleState(uid, 'school-a'), {
    initialProps: { uid: 'account-a' },
  });
  act(() => state.listeners[0].next(snapshot({ role: 'admin', status: 'active' })));
  const previousRetry = result.current.retry;
  rerender({ uid: 'account-b' });
  expect(result.current).toMatchObject({ status: 'loading', role: null });
  rerender({ uid: 'account-a' });
  expect(result.current).toMatchObject({ status: 'loading', role: null });
  act(() => previousRetry());
  expect(state.listeners).toHaveLength(3);
  act(() => state.listeners[2].next(snapshot({ role: 'student', status: 'active' })));
  expect(result.current).toMatchObject({ status: 'ready', role: 'student' });
  act(() => previousRetry());
  expect(result.current).toMatchObject({ status: 'ready', role: 'student' });
  expect(state.listeners).toHaveLength(3);
});
