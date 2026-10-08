import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'subscription-test-key';
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'subscriptions.firebaseapp.com';
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'subscriptions-test';
  return {
    listeners: [] as Array<{
      query: { path: string; constraints: unknown[] };
      options: unknown;
      next: (snapshot: unknown) => void;
      fail: (error: unknown) => void;
      stop: ReturnType<typeof vi.fn>;
    }>,
  };
});
vi.mock('firebase/app', async (original) => ({
  ...(await original<typeof import('firebase/app')>()),
  initializeApp: () => ({}),
  getApps: () => [{}],
}));
vi.mock('firebase/firestore', async (original) => ({
  ...(await original<typeof import('firebase/firestore')>()),
  getFirestore: () => ({}),
  collection: (_: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (reference: { path: string }, ...constraints: unknown[]) => ({
    ...reference,
    constraints,
  }),
  where: (...args: unknown[]) => ({ where: args }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  onSnapshot: (
    query: { path: string; constraints: unknown[] },
    options: unknown,
    next: (snapshot: unknown) => void,
    fail: (error: unknown) => void,
  ) => {
    const stop = vi.fn();
    state.listeners.push({ query, options, next, fail, stop });
    return stop;
  },
}));
import { subscribeCafeterias, subscribeMenus } from './firebase';
beforeEach(() => {
  state.listeners = [];
});
function listener(path: string) {
  return state.listeners.find((row) => row.query.path === path)!;
}
function snapshot(rows: Array<Record<string, unknown>>, metadata = {}) {
  return {
    metadata: { fromCache: false, hasPendingWrites: false, ...metadata },
    docs: rows.map((row, index) => ({ id: String(index), data: () => row })),
  };
}
it('uses metadata events and does not present cached cafeterias as confirmed data, then recovers', () => {
  const next = vi.fn(),
    fail = vi.fn();
  subscribeCafeterias('pu', next, fail);
  const live = listener('schools/pu/cafeterias');
  expect(live.options).toEqual({ includeMetadataChanges: true });
  live.next(snapshot([{ name: 'Old café' }], { fromCache: true }));
  expect(next).not.toHaveBeenCalled();
  expect(fail).toHaveBeenCalledOnce();
  live.next(snapshot([{ name: 'Current café' }]));
  expect(next).toHaveBeenLastCalledWith([expect.objectContaining({ name: 'Current café' })]);
});
it('invalidates confirmed menus on pending writes and accepts the later server metadata event', () => {
  const next = vi.fn(),
    fail = vi.fn();
  subscribeMenus('pu', next, fail);
  const live = listener('schools/pu/menus');
  live.next(snapshot([{ name: 'Confirmed meal' }]));
  next.mockClear();
  live.next(snapshot([{ name: 'Unconfirmed change' }], { hasPendingWrites: true }));
  expect(next).not.toHaveBeenCalled();
  expect(fail).toHaveBeenCalledOnce();
  live.next(snapshot([{ name: 'Saved meal' }]));
  expect(next).toHaveBeenLastCalledWith([expect.objectContaining({ name: 'Saved meal' })]);
});
it('keeps a primary permission error visible instead of re-emitting its stale rows or a fallback', () => {
  const next = vi.fn(),
    fail = vi.fn();
  subscribeMenus('pu', next, fail);
  listener('schools/pu/menus').next(snapshot([{ name: 'Old primary meal' }]));
  next.mockClear();
  const denied = new Error('permission-denied');
  listener('schools/pu/menus').fail(denied);
  listener('schools/pu/cafeteriaMenus').next(snapshot([]));
  listener('menus').next(snapshot([{ name: 'Legacy meal' }]));
  expect(next).not.toHaveBeenCalled();
  expect(fail).toHaveBeenLastCalledWith(denied);
});
it('reads legacy menus only for the requested school after canonical emptiness and confirmed metadata', () => {
  const next = vi.fn(),
    fail = vi.fn();
  const stop = subscribeMenus('pu', next, fail);
  const root = listener('menus');
  expect(root.query.constraints).toEqual([{ where: ['schoolId', '==', 'pu'] }]);
  expect(root.options).toEqual({ includeMetadataChanges: true });
  listener('schools/pu/menus').next(snapshot([]));
  listener('schools/pu/cafeteriaMenus').next(snapshot([]));
  root.next(snapshot([{ name: 'Cached legacy meal' }], { fromCache: true }));
  expect(next).not.toHaveBeenCalled();
  expect(fail).toHaveBeenCalledOnce();
  root.next(snapshot([{ name: 'Confirmed legacy meal' }]));
  expect(next).toHaveBeenLastCalledWith([
    expect.objectContaining({ name: 'Confirmed legacy meal' }),
  ]);
  stop();
  next.mockClear();
  root.next(snapshot([{ name: 'Late meal' }]));
  expect(next).not.toHaveBeenCalled();
  state.listeners.forEach((row) => expect(row.stop).toHaveBeenCalledOnce());
});
