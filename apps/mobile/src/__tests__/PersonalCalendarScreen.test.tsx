import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  personalImportSavedNotice,
  type PersonalImportRecord,
} from '@campus/shared';
import PersonalCalendarScreen from '../screens/PersonalCalendarScreen';
import {
  appendPersonalImports,
  loadPersonalImports,
  personalImportStorageKey,
} from '../services/personalImports';

let mockScope: { owner: string; schoolId: string } | null = {
  owner: 'nuni:pa_11111111-1111-4111-8111-111111111111',
  schoolId: 'pu',
};

const mockNavigate = jest.fn();

jest.mock('../state/personalImportScope', () => ({
  usePersonalImportScope: () => mockScope,
}));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: 'pu', name: '靜宜大學' } }),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) =>
    require('react').useEffect(() => callback(), [callback]),
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: undefined }),
}));
jest.mock('../utils/safeNavigate', () => ({
  safeNavigate: (_nav: unknown, route: string, params?: unknown) => mockNavigate(route, params),
}));
jest.mock('../ui/components', () => {
  const React = require('react');
  const { View, Text, Pressable } = require('react-native');
  return {
    Screen: ({ children, title }: { children: React.ReactNode; title: string }) => (
      <View>
        <Text>{title}</Text>
        {children}
      </View>
    ),
    Button: ({
      text,
      disabled,
      onPress,
    }: {
      text: string;
      disabled?: boolean;
      onPress?(): void;
    }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        disabled={!!disabled}
        onPress={disabled ? undefined : onPress}
      >
        <Text>{text}</Text>
      </Pressable>
    ),
  };
});

const mockEnableTimed = jest.fn();
const mockEnableAllDay = jest.fn();
const mockDisableReminder = jest.fn();
const mockRetryReminder = jest.fn();
const mockListReminders = jest.fn(async () => ({}));
const mockOpenReminderSettings = jest.fn();

jest.mock('../services/personalEventReminders', () => ({
  enableTimedPersonalEventReminder: (...args: unknown[]) => mockEnableTimed(...args),
  enableAllDayPersonalEventReminder: (...args: unknown[]) => mockEnableAllDay(...args),
  disablePersonalEventReminder: (...args: unknown[]) => mockDisableReminder(...args),
  retryPersonalEventReminder: (...args: unknown[]) => mockRetryReminder(...args),
  listPersonalEventReminderEntries: (...args: unknown[]) => mockListReminders(...args),
  openPersonalReminderSettings: (...args: unknown[]) => mockOpenReminderSettings(...args),
}));

jest.mock('../services/personalEventReminderJournal', () => {
  const actual = jest.requireActual('../services/personalEventReminderJournal');
  return {
    ...actual,
    subscribePersonalEventReminderJournal: () => () => undefined,
  };
});

beforeEach(async () => {
  mockScope = {
    owner: 'nuni:pa_11111111-1111-4111-8111-111111111111',
    schoolId: 'pu',
  };
  mockNavigate.mockReset();
  mockEnableTimed.mockReset();
  mockEnableAllDay.mockReset();
  mockDisableReminder.mockReset();
  mockRetryReminder.mockReset();
  mockListReminders.mockReset();
  mockListReminders.mockResolvedValue({});
  mockOpenReminderSettings.mockReset();
  await AsyncStorage.clear();
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    const confirm = buttons?.find((button) => button.style === 'destructive' || button.text === '刪除');
    confirm?.onPress?.();
  });
});

async function waitUntilEditable(view: ReturnType<typeof render>) {
  await waitFor(() => {
    const button = view.getByRole('button', { name: '新增行程' });
    expect(button.props.accessibilityState?.disabled).toBe(false);
  });
}

async function fillAndSave(title: string) {
  const view = render(<PersonalCalendarScreen />);
  await waitUntilEditable(view);
  fireEvent.press(view.getByRole('button', { name: '新增行程' }));
  await waitFor(() => expect(view.getByLabelText('標題')).toBeTruthy());
  fireEvent.changeText(view.getByLabelText('標題'), title);
  fireEvent.changeText(view.getByLabelText('日期（YYYY-MM-DD）'), '2026-10-20');
  fireEvent.changeText(view.getByLabelText('開始時間（HH:MM）'), '09:00');
  fireEvent.changeText(view.getByLabelText('結束時間（HH:MM）'), '10:00');
  fireEvent.changeText(view.getByLabelText('地點（選填）'), '圖書館');
  fireEvent.press(view.getByRole('button', { name: '儲存行程' }));
  await waitFor(() => expect(view.getByText(personalImportSavedNotice(1))).toBeTruthy());
  return view;
}

it('creates edits and deletes personal events on the public/platform scope', async () => {
  const view = await fillAndSave('口試練習');
  const scope = mockScope!;
  let ledger = await loadPersonalImports(scope);
  expect(ledger.records).toHaveLength(1);
  expect(ledger.records[0]).toMatchObject({
    title: '口試練習',
    date: '2026-10-20',
    startTime: '09:00',
    endTime: '10:00',
    location: '圖書館',
  });

  fireEvent.press(view.getByText('口試練習'));
  fireEvent.changeText(view.getByLabelText('標題'), '口試練習（改）');
  fireEvent.press(view.getByText('儲存修改'));
  await waitFor(() => expect(view.getByText('個人行程已更新。')).toBeTruthy());
  ledger = await loadPersonalImports(scope);
  expect(ledger.records[0].title).toBe('口試練習（改）');
  expect(ledger.records[0].id).toMatch(/^import-/);

  fireEvent.press(view.getByText('口試練習（改）'));
  fireEvent.press(view.getByText('刪除這筆'));
  await waitFor(() => expect(view.getByText('已刪除這筆個人行程。')).toBeTruthy());
  ledger = await loadPersonalImports(scope);
  expect(ledger.records).toEqual([]);
});

it('keeps draft on validation failure and refuses destructive overwrite when load fails', async () => {
  const view = render(<PersonalCalendarScreen />);
  await waitUntilEditable(view);
  fireEvent.press(view.getByRole('button', { name: '新增行程' }));
  await waitFor(() => expect(view.getByLabelText('標題')).toBeTruthy());
  fireEvent.changeText(view.getByLabelText('標題'), '結束太早');
  fireEvent.changeText(view.getByLabelText('日期（YYYY-MM-DD）'), '2026-10-20');
  fireEvent.changeText(view.getByLabelText('開始時間（HH:MM）'), '18:00');
  fireEvent.changeText(view.getByLabelText('結束時間（HH:MM）'), '17:00');
  await waitFor(() => expect(view.getByText(/結束時間必須晚於開始時間/)).toBeTruthy());
  expect(view.getByDisplayValue('結束太早')).toBeTruthy();

  const key = personalImportStorageKey(mockScope!);
  await AsyncStorage.setItem(key, '{damaged');
  const broken = render(<PersonalCalendarScreen />);
  await waitFor(() => expect(broken.getByText(/無法讀取|稍後重試/)).toBeTruthy());
  expect(broken.getByRole('button', { name: '新增行程' }).props.accessibilityState?.disabled).toBe(
    true,
  );
  expect(await AsyncStorage.getItem(key)).toBe('{damaged');
});

it('preserves imported provenance and isolates account/school switches', async () => {
  const scope = mockScope!;
  const imported: PersonalImportRecord = {
    id: 'import-keep',
    kind: 'events',
    title: '校慶',
    schoolId: 'pu',
    academicYear: '',
    semester: '',
    date: '2026-10-25',
    allDay: true,
    batchId: 'batch-import',
    importedAt: '2026-10-01T00:00:00.000Z',
    source: { type: 'file', name: '公告.ics', line: 4, rawText: 'SUMMARY:校慶' },
  };
  await appendPersonalImports(scope, [imported]);
  const view = await fillAndSave('手動');
  fireEvent.press(view.getByText('手動'));
  fireEvent.changeText(view.getByLabelText('標題'), '手動（改）');
  fireEvent.press(view.getByRole('button', { name: '儲存修改' }));
  await waitFor(() => expect(view.getByText('個人行程已更新。')).toBeTruthy());
  const ledger = await loadPersonalImports(scope);
  expect(ledger.records).toHaveLength(2);
  expect(ledger.records.find((row) => row.source.name === '公告.ics')?.source).toEqual(
    imported.source,
  );
  view.unmount();

  mockScope = { owner: 'nuni:pa_22222222-2222-4222-8222-222222222222', schoolId: 'pu' };
  const other = render(<PersonalCalendarScreen />);
  await waitFor(() => expect(other.getByText(/還沒有行程/)).toBeTruthy());
  other.unmount();

  mockScope = { owner: scope.owner, schoolId: 'ntu' };
  const otherSchool = render(<PersonalCalendarScreen />);
  await waitFor(() => expect(otherSchool.getByText(/還沒有行程/)).toBeTruthy());
  otherSchool.unmount();
});

it('wires import navigation without enabling the old Firebase calendar demo', async () => {
  const view = render(<PersonalCalendarScreen />);
  await waitFor(() =>
    expect(view.getByRole('button', { name: '從截圖或檔案匯入' })).toBeTruthy(),
  );
  fireEvent.press(view.getByRole('button', { name: '從截圖或檔案匯入' }));
  expect(mockNavigate).toHaveBeenCalledWith('PersonalImport', { kind: 'events' });
});

it('preserves imported course metadata when only location is edited', async () => {
  const scope = mockScope!;
  const imported: PersonalImportRecord = {
    id: 'import-meta',
    kind: 'events',
    title: '專題發表',
    schoolId: 'pu',
    academicYear: '',
    semester: '',
    courseCode: 'IM499',
    teacher: '李老師',
    className: '專題班',
    date: '2026-10-22',
    startTime: '14:00',
    endTime: '16:00',
    location: '舊教室',
    batchId: 'batch-meta',
    importedAt: '2026-10-01T00:00:00.000Z',
    source: { type: 'file', name: '課表.ics', line: 2, rawText: 'SUMMARY:專題發表' },
  };
  const other: PersonalImportRecord = {
    id: 'other-keep',
    kind: 'events',
    title: '另一筆',
    schoolId: 'pu',
    academicYear: '',
    semester: '',
    date: '2026-10-23',
    allDay: true,
    batchId: 'batch-other',
    importedAt: '2026-10-01T00:00:00.000Z',
    source: { type: 'paste', name: '手動新增', line: 1, rawText: '另一筆' },
  };
  await appendPersonalImports(scope, [imported, other]);
  const view = render(<PersonalCalendarScreen />);
  await waitUntilEditable(view);
  fireEvent.press(view.getByText('專題發表'));
  fireEvent.changeText(view.getByLabelText('地點（選填）'), '新教室');
  fireEvent.press(view.getByRole('button', { name: '儲存修改' }));
  await waitFor(() => expect(view.getByText('個人行程已更新。')).toBeTruthy());
  const ledger = await loadPersonalImports(scope);
  expect(ledger.records).toHaveLength(2);
  expect(ledger.records.find((row) => row.id === 'import-meta')).toMatchObject({
    id: 'import-meta',
    courseCode: 'IM499',
    teacher: '李老師',
    className: '專題班',
    location: '新教室',
    source: imported.source,
  });
  expect(ledger.records.find((row) => row.id === 'other-keep')?.title).toBe('另一筆');
});

it('deliberate reminder enable and refusal recovery leave saved events intact', async () => {
  const view = await fillAndSave('提醒測試');
  const scope = mockScope!;
  const ledgerBefore = await loadPersonalImports(scope);
  const record = ledgerBefore.records[0]!;

  mockEnableTimed.mockResolvedValue({
    entry: {
      eventId: record.id,
      revision: 'rev',
      preference: { enabled: true, mode: 'timed', leadMinutes: 10 },
      lookupToken: 'tok',
      osIdentifier: 'per-evtrem.tok',
      intentGeneration: 1,
      status: 'permission_needed',
      updatedAt: new Date().toISOString(),
    },
    permission: { granted: false, canAskAgain: false, unsupported: false, status: 'denied' },
    eventSavedIndependent: true,
  });
  mockListReminders.mockResolvedValue({
    [record.id]: {
      eventId: record.id,
      revision: 'rev',
      preference: { enabled: true, mode: 'timed', leadMinutes: 10 },
      lookupToken: 'tok',
      osIdentifier: 'per-evtrem.tok',
      intentGeneration: 1,
      status: 'permission_needed',
      updatedAt: new Date().toISOString(),
    },
  });

  fireEvent.press(view.getByText('提醒測試'));
  await waitFor(() => expect(view.getByRole('button', { name: '提前 10 分' })).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: '提前 10 分' }));
  await waitFor(() => expect(mockEnableTimed).toHaveBeenCalled());
  await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);

  mockEnableTimed.mockRejectedValue(new Error('injected reminder failure'));
  fireEvent.press(view.getByRole('button', { name: '提前 30 分' }));
  await waitFor(() => expect(view.getByText('injected reminder failure')).toBeTruthy());
  expect((await loadPersonalImports(scope)).records[0]?.title).toBe('提醒測試');
});
