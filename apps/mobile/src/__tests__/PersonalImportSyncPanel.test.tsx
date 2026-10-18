import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { PersonalImportSyncPanel } from '../components/PersonalImportSyncPanel';
import {
  appendPersonalImports,
  editPersonalImport,
  loadPersonalImports,
} from '../services/personalImports';
import {
  cancelPersonalImportSync,
  setPersonalImportSyncEnabled,
  syncPersonalImports,
} from '../services/personalImportSync';
import type { PersonalImportRecord, PersonalImportRow } from '@campus/shared';
import type { PersonalImportSnapshot } from '@campus/shared/src/imports/sync';
const scope = { owner: 'nuni:pa_11111111-1111-4111-8111-111111111111', schoolId: 'pu' };
const mockAuth = {
  session: { platformAccountId: scope.owner.slice(5), context: 'a'.repeat(43) },
  loading: false,
  pendingLogout: false,
  request: jest.fn(),
};
jest.mock('../state/nuniSession', () => ({ useNuniSession: () => mockAuth }));
jest.mock('../ui/components', () => ({
  Button: ({
    text,
    disabled,
    onPress,
  }: {
    text: string;
    disabled?: boolean;
    onPress?: () => void;
  }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={onPress}
      >
        <Text>{text}</Text>
      </Pressable>
    );
  },
}));
let remote: PersonalImportSnapshot;
const row: PersonalImportRow = {
  id: 'one',
  title: '英文',
  kind: 'grades',
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  credits: 3,
  grade: '85',
  source: { type: 'paste', line: 1, rawText: '英文 85' },
};
const transport = (path: string, input: Record<string, unknown>) =>
  mockAuth.request(path, mockAuth.session.context, input);
beforeEach(async () => {
  await AsyncStorage.clear();
  cancelPersonalImportSync(scope);
  mockAuth.session.context = 'a'.repeat(43);
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
  await appendPersonalImports(scope, [row]);
});
test('mounting stays local; explicit opt-in uploads source text and pause preserves both copies', async () => {
  const screen = render(<PersonalImportSyncPanel scope={scope} />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '開啟此帳號與校園的同步' })).toBeEnabled(),
  );
  expect(mockAuth.request).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('開啟此帳號與校園的同步'));
  await waitFor(() => expect(screen.getByText('已同步到帳號。')).toBeTruthy());
  expect(remote.records[0].source.rawText).toBe('英文 85');
  expect(mockAuth.request.mock.calls.every((call) => call[1] === mockAuth.session.context)).toBe(
    true,
  );
  fireEvent.press(screen.getByText('暫停同步'));
  await waitFor(() => expect(screen.getByText(/已暫停自動同步/)).toBeTruthy());
  const ledger = await loadPersonalImports(scope);
  expect(ledger.sync?.enabled).toBe(false);
  expect(ledger.records).toEqual(remote.records);
});
test('offline opt-in persists intent without network requests or losing local rows', async () => {
  (NetInfo.fetch as jest.Mock).mockResolvedValue({
    isConnected: false,
    isInternetReachable: false,
  });
  const screen = render(<PersonalImportSyncPanel scope={scope} />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '開啟此帳號與校園的同步' })).toBeEnabled(),
  );
  fireEvent.press(screen.getByText('開啟此帳號與校園的同步'));
  await waitFor(() => expect(screen.getByText(/目前離線/)).toBeTruthy());
  expect(mockAuth.request).not.toHaveBeenCalled();
  expect((await loadPersonalImports(scope)).sync?.enabled).toBe(true);
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);
});
test('a cloud/local edit conflict requires an explicit row choice before changing local data', async () => {
  await setPersonalImportSyncEnabled(scope, true, () => true);
  await syncPersonalImports(scope, transport, () => true);
  const saved = (await loadPersonalImports(scope)).records[0];
  await editPersonalImport(scope, saved, { ...saved, grade: '90' });
  remote = { ...remote, revision: 2, records: [{ ...remote.records[0], grade: '95' }] };
  const screen = render(<PersonalImportSyncPanel scope={scope} />);
  await waitFor(() => expect(screen.getByText('立即同步')).toBeTruthy());
  fireEvent.press(screen.getByText('立即同步'));
  await waitFor(() => expect(screen.getByText('確認這些選擇並同步')).toBeTruthy());
  expect(screen.getByRole('button', { name: '確認這些選擇並同步' })).toBeDisabled();
  expect((await loadPersonalImports(scope)).records[0].grade).toBe('90');
  fireEvent.press(screen.getByText('保留帳號資料'));
  fireEvent.press(screen.getByText('確認這些選擇並同步'));
  await waitFor(() => expect(screen.getByText('已同步到帳號。')).toBeTruthy());
  expect((await loadPersonalImports(scope)).records[0].grade).toBe('95');
});
test('account context replacement while reading cannot upload or apply old context data', async () => {
  let finish!: (value: unknown) => void;
  mockAuth.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const screen = render(<PersonalImportSyncPanel scope={scope} />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '開啟此帳號與校園的同步' })).toBeEnabled(),
  );
  fireEvent.press(screen.getByText('開啟此帳號與校園的同步'));
  await waitFor(() => expect(finish).toBeDefined());
  mockAuth.session.context = 'b'.repeat(43);
  screen.rerender(<PersonalImportSyncPanel scope={scope} />);
  await act(async () => {
    finish(remote);
  });
  expect(mockAuth.request).toHaveBeenCalledTimes(1);
  expect(remote.records).toEqual([]);
  expect((await loadPersonalImports(scope)).records[0].grade).toBe('85');
});
