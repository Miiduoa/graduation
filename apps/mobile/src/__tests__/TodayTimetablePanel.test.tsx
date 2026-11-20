import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { PersonalImportRecord } from '@campus/shared';
import { TodayTimetablePanel } from '../components/TodayTimetablePanel';
import { loadPersonalImports, type PersonalImportScope } from '../services/personalImports';
import { loadPersonalTimetable } from '../services/personalTimetable';

let mockScope: PersonalImportScope | null = { owner: 'nuni:account-a', schoolId: 'pu' };
jest.mock('../state/personalImportScope', () => ({ usePersonalImportScope: () => mockScope }));
jest.mock('../services/personalImports', () => ({ loadPersonalImports: jest.fn() }));
jest.mock('../firebase', () => ({ getDb: jest.fn(), getFunctionsInstance: jest.fn() }));
jest.mock('../services/personalTimetable', () => ({
  ...jest.requireActual('../services/personalTimetable'),
  loadPersonalTimetable: jest.fn(),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));

const onOpenImport = jest.fn();
const onOpenTimetable = jest.fn();
let nowMs = Date.parse('2026-10-19T00:50:00Z');
const panel = (refreshKey = 0) => (
  <TodayTimetablePanel
    onOpenImport={onOpenImport}
    onOpenTimetable={onOpenTimetable}
    refreshKey={refreshKey}
  />
);
const record = (overrides: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({
  id: 'course-a',
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
  teacher: '林老師',
  source: { type: 'paste', line: 1, rawText: '' },
  ...overrides,
});
const ledger = (records = [record()]) => ({ version: 1 as const, records, batches: [] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  nowMs = Date.parse('2026-10-19T00:50:00Z');
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
  mockScope = { owner: 'nuni:account-a', schoolId: 'pu' };
  jest.mocked(loadPersonalImports).mockReset().mockResolvedValue(ledger());
  jest
    .mocked(loadPersonalTimetable)
    .mockReset()
    .mockResolvedValue({
      courses: [],
      schoolId: 'pu',
      shareWithFriends: false,
      updatedAt: new Date(nowMs).toISOString(),
      meta: { year: '115', semester: '1', school: '', className: '', credits: 0, title: '' },
    });
});
afterEach(() => {
  jest.restoreAllMocks();
});

test('shows actual imported times, rooms and provenance, with working record and week actions', async () => {
  const view = render(panel());
  await view.findByText('資料結構');
  expect(view.getByText('09:00–10:00 · 下一堂')).toBeTruthy();
  expect(view.getByText('主顧 303 · 林老師')).toBeTruthy();
  expect(view.getByText(/目前課表：115／1/)).toBeTruthy();
  expect(view.getByText(/停課與補課請確認學校通知/)).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '查看整週課表' }));
  fireEvent.press(view.getByRole('button', { name: '檢查匯入紀錄' }));
  expect(onOpenTimetable).toHaveBeenCalledTimes(1);
  expect(onOpenTimetable).toHaveBeenCalledWith('115|1');
  expect(onOpenImport).toHaveBeenCalledTimes(1);
});

test('does not combine semesters, and lets the user explicitly select an older one', async () => {
  jest
    .mocked(loadPersonalImports)
    .mockResolvedValue(
      ledger([record(), record({ id: 'old', academicYear: '114', title: '舊學期課程' })]),
    );
  const view = render(panel());
  await view.findByText('資料結構');
  expect(view.queryByText('舊學期課程')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '查看 114／1 課表' }));
  expect(view.getByText('舊學期課程')).toBeTruthy();
  expect(view.queryByText('資料結構')).toBeNull();
});

test.each(['owner', 'schoolId'] as const)(
  'hides old records immediately when %s changes and discards a late response',
  async (field) => {
    const old = deferred<ReturnType<typeof ledger>>();
    const next = deferred<ReturnType<typeof ledger>>();
    const view = render(panel());
    await view.findByText('資料結構');
    jest
      .mocked(loadPersonalImports)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    view.rerender(panel(1));
    mockScope = { ...mockScope!, [field]: field === 'owner' ? 'nuni:account-b' : 'ntpu' };
    view.rerender(panel(1));
    expect(view.queryByText('資料結構')).toBeNull();
    await act(async () => old.resolve(ledger([record({ title: '舊帳號課程' })])));
    expect(view.queryByText('舊帳號課程')).toBeNull();
    await act(async () => next.resolve(ledger([])));
    expect(view.getByRole('button', { name: '匯入我的課表' })).toBeTruthy();
  },
);

test('pending logout or account revalidation masks the timetable and makes no guest read', async () => {
  const view = render(panel());
  await view.findByText('資料結構');
  const calls = jest.mocked(loadPersonalImports).mock.calls.length;
  mockScope = null;
  view.rerender(panel());
  expect(view.queryByText('資料結構')).toBeNull();
  expect(view.getByText(/正在確認帳號/)).toBeTruthy();
  expect(loadPersonalImports).toHaveBeenCalledTimes(calls);
});

test('read failure is retryable and is never reported as no classes', async () => {
  jest.mocked(loadPersonalImports).mockRejectedValueOnce(new Error('storage read failed'));
  const view = render(panel());
  await view.findByText(/這不代表今天沒有課/);
  expect(view.queryByText('這份課表今天沒有排課。')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '重試課表' }));
  await view.findByText('資料結構');
});

test('class status advances with time and returning to the foreground reloads edited records', async () => {
  let tick: (() => void) | undefined;
  const schedule = global.setInterval;
  jest.spyOn(global, 'setInterval').mockImplementation((callback, milliseconds) => {
    if (milliseconds === 30_000) tick = callback as () => void;
    return schedule(callback, milliseconds);
  });
  let resume: ((state: string) => void) | undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, callback) => {
    resume = callback;
    return { remove: jest.fn() };
  });
  const view = render(panel());
  await view.findByText('09:00–10:00 · 下一堂');
  act(() => {
    nowMs += 10 * 60_000;
    tick?.();
  });
  expect(view.getByText('09:00–10:00 · 上課時段')).toBeTruthy();
  jest.mocked(loadPersonalImports).mockResolvedValue(ledger([record({ location: '更新教室' })]));
  await act(async () => resume?.('active'));
  expect(view.getByText('更新教室 · 林老師')).toBeTruthy();
});

test('manually edited courses appear under the same platform account without querying a school account', async () => {
  jest.mocked(loadPersonalImports).mockResolvedValue(ledger([]));
  jest.mocked(loadPersonalTimetable).mockResolvedValue({
    courses: [
      {
        id: 'saved-course',
        name: '手排課程',
        day: 1,
        start: 2,
        end: 3,
        teacher: '',
        room: 'R2',
        color: 'blue',
      },
    ],
    schoolId: 'pu',
    shareWithFriends: false,
    updatedAt: new Date(nowMs).toISOString(),
    meta: { year: '', semester: '', school: '', className: '', credits: 0, title: '' },
  });
  const view = render(panel());
  await view.findByText('手排課程');
  expect(view.getByText('來源：自行編輯')).toBeTruthy();
  expect(loadPersonalTimetable).toHaveBeenCalledWith(null, 'pu', 'nuni:account-a');
  fireEvent.press(view.getByRole('button', { name: '查看整週課表' }));
  expect(onOpenTimetable).toHaveBeenCalledWith('未填|未填');
});

test('keeps the next class visible while completed classes can be expanded and collapsed', async () => {
  nowMs = Date.parse('2026-10-19T02:30:00Z');
  jest
    .mocked(loadPersonalImports)
    .mockResolvedValue(
      ledger([
        record(),
        record({ id: 'course-b', title: '資料庫', startTime: '11:00', endTime: '12:00' }),
      ]),
    );
  const view = render(panel());
  await view.findByText('資料庫');
  expect(view.getByText('11:00–12:00 · 下一堂')).toBeTruthy();
  expect(view.queryByText('資料結構')).toBeNull();
  const disclosure = view.getByRole('button', { name: '查看已結束的 1 堂課' });
  expect(disclosure).toHaveAccessibilityState({ expanded: false });
  fireEvent.press(disclosure);
  expect(view.getByText('資料結構')).toBeTruthy();
  expect(view.getByText('09:00–10:00 · 已過下課時間')).toBeTruthy();
  expect(view.getByText('資料庫')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '收合已結束課程' }));
  expect(view.queryByText('資料結構')).toBeNull();
  expect(view.getByText('資料庫')).toBeTruthy();
});

test('finishing the last class preserves access to its details instead of claiming no timetable', async () => {
  nowMs = Date.parse('2026-10-19T02:30:00Z');
  const view = render(panel());
  await view.findByText('今天的上課時段已結束。');
  expect(view.queryByText('這份課表今天沒有排課。')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '查看已結束的 1 堂課' }));
  expect(view.getByText('資料結構')).toBeTruthy();
  expect(view.getByText('主顧 303 · 林老師')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '查看整週課表' }));
  expect(onOpenTimetable).toHaveBeenCalledWith('115|1');
});
