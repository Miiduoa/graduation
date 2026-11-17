import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useSchoolRole } from './useSchoolRole';

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
    snapshot({ role: 'admin' }),
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
