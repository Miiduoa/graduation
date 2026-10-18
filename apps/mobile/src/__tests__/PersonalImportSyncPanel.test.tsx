import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { PersonalImportSyncPanel } from '../components/PersonalImportSyncPanel';
import {
  appendPersonalImports,
  editPersonalImport,
  loadPersonalImports,
  personalImportStorageKey,
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

test('unconfirmable pending write offers explicit whole-ledger recovery without a new automatic upload', async () => {
  const ledger = await loadPersonalImports(scope);
  const pending = {
    mutationId: 'sync-unknown-write',
    expectedRevision: 0,
    records: ledger.records,
  };
  await AsyncStorage.setItem(
    personalImportStorageKey(scope),
    JSON.stringify({ ...ledger, sync: { enabled: true, base: null, pending } }),
  );
  remote = { schoolId: 'pu', revision: 2, records: [], updatedAt: '2026-10-18T00:00:00.000Z' };
  mockAuth.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/write'))
      throw Object.assign(new Error('expired mutation'), {
        code: 'PERSONAL_IMPORT_REVISION_CONFLICT',
      });
    return remote;
  });
  const screen = render(<PersonalImportSyncPanel scope={scope} />);
  await waitFor(() => expect(screen.getByText('立即同步')).toBeTruthy());
  fireEvent.press(screen.getByText('立即同步'));
  await waitFor(() => expect(screen.getByText(/無法確認上次同步是否已送達/)).toBeTruthy());
  expect(screen.getByRole('button', { name: '確認這些選擇並同步' })).toBeDisabled();
  expect((await loadPersonalImports(scope)).sync?.pending).toEqual(pending);
  fireEvent.press(screen.getByText('保留帳號資料'));
  fireEvent.press(screen.getByText('確認這些選擇並同步'));
  await waitFor(async () =>
    expect((await loadPersonalImports(scope)).sync?.pending).toBeUndefined(),
  );
  expect((await loadPersonalImports(scope)).records).toEqual([]);
  expect(remote.revision).toBe(2);
  const writes = mockAuth.request.mock.calls.filter(([path]) => path.endsWith('/write'));
  expect(writes.every(([, , input]) => input.mutationId === pending.mutationId)).toBe(true);
});

test('conflict details expose course code, actual class link, and source differences before replacement', async () => {
  await setPersonalImportSyncEnabled(scope, true, () => true);
  await syncPersonalImports(scope, transport, () => true);
  const saved = (await loadPersonalImports(scope)).records[0];
  await editPersonalImport(scope, saved, {
    ...saved,
    courseCode: 'IM001',
    linkedCourseId: 'class-local',
    source: { ...saved.source, type: 'file', name: 'first.csv', rawText: '本機來源原文' },
  });
  remote = {
    ...remote,
    revision: 2,
    records: [
      {
        ...remote.records[0],
        courseCode: 'IM002',
        linkedCourseId: 'class-remote',
        source: {
          ...remote.records[0].source,
          type: 'file',
          name: 'second.csv',
          rawText: '帳號來源原文',
        },
      },
    ],
  };
  const screen = render(<PersonalImportSyncPanel scope={scope} />);
  await waitFor(() => expect(screen.getByText('立即同步')).toBeTruthy());
  fireEvent.press(screen.getByText('立即同步'));
  await waitFor(() => expect(screen.getByText(/課程代碼：IM001/)).toBeTruthy());
  expect(screen.getByText(/課程代碼：IM002/)).toBeTruthy();
  expect(screen.getByText(/課班連結：class-local/)).toBeTruthy();
  expect(screen.getByText(/課班連結：class-remote/)).toBeTruthy();
  expect(screen.getByText(/來源檔名：first.csv/)).toBeTruthy();
  expect(screen.getByText(/來源檔名：second.csv/)).toBeTruthy();
  expect(screen.getByText(/來源文字：本機來源原文/)).toBeTruthy();
  expect(screen.getByText(/來源文字：帳號來源原文/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '確認這些選擇並同步' })).toBeDisabled();
});

test('all-day versus timed event conflicts show exclusive end date and all-day values', async () => {
  await AsyncStorage.clear();
  const event: PersonalImportRow = {
    id: 'event',
    title: '校慶',
    kind: 'events',
    schoolId: 'pu',
    academicYear: '',
    semester: '',
    date: '2026-10-20',
    endDate: '2026-10-21',
    allDay: true,
    source: { type: 'file', name: 'calendar.ics', line: 1, rawText: '校慶' },
  };
  await appendPersonalImports(scope, [event]);
  await setPersonalImportSyncEnabled(scope, true, () => true);
  await syncPersonalImports(scope, transport, () => true);
  const saved = (await loadPersonalImports(scope)).records[0];
  await editPersonalImport(scope, saved, { ...saved, endDate: '2026-10-22' });
  remote = {
    ...remote,
    revision: 2,
    records: [
      {
        ...remote.records[0],
        allDay: false,
        endDate: undefined,
        startTime: '09:00',
        endTime: '10:00',
      },
    ],
  };
  const screen = render(<PersonalImportSyncPanel scope={scope} />);
  await waitFor(() => expect(screen.getByText('立即同步')).toBeTruthy());
  fireEvent.press(screen.getByText('立即同步'));
  await waitFor(() => expect(screen.getByText(/結束日期：2026-10-22/)).toBeTruthy());
  expect(screen.getByText(/全天：是/)).toBeTruthy();
  expect(screen.getByText(/全天：否/)).toBeTruthy();
  expect(screen.getByText(/開始時間：09:00/)).toBeTruthy();
});
