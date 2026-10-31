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
  mockWrite.mockClear();
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
