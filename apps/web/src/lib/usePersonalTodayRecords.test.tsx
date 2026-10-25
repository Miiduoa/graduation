import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { StoredTimetable } from './timetable/store';
import { usePersonalTodayRecords } from './usePersonalTodayRecords';

const state = vi.hoisted(() => ({
  owner: 'school:a',
  schoolId: 'pu',
  uid: 'a' as string | null,
  loading: false,
  load: vi.fn(),
}));

vi.mock('./usePersonalImports', () => ({
  usePersonalImportScope: () => ({
    scope: { owner: state.owner, schoolId: state.schoolId },
    loading: state.loading,
  }),
  usePersonalImports: (_scope: unknown, enabled: boolean) => ({
    records: [],
    loading: !enabled,
    error: '',
    syncEnabled: false,
    ready: enabled,
  }),
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: state.uid ? { uid: state.uid } : null }),
}));
vi.mock('./timetable/store', () => ({ loadPersonalTimetable: state.load }));

function timetable(title: string, schoolId = 'pu'): StoredTimetable {
  return {
    schoolId,
    courses: [
      {
        id: 'course-1',
        name: title,
        day: 1,
        start: 1,
        end: 2,
        teacher: '',
        room: '',
        color: 'blue',
      },
    ],
    meta: { school: '', year: '115', semester: '1', className: '', credits: 2, title: '' },
    updatedAt: '2026-10-25T01:00:00.000Z',
    shareWithFriends: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  state.owner = 'school:a';
  state.schoolId = 'pu';
  state.uid = 'a';
  state.loading = false;
  state.load.mockReset();
});

it('hides the previous account timetable immediately while the next account loads in the same school', async () => {
  const next = deferred<StoredTimetable>();
  state.load.mockResolvedValueOnce(timetable('帳號 A 的課程')).mockReturnValueOnce(next.promise);
  const { result, rerender } = renderHook(() => usePersonalTodayRecords());
  await waitFor(() => expect(result.current.manual?.[0].title).toBe('帳號 A 的課程'));
  state.owner = 'school:b';
  state.uid = 'b';
  rerender();
  expect(result.current.manual).toBeNull();
  expect(result.current.loaded).toBe(false);
  expect(result.current.error).toBe('');
  expect(state.load).toHaveBeenLastCalledWith('b', 'pu', 'school:b');
  await act(async () => next.resolve(timetable('帳號 B 的課程')));
  expect(result.current.manual?.[0].title).toBe('帳號 B 的課程');
});

it('ignores an old school response that finishes after the current school', async () => {
  const first = deferred<StoredTimetable>();
  const next = deferred<StoredTimetable>();
  state.load.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
  const { result, rerender } = renderHook(() => usePersonalTodayRecords());
  state.schoolId = 'nthu';
  rerender();
  await act(async () => next.resolve(timetable('清華課程', 'nthu')));
  await act(async () => first.resolve(timetable('較晚回應的靜宜課程')));
  expect(result.current.manual?.[0].title).toBe('清華課程');
  expect(result.current.schoolId).toBe('nthu');
});

it('also fences a changed school account when the platform owner remains the same', async () => {
  state.owner = 'platform:one';
  const next = deferred<StoredTimetable>();
  state.load.mockResolvedValueOnce(timetable('原學校帳號課程')).mockReturnValueOnce(next.promise);
  const { result, rerender } = renderHook(() => usePersonalTodayRecords());
  await waitFor(() => expect(result.current.loaded).toBe(true));
  const oldScope = result.current.scopeKey;
  state.uid = 'b';
  rerender();
  expect(result.current.manual).toBeNull();
  expect(result.current.scopeKey).not.toBe(oldScope);
  await act(async () => next.resolve(timetable('新學校帳號課程')));
  expect(result.current.manual?.[0].title).toBe('新學校帳號課程');
});

it('hides records during identity revalidation and waits to read until the scope is ready', async () => {
  state.load.mockResolvedValue(timetable('課程'));
  const { result, rerender } = renderHook(() => usePersonalTodayRecords());
  await waitFor(() => expect(result.current.loaded).toBe(true));
  state.loading = true;
  rerender();
  expect(result.current.manual).toBeNull();
  expect(result.current.loaded).toBe(false);
  expect(state.load).toHaveBeenCalledTimes(1);
  state.uid = null;
  state.owner = 'guest';
  state.loading = false;
  rerender();
  await waitFor(() => expect(state.load).toHaveBeenCalledWith(null, 'pu', 'guest'));
});

it('does not carry a previous scope error into a new account and retries only the current scope', async () => {
  const next = deferred<StoredTimetable>();
  state.load.mockRejectedValueOnce(new Error('storage')).mockReturnValueOnce(next.promise);
  const { result, rerender } = renderHook(() => usePersonalTodayRecords());
  await waitFor(() => expect(result.current.error).toContain('手動課表暫時讀不到'));
  state.owner = 'school:b';
  state.uid = 'b';
  rerender();
  expect(result.current.error).toBe('');
  expect(result.current.loaded).toBe(false);
  await act(async () => next.resolve(timetable('新課程')));
  state.load.mockResolvedValue(timetable('重讀新課程'));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.manual?.[0].title).toBe('重讀新課程'));
  expect(state.load).toHaveBeenLastCalledWith('b', 'pu', 'school:b');
});
