import '@/test/campusEventShortlistLocks';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  campusEventShortlistKey,
  campusEventShortlistOwner,
  type SavedCampusEvent,
} from '@campus/shared/src/campusEventShortlist';
import { campusEventShortlistScopeCopy, useCampusEventShortlist } from './campusEventShortlist';

const auth = vi.hoisted(() => ({
  loading: false,
  error: null as Error | null,
  user: null as { uid: string } | null,
}));
const platform = vi.hoisted(() => ({
  loading: false,
  error: '',
  pendingLogout: false,
  session: null as { platformAccountId: string } | null,
  refresh: vi.fn(async () => {}),
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => auth }));
vi.mock('@/features/nuni/Session', () => ({ useOptionalNuniSession: () => platform }));

beforeEach(() => {
  localStorage.clear();
  Object.assign(auth, { loading: false, error: null, user: null });
  Object.assign(platform, { loading: false, error: '', pendingLogout: false, session: null });
  vi.clearAllMocks();
});
afterEach(cleanup);

it('keeps saved events isolated through guest, Google-only, Firebase-only and combined sessions', async () => {
  const schoolId = 'ntu';
  const item: SavedCampusEvent = {
    id: 'club-1',
    schoolId,
    title: '校友分享',
    source: 'school-club-events',
  };
  const guest = { ...item, id: 'guest-event', title: '訪客市集' };
  const guestKey = campusEventShortlistKey(schoolId, campusEventShortlistOwner(null, null));
  localStorage.setItem(guestKey, JSON.stringify({ version: 1, items: [guest] }));
  platform.loading = true;
  const hook = renderHook(() => useCampusEventShortlist(schoolId));
  expect(hook.result.current).toMatchObject({ phase: 'pending', items: [] });
  expect(await hook.result.current.toggle(item, true)).toBe('ignored');

  platform.loading = false;
  hook.rerender();
  await waitFor(() => expect(hook.result.current.items).toEqual([guest]));
  expect(hook.result.current.scope).toBe('guest');

  platform.session = { platformAccountId: 'google-a' };
  hook.rerender();
  expect(hook.result.current.items).toEqual([]);
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.scope).toBe('account');
  await act(async () => {
    expect(await hook.result.current.toggle(item, true)).toBe('done');
  });
  const aKey = campusEventShortlistKey(schoolId, campusEventShortlistOwner(null, 'google-a'));
  expect(JSON.parse(localStorage.getItem(aKey)!)).toEqual({ version: 1, items: [item] });
  const previousSave = hook.result.current.toggle;

  platform.session = { platformAccountId: 'google-b' };
  hook.rerender();
  expect(hook.result.current.items).toEqual([]);
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(await previousSave(item, false)).toBe('ignored');
  expect(hook.result.current.notice).toBe('');

  auth.user = { uid: 'firebase-a' };
  hook.rerender();
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => {
    await hook.result.current.toggle(item, true);
  });
  const combined = campusEventShortlistKey(
    schoolId,
    campusEventShortlistOwner('firebase-a', 'google-b'),
  );
  expect(JSON.parse(localStorage.getItem(combined)!).items).toEqual([item]);
  platform.session = null;
  hook.rerender();
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.items).toEqual([]);

  auth.user = null;
  platform.session = { platformAccountId: 'google-a' };
  hook.rerender();
  await waitFor(() => expect(hook.result.current.items).toEqual([item]));
  platform.session = null;
  hook.rerender();
  await waitFor(() => expect(hook.result.current.items).toEqual([guest]));
  expect(JSON.parse(localStorage.getItem(guestKey)!).items).toEqual([guest]);
});

it('hides prior items during account lookup, pending logout and auth failure, and retries the failed platform lookup', async () => {
  const item: SavedCampusEvent = {
    schoolId: 'nthu',
    id: 'workshop',
    title: '工作坊',
    source: 'school-events',
  };
  auth.user = { uid: 'school-a' };
  platform.session = { platformAccountId: 'google-a' };
  const hook = renderHook(() => useCampusEventShortlist(item.schoolId));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => {
    await hook.result.current.toggle(item, true);
  });
  platform.loading = true;
  hook.rerender();
  expect(hook.result.current).toMatchObject({ scope: 'pending', phase: 'pending', items: [] });
  expect(await hook.result.current.toggle(item, false)).toBe('ignored');
  platform.pendingLogout = true;
  hook.rerender();
  expect(hook.result.current).toMatchObject({ scope: 'signing-out', items: [], ready: false });
  expect(campusEventShortlistScopeCopy(hook.result.current.scope)).toContain('完成登出');
  platform.pendingLogout = false;
  platform.loading = false;
  platform.session = null;
  platform.error = 'unavailable';
  hook.rerender();
  expect(hook.result.current).toMatchObject({ scope: 'auth-error', phase: 'error', items: [] });
  expect(hook.result.current.error).toContain('登入');
  await act(async () => {
    await hook.result.current.retry();
  });
  expect(platform.refresh).toHaveBeenCalledOnce();
  platform.error = '';
  auth.error = new Error('Firebase failed');
  hook.rerender();
  expect(hook.result.current).toMatchObject({ scope: 'auth-error', phase: 'error', items: [] });
  auth.error = null;
  auth.loading = true;
  hook.rerender();
  expect(hook.result.current.phase).toBe('pending');
  auth.loading = false;
  platform.session = { platformAccountId: 'google-a' };
  hook.rerender();
  await waitFor(() => expect(hook.result.current.items).toEqual([item]));
});

it.each([true, false])(
  'retries the requested saved=%s after a transient read failure during the mutation',
  async (saved) => {
    const item: SavedCampusEvent = {
      schoolId: 'pu',
      id: 'lecture',
      title: '公開講座',
      source: 'school-events',
    };
    const key = campusEventShortlistKey(item.schoolId, null);
    const original = { version: 1, items: saved ? [] : [item] };
    localStorage.setItem(key, JSON.stringify(original));
    const hook = renderHook(() => useCampusEventShortlist(item.schoolId));
    await waitFor(() => expect(hook.result.current.items).toEqual(original.items));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));

    const storage = Object.hasOwn(localStorage, 'getItem') ? localStorage : Storage.prototype;
    const read = vi.spyOn(storage, 'getItem').mockImplementationOnce(() => {
      throw new Error('denied');
    });
    try {
      await act(async () => {
        expect(await hook.result.current.toggle(item, saved)).toBe('failed');
      });
      expect(hook.result.current.phase).toBe('error');
      expect(JSON.parse(localStorage.getItem(key)!)).toEqual(original);
      await act(async () => {
        expect(await hook.result.current.retry()).toBe(true);
      });
      const expected = saved ? [item] : [];
      expect(hook.result.current.items).toEqual(expected);
      expect(JSON.parse(localStorage.getItem(key)!).items).toEqual(expected);
      expect(hook.result.current.error).toBeNull();
    } finally {
      read.mockRestore();
    }
  },
);

it('does not resume a failed save if the account changes while retrying the read', async () => {
  const item: SavedCampusEvent = {
    schoolId: 'ntu',
    id: 'concert',
    title: '音樂會',
    source: 'school-events',
  };
  const hook = renderHook(() => useCampusEventShortlist(item.schoolId));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const storage = Object.hasOwn(localStorage, 'getItem') ? localStorage : Storage.prototype;
  const read = vi.spyOn(storage, 'getItem').mockImplementationOnce(() => {
    throw new Error('denied');
  });
  try {
    await act(async () => {
      expect(await hook.result.current.toggle(item, true)).toBe('failed');
    });
    const pending = hook.result.current.retry();
    platform.session = { platformAccountId: 'another-owner' };
    hook.rerender();
    await act(async () => {
      expect(await pending).toBe(false);
    });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.items).toEqual([]);
    expect(localStorage.getItem(campusEventShortlistKey(item.schoolId, null))).toBeNull();
    expect(
      localStorage.getItem(
        campusEventShortlistKey(item.schoolId, campusEventShortlistOwner(null, 'another-owner')),
      ),
    ).toBeNull();
  } finally {
    read.mockRestore();
  }
});

it('reopens an idle shortlist without briefly displaying the previous device copy', async () => {
  const schoolId = 'pu';
  const item: SavedCampusEvent = {
    schoolId,
    id: 'idle-lecture',
    title: '講座',
    source: 'school-events',
  };
  const key = campusEventShortlistKey(schoolId, null);
  localStorage.setItem(key, JSON.stringify({ version: 1, items: [item] }));
  const first = renderHook(() => useCampusEventShortlist(schoolId));
  await waitFor(() => expect(first.result.current.items).toEqual([item]));
  first.unmount();
  localStorage.setItem(key, JSON.stringify({ version: 1, items: [] }));

  const renders: Array<{ ready: boolean; items: SavedCampusEvent[] }> = [];
  const second = renderHook(() => {
    const result = useCampusEventShortlist(schoolId);
    renders.push({ ready: result.ready, items: result.items });
    return result;
  });
  expect(renders[0]).toEqual({ ready: false, items: [] });
  await waitFor(() => expect(second.result.current.ready).toBe(true));
  expect(second.result.current.items).toEqual([]);
});

it('does not revive an earlier Web save, retry or notice when returning to the same account', async () => {
  const item: SavedCampusEvent = {
    schoolId: 'pu', id: 'return-lecture', title: '回訪講座', source: 'school-events',
  };
  platform.session = { platformAccountId: 'return-a' };
  const aKey = campusEventShortlistKey(item.schoolId, campusEventShortlistOwner(null, 'return-a'));
  const bKey = campusEventShortlistKey(item.schoolId, campusEventShortlistOwner(null, 'return-b'));
  const hook = renderHook(() => useCampusEventShortlist(item.schoolId));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => {
    expect(await hook.result.current.toggle(item, true)).toBe('done');
  });
  expect(hook.result.current.notice).toContain(item.title);
  const previous = hook.result.current;

  platform.session = { platformAccountId: 'return-b' };
  hook.rerender();
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  platform.session = { platformAccountId: 'return-a' };
  hook.rerender();
  await waitFor(() => expect(hook.result.current.items).toEqual([item]));
  expect(hook.result.current.notice).toBe('');
  await act(async () => {
    expect(await previous.toggle(item, false)).toBe('ignored');
    expect(await previous.retry()).toBe(false);
    expect(await previous.reload()).toBe(false);
  });
  expect(JSON.parse(localStorage.getItem(aKey)!).items).toEqual([item]);
  expect(localStorage.getItem(bKey)).toBeNull();
  await act(async () => {
    expect(await hook.result.current.toggle(item, false)).toBe('done');
  });
  expect(hook.result.current.items).toEqual([]);
  const last = hook.result.current;
  hook.unmount();
  expect(await last.toggle(item, true)).toBe('ignored');
  expect(JSON.parse(localStorage.getItem(aKey)!).items).toEqual([]);
});

it('does not offer an earlier failed write as a retry after leaving and returning to its scope', async () => {
  const item: SavedCampusEvent = {
    schoolId: 'nthu', id: 'failed-return', title: '回訪工作坊', source: 'school-events',
  };
  const key = campusEventShortlistKey(item.schoolId, null);
  const hook = renderHook(() => useCampusEventShortlist(item.schoolId));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const storage = Object.hasOwn(localStorage, 'setItem') ? localStorage : Storage.prototype;
  const write = vi.spyOn(storage, 'setItem').mockImplementationOnce(() => {
    throw new Error('storage unavailable');
  });
  try {
    await act(async () => {
      expect(await hook.result.current.toggle(item, true)).toBe('failed');
    });
    const staleRetry = hook.result.current.retry;
    platform.loading = true;
    hook.rerender();
    expect(hook.result.current.items).toEqual([]);
    platform.loading = false;
    hook.rerender();
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.error).toBeNull();
    await act(async () => {
      expect(await staleRetry()).toBe(false);
      expect(await hook.result.current.retry()).toBe(true);
    });
    expect(localStorage.getItem(key)).toBeNull();
    expect(hook.result.current.items).toEqual([]);
  } finally {
    write.mockRestore();
  }
});
