import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, cleanup, render } from '@testing-library/react-native/pure';
import { onAuthStateChanged } from 'firebase/auth';
import { type PersonalImportRecord } from '@campus/shared';
import { AssistantClassNowHint } from '../screens/AssistantClassNowHint';
import { readAssistantTimetable } from '../services/assistantTimetableSource';
import { notifyTimetableChanged } from '../widgets/timetableChanges';

let mockAuthUid = 'A';
let mockDemo = false;
jest.mock('../firebase', () => ({
  getAuthInstance: () => ({ currentUser: { uid: mockAuthUid } }),
  isFirebaseMockMode: () => mockDemo,
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: React.EffectCallback) => require('react').useEffect(effect, [effect]),
}));
jest.mock('../services/assistantTimetableSource', () => ({
  ...jest.requireActual('../services/assistantTimetableSource'), readAssistantTimetable: jest.fn(),
}));
let mockImportChange: (change: { scope: { owner: string; schoolId: string } }) => void;
jest.mock('../services/personalImports', () => ({
  subscribePersonalImports: (listener: typeof mockImportChange) => { mockImportChange = listener; return () => undefined; },
}));

const row: PersonalImportRecord = {
  kind: 'timetable', id: 'db', batchId: 'b', academicYear: '115', semester: '1',
  schoolId: 'pu', dayOfWeek: 4, startTime: '09:00', endTime: '09:50',
  title: '資料庫', location: '主顧 305', importedAt: '2026-09-01T00:00:00Z',
  source: { type: 'paste', line: 1, rawText: '' },
};
const saved = (...records: PersonalImportRecord[]) => ({ schoolId: 'pu', updatedAt: row.importedAt, records, timetable: null });
const read = jest.mocked(readAssistantTimetable);
const hint = (uid = 'A') => <AssistantClassNowHint uid={uid} schoolId="pu" />;
const at = (time: string) => jest.setSystemTime(new Date(`2026-11-05T${time}+08:00`));

const initialState = AppState.currentState;
beforeEach(() => {
  AppState.currentState = 'active';
  mockAuthUid = 'A';
  mockDemo = false;
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  at('09:40:00');
  read.mockReset().mockResolvedValue(saved(row));
});
afterEach(() => {
  cleanup();
  AppState.currentState = initialState;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('advances from class to break to the next class at the actual clock boundaries without another storage read', async () => {
  at('09:49:58');
  read.mockResolvedValue(saved(row, { ...row, id: 'english', title: '英文', startTime: '10:10', endTime: '11:00' }));
  const screen = render(hint());
  await act(async () => {});
  expect(screen.getByText('資料庫')).toBeTruthy();
  expect(screen.getByText('手機課表 · 上課中')).toBeTruthy();
  act(() => jest.advanceTimersByTime(2_000));
  expect(screen.queryByText('資料庫')).toBeNull();
  expect(screen.getByText('手機課表 · 20 分鐘後上課')).toBeTruthy();
  act(() => jest.advanceTimersByTime(20 * 60_000));
  expect(screen.getByText('手機課表 · 上課中')).toBeTruthy();
  expect(screen.getByText('英文')).toBeTruthy();
  expect(read).toHaveBeenCalledTimes(1);
});

test('hides distant classes, reveals an imminent one across Taipei midnight', async () => {
  at('23:48:59');
  read.mockResolvedValue(saved({ ...row, dayOfWeek: 5, startTime: '00:10', endTime: '01:00' }));
  const screen = render(hint());
  await act(async () => {});
  expect(screen.queryByText('資料庫')).toBeNull();
  act(() => jest.advanceTimersByTime(61_000));
  expect(screen.getByText('手機課表 · 20 分鐘後上課')).toBeTruthy();
  expect(screen.getByText('資料庫')).toBeTruthy();
});

test('a timetable write replaces the old hint, while an older pending read cannot restore it', async () => {
  const screen = render(hint());
  await act(async () => {});
  expect(screen.getByText('資料庫')).toBeTruthy();
  let settle!: (s: ReturnType<typeof saved>) => void;
  read.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
  act(() => notifyTimetableChanged());
  expect(screen.queryByText('資料庫')).toBeNull();
  read.mockResolvedValueOnce(saved(row, { ...row, id: 'econ', title: '經濟學', startTime: '09:35' }));
  await act(async () => notifyTimetableChanged());
  expect(screen.getByText('現在有 2 堂課重疊')).toBeTruthy();
  await act(async () => settle(saved(row)));
  expect(screen.queryByText('資料庫')).toBeNull();
});

test('drops private hints on background and reads the selected account on return; ignores pending loads after switching accounts', async () => {
  let change!: (value: AppStateStatus) => void;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    change = listener as typeof change;
    return { remove };
  });
  const screen = render(hint());
  await act(async () => {});
  expect(screen.getByText('資料庫')).toBeTruthy();
  act(() => change('background'));
  expect(screen.queryByText('資料庫')).toBeNull();
  act(() => { jest.advanceTimersByTime(60_000); notifyTimetableChanged(); });
  expect(read).toHaveBeenCalledTimes(1);
  let finish!: (s: ReturnType<typeof saved>) => void;
  read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  act(() => change('active'));
  read.mockResolvedValueOnce(null);
  mockAuthUid = 'B';
  screen.rerender(hint('B'));
  await act(async () => finish(saved(row)));
  expect(read).toHaveBeenLastCalledWith('B', 'pu', undefined);
  expect(screen.queryByText('資料庫')).toBeNull();
  screen.unmount();
  expect(remove).toHaveBeenCalled();
});

test.each(['demo', 'different-account'])('does not read private storage for %s', async (mode) => {
  mockDemo = mode === 'demo';
  mockAuthUid = mode === 'different-account' ? 'B' : 'A';
  const screen = render(hint());
  await act(async () => {});
  expect(read).not.toHaveBeenCalled();
  expect(screen.queryByText('資料庫')).toBeNull();
});

test('checks the actual Firebase account again before displaying an async read', async () => {
  let finish!: (s: ReturnType<typeof saved>) => void;
  read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const screen = render(hint());
  expect(read).toHaveBeenCalledWith('A', 'pu', undefined);
  mockAuthUid = 'B';
  await act(async () => finish(saved(row)));
  expect(screen.queryByText('資料庫')).toBeNull();
});

test('immediately clears a visible class when the signed-in Firebase user changes', async () => {
  const screen = render(hint());
  await act(async () => {});
  expect(screen.getByText('資料庫')).toBeTruthy();
  const notify = jest.mocked(onAuthStateChanged).mock.lastCall![1] as () => void;
  mockAuthUid = 'B';
  act(() => notify());
  expect(screen.queryByText('資料庫')).toBeNull();
  expect(read).toHaveBeenCalledTimes(1);
});

test('a platform hint listens only to that nuni ledger and clears a reply crossing a session change', async () => {
  const accountId = 'pa_11111111-1111-4111-8111-111111111111';
  let valid = true;
  const access = { accountId, isCurrent: () => valid };
  const screen = render(<AssistantClassNowHint uid="" schoolId="pu" platformTimetable={access} />);
  await act(async () => {});
  expect(screen.getByText('資料庫')).toBeTruthy();
  expect(read).toHaveBeenLastCalledWith('', 'pu', access);
  act(() => mockImportChange({ scope: { owner: 'firebase:A', schoolId: 'pu' } }));
  expect(read).toHaveBeenCalledTimes(1);
  let finish!: (s: ReturnType<typeof saved>) => void;
  read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  act(() => mockImportChange({ scope: { owner: 'nuni:' + accountId, schoolId: 'pu' } }));
  expect(read).toHaveBeenCalledTimes(2);
  valid = false;
  await act(async () => finish(saved(row)));
  expect(screen.queryByText('資料庫')).toBeNull();
});
