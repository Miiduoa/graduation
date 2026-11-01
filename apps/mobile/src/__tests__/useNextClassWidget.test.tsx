import Constants from 'expo-constants';
import { loadPersonalTimetable } from '../services/personalTimetable';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useNextClassWidget } from '../widgets/useNextClassWidget';
import { loadPersonalImports } from '../services/personalImports';
import { notifyTimetableChanged } from '../widgets/timetableChanges';
const mockWrite = jest.fn().mockResolvedValue(undefined);
let mockImportListener: (change: { scope: { owner: string; schoolId: string } }) => void;
let mockScope: { owner: string; schoolId: string } | null = {
  owner: 'nuni:test-a',
  schoolId: 'pu',
};
jest.mock('expo', () => ({
  requireOptionalNativeModule: () => ({ setSnapshot: (value: string | null) => mockWrite(value) }),
}));
jest.mock('expo-constants', () => ({
  expoConfig: { extra: { release: { features: { widgets: true } } } },
}));
jest.mock('../state/personalImportScope', () => ({ usePersonalImportScope: () => mockScope }));
jest.mock('../services/personalImports', () => ({
  loadPersonalImports: jest.fn(),
  subscribePersonalImports: (listener: typeof mockImportListener) => {
    mockImportListener = listener;
    return () => undefined;
  },
}));
jest.mock('../services/personalTimetable', () => ({
  loadPersonalTimetable: jest.fn().mockResolvedValue({ courses: [] }),
  personalTimetableRecords: () => [],
}));
const ledger = { version: 1 as const, records: [], batches: [] };
beforeEach(() => {
  mockScope = { owner: 'nuni:test-a', schoolId: 'pu' };
  Constants.expoConfig!.extra!.release.features.widgets = true;
  mockWrite.mockClear();
  jest.mocked(loadPersonalTimetable).mockClear();
  jest.mocked(loadPersonalImports).mockReset().mockResolvedValue(ledger);
});
test('mount, manual timetable changes, account switch and logout update or clear the native snapshot', async () => {
  const view = renderHook(useNextClassWidget);
  await waitFor(() => expect(mockWrite.mock.calls.some(([value]) => value !== null)).toBe(true));
  expect(mockWrite.mock.calls[0][0]).toBeNull();
  expect(JSON.parse(mockWrite.mock.calls.at(-1)![0]).classes).toEqual([]);
  act(() => notifyTimetableChanged());
  await waitFor(() => expect(loadPersonalImports).toHaveBeenCalledTimes(2));
  act(() => mockImportListener({ scope: mockScope! }));
  await waitFor(() => expect(loadPersonalImports).toHaveBeenCalledTimes(3));
  mockScope = { owner: 'nuni:test-b', schoolId: 'pu' };
  view.rerender(undefined);
  await waitFor(() => expect(loadPersonalImports).toHaveBeenLastCalledWith(mockScope));
  mockScope = null;
  view.rerender(undefined);
  await waitFor(() => expect(mockWrite).toHaveBeenLastCalledWith(null));
});
test('an unresolved previous account load cannot repopulate a cleared snapshot', async () => {
  let resolve!: (value: typeof ledger) => void;
  jest.mocked(loadPersonalImports).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = renderHook(useNextClassWidget);
  await waitFor(() => expect(resolve).toBeDefined());
  mockScope = null;
  view.rerender(undefined);
  await act(async () => resolve(ledger));
  expect(mockWrite.mock.calls.every(([value]) => value === null)).toBe(true);
});

test.each([false, undefined, 'true', 1])('only explicit true shares a snapshot: %s', async (value) => {
  Constants.expoConfig!.extra!.release.features.widgets = value;
  renderHook(useNextClassWidget);
  await waitFor(() => expect(mockWrite).toHaveBeenCalledWith(null));
  expect(loadPersonalImports).not.toHaveBeenCalled();
  expect(loadPersonalTimetable).not.toHaveBeenCalled();
  expect(mockWrite.mock.calls.every(([snapshot]) => snapshot === null)).toBe(true);
});
test('disabling sharing clears the snapshot for the same account', async () => {
  const view = renderHook(useNextClassWidget);
  await waitFor(() => expect(mockWrite.mock.calls.some(([value]) => value !== null)).toBe(true));
  Constants.expoConfig!.extra!.release.features.widgets = false;
  view.rerender(undefined);
  await waitFor(() => expect(mockWrite).toHaveBeenLastCalledWith(null));
  const count = jest.mocked(loadPersonalImports).mock.calls.length;
  act(() => notifyTimetableChanged());
  expect(loadPersonalImports).toHaveBeenCalledTimes(count);
});

test('absent feature metadata clears without reading timetable data', async () => {
  const extra = Constants.expoConfig!.extra;
  Constants.expoConfig!.extra = undefined;
  try {
    renderHook(useNextClassWidget);
    await waitFor(() => expect(mockWrite).toHaveBeenCalledWith(null));
    expect(loadPersonalImports).not.toHaveBeenCalled();
    expect(loadPersonalTimetable).not.toHaveBeenCalled();
  } finally {
    Constants.expoConfig!.extra = extra;
  }
});

test('foreground time checks reuse the snapshot and stop when the hook unmounts', async () => {
  const { AppState } = require('react-native');
  const { nextClassWriter } = require('../widgets/nextClassBridge');
  const original = AppState.currentState;
  const refresh = jest.spyOn(nextClassWriter, 'refreshActivity').mockResolvedValue(undefined);
  let tick!: () => void;
  const originalInterval = global.setInterval;
  const interval = jest.spyOn(global, 'setInterval').mockImplementation((callback, delay, ...args) => {
    if (delay !== 30_000) return originalInterval(callback, delay, ...args);
    tick = callback as () => void;
    return 123 as unknown as ReturnType<typeof setInterval>;
  });
  const clear = jest.spyOn(global, 'clearInterval');
  AppState.currentState = 'active';
  try {
    const view = renderHook(useNextClassWidget);
    await waitFor(() => expect(mockWrite.mock.calls.some(([value]) => value !== null)).toBe(true));
    const reads = jest.mocked(loadPersonalImports).mock.calls.length;
    act(() => tick());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(loadPersonalImports).toHaveBeenCalledTimes(reads);
    AppState.currentState = 'background';
    act(() => tick());
    expect(refresh).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(clear).toHaveBeenCalledWith(123);
  } finally {
    AppState.currentState = original;
    refresh.mockRestore();
    interval.mockRestore();
    clear.mockRestore();
  }
});

test('回前景先核對既有動態，不等待未完成的課表讀取', async () => {
  const { AppState } = require('react-native');
  const { nextClassWriter } = require('../widgets/nextClassBridge');
  let foreground!: (state: string) => void;
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    foreground = callback as (state: string) => void;
    return { remove: jest.fn() };
  });
  const refresh = jest.spyOn(nextClassWriter, 'refreshActivity').mockResolvedValue(undefined);
  const view = renderHook(useNextClassWidget);
  await waitFor(() => expect(mockWrite.mock.calls.some(([value]) => value !== null)).toBe(true));
  jest.mocked(loadPersonalImports).mockImplementationOnce(() => new Promise(() => undefined));
  act(() => foreground('active'));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(loadPersonalImports).toHaveBeenCalledTimes(2);
  view.unmount();
  refresh.mockRestore();
  listener.mockRestore();
});
