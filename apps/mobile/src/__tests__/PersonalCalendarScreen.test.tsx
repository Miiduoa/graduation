import React from 'react';
import { Alert, Platform } from 'react-native';
import { Paths } from 'expo-file-system';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  personalImportSavedNotice,
  emptyPersonalEventDraft,
  personalEventRowFromDraft,
  type PersonalImportRecord,
} from '@campus/shared';
import { PersonalImportAuthorityProvider } from '../state/personalImportAuthority';
import PersonalCalendarScreen from '../screens/PersonalCalendarScreen';
import { PersonalEventReminderJournalCorruptError } from '../services/personalEventReminderJournal';
import { reminderStatusCopy, type PersonalEventReminderEntry } from '../services/personalEventReminderModel';
import { shareICalContent } from '../services/ical';
jest.mock('../services/ical', () => ({ shareICalContent: jest.fn(async () => undefined) }));
import {
  appendPersonalImports,
  deletePersonalImport,
  editPersonalImport,
  loadPersonalImports,
  personalImportStorageKey,
  subscribePersonalImports,
} from '../services/personalImports';

jest.mock('../services/personalImports', () => {
  const actual = jest.requireActual('../services/personalImports') as typeof import('../services/personalImports');
  return {
    ...actual,
    loadPersonalImports: jest.fn(actual.loadPersonalImports),
    appendPersonalImports: jest.fn((...args: Parameters<typeof actual.appendPersonalImports>) =>
      actual.appendPersonalImports(...args),
    ),
    editPersonalImport: jest.fn((...args: Parameters<typeof actual.editPersonalImport>) =>
      actual.editPersonalImport(...args),
    ),
    deletePersonalImport: jest.fn((...args: Parameters<typeof actual.deletePersonalImport>) =>
      actual.deletePersonalImport(...args),
    ),
  };
});

let mockScope: { owner: string; schoolId: string } | null = {
  owner: 'nuni:pa_11111111-1111-4111-8111-111111111111',
  schoolId: 'pu',
};

const mockNavigate = jest.fn();

let mockPendingLogout = false;
let mockSession: { platformAccountId: string } | null = {
  platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
};
let mockNuniLoading = false;
let mockSignInGeneration: number | undefined;
let mockSessionError = '';
let mockAuth: { user: { uid: string } | null; loading: boolean };
let mockUseLiveScope = false;

jest.mock('../state/personalImportScope', () => ({
  usePersonalImportScope: () =>
    mockUseLiveScope
      ? jest.requireActual('../state/personalImportScope').usePersonalImportScope()
      : mockScope,
}));
jest.mock('../state/nuniSession', () => ({
  useNuniSession: () => ({
    pendingLogout: mockPendingLogout,
    loading: mockNuniLoading,
    signInGeneration: mockSignInGeneration,
    session: mockSession,
    error: mockSessionError,
  }),
}));
let mockSchool = { id: 'pu', name: '靜宜大學' };
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: mockSchool, schoolId: mockSchool.id, selectionReady: true }),
}));
jest.mock('../state/auth', () => ({
  useAuth: () => mockAuth,
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
const mockListReminders = jest.fn(async (): Promise<Record<string, PersonalEventReminderEntry>> => ({}));
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
  mockUseLiveScope = false;
  mockScope = {
    owner: 'nuni:pa_11111111-1111-4111-8111-111111111111',
    schoolId: 'pu',
  };
  mockPendingLogout = false;
  mockSession = {
    platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
  };
  mockSessionError = '';
  mockNuniLoading = false;
  mockSignInGeneration = undefined;
  mockAuth = { user: null, loading: false };
  mockSchool = { id: 'pu', name: '靜宜大學' };
  mockNavigate.mockReset();
  mockEnableTimed.mockReset();
  mockEnableAllDay.mockReset();
  mockDisableReminder.mockReset();
  mockRetryReminder.mockReset();
  mockListReminders.mockReset();
  mockListReminders.mockResolvedValue({});
  mockOpenReminderSettings.mockReset();
  await AsyncStorage.clear();
  jest.mocked(appendPersonalImports).mockClear();
  jest.mocked(deletePersonalImport).mockClear();
  jest.mocked(editPersonalImport).mockClear();

  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    const confirm = buttons?.find(
      (button) => button.style === 'destructive' || button.text === '刪除',
    );
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
  const view = renderCalendar();
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

it('saves new and edited events on Web with an existing AsyncStorage ledger', async () => {
  const scope = mockScope!;
  const { ledger: existing } = await appendPersonalImports(scope, [personalEventRowFromDraft({
    ...emptyPersonalEventDraft(),
    title: '既有行程',
    date: '2026-10-20',
    allDay: true,
  }, scope.schoolId)]);
  const originalPlatform = Platform.OS;
  const document = Object.getOwnPropertyDescriptor(Paths, 'document')!;
  Platform.OS = 'web';
  const key = personalImportStorageKey(scope);
  window.localStorage.setItem(key, JSON.stringify(existing));
  const getItem = jest.mocked(AsyncStorage.getItem);
  const setItem = jest.mocked(AsyncStorage.setItem);
  const nativeGet = getItem.getMockImplementation()!;
  const nativeSet = setItem.getMockImplementation()!;
  getItem.mockImplementation(async (entry) => window.localStorage.getItem(entry));
  setItem.mockImplementation(async (entry, value) => window.localStorage.setItem(entry, value));
  Object.defineProperty(Paths, 'document', {
    get: () => { throw new TypeError('Expo 網頁預覽沒有文件目錄'); },
  });
  try {
    const view = await fillAndSave('網頁新增行程');
    fireEvent.press(view.getByText('網頁新增行程'));
    fireEvent.changeText(view.getByLabelText('標題'), '網頁修改行程');
    fireEvent.press(view.getByRole('button', { name: '儲存修改' }));
    await view.findByText('個人行程已更新。');
    expect((await loadPersonalImports(scope)).records).toEqual([
      ...existing.records,
      expect.objectContaining({ title: '網頁修改行程' }),
    ]);
    expect(Object.keys(window.localStorage)).toEqual([key]);
  } finally {
    getItem.mockImplementation(nativeGet);
    setItem.mockImplementation(nativeSet);
    window.localStorage.clear();
    Platform.OS = originalPlatform;
    Object.defineProperty(Paths, 'document', document);
  }
});

it('keeps draft on validation failure and refuses destructive overwrite when load fails', async () => {
  const view = renderCalendar();
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
  const broken = renderCalendar();
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
  const other = renderCalendar();
  await waitFor(() => expect(other.getByText(/還沒有行程/)).toBeTruthy());
  other.unmount();

  mockScope = { owner: scope.owner, schoolId: 'ntu' };
  const otherSchool = renderCalendar();
  await waitFor(() => expect(otherSchool.getByText(/還沒有行程/)).toBeTruthy());
  otherSchool.unmount();
});

it('wires import navigation without enabling the old Firebase calendar demo', async () => {
  const view = renderCalendar();
  await waitFor(() => expect(view.getByRole('button', { name: '從截圖或檔案匯入' })).toBeTruthy());
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
  const view = renderCalendar();
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

function renderCalendar() {
  const view = render(<PersonalCalendarScreen />, { wrapper: PersonalImportAuthorityProvider });
  const today = emptyPersonalEventDraft().date;
  const offset = (Number(today.slice(0, 4)) - 2026) * 12 + Number(today.slice(5, 7)) - 10;
  for (let i = 0; i < Math.abs(offset); i += 1)
    fireEvent.press(view.getByText(offset > 0 ? '上一月' : '下一月'));
  fireEvent.press(view.getByText('列表'));
  return view;
}

it('月格選日期看列表、切月清除選取並回到今天', async () => {
  const view = await fillAndSave('合成安排');
  fireEvent.press(view.getByText('月格'));
  fireEvent.press(view.getByLabelText('2026-10-20'));
  expect(view.getByText('2026-10-20 的行程')).toBeTruthy();
  fireEvent.press(view.getAllByRole('button', { name: '合成安排' })[0]);
  expect(view.getByDisplayValue('合成安排')).toBeTruthy();
  fireEvent.press(view.getByText('取消'));
  fireEvent.press(view.getByText('下一月'));
  expect(view.getByText('2026-11')).toBeTruthy();
  expect(view.queryByText('2026-10-20 的行程')).toBeNull();
  fireEvent.press(view.getByText('上一月'));
  expect(view.getByRole('button', { name: '合成安排' })).toBeTruthy();
  fireEvent.press(view.getByText('回今天'));
  expect(view.getByText(`${emptyPersonalEventDraft().date} 的行程`)).toBeTruthy();
});

it('選取單日後仍匯出所選整月，包含跨月活動並保留原始起訖', async () => {
  const rows: PersonalImportRecord[] = [
    {
      id: 'cross',
      kind: 'events',
      title: '跨月合成',
      schoolId: 'pu',
      academicYear: '',
      semester: '',
      date: '2026-09-30',
      endDate: '2026-10-02',
      allDay: true,
      batchId: 'test',
      importedAt: '2026-09-01T00:00:00Z',
      source: { type: 'paste', line: 1, rawText: '' },
    },
    {
      id: 'inside',
      kind: 'events',
      title: '月內合成',
      schoolId: 'pu',
      academicYear: '',
      semester: '',
      date: '2026-10-20',
      allDay: true,
      batchId: 'test2',
      importedAt: '2026-09-01T00:00:00Z',
      source: { type: 'paste', line: 1, rawText: '' },
    },
    {
      id: 'outside',
      kind: 'events',
      title: '其他月份',
      schoolId: 'pu',
      academicYear: '',
      semester: '',
      date: '2026-11-01',
      allDay: true,
      batchId: 'test3',
      importedAt: '2026-09-01T00:00:00Z',
      source: { type: 'paste', line: 1, rawText: '' },
    },
  ];
  await appendPersonalImports(mockScope!, rows);
  const view = renderCalendar();
  await waitUntilEditable(view);
  fireEvent.press(view.getByText('月格'));
  fireEvent.press(view.getByLabelText('2026-10-20'));
  jest.mocked(shareICalContent).mockClear();
  fireEvent.press(view.getByText('匯出所選月份'));
  await waitFor(() => expect(shareICalContent).toHaveBeenCalled());
  const content = jest.mocked(shareICalContent).mock.calls[0][0];
  expect(content.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  expect(content).toContain('SUMMARY:跨月合成');
  expect(content).toContain('DTSTART;VALUE=DATE:20260930');
  expect(content).toContain('DTEND;VALUE=DATE:20261002');
  expect(content).toContain('SUMMARY:月內合成');
  expect(content).not.toContain('SUMMARY:其他月份');
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function fillDraft(view: ReturnType<typeof render>, title: string) {
  await waitUntilEditable(view);
  fireEvent.press(view.getByRole('button', { name: '新增行程' }));
  await waitFor(() => expect(view.getByLabelText('標題')).toBeTruthy());
  fireEvent.changeText(view.getByLabelText('標題'), title);
  fireEvent.changeText(view.getByLabelText('日期（YYYY-MM-DD）'), '2026-10-20');
  fireEvent.changeText(view.getByLabelText('開始時間（HH:MM）'), '09:00');
  fireEvent.changeText(view.getByLabelText('結束時間（HH:MM）'), '10:00');
}

it.each(['availability', 'write'])('blocks an old export after same-account revalidation during %s', async (phase) => {
  const view = await fillAndSave('等待匯出的行程');
  const scope = mockScope!;
  const pending = deferred<void>();
  const started = jest.fn();
  const remove = jest.fn();
  const write = jest.fn(async () => {
    if (phase === 'write') {
      started();
      await pending.promise;
    }
    return { uri: 'file:///old-export.ics', remove };
  });
  const share = jest.fn(async () => undefined);
  const actual = jest.requireActual<typeof import('../services/ical')>('../services/ical');
  const exportMock = jest.mocked(shareICalContent);
  exportMock.mockClear();
  exportMock.mockImplementationOnce((content, filename, active) => actual.shareICalContent(
    content, filename, active, {
      isAvailable: async () => {
        if (phase === 'availability') {
          started();
          await pending.promise;
        }
        return true;
      },
      write,
      share,
    },
  ));

  fireEvent.press(view.getByText('匯出所選月份'));
  await waitFor(() => expect(started).toHaveBeenCalledTimes(1));
  mockScope = null;
  view.rerender(<PersonalCalendarScreen />);
  mockScope = scope;
  view.rerender(<PersonalCalendarScreen />);
  await waitFor(() => expect(view.getByRole('button', { name: '匯出所選月份' })).toBeEnabled());

  await act(async () => {
    pending.resolve();
    await expect(exportMock.mock.results[0].value).rejects.toThrow('匯出已停止');
  });
  expect(share).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledTimes(phase === 'write' ? 1 : 0);
  expect(remove).toHaveBeenCalledTimes(phase === 'write' ? 1 : 0);

  fireEvent.press(view.getByText('匯出所選月份'));
  await waitFor(() => expect(exportMock).toHaveBeenCalledTimes(2));
  expect(exportMock.mock.calls[1][2]?.()).toBe(true);
});

it('finishes a started save while the account is briefly revalidated', async () => {
  const view = renderCalendar();
  await fillDraft(view, '重驗後仍要存下');
  const write = deferred<Awaited<ReturnType<typeof appendPersonalImports>>>();
  const actual = jest.requireActual('../services/personalImports') as typeof import('../services/personalImports');
  jest.mocked(appendPersonalImports).mockImplementationOnce(() => write.promise);
  fireEvent.press(view.getByRole('button', { name: '儲存行程' }));
  await waitFor(() => expect(appendPersonalImports).toHaveBeenCalled());
  const [scope, rows, canContinue] = jest.mocked(appendPersonalImports).mock.calls[0];
  mockScope = null;
  view.rerender(<PersonalCalendarScreen />);
  await act(async () => {
    write.resolve(await actual.appendPersonalImports(scope, rows, canContinue));
  });
  mockScope = {
    owner: 'nuni:pa_11111111-1111-4111-8111-111111111111',
    schoolId: 'pu',
  };
  view.rerender(<PersonalCalendarScreen />);
  await waitFor(() => expect(view.getByText(personalImportSavedNotice(1))).toBeTruthy());
  const ledger = await loadPersonalImports(mockScope);
  expect(ledger.records).toHaveLength(1);
  expect(ledger.records[0]?.title).toBe('重驗後仍要存下');
});

it('shows a save error if the write fails while the account is briefly revalidated', async () => {
  const view = renderCalendar();
  await fillDraft(view, '重驗失敗要看見錯誤');
  const write = deferred<Awaited<ReturnType<typeof appendPersonalImports>>>();
  jest.mocked(appendPersonalImports).mockImplementationOnce(() => write.promise);
  fireEvent.press(view.getByRole('button', { name: '儲存行程' }));
  await waitFor(() => expect(appendPersonalImports).toHaveBeenCalled());
  mockScope = null;
  view.rerender(<PersonalCalendarScreen />);
  await act(async () => {
    write.reject(new Error('網路中斷'));
  });
  expect(view.getByText('網路中斷')).toBeTruthy();
  mockScope = {
    owner: 'nuni:pa_11111111-1111-4111-8111-111111111111',
    schoolId: 'pu',
  };
  view.rerender(<PersonalCalendarScreen />);
  await waitFor(() => expect(view.getByText('網路中斷')).toBeTruthy());
  expect(view.getByLabelText('標題').props.value).toBe('重驗失敗要看見錯誤');
  expect(view.queryByText(personalImportSavedNotice(1))).toBeNull();
});

it.each([
  ['create', 'switch', 'nuni'],
  ['edit', 'switch', 'nuni'],
  ['create', 'sign out', 'firebase'],
  ['edit', 'sign out', 'firebase'],
  ['create', 'sign out', 'nuni'],
  ['edit', 'sign out', 'nuni'],
  ['create', 'sign out before Nuni', 'nuni'],
  ['edit', 'sign out before Nuni', 'nuni'],
  ['create', 'sign out before scope loss', 'nuni'],
  ['edit', 'sign out before scope loss', 'nuni'],
] as const)('unmounts the old calendar and rejects a queued %s on Firebase %s for a %s ledger', async (mode, transition, owner) => {
  mockAuth = { user: { uid: 'student-a' }, loading: false };
  if (owner === 'firebase') {
    mockSession = null;
    mockScope = { owner: 'firebase:student-a', schoolId: 'pu' };
  }
  const scope = mockScope!;
  const key = personalImportStorageKey(scope);
  const originalTitle = '原本的行程';
  const view = mode === 'edit' ? await fillAndSave(originalTitle) : renderCalendar();
  if (mode === 'edit') {
    fireEvent.press(view.getByText(originalTitle));
    fireEvent.changeText(view.getByLabelText('標題'), '舊帳號的草稿');
  } else {
    await fillDraft(view, '舊帳號的草稿');
  }
  const stored = await AsyncStorage.getItem(key);
  const read = deferred<string | null>();
  const getItem = jest.mocked(AsyncStorage.getItem);
  getItem.mockClear();
  getItem.mockImplementationOnce(() => read.promise);
  const setItem = jest.mocked(AsyncStorage.setItem);
  setItem.mockClear();
  fireEvent.press(view.getByRole('button', { name: mode === 'edit' ? '儲存修改' : '儲存行程' }));
  await waitFor(() => expect(getItem).toHaveBeenCalledWith(key));
  const save = mode === 'edit'
    ? jest.mocked(editPersonalImport).mock.results[0].value
    : jest.mocked(appendPersonalImports).mock.results[0].value;

  if (transition === 'sign out before scope loss') {
    mockAuth = { user: null, loading: false };
  } else if (transition !== 'switch') {
    mockScope = null;
    if (transition === 'sign out') mockSession = null;
    mockNuniLoading = true;
    mockAuth = { user: null, loading: true };
    view.rerender(<PersonalCalendarScreen />);
    expect(view.getByLabelText('標題')).toBeTruthy();
    mockAuth = { user: null, loading: false };
  } else {
    mockScope = null;
    mockAuth = { user: { uid: 'student-b' }, loading: true };
  }
  view.rerender(<PersonalCalendarScreen />);
  await act(async () => {
    read.resolve(stored);
    await expect(save).rejects.toThrow('帳號或學校已切換');
  });
  expect(view.queryByLabelText('標題')).toBeNull();
  expect(setItem).not.toHaveBeenCalledWith(key, expect.any(String));
  expect(await AsyncStorage.getItem(key)).toBe(stored);

  mockAuth = { user: { uid: 'student-a' }, loading: false };
  mockScope = scope;
  view.rerender(<PersonalCalendarScreen />);
  await waitUntilEditable(view);
  expect(view.queryByLabelText('標題')).toBeNull();
});

it('loads and saves the guest ledger on the same screen after Firebase and Nuni sign out', async () => {
  mockUseLiveScope = true;
  mockAuth = { user: { uid: 'student-a' }, loading: false };
  const accountScope = mockScope!;
  const guestScope = { owner: 'guest:device', schoolId: accountScope.schoolId };
  const today = emptyPersonalEventDraft();
  await appendPersonalImports(guestScope, [
    personalEventRowFromDraft({ ...today, title: '既有訪客行程', allDay: true }, guestScope.schoolId),
  ]);
  const view = render(<PersonalCalendarScreen />, { wrapper: PersonalImportAuthorityProvider });
  await fillDraft(view, '登出前的帳號草稿');

  // Firebase finishes first while Nuni still supplies the old account.
  mockAuth = { user: null, loading: false };
  view.rerender(<PersonalCalendarScreen />);
  expect(view.queryByLabelText('標題')).toBeNull();

  mockSession = null;
  view.rerender(<PersonalCalendarScreen />);
  await waitUntilEditable(view);
  fireEvent.press(view.getByText('列表'));
  expect(view.getByText('既有訪客行程')).toBeTruthy();

  await fillDraft(view, '登出後新增的訪客行程');
  fireEvent.press(view.getByRole('button', { name: '儲存行程' }));
  await waitFor(() => expect(view.getByText(personalImportSavedNotice(1))).toBeTruthy());
  expect((await loadPersonalImports(guestScope)).records.map(({ title }) => title)).toEqual(
    expect.arrayContaining(['既有訪客行程', '登出後新增的訪客行程']),
  );
  expect((await loadPersonalImports(accountScope)).records).toEqual([]);
});

it.each(['', '已登出；裝置上的 Google 帳號選擇狀態尚未清除。'])(
  'accepts a fresh Nuni-only login for the same account after both sessions sign out (%j)',
  async (logoutNotice) => {
    mockUseLiveScope = true;
    mockAuth = { user: { uid: 'student-a' }, loading: false };
    const scope = mockScope!;
    const accountSession = mockSession;
    await appendPersonalImports(scope, [
      personalEventRowFromDraft(
        { ...emptyPersonalEventDraft(), title: '既有 Nuni 行程', allDay: true },
        scope.schoolId,
      ),
    ]);
    const view = render(<PersonalCalendarScreen />, { wrapper: PersonalImportAuthorityProvider });
    await waitUntilEditable(view);

    mockAuth = { user: null, loading: false };
    view.rerender(<PersonalCalendarScreen />);
    expect(view.queryByRole('button', { name: '新增行程', disabled: false })).toBeNull();

    mockSession = null;
    mockSessionError = logoutNotice;
    view.rerender(<PersonalCalendarScreen />);
    if (!logoutNotice) await waitUntilEditable(view);

    mockSession = accountSession;
    mockSessionError = '';
    mockSignInGeneration = 1;
    view.rerender(<PersonalCalendarScreen />);
    await waitUntilEditable(view);
    fireEvent.press(view.getByText('列表'));
    expect(view.getByText('既有 Nuni 行程')).toBeTruthy();

    await fillDraft(view, 'Nuni 重新登入後的行程');
    fireEvent.press(view.getByRole('button', { name: '儲存行程' }));
    await waitFor(() => expect(view.getByText(personalImportSavedNotice(1))).toBeTruthy());
    expect((await loadPersonalImports(scope)).records.map(({ title }) => title)).toEqual(
      expect.arrayContaining(['既有 Nuni 行程', 'Nuni 重新登入後的行程']),
    );
  },
);

it.each(['during revalidation', 'after revalidation'])(
  'rejects a delete confirmation opened before revalidation and accepted %s',
  async (when) => {
    const view = await fillAndSave('待確認的行程');
    const scope = mockScope!;
    const alert = jest.mocked(Alert.alert);
    alert.mockImplementationOnce(() => undefined);
    fireEvent.press(view.getByText('待確認的行程'));
    fireEvent.press(view.getByText('刪除這筆'));
    const confirm = alert.mock.lastCall?.[2]?.find((button) => button.style === 'destructive');
    expect(confirm?.onPress).toBeDefined();

    mockScope = null;
    view.rerender(<PersonalCalendarScreen />);
    if (when === 'after revalidation') {
      mockScope = scope;
      view.rerender(<PersonalCalendarScreen />);
      await waitUntilEditable(view);
    }
    await act(async () => {
      confirm?.onPress?.();
    });

    expect(deletePersonalImport).not.toHaveBeenCalled();
    expect((await loadPersonalImports(scope)).records.map((row) => row.title)).toEqual([
      '待確認的行程',
    ]);
  },
);

it.each(['during revalidation', 'after recovery'])(
  'keeps an event when a confirmed deletion reaches its first write check %s',
  async (when) => {
    const view = await fillAndSave('首次寫入前重驗');
    const scope = mockScope!;
    const stored = await AsyncStorage.getItem(personalImportStorageKey(scope));
    const read = deferred<string | null>();
    const getItem = jest.mocked(AsyncStorage.getItem);
    getItem.mockClear();
    getItem.mockImplementationOnce(() => read.promise);
    fireEvent.press(view.getByText('首次寫入前重驗'));
    fireEvent.press(view.getByText('刪除這筆'));
    await waitFor(() => expect(getItem).toHaveBeenLastCalledWith(personalImportStorageKey(scope)));
    const deletion = jest.mocked(deletePersonalImport).mock.results[0].value;

    mockScope = null;
    view.rerender(<PersonalCalendarScreen />);
    if (when === 'after recovery') {
      mockScope = scope;
      view.rerender(<PersonalCalendarScreen />);
    }
    await act(async () => {
      read.resolve(stored);
      await expect(deletion).rejects.toThrow('目前無法確認行事曆可寫入');
    });

    expect(await AsyncStorage.getItem(personalImportStorageKey(scope))).toBe(stored);
    expect(view.queryByText('已刪除這筆個人行程。')).toBeNull();
  },
);

it.each([
  ['setItem', false, false],
  ['setItem', true, false],
  ['multiRemove', false, false],
  ['multiRemove', true, false],
  ['multiRemove', false, true],
  ['multiRemove', true, true],
] as const)('preserves the event when deletion loses verification during %s (restoration fails: %s, backup rebuild fails: %s)', async (phase, restoreFails, rebuildFails) => {
  const view = await fillAndSave('寫入途中重驗');
  const scope = mockScope!;
  const key = personalImportStorageKey(scope);
  const stored = await AsyncStorage.getItem(key);
  const setItem = jest.mocked(AsyncStorage.setItem);
  const nativeSetItem = setItem.getMockImplementation()!;
  const pending = deferred<void>();
  const started = jest.fn();
  const multiRemove = jest.mocked(AsyncStorage.multiRemove);
  const nativeMultiRemove = multiRemove.getMockImplementation()!;
  const rejectRebuild = jest.fn(async () => {
    throw new Error('重建備份失敗');
  });
  setItem.mockClear();
  if (phase === 'setItem') {
    setItem.mockImplementationOnce(async (storageKey, value) => {
      started();
      await pending.promise;
      await nativeSetItem(storageKey, value);
    });
  } else {
    setItem.mockImplementationOnce(nativeSetItem);
    multiRemove.mockImplementationOnce(async (keys) => {
      started();
      await pending.promise;
      await nativeMultiRemove(keys);
      if (rebuildFails) jest.mocked(AsyncStorage.multiSet).mockImplementationOnce(rejectRebuild);
    });
  }
  if (restoreFails) setItem.mockRejectedValueOnce(new Error('還原寫入失敗'));
  const listener = jest.fn();
  const unsubscribe = subscribePersonalImports(listener);
  try {
    fireEvent.press(view.getByText('寫入途中重驗'));
    fireEvent.press(view.getByText('刪除這筆'));
    await waitFor(() => expect(started).toHaveBeenCalledTimes(1));
    expect(JSON.parse(setItem.mock.calls[0][1]).records).toEqual([]);
    const deletion = jest.mocked(deletePersonalImport).mock.results[0].value;

    mockScope = null;
    view.rerender(<PersonalCalendarScreen />);
    mockScope = scope;
    view.rerender(<PersonalCalendarScreen />);
    const read = loadPersonalImports(scope);
    await act(async () => {
      pending.resolve();
      await expect(deletion).rejects.toThrow(
        restoreFails ? '還原寫入失敗' : '目前無法確認行事曆可寫入',
      );
    });

    expect((await read).records.map((row) => row.title)).toEqual(['寫入途中重驗']);
    expect(setItem.mock.calls).toEqual([[key, expect.any(String)], [key, stored]]);
    if (rebuildFails) {
      expect(rejectRebuild).toHaveBeenCalledWith([[key + ':checkpoint', stored]]);
    }
    expect(listener).not.toHaveBeenCalled();
    expect(view.queryByText('已刪除這筆個人行程。')).toBeNull();
    if (restoreFails) {
      expect(JSON.parse((await AsyncStorage.getItem(key))!).records).toEqual([]);
      expect(await AsyncStorage.getItem(key + ':checkpoint')).toBe(rebuildFails ? null : stored);
      expect((await loadPersonalImports(scope)).records.map((row) => row.title)).toEqual(['寫入途中重驗']);
      let restarted!: typeof import('../services/personalImports');
      jest.isolateModules(() => {
        restarted = jest.requireActual('../services/personalImports');
      });
      const recovered = await restarted.loadPersonalImports(scope);
      expect(recovered.records.map((row) => row.title)).toEqual(['寫入途中重驗']);
      // A verified retry commits directly from the recovered ledger.
      view.unmount();
      await deletePersonalImport(scope, recovered.records[0], { canContinue: () => true });
      expect(JSON.parse((await AsyncStorage.getItem(key))!).records).toEqual([]);
      expect(await AsyncStorage.getItem(key + ':checkpoint')).toBeNull();
    } else {
      expect(await AsyncStorage.getItem(key)).toBe(stored);
    }
  } finally {
    pending.resolve();
    unsubscribe();
  }
});

it('revokes a pending reminder across same-account revalidation and ignores its late result', async () => {
  const view = await fillAndSave('提醒權限等待');
  const scope = mockScope!;
  const { records: [record] } = await loadPersonalImports(scope);
  const permission = deferred<void>();
  const nextPermission = deferred<void>();
  const writeJournal = jest.fn();
  const result = {
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
    permission: { granted: false, canAskAgain: false, unsupported: false },
  };
  mockEnableTimed.mockImplementationOnce(async (_scope, _record, _lead, isCurrent: () => boolean) => {
    await permission.promise;
    if (isCurrent()) writeJournal();
    return result;
  });
  mockEnableTimed.mockImplementationOnce(async () => {
    await nextPermission.promise;
    return result;
  });

  fireEvent.press(view.getByText(record.title));
  fireEvent.press(view.getByRole('button', { name: '提前 10 分' }));
  const oldOperation = mockEnableTimed.mock.calls[0][3];
  expect(oldOperation()).toBe(true);
  mockScope = null;
  view.rerender(<PersonalCalendarScreen />);
  expect(oldOperation()).toBe(false);
  mockScope = scope;
  view.rerender(<PersonalCalendarScreen />);
  await waitFor(() => expect(view.getByRole('button', { name: '提前 30 分' })).toBeEnabled());
  fireEvent.press(view.getByRole('button', { name: '提前 30 分' }));
  expect(mockEnableTimed.mock.calls[1][3]()).toBe(true);
  expect(oldOperation()).toBe(false);

  await act(async () => { permission.resolve(); });
  expect(writeJournal).not.toHaveBeenCalled();
  expect(view.queryByRole('button', { name: '✓ 提前 10 分' })).toBeNull();
  expect(view.getByRole('button', { name: '提前 30 分' })).toBeDisabled();
  await act(async () => { nextPermission.resolve(); });
});

it.each(['recovered success', 'recovered error', 'success without revalidation'])(
  'ignores an older enabled reminder read after %s',
  async (outcome) => {
    const view = await fillAndSave('提醒讀取競態');
    const scope = mockScope!;
    const { records: [record] } = await loadPersonalImports(scope);
    fireEvent.press(view.getByText(record.title));
    const read = deferred<Record<string, PersonalEventReminderEntry>>();
    mockListReminders.mockClear();
    mockListReminders.mockImplementationOnce(() => read.promise);
    const actual = jest.requireActual<typeof import('../services/personalImports')>(
      '../services/personalImports',
    );
    const notifyLedger = (location: string) => actual.mutatePersonalImportLedger(
      scope,
      () => true,
      (ledger) => ({
        ledger: { ...ledger, records: ledger.records.map((row) => ({ ...row, location })) },
        result: undefined,
      }),
    );

    await act(async () => { await notifyLedger('第一次讀取'); });
    expect(mockListReminders).toHaveBeenCalledTimes(1);

    if (outcome === 'recovered error') {
      mockListReminders.mockRejectedValueOnce(new PersonalEventReminderJournalCorruptError(scope));
    }
    if (outcome === 'success without revalidation') {
      await act(async () => { await notifyLedger('第二次讀取'); });
    } else {
      mockScope = null;
      view.rerender(<PersonalCalendarScreen />);
      mockScope = scope;
      view.rerender(<PersonalCalendarScreen />);
    }
    await waitFor(() => expect(mockListReminders).toHaveBeenCalledTimes(2));
    const expectedStatus = outcome === 'recovered error'
      ? reminderStatusCopy('corrupt_blocked')
      : '此裝置提醒：關閉';
    expect(view.getAllByText(expectedStatus).length).toBeGreaterThan(0);

    await act(async () => {
      read.resolve({
        [record.id]: {
          eventId: record.id,
          revision: 'rev',
          preference: { enabled: true, mode: 'timed', leadMinutes: 10 },
          lookupToken: 'tok',
          osIdentifier: 'per-evtrem.tok',
          intentGeneration: 1,
          status: 'scheduled',
          updatedAt: new Date().toISOString(),
        },
      });
    });
    expect(view.getAllByText(expectedStatus).length).toBeGreaterThan(0);
    expect(view.queryByRole('button', { name: '關閉此裝置提醒' })).toBeNull();
  },
);

it('ignores a pre-revalidation read that resolves after the recovered calendar loads', async () => {
  const scope = mockScope!;
  const empty = await loadPersonalImports(scope);
  const read = deferred<typeof empty>();
  jest.mocked(loadPersonalImports).mockImplementationOnce(() => read.promise);
  const view = renderCalendar();
  mockScope = null;
  view.rerender(<PersonalCalendarScreen />);
  await appendPersonalImports(scope, [
    personalEventRowFromDraft(
      { ...emptyPersonalEventDraft(), title: '重新驗證後的行程', date: '2026-10-20', allDay: true },
      scope.schoolId,
      null,
    ),
  ]);
  mockScope = scope;
  view.rerender(<PersonalCalendarScreen />);
  await waitFor(() => expect(view.getByText('重新驗證後的行程')).toBeTruthy());

  await act(async () => {
    read.resolve(empty);
  });
  expect(view.getByText('重新驗證後的行程')).toBeTruthy();
});

it('ignores an older ledger notification read after a delete refresh', async () => {
  const view = await fillAndSave('稍後要刪除的行程');
  const scope = mockScope!;
  const stale = await loadPersonalImports(scope);
  const read = deferred<typeof stale>();
  const actual = jest.requireActual<typeof import('../services/personalImports')>(
    '../services/personalImports',
  );
  jest.mocked(loadPersonalImports).mockImplementationOnce(() => read.promise);
  await act(async () => {
    await actual.mutatePersonalImportLedger(scope, () => true, (ledger) => ({
      ledger: { ...ledger, records: ledger.records.map((row) => ({ ...row, location: '新地點' })) },
      result: undefined,
    }));
  });
  // Refresh the edit target to the exact persisted revision while the older read is pending.
  await act(async () => {
    await actual.mutatePersonalImportLedger(scope, () => true, () => ({
      ledger: stale,
      result: undefined,
    }));
  });
  fireEvent.press(view.getByText('稍後要刪除的行程'));
  fireEvent.press(view.getByText('刪除這筆'));
  await waitFor(() => {
    expect(view.getByText('已刪除這筆個人行程。')).toBeTruthy();
    expect(view.queryByText('稍後要刪除的行程')).toBeNull();
  });

  await act(async () => {
    read.resolve(stale);
  });
  expect(view.queryByText('稍後要刪除的行程')).toBeNull();
});

it("hides the previous owner's calendar while logout is pending", async () => {
  const view = await fillAndSave('即將登出的行程');
  expect(view.getByText('即將登出的行程')).toBeTruthy();
  mockPendingLogout = true;
  mockScope = null;
  view.rerender(<PersonalCalendarScreen />);
  expect(view.queryByText('即將登出的行程')).toBeNull();
});

it('hides the previous campus calendar when the school changes during revalidation', async () => {
  const view = await fillAndSave('原校園行程');
  expect(view.getByText('原校園行程')).toBeTruthy();
  mockSchool = { id: 'ntu', name: '臺灣大學' };
  mockScope = null;
  view.rerender(<PersonalCalendarScreen />);
  expect(view.queryByText('原校園行程')).toBeNull();
});

it('hides the previous calendar after a rejected Nuni session', async () => {
  const view = await fillAndSave('已失效的行程');
  expect(view.getByText('已失效的行程')).toBeTruthy();
  mockSession = null;
  mockSessionError = '無法確認登入狀態，請重新連線後再試。';
  mockScope = null;
  view.rerender(<PersonalCalendarScreen />);
  expect(view.queryByText('已失效的行程')).toBeNull();
});

it('hides the previous calendar when the confirmed school is cleared', async () => {
  const view = await fillAndSave('已清空校園的行程');
  expect(view.getByText('已清空校園的行程')).toBeTruthy();
  mockSchool = { id: '', name: '' };
  mockScope = null;
  view.rerender(<PersonalCalendarScreen />);
  expect(view.queryByText('已清空校園的行程')).toBeNull();
});
