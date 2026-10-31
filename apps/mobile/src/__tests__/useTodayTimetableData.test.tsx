import { classMeetingKey } from '@campus/shared';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { PersonalImportRecord } from '@campus/shared';
import { useTodayTimetableData } from '../hooks/useTodayTimetableData';
import { loadPersonalImports } from '../services/personalImports';
import { loadPersonalTimetable } from '../services/personalTimetable';

let mockScope = { owner: 'nuni:account-a', schoolId: 'pu' };
jest.mock('../state/personalImportScope', () => ({ usePersonalImportScope: () => mockScope }));
jest.mock('../services/personalImports', () => ({ loadPersonalImports: jest.fn() }));
jest.mock('../services/personalTimetable', () => ({
  loadPersonalTimetable: jest.fn(),
  personalTimetableRecords: (timetable: { classExceptions?: unknown[] }, imported: PersonalImportRecord[] = []) => require('@campus/shared').withClassExceptions(imported, timetable.classExceptions),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));

const now = new Date('2026-10-19T00:50:00Z');
const record: PersonalImportRecord = {
  id: 'class-a',
  batchId: 'batch-a',
  importedAt: '2026-10-18T00:00:00Z',
  kind: 'timetable',
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  title: '資料結構',
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '10:00',
  location: '主顧 303',
  source: { type: 'paste', line: 1, rawText: '' },
};
const ledger = (records = [record]) => ({ version: 1 as const, records, batches: [] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mockScope = { owner: 'nuni:account-a', schoolId: 'pu' };
  jest.mocked(loadPersonalImports).mockReset().mockResolvedValue(ledger());
  jest
    .mocked(loadPersonalTimetable)
    .mockReset()
    .mockResolvedValue({
      courses: [],
      schoolId: 'pu',
      shareWithFriends: false,
      updatedAt: now.toISOString(),
      meta: { year: '115', semester: '1', school: '', className: '', credits: 0, title: '' },
    });
});

test('refreshing the same timetable keeps the current classes visible until the next result arrives', async () => {
  const view = renderHook(() => useTodayTimetableData(now));
  await waitFor(() => expect(view.result.current.classes[0]?.title).toBe('資料結構'));
  const next = deferred<ReturnType<typeof ledger>>();
  jest.mocked(loadPersonalImports).mockReturnValueOnce(next.promise);
  act(() => {
    void view.result.current.retry();
  });
  expect(view.result.current.status).toBe('ready');
  expect(view.result.current.classes[0]?.title).toBe('資料結構');
  await act(async () => next.resolve(ledger([{ ...record, title: '更新的課程' }])));
  expect(view.result.current.classes[0]?.title).toBe('更新的課程');
});

test('switching the account masks the previous timetable and ignores its late refresh', async () => {
  const view = renderHook(() => useTodayTimetableData(now));
  await waitFor(() => expect(view.result.current.classes).toHaveLength(1));
  const previous = deferred<ReturnType<typeof ledger>>();
  const next = deferred<ReturnType<typeof ledger>>();
  jest
    .mocked(loadPersonalImports)
    .mockReturnValueOnce(previous.promise)
    .mockReturnValueOnce(next.promise);
  act(() => {
    void view.result.current.retry();
  });
  mockScope = { owner: 'nuni:account-b', schoolId: 'pu' };
  view.rerender(undefined);
  expect(view.result.current.status).toBe('loading');
  expect(view.result.current.classes).toEqual([]);
  await act(async () => previous.resolve(ledger([{ ...record, title: '舊帳號課程' }])));
  expect(view.result.current.classes).toEqual([]);
  await act(async () => next.resolve(ledger([{ ...record, title: '新帳號課程' }])));
  expect(view.result.current.classes[0]?.title).toBe('新帳號課程');
});

test('a refresh failure reports unavailable data rather than an empty day', async () => {
  const view = renderHook(() => useTodayTimetableData(now));
  await waitFor(() => expect(view.result.current.classes).toHaveLength(1));
  jest.mocked(loadPersonalImports).mockRejectedValueOnce(new Error('storage-unavailable'));
  await act(async () => view.result.current.retry());
  expect(view.result.current.status).toBe('error');
  expect(view.result.current.classes).toEqual([]);
});


test('the today hook consumes a dated room change from the same timetable as the widget', async () => {
  const timetable = await jest.mocked(loadPersonalTimetable)(null, 'pu', 'nuni:account-a');
  jest.mocked(loadPersonalTimetable).mockResolvedValue({ ...timetable, classExceptions: [{
    id: 'room', courseKey: classMeetingKey(record), originalDate: '2026-10-19', kind: 'room',
    location: '單次教室', createdAt: '', original: record,
  }] });
  const view = renderHook(() => useTodayTimetableData(now));
  await waitFor(() => expect(view.result.current.classes[0]?.location).toBe('單次教室'));
  expect(view.result.current.classes[0].startAt).toBe(Date.parse('2026-10-19T09:00:00+08:00'));
});
