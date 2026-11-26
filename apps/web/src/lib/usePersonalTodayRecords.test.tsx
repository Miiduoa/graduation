import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parsePersonalImport } from '@campus/shared';
import type { StoredTimetable } from './timetable/store';
import { usePersonalTodayRecords } from './usePersonalTodayRecords';
import { personalImportsStorageKey } from './personalImports';

const state = vi.hoisted(() => ({
  owner: 'school:a',
  schoolId: 'pu',
  uid: 'a' as string | null,
  loading: false,
  load: vi.fn(),
}));

vi.mock('./usePersonalImports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./usePersonalImports')>();
  return {
    ...actual,
    usePersonalImportScope: () => ({
      scope: { owner: state.owner, schoolId: state.schoolId },
      loading: state.loading,
    }),
  };
});
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

afterEach(() => {
  vi.restoreAllMocks();
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

function storeImportedCourse(title: string, owner = state.owner, schoolId = state.schoolId) {
  const parsed = parsePersonalImport(`課程名稱,星期,開始節次,結束節次\n${title},一,1,2`, {
    kind: 'timetable',
    schoolId,
    academicYear: '115',
    semester: '1',
  });
  const records = parsed.rows.map((row, index) => ({
    ...row,
    id: `imported-${index}`,
    batchId: 'batch-1',
    importedAt: '2026-11-21T01:00:00Z',
  }));
  expect(records).toHaveLength(1);
  const key = personalImportsStorageKey({ owner, schoolId });
  localStorage.setItem(key, JSON.stringify({ version: 1, records }));
  return key;
}

function TodayReadout() {
  const records = usePersonalTodayRecords();
  return (
    <>
      <input aria-label="未送出草稿" defaultValue="保留我的內容" />
      <button type="button" onClick={records.retry}>
        重新讀取課表
      </button>
      <p role="status">
        {!records.loaded ? '正在確認課表' : records.error ? '課表暫時讀不到' : '已確認課表'}
      </p>
      {records.error && <p role="alert">{records.error}</p>}
      <ul>
        {[...records.imported.records, ...(records.manual ?? [])].map((row) => (
          <li key={row.id}>{row.title}</li>
        ))}
      </ul>
    </>
  );
}

it('exposes imported courses while the first manual timetable read is pending', async () => {
  storeImportedCourse('先讀到的匯入課程');
  const manual = deferred<StoredTimetable>();
  state.load.mockReturnValueOnce(manual.promise);
  render(<TodayReadout />);

  expect(screen.getByText('先讀到的匯入課程')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('正在確認課表');
  await act(async () => manual.resolve(timetable('後讀到的手動課程')));
  expect(screen.getByRole('status').textContent).toBe('已確認課表');
  expect(screen.getByText('先讀到的匯入課程')).toBeTruthy();
  expect(screen.getByText('後讀到的手動課程')).toBeTruthy();
});

it('retries a failed imported ledger and the manual source without remounting the active task', async () => {
  const key = storeImportedCourse('恢復的匯入課程');
  const read = localStorage.getItem.bind(localStorage);
  const methods: Pick<Storage, 'getItem'> = Object.hasOwn(localStorage, 'getItem')
    ? localStorage
    : Object.getPrototypeOf(localStorage);
  let failed = false;
  const getItem = vi.spyOn(methods, 'getItem').mockImplementation((item: string) => {
    if (item === key && !failed) {
      failed = true;
      throw new Error('儲存空間暫時無法讀取');
    }
    return read(item);
  });
  const next = deferred<StoredTimetable>();
  state.load.mockResolvedValueOnce(timetable('舊手動課程')).mockReturnValueOnce(next.promise);
  render(<TodayReadout />);
  await screen.findByText('課表暫時讀不到');
  expect(screen.getByRole('alert').textContent).toContain('儲存空間暫時無法讀取');
  const draft = screen.getByRole('textbox', { name: '未送出草稿' });
  fireEvent.change(draft, { target: { value: '重讀時也要保留的草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '重新讀取課表' }));
  expect(screen.getByRole('status').textContent).toBe('正在確認課表');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('舊手動課程')).toBeTruthy();
  expect(state.load).toHaveBeenCalledTimes(2);
  await act(async () => next.resolve(timetable('重讀的手動課程')));
  expect(screen.getByRole('status').textContent).toBe('已確認課表');
  expect(screen.getByText('恢復的匯入課程')).toBeTruthy();
  expect(screen.getByText('重讀的手動課程')).toBeTruthy();
  expect(screen.queryByText('舊手動課程')).toBeNull();
  expect(screen.getByRole('textbox', { name: '未送出草稿' })).toBe(draft);
  expect((draft as HTMLInputElement).value).toBe('重讀時也要保留的草稿');
  expect(getItem.mock.calls.filter(([item]) => item === key).length).toBeGreaterThan(1);
});

it('keeps both sources in the current account and campus when an older retry finishes later', async () => {
  storeImportedCourse('帳號 A 匯入課程');
  storeImportedCourse('帳號 B 清華匯入課程', 'school:b', 'nthu');
  const oldRetry = deferred<StoredTimetable>();
  const nextAccount = deferred<StoredTimetable>();
  state.load
    .mockResolvedValueOnce(timetable('帳號 A 手動課程'))
    .mockReturnValueOnce(oldRetry.promise)
    .mockReturnValueOnce(nextAccount.promise);
  const view = render(<TodayReadout />);
  await screen.findByText('已確認課表');
  fireEvent.click(screen.getByRole('button', { name: '重新讀取課表' }));
  expect(screen.getByRole('status').textContent).toBe('正在確認課表');
  expect(screen.getByText('帳號 A 匯入課程')).toBeTruthy();
  expect(screen.getByText('帳號 A 手動課程')).toBeTruthy();
  state.owner = 'school:b';
  state.uid = 'b';
  state.schoolId = 'nthu';
  view.rerender(<TodayReadout />);
  expect(screen.queryByText('帳號 A 匯入課程')).toBeNull();
  expect(screen.queryByText('帳號 A 手動課程')).toBeNull();
  await act(async () => nextAccount.resolve(timetable('帳號 B 清華手動課程', 'nthu')));
  await act(async () => oldRetry.resolve(timetable('帳號 A 晚到的結果')));
  expect(screen.getByRole('status').textContent).toBe('已確認課表');
  expect(screen.getByText('帳號 B 清華匯入課程')).toBeTruthy();
  expect(screen.getByText('帳號 B 清華手動課程')).toBeTruthy();
  expect(screen.queryByText('帳號 A 晚到的結果')).toBeNull();
  expect(state.load).toHaveBeenLastCalledWith('b', 'nthu', 'school:b');
});
