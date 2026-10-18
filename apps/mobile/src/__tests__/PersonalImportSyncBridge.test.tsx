import React from 'react';
import { AppState } from 'react-native';
import { act, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { PersonalImportSyncBridge } from '../components/PersonalImportSyncBridge';
import { appendPersonalImports, loadPersonalImports } from '../services/personalImports';
import {
  cancelPersonalImportSync,
  setPersonalImportSyncEnabled,
} from '../services/personalImportSync';
import type { PersonalImportRecord, PersonalImportRow } from '@campus/shared';
import type { PersonalImportSnapshot } from '@campus/shared/src/imports/sync';
const scope = { owner: 'nuni:pa_11111111-1111-4111-8111-111111111111', schoolId: 'pu' };
let mockScope: typeof scope | null = scope;
const mockAuth = {
  session: { platformAccountId: scope.owner.slice(5), context: 'a'.repeat(43) },
  loading: false,
  pendingLogout: false,
  request: jest.fn(),
};
jest.mock('../state/nuniSession', () => ({ useNuniSession: () => mockAuth }));
jest.mock('../state/personalImportScope', () => ({ usePersonalImportScope: () => mockScope }));
let remote: PersonalImportSnapshot;
const row = (id: string, title: string): PersonalImportRow => ({
  id,
  title,
  kind: 'grades',
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  credits: 3,
  grade: '85',
  source: { type: 'paste', line: 1, rawText: title },
});
const flush = async () => {
  await act(async () => {
    for (let count = 0; count < 60; count++) await Promise.resolve();
  });
};
beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  cancelPersonalImportSync(scope);
  mockScope = scope;
  mockAuth.session.context = 'a'.repeat(43);
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
  remote = { schoolId: 'pu', revision: 0, records: [], updatedAt: null };
  mockAuth.request
    .mockReset()
    .mockImplementation(
      async (path: string, _context: string, input: { records?: PersonalImportRecord[] }) => {
        if (path === 'personal-imports/read') return remote;
        remote = {
          ...remote,
          records: input.records!,
          revision: remote.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        return remote;
      },
    );
  (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true, isInternetReachable: true });
  await appendPersonalImports(scope, [row('one', '英文')]);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
test('automatic foreground synchronization waits for opt-in and responds to local edits; background and unmount stop it', async () => {
  const screen = render(<PersonalImportSyncBridge />);
  await flush();
  expect(mockAuth.request).not.toHaveBeenCalled();
  await act(async () => {
    await setPersonalImportSyncEnabled(scope, true, () => true);
  });
  await flush();
  expect(remote.records.map((item) => item.title)).toEqual(['英文']);
  await act(async () => {
    await appendPersonalImports(scope, [row('two', '統計')]);
  });
  await flush();
  expect(remote.records.map((item) => item.title)).toEqual(['英文', '統計']);
  AppState.currentState = 'background';
  mockAuth.request.mockClear();
  await act(async () => {
    await appendPersonalImports(scope, [row('three', '數學')]);
    jest.advanceTimersByTime(60_000);
  });
  await flush();
  expect(mockAuth.request).not.toHaveBeenCalled();
  AppState.currentState = 'active';
  await act(async () => {
    jest.advanceTimersByTime(30_000);
  });
  await flush();
  expect(remote.records.map((item) => item.title)).toEqual(['英文', '統計', '數學']);
  screen.unmount();
  mockAuth.request.mockClear();
  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  expect(mockAuth.request).not.toHaveBeenCalled();
});
test('account transition invalidates an outstanding background read and keeps the original local ledger', async () => {
  await setPersonalImportSyncEnabled(scope, true, () => true);
  const before = await loadPersonalImports(scope);
  let finish!: (value: unknown) => void;
  mockAuth.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const screen = render(<PersonalImportSyncBridge />);
  await flush();
  expect(finish).toBeDefined();
  mockScope = null;
  screen.rerender(<PersonalImportSyncBridge />);
  await act(async () => {
    finish(remote);
  });
  await flush();
  expect(mockAuth.request).toHaveBeenCalledTimes(1);
  expect(await loadPersonalImports(scope)).toEqual(before);
});
