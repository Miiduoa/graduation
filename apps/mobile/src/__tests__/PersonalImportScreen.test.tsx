import type { ReactNode } from 'react';
import type { useNuniSession } from '../state/nuniSession';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import {
  PERSONAL_IMPORT_IMAGE_UNREADABLE,
  personalImportPreviewNotice,
  personalImportSavedNotice,
  personalImportUndoBody,
  personalImportUndoneNotice,
  serializePersonalImportBackup,
  type PersonalImportDocument,
  type PersonalImportRecord,
} from '@campus/shared';
import { sharePersonalImportBackup } from '../services/personalImportBackupSharing';
import * as ImagePicker from 'expo-image-picker';
import PersonalImportScreen from '../screens/PersonalImportScreen';
import { loadPersonalImports, personalImportStorageKey } from '../services/personalImports';
import {
  runMobilePersonalImportAi,
  type MobileImportAiAvailability,
} from '../services/imports/personalImportAi';
import { parsePersonalImportAiResponse } from '@campus/shared/src/imports/aiRecognition';
import { loadPersonalImportDraft } from '../services/imports/personalImportDraft';

let mockScope: { owner: string; schoolId: string } | null;
const mockRequest = jest.fn();
let mockPlatform: ReturnType<typeof useNuniSession>;
const mockRecognize = jest.fn();
const mockDocumentRead = jest.fn();
const mockDocumentCancel = jest.fn();
const mockFileText = jest.fn();
let mockAiAvailability: MobileImportAiAvailability;
jest.mock('../services/imports/personalImportAi', () => ({
  getMobileImportAiAvailability: () => mockAiAvailability,
  subscribeMobileImportAi: () => jest.fn(),
  runMobilePersonalImportAi: jest.fn(),
  MOBILE_IMPORT_AI_MAX_CHARACTERS: 1000,
}));
jest.mock('../screens/AIModelManagerScreen', () => {
  const { Text } = require('react-native');
  return function ModelManager() {
    return <Text>本機模型管理內容</Text>;
  };
});
jest.mock('../services/personalImportBackupSharing', () => ({
  sharePersonalImportBackup: jest.fn(),
}));
jest.mock('expo-file-system', () => ({
  File: class {
    size = 1000;
    uri: string;
    constructor(value: string) {
      this.uri = value;
    }
    async text() {
      return mockFileText();
    }
    async base64() {
      return '';
    }
  },
}));
jest.mock('../state/personalImportScope', () => ({ usePersonalImportScope: () => mockScope }));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: 'pu', name: '靜宜大學' } }),
}));
jest.mock('../state/nuniSession', () => ({ useNuniSession: () => mockPlatform }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('../components/TimetableOcrHost', () => ({
  TimetableOcrHost: require('react').forwardRef((_: unknown, ref: unknown) => {
    require('react').useImperativeHandle(ref, () => ({
      recognize: mockRecognize,
      cancel: jest.fn(),
    }));
    return null;
  }),
}));
// This real module may already be resolved by navigation tests in the same Jest worker.
// A virtual mock uses a different module ID and can leave the native host unmocked.
jest.mock('../components/DocumentImportHost', () => ({
  DocumentImportHost: require('react').forwardRef((_: unknown, ref: unknown) => {
    require('react').useImperativeHandle(ref, () => ({
      read: mockDocumentRead,
      cancel: mockDocumentCancel,
    }));
    return null;
  }),
}));
jest.mock('../ui/components', () => {
  const React = require('react');
  const { View, Text, Pressable } = require('react-native');
  return {
    Screen: ({ children, title }: { children: ReactNode; title: string }) => (
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
        disabled={disabled}
        onPress={onPress}
      >
        <Text>{text}</Text>
      </Pressable>
    ),
  };
});
const scope = { owner: 'nuni:pa-a', schoolId: 'pu' };
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockFileText.mockReset();
  mockDocumentRead.mockReset();
  mockDocumentCancel.mockReset();
  jest.mocked(DocumentPicker.getDocumentAsync).mockReset();
  jest.mocked(sharePersonalImportBackup).mockReset();
  jest.mocked(runMobilePersonalImportAi).mockReset();
  mockAiAvailability = {
    status: 'missing',
    title: '先啟用一個本機模型',
    detail: '模型免費，首次需自行下載。',
  };
  mockScope = { ...scope };
  mockPlatform = {
    session: null,
    loading: false,
    pendingLogout: false,
    error: '',
    refresh: jest.fn(),
    signIn: jest.fn(),
    logout: jest.fn(),
    request: mockRequest,
  };
});

function sampleWorkbook(): PersonalImportDocument {
  return {
    format: 'xlsx',
    name: 'grades.xlsx',
    warnings: ['含兩個工作表，請自行選取。'],
    sections: [
      {
        id: 'sheet-a',
        label: '上學期',
        needsOcr: false,
        warnings: [],
        rows: [
          { line: 1, cells: ['備註', '略過'] },
          { line: 2, cells: ['課程名稱', '學分', '成績'] },
          { line: 3, cells: ['微積分', '3', 'A-'] },
        ],
      },
      {
        id: 'sheet-b',
        label: '下學期',
        needsOcr: false,
        warnings: [],
        rows: [
          { line: 1, cells: ['課程名稱', '學分', '成績'] },
          { line: 2, cells: ['英文', '2', 'B+'] },
        ],
      },
      {
        id: 'sheet-scan',
        label: '掃描頁',
        needsOcr: true,
        warnings: ['此頁為影像，無文字層。'],
        rows: [],
      },
    ],
  };
}

function chooseDocument(
  document: PersonalImportDocument,
  file: { name: string; size?: number; mimeType?: string } = {
    name: document.name,
    size: 2048,
    mimeType:
      document.format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
) {
  mockDocumentRead.mockResolvedValue(document);
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: `file:///${file.name}`,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
      },
    ],
  });
}
function fill(
  view: ReturnType<typeof render>,
  kind: 'grades' | 'events' | 'timetable',
  content: string,
) {
  if (kind !== 'timetable')
    fireEvent.press(view.getByText(kind === 'grades' ? '成績與學分' : '行事曆'));
  fireEvent.changeText(view.getByLabelText('這批資料的學年度（例如 115）'), '115');
  fireEvent.changeText(view.getByLabelText('這批資料的學期（例如 1、2、暑期）'), '1');
  fireEvent.changeText(view.getByLabelText('貼上或修正原始文字'), content);
  fireEvent.press(view.getByText('整理成可編輯資料'));
}

test.each([
  ['timetable', '課程名稱,星期,節次,老師\n微積分,星期一,1-2,王老師'],
  ['grades', '課程名稱,學分,成績\n微積分,3,A-'],
  ['events', '活動名稱,日期,全天\n校慶,2026-10-20,是'],
] as const)(
  '%s preview requires confirmation and saves a visible personal record',
  async (kind, content) => {
    const view = render(<PersonalImportScreen />);
    await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
    fill(view, kind, content);
    expect(view.getByText(personalImportPreviewNotice(1))).toBeTruthy();
    expect((await loadPersonalImports(scope)).records).toHaveLength(0);
    fireEvent.press(view.getByText('確認新增 1 筆'));
    await waitFor(() => expect(view.getByText(personalImportSavedNotice(1))).toBeTruthy());
    expect((await loadPersonalImports(scope)).records[0].kind).toBe(kind);
    fireEvent.press(view.getByText('撤銷上次匯入'));
    expect(view.getByText(personalImportUndoBody(1))).toBeTruthy();
    fireEvent.press(view.getByText('撤銷'));
    await waitFor(() => expect(view.getByText(personalImportUndoneNotice(1))).toBeTruthy());
    expect((await loadPersonalImports(scope)).records).toHaveLength(0);
  },
);

test('with sync enabled, saving only reports the local add', async () => {
  await AsyncStorage.setItem(
    personalImportStorageKey(scope),
    JSON.stringify({ version: 1, records: [], batches: [], sync: { enabled: true, base: null } }),
  );
  const view = render(<PersonalImportScreen />);
  await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
  fill(view, 'grades', '課程名稱,學分,成績\n微積分,3,A-');
  fireEvent.press(view.getByText('確認新增 1 筆'));
  await waitFor(() => expect(view.getByText(personalImportSavedNotice(1, true))).toBeTruthy());
  expect(view.queryByText(/資料只存在這台裝置/)).toBeNull();
  expect(view.queryByText(/還沒同步到你的帳號，同步狀態請看下方/)).toBeNull();
});

test('unknown columns and incomplete CSV cannot silently bypass preview errors', async () => {
  const view = render(<PersonalImportScreen />);
  await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
  fill(view, 'grades', '課程名稱,學分,成績\n微積分,3,90,未對應資料');
  expect(view.getByText('確認新增 1 筆')).toBeTruthy();
  fireEvent.press(view.getByText('確認新增 1 筆'));
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
  expect(
    view.getByText('來源格式還有問題，請修正原文後重新整理，或取消勾選有問題的資料。'),
  ).toBeTruthy();
});

test('account refresh hides drafts and restores them only for the same account', async () => {
  const view = render(<PersonalImportScreen />);
  fireEvent.changeText(view.getByLabelText('貼上或修正原始文字'), '自己的課表文字');
  mockScope = null;
  mockPlatform = { ...mockPlatform, loading: true };
  view.rerender(<PersonalImportScreen />);
  expect(view.queryByDisplayValue('自己的課表文字')).toBeNull();
  mockScope = { ...scope };
  mockPlatform = { ...mockPlatform, loading: false };
  view.rerender(<PersonalImportScreen />);
  expect(view.getByDisplayValue('自己的課表文字')).toBeTruthy();
  mockScope = { ...scope, owner: 'nuni:pa-b' };
  view.rerender(<PersonalImportScreen />);
  expect(view.queryByDisplayValue('自己的課表文字')).toBeNull();
  await act(async () => {});
});

test('an OCR response arriving after cancellation cannot replace typed input', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///shot.png', width: 100, height: 100, mimeType: 'image/png' }],
  });
  let resolve: (value: string) => void = () => {};
  mockRecognize.mockImplementation(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  const view = render(<PersonalImportScreen />);
  fireEvent.press(view.getByText('選擇截圖'));
  await waitFor(() => expect(mockRecognize).toHaveBeenCalled());
  fireEvent.press(view.getByText('取消讀取'));
  fireEvent.changeText(view.getByLabelText('貼上或修正原始文字'), '取消後的新文字');
  await act(async () => {
    resolve('舊圖辨識結果');
  });
  expect(view.getByDisplayValue('取消後的新文字')).toBeTruthy();
  expect(view.queryByDisplayValue('舊圖辨識結果')).toBeNull();
});

test('recurring ICS stays blocked even when its first event has valid editable fields', async () => {
  const view = render(<PersonalImportScreen />);
  await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
  fill(
    view,
    'events',
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:repeat-1',
      'SUMMARY:每週會議',
      'DTSTART;TZID=Asia/Taipei:20261020T180000',
      'DTEND;TZID=Asia/Taipei:20261020T190000',
      'RRULE:FREQ=WEEKLY',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n'),
  );
  fireEvent.press(view.getByText('確認新增 1 筆'));
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
  expect(
    view.getByText('來源格式還有問題，請修正原文後重新整理，或取消勾選有問題的資料。'),
  ).toBeTruthy();
});

test('class link is explicitly selected from the accessible workspace list without a membership write', async () => {
  const workspace = {
    id: 'cw_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    title: '微積分甲班',
    memberRole: 'student',
    state: 'active',
  };
  mockPlatform = {
    ...mockPlatform,
    session: {
      platformAccountId: 'pa_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      context: 'session-1',
      isPlatformOperator: false,
    },
  };
  mockRequest.mockResolvedValue({ workspaces: [workspace] });
  const view = render(<PersonalImportScreen />);
  fill(view, 'grades', '課程名稱,學分,成績\n微積分,3,A-');
  await waitFor(() => expect(view.getByText('微積分甲班（學生）')).toBeTruthy());
  fireEvent.press(view.getByText('微積分甲班（學生）'));
  fireEvent.press(view.getByText('確認新增 1 筆'));
  await waitFor(() => expect(view.getByText(personalImportSavedNotice(1))).toBeTruthy());
  expect((await loadPersonalImports(scope)).records[0].linkedCourseId).toBe(workspace.id);
  expect(
    mockRequest.mock.calls.every(
      ([path, , input]) => path === 'class-workspaces' && input === undefined,
    ),
  ).toBe(true);
});

test('correcting screenshot text preserves space-delimited table parsing', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///grades.png', width: 100, height: 100, mimeType: 'image/png' }],
  });
  mockRecognize.mockResolvedValue('課程名稱  學分  成績\n微積分  3  85');
  const view = render(<PersonalImportScreen />);
  fireEvent.press(view.getByText('成績與學分'));
  fireEvent.changeText(view.getByLabelText('這批資料的學年度（例如 115）'), '115');
  fireEvent.changeText(view.getByLabelText('這批資料的學期（例如 1、2、暑期）'), '1');
  fireEvent.press(view.getByText('選擇截圖'));
  await waitFor(() =>
    expect(view.getByDisplayValue('課程名稱  學分  成績\n微積分  3  85')).toBeTruthy(),
  );
  fireEvent.changeText(
    view.getByLabelText('貼上或修正原始文字'),
    '課程名稱  學分  成績\n微積分  3  90',
  );
  fireEvent.press(view.getByText('整理成可編輯資料'));
  fireEvent.press(view.getByText('確認新增 1 筆'));
  await waitFor(() => expect(view.getByText(personalImportSavedNotice(1))).toBeTruthy());
  expect((await loadPersonalImports(scope)).records[0]).toMatchObject({
    title: '微積分',
    credits: 3,
    grade: '90',
    source: { type: 'screenshot' },
  });
});

test('starts new pasted data without inheriting the previous screenshot source', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: 'file:///grades.png',
        width: 100,
        height: 100,
        mimeType: 'image/png',
        fileName: 'grades.png',
      },
    ],
  });
  mockRecognize.mockResolvedValue('課程名稱,學分,成績\n資料庫,3,85');
  const view = render(<PersonalImportScreen />);
  await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
  fireEvent.press(view.getByText('成績與學分'));
  fireEvent.changeText(view.getByLabelText('這批資料的學年度（例如 115）'), '115');
  fireEvent.changeText(view.getByLabelText('這批資料的學期（例如 1、2、暑期）'), '1');
  fireEvent.press(view.getByText('選擇截圖'));
  await waitFor(() =>
    expect(view.getByDisplayValue('課程名稱,學分,成績\n資料庫,3,85')).toBeTruthy(),
  );
  fireEvent.press(view.getByText('整理成可編輯資料'));
  fireEvent.press(view.getByText('確認新增 1 筆'));
  await waitFor(() => expect(view.getByText(personalImportSavedNotice(1))).toBeTruthy());
  fireEvent.changeText(view.getByLabelText('貼上或修正原始文字'), '課程名稱,學分,成績\n英文,2,90');
  fireEvent.press(view.getByText('整理成可編輯資料'));
  fireEvent.press(view.getByText('確認新增 1 筆'));
  await waitFor(async () => expect((await loadPersonalImports(scope)).records).toHaveLength(2));
  const records = (await loadPersonalImports(scope)).records;
  expect(records[0].source).toMatchObject({ type: 'screenshot', name: 'grades.png' });
  expect(records[1].source).toMatchObject({ type: 'paste' });
  expect(records[1].source.name).toBeUndefined();
});

test('asks before undoing and keeps records when the person chooses not to', async () => {
  const view = render(<PersonalImportScreen />);
  await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
  fill(view, 'grades', '課程名稱,學分,成績\n微積分,3,A-');
  fireEvent.press(view.getByText('確認新增 1 筆'));
  await waitFor(() => expect(view.getByText(personalImportSavedNotice(1))).toBeTruthy());
  fireEvent.press(view.getByText('撤銷上次匯入'));
  expect(view.getByText('撤銷上次匯入？')).toBeTruthy();
  expect(view.getByText(personalImportUndoBody(1))).toBeTruthy();
  fireEvent.press(view.getByText('先不要'));
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);
  expect(view.queryByText('撤銷上次匯入？')).toBeNull();
});

test('shows a Chinese notice when the screenshot file cannot be opened', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///broken.png', width: 100, height: 100, mimeType: 'image/png' }],
  });
  mockRecognize.mockRejectedValue(new Error('The source image could not be decoded.'));
  const view = render(<PersonalImportScreen />);
  fireEvent.press(view.getByText('選擇截圖'));
  await waitFor(() => expect(view.getByText(PERSONAL_IMPORT_IMAGE_UNREADABLE)).toBeTruthy());
  expect(view.queryByText(/could not be decoded/i)).toBeNull();
});

const backupGrade = (): PersonalImportRecord => ({
  id: 'old-grade',
  batchId: 'old-batch',
  importedAt: '2026-10-13T00:00:00.000Z',
  kind: 'grades',
  title: '備份英文',
  schoolId: 'pu',
  academicYear: '114',
  semester: '2',
  credits: 3,
  grade: 'A-',
  linkedCourseId: 'cw_12345678-1234-1234-1234-123456789abc',
  source: { type: 'screenshot', name: '舊成績截圖.png', line: 3, rawText: '英文 3 A-' },
});
function chooseBackup(records: PersonalImportRecord[] = [backupGrade()]) {
  mockFileText.mockResolvedValue(
    serializePersonalImportBackup(records, { schoolId: records[0]?.schoolId || 'pu' }),
  );
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: 'file:///backup.json',
        name: 'backup.json',
        size: 1000,
        mimeType: 'application/json',
      },
    ],
  });
}

test('backup restores mixed kinds and terms only after review without activating archive links', async () => {
  const grade = backupGrade();
  chooseBackup([
    grade,
    {
      ...grade,
      id: 'old-course',
      kind: 'timetable',
      title: '備份課表',
      academicYear: '115',
      semester: '1',
      dayOfWeek: 1,
      startPeriod: 3,
      endPeriod: 4,
    },
    {
      ...grade,
      id: 'old-event',
      kind: 'events',
      title: '備份校慶',
      academicYear: '',
      semester: '',
      date: '2026-10-24',
      allDay: true,
    },
  ]);
  const view = render(<PersonalImportScreen />);
  fireEvent.press(view.getByText('從備份檔還原'));
  await waitFor(() => expect(view.getByText('確認新增 3 筆')).toBeTruthy());
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
  expect(view.getByText(/目的地：目前登入的平台帳號/)).toBeTruthy();
  fireEvent.press(view.getByText('確認新增 3 筆'));
  await waitFor(() => expect(view.getByText(personalImportSavedNotice(3))).toBeTruthy());
  const saved = (await loadPersonalImports(scope)).records;
  expect(saved.map((row) => row.kind).sort()).toEqual(['events', 'grades', 'timetable']);
  expect(saved.find((row) => row.kind === 'grades')).toMatchObject({
    academicYear: '114',
    semester: '2',
    source: grade.source,
  });
  expect(saved.every((row) => !row.linkedCourseId && row.batchId !== 'old-batch')).toBe(true);
  expect(mockRequest).not.toHaveBeenCalled();
});

test('wrong-school backup is rejected without changing the current ledger', async () => {
  chooseBackup([{ ...backupGrade(), schoolId: 'ntu' }]);
  const view = render(<PersonalImportScreen />);
  fireEvent.press(view.getByText('從備份檔還原'));
  await waitFor(() => expect(view.getByText(/與目前學校不同/)).toBeTruthy());
  expect(view.queryByText('確認新增 1 筆')).toBeNull();
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
});

test('late backup file result cannot populate another account preview', async () => {
  chooseBackup();
  let resolve!: (text: string) => void;
  mockFileText.mockReturnValue(
    new Promise<string>((done) => {
      resolve = done;
    }),
  );
  const view = render(<PersonalImportScreen />);
  fireEvent.press(view.getByText('從備份檔還原'));
  await waitFor(() => expect(mockFileText).toHaveBeenCalled());
  mockScope = { ...scope, owner: 'nuni:pa-b' };
  view.rerender(<PersonalImportScreen />);
  await act(async () => {
    resolve(serializePersonalImportBackup([backupGrade()], { schoolId: 'pu' }));
  });
  expect(view.queryByText('確認新增 1 筆')).toBeNull();
  expect(view.queryByText('備份英文')).toBeNull();
});

test('backup sharing failure is shown without claiming that a file was saved', async () => {
  chooseBackup();
  const view = render(<PersonalImportScreen />);
  fireEvent.press(view.getByText('從備份檔還原'));
  await waitFor(() => expect(view.getByText('確認新增 1 筆')).toBeTruthy());
  fireEvent.press(view.getByText('確認新增 1 筆'));
  await waitFor(() => expect(view.getByText(personalImportSavedNotice(1))).toBeTruthy());
  jest.mocked(sharePersonalImportBackup).mockRejectedValue(new Error('分享未完成'));
  fireEvent.press(view.getByText('備份全部個人資料'));
  await waitFor(() => expect(view.getByText('分享未完成')).toBeTruthy());
  expect(view.queryByText(/^已開啟系統分享選單/)).toBeNull();
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);
});

test('record deletion requires confirmation naming that record', async () => {
  chooseBackup();
  const view = render(<PersonalImportScreen route={{ params: { kind: 'grades' } }} />);
  fireEvent.press(view.getByText('從備份檔還原'));
  await waitFor(() => expect(view.getByText('確認新增 1 筆')).toBeTruthy());
  fireEvent.press(view.getByText('確認新增 1 筆'));
  await waitFor(() => expect(view.getByText('編輯 備份英文')).toBeTruthy());
  fireEvent.press(view.getByText('移除這筆'));
  expect(view.getByText(/確定移除「備份英文」/)).toBeTruthy();
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);
  fireEvent.press(view.getByText('確認移除'));
  await waitFor(() =>
    expect(view.getByText('已移除這筆個人紀錄；其他紀錄不受影響。')).toBeTruthy(),
  );
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
});

test('file picker accepts PDF, XLSX and TSV types without reading binary via text()', async () => {
  chooseDocument(sampleWorkbook());
  const view = render(<PersonalImportScreen />);
  await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
  fireEvent.press(view.getByText('選擇檔案'));
  await waitFor(() => expect(mockDocumentRead).toHaveBeenCalled());
  expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      type: expect.arrayContaining([
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/tab-separated-values',
      ]),
    }),
  );
  expect(mockDocumentRead).toHaveBeenCalledWith(
    expect.objectContaining({ uri: 'file:///grades.xlsx', name: 'grades.xlsx' }),
    expect.any(AbortSignal),
  );
  expect(mockFileText).not.toHaveBeenCalled();
  await waitFor(() => expect(view.getByText('準備讀取：grades.xlsx')).toBeTruthy());
  expect(view.queryByText('確認新增 1 筆')).toBeNull();
});

test('mixed sheet selection with distinct header rows builds a draft only after confirm', async () => {
  chooseDocument(sampleWorkbook());
  const view = render(<PersonalImportScreen />);
  await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
  fireEvent.press(view.getByText('成績與學分'));
  fireEvent.changeText(view.getByLabelText('這批資料的學年度（例如 115）'), '115');
  fireEvent.changeText(view.getByLabelText('這批資料的學期（例如 1、2、暑期）'), '1');
  fireEvent.press(view.getByText('選擇檔案'));
  await waitFor(() => expect(view.getByText('□ 上學期')).toBeTruthy());
  expect(
    view.getByRole('button', { name: '讀取選取內容' }).props.accessibilityState?.disabled,
  ).toBe(true);
  fireEvent.press(view.getByText('□ 上學期'));
  fireEvent.press(view.getByText('第 2 列'));
  fireEvent.press(view.getByText('□ 下學期'));
  expect(view.getByText(/掃描頁（無文字，需截圖）/)).toBeTruthy();
  fireEvent.press(view.getByText('讀取選取內容'));
  await waitFor(() => expect(view.getByText('確認新增 2 筆')).toBeTruthy());
  expect(view.getByText(personalImportPreviewNotice(2))).toBeTruthy();
  expect(view.getByDisplayValue('微積分')).toBeTruthy();
  expect(view.getByText(/英文/)).toBeTruthy();
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
  fireEvent.press(view.getByText('確認新增 2 筆'));
  await waitFor(() => expect(view.getByText(personalImportSavedNotice(2))).toBeTruthy());
  const saved = (await loadPersonalImports(scope)).records;
  expect(saved).toHaveLength(2);
  expect(saved.map((row) => row.title).sort()).toEqual(['微積分', '英文']);
  expect(saved.every((row) => row.source.type === 'file')).toBe(true);
});

test('cancelling document preparation keeps the prior editable draft', async () => {
  chooseDocument(sampleWorkbook());
  const view = render(<PersonalImportScreen />);
  await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
  fireEvent.press(view.getByText('成績與學分'));
  fireEvent.changeText(view.getByLabelText('這批資料的學年度（例如 115）'), '115');
  fireEvent.changeText(view.getByLabelText('這批資料的學期（例如 1、2、暑期）'), '1');
  fireEvent.changeText(
    view.getByLabelText('貼上或修正原始文字'),
    '課程名稱,學分,成績\n保留草稿,3,A',
  );
  fireEvent.press(view.getByText('整理成可編輯資料'));
  expect(view.getByText('確認新增 1 筆')).toBeTruthy();
  fireEvent.press(view.getByText('選擇檔案'));
  await waitFor(() => expect(view.getByText('準備讀取：grades.xlsx')).toBeTruthy());
  expect(view.queryByText('確認新增 1 筆')).toBeNull();
  fireEvent.press(view.getByText('取消，回到先前草稿'));
  expect(view.getByText('確認新增 1 筆')).toBeTruthy();
  expect(view.getByDisplayValue('保留草稿')).toBeTruthy();
  expect(view.getByText('已取消文件準備，先前草稿保留。')).toBeTruthy();
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
});

test('late document read after account switch cannot leave a stale prep draft', async () => {
  const document = sampleWorkbook();
  let resolve!: (value: PersonalImportDocument) => void;
  mockDocumentRead.mockReturnValue(
    new Promise<PersonalImportDocument>((done) => {
      resolve = done;
    }),
  );
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: 'file:///grades.xlsx',
        name: 'grades.xlsx',
        size: 2048,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ],
  });
  const view = render(<PersonalImportScreen />);
  fireEvent.press(view.getByText('選擇檔案'));
  await waitFor(() => expect(mockDocumentRead).toHaveBeenCalled());
  mockScope = { ...scope, owner: 'nuni:pa-b' };
  view.rerender(<PersonalImportScreen />);
  await act(async () => {
    resolve(document);
  });
  expect(view.queryByText('準備讀取：grades.xlsx')).toBeNull();
  expect(view.queryByText('確認新增 1 筆')).toBeNull();
});

test('document errors stay Chinese and scan pages are not treated as readable text', async () => {
  mockDocumentRead.mockRejectedValue(new Error('此 PDF 已加密，請先解除密碼保護。'));
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: 'file:///locked.pdf',
        name: 'locked.pdf',
        size: 4096,
        mimeType: 'application/pdf',
      },
    ],
  });
  const view = render(<PersonalImportScreen />);
  fireEvent.press(view.getByText('選擇檔案'));
  await waitFor(() => expect(view.getByText('此 PDF 已加密，請先解除密碼保護。')).toBeTruthy());
  expect(view.queryByText('準備讀取：locked.pdf')).toBeNull();

  chooseDocument({
    format: 'pdf',
    name: 'scan.pdf',
    warnings: [],
    sections: [
      {
        id: 'page-1',
        label: '第 1 頁',
        needsOcr: true,
        warnings: [],
        rows: [],
      },
    ],
  });
  fireEvent.press(view.getByText('選擇檔案'));
  await waitFor(() => expect(view.getByText('準備讀取：scan.pdf')).toBeTruthy());
  expect(view.getByText(/這個檔案沒有可讀取的文字頁。掃描 PDF 請改用「選擇截圖」/)).toBeTruthy();
  expect(
    view.getByRole('button', { name: '讀取選取內容' }).props.accessibilityState?.disabled,
  ).toBe(true);
  expect(view.queryByText(/已讀取 \d+ 個選取範圍/)).toBeNull();
});

test('oversize PDF is rejected before the native document host runs', async () => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: 'file:///huge.pdf',
        name: 'huge.pdf',
        size: 8 * 1024 * 1024 + 1,
        mimeType: 'application/pdf',
      },
    ],
  });
  const view = render(<PersonalImportScreen />);
  fireEvent.press(view.getByText('選擇檔案'));
  await waitFor(() =>
    expect(view.getByText('PDF／Excel 上限 8 MiB，請拆成較小的檔案。')).toBeTruthy(),
  );
  expect(mockDocumentRead).not.toHaveBeenCalled();
  expect(mockFileText).not.toHaveBeenCalled();
});

function gradeSection(id: string, label: string, count: number) {
  return {
    id,
    label,
    needsOcr: false,
    warnings: [],
    rows: [
      { line: 1, cells: ['課程名稱', '學分', '成績'] },
      ...Array.from({ length: count }, (_, index) => ({
        line: index + 2,
        cells: [`課${id}-${index}`, '2', 'A'],
      })),
    ],
  };
}

test('total rows across all chosen sections are capped; nothing is imported or truncated', async () => {
  chooseDocument({
    format: 'xlsx',
    name: 'many.xlsx',
    warnings: [],
    sections: [gradeSection('a', '上學期', 300), gradeSection('b', '下學期', 300)],
  });
  const view = render(<PersonalImportScreen />);
  await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
  fireEvent.press(view.getByText('成績與學分'));
  fireEvent.changeText(view.getByLabelText('這批資料的學年度（例如 115）'), '115');
  fireEvent.changeText(view.getByLabelText('這批資料的學期（例如 1、2、暑期）'), '1');
  fireEvent.press(view.getByText('選擇檔案'));
  await waitFor(() => expect(view.getByText('□ 上學期')).toBeTruthy());
  fireEvent.press(view.getByText('□ 上學期'));
  fireEvent.press(view.getByText('□ 下學期'));
  fireEvent.press(view.getByText('讀取選取內容'));
  await waitFor(() =>
    expect(view.getByText('選取的內容超過 500 筆，請減少工作表或頁面，分次匯入。')).toBeTruthy(),
  );
  expect(view.getByText('準備讀取：many.xlsx')).toBeTruthy();
  expect(view.queryByText('確認新增')).toBeNull();
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
});

test('PDF full-page reread wires pdfMode ocr and keeps preview on cancel or failure', async () => {
  const autoDoc: PersonalImportDocument = {
    format: 'pdf',
    name: 'hybrid.pdf',
    warnings: [],
    sections: [
      {
        id: 'page-1',
        label: '第 1 頁',
        needsOcr: false,
        warnings: [],
        rows: [
          { line: 1, cells: ['課程名稱', '學分', '成績'] },
          { line: 2, cells: ['微積分', '3', 'A'] },
        ],
      },
    ],
  };
  const ocrDoc: PersonalImportDocument = {
    ...autoDoc,
    sections: [
      {
        ...autoDoc.sections[0],
        rows: [
          { line: 1, cells: ['課程名稱', '學分', '成績'] },
          { line: 2, cells: ['微積分', '3', 'A'] },
          { line: 3, cells: ['英文', '2', 'B'] },
        ],
      },
    ],
  };
  chooseDocument(autoDoc, { name: 'hybrid.pdf', size: 4096, mimeType: 'application/pdf' });
  const view = render(<PersonalImportScreen />);
  fireEvent.press(view.getByText('成績與學分'));
  fireEvent.changeText(view.getByLabelText('這批資料的學年度（例如 115）'), '115');
  fireEvent.changeText(view.getByLabelText('這批資料的學期（例如 1、2、暑期）'), '1');
  fireEvent.press(view.getByText('選擇檔案'));
  await waitFor(() => expect(view.getByText('準備讀取：hybrid.pdf')).toBeTruthy());
  expect(mockDocumentRead).toHaveBeenCalledWith(
    expect.objectContaining({ uri: 'file:///hybrid.pdf', name: 'hybrid.pdf' }),
    expect.any(AbortSignal),
  );
  expect(view.getByText('重新辨識 PDF 整頁')).toBeTruthy();

  let resolveOcr!: (value: PersonalImportDocument) => void;
  mockDocumentRead.mockReturnValueOnce(
    new Promise<PersonalImportDocument>((done) => {
      resolveOcr = done;
    }),
  );
  fireEvent.press(view.getByText('重新辨識 PDF 整頁'));
  await waitFor(() =>
    expect(mockDocumentRead).toHaveBeenLastCalledWith(
      expect.objectContaining({ uri: 'file:///hybrid.pdf', name: 'hybrid.pdf' }),
      expect.any(AbortSignal),
      { pdfMode: 'ocr' },
    ),
  );
  expect(
    view.getByRole('button', { name: '讀取選取內容' }).props.accessibilityState?.disabled,
  ).toBe(true);
  fireEvent.press(view.getByText('取消讀取'));
  await act(async () => {
    resolveOcr(ocrDoc);
  });
  expect(view.getByText('準備讀取：hybrid.pdf')).toBeTruthy();
  expect(view.queryByText('已重新辨識整頁')).toBeNull();

  mockDocumentRead.mockRejectedValueOnce(new Error('辨識引擎暫時無法使用。'));
  fireEvent.press(view.getByText('重新辨識 PDF 整頁'));
  await waitFor(() => expect(view.getByText('辨識引擎暫時無法使用。')).toBeTruthy());
  expect(view.getByText('準備讀取：hybrid.pdf')).toBeTruthy();

  mockDocumentRead.mockResolvedValueOnce(ocrDoc);
  fireEvent.press(view.getByText('重新辨識 PDF 整頁'));
  await waitFor(() => expect(view.getByText(/已重新辨識整頁/)).toBeTruthy());
  fireEvent.press(view.getByText('□ 第 1 頁'));
  fireEvent.press(view.getByText('讀取選取內容'));
  await waitFor(() => expect(view.getByText('確認新增 2 筆')).toBeTruthy());
});

test('late PDF reread after account switch cannot replace the scoped document prep', async () => {
  const autoDoc: PersonalImportDocument = {
    format: 'pdf',
    name: 'scoped.pdf',
    warnings: [],
    sections: [
      {
        id: 'page-1',
        label: '第 1 頁',
        needsOcr: false,
        warnings: [],
        rows: [
          { line: 1, cells: ['課程名稱', '學分', '成績'] },
          { line: 2, cells: ['微積分', '3', 'A'] },
        ],
      },
    ],
  };
  chooseDocument(autoDoc, { name: 'scoped.pdf', size: 2048, mimeType: 'application/pdf' });
  const view = render(<PersonalImportScreen />);
  fireEvent.press(view.getByText('選擇檔案'));
  await waitFor(() => expect(view.getByText('準備讀取：scoped.pdf')).toBeTruthy());
  let resolveOcr!: (value: PersonalImportDocument) => void;
  mockDocumentRead.mockReturnValueOnce(
    new Promise<PersonalImportDocument>((done) => {
      resolveOcr = done;
    }),
  );
  fireEvent.press(view.getByText('重新辨識 PDF 整頁'));
  await waitFor(() =>
    expect(mockDocumentRead).toHaveBeenLastCalledWith(expect.anything(), expect.any(AbortSignal), {
      pdfMode: 'ocr',
    }),
  );
  mockScope = { ...scope, owner: 'nuni:pa-b' };
  view.rerender(<PersonalImportScreen />);
  await act(async () => {
    resolveOcr({
      ...autoDoc,
      name: 'scoped.pdf',
      sections: [
        {
          ...autoDoc.sections[0],
          rows: [
            { line: 1, cells: ['課程名稱', '學分', '成績'] },
            { line: 2, cells: ['不該出現', '3', 'A'] },
          ],
        },
      ],
    });
  });
  expect(view.queryByText('準備讀取：scoped.pdf')).toBeNull();
  expect(view.queryByText('不該出現')).toBeNull();
  expect(view.queryByText(/已重新辨識整頁/)).toBeNull();
});

test.each([
  ['pu', '目前使用靜宜大學 13 節'],
  ['ncku', '目前使用國立成功大學 15 節'],
  ['ntpu', '目前使用國立臺北大學 13 節'],
] as const)(
  'timetable copy follows school period profile for %s without inventing enrollments',
  async (schoolId, banner) => {
    mockScope = { owner: scope.owner, schoolId };
    const view = render(<PersonalImportScreen />);
    await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
    expect(view.getByText(new RegExp(banner))).toBeTruthy();
    expect(view.queryByText(/自動加入|自動註冊|已完成教師核對/)).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
  },
);

test('unknown school keeps raw times and still does not contact course access', async () => {
  mockScope = { owner: scope.owner, schoolId: 'unknown-school' };
  const view = render(<PersonalImportScreen />);
  await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
  expect(view.getByText(/這所學校尚未設定課表格線，請保留原始時間/)).toBeTruthy();
  expect(view.queryByText(/目前使用/)).toBeNull();
  expect(mockRequest).not.toHaveBeenCalled();
});

test('native saved school HTML tables enter editable review rather than saving immediately', async () => {
  const html =
    '<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>' +
    '<tr><td>離散數學</td><td>3</td><td>92</td></tr></table>';
  mockFileText.mockResolvedValue(html);
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [
      { uri: 'file:///grades.html', name: 'grades.html', size: html.length, mimeType: 'text/html' },
    ],
  });
  const view = render(<PersonalImportScreen />);
  await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
  fireEvent.press(view.getByText('成績與學分'));
  fireEvent.changeText(view.getByLabelText('這批資料的學年度（例如 115）'), '115');
  fireEvent.changeText(view.getByLabelText('這批資料的學期（例如 1、2、暑期）'), '1');
  fireEvent.press(view.getByText('選擇檔案'));
  expect(await view.findByText('選擇校務網頁表格')).toBeTruthy();
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
  fireEvent.press(view.getByText(/表格 1 · 1 筆/));
  expect(view.getByLabelText('貼上或修正原始文字').props.value).toContain('離散數學');
  fireEvent.press(view.getByText('整理成可編輯資料'));
  expect(view.getByText(personalImportPreviewNotice(1))).toBeTruthy();
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
});

const aiSource = '資料庫，學分 3，成績 85';
function aiResult() {
  return parsePersonalImportAiResponse(
    JSON.stringify({
      complete: true,
      rows: [{ title: '資料庫', credits: 3, grade: '85', evidence: aiSource }],
    }),
    aiSource,
    { kind: 'grades', schoolId: 'pu', academicYear: '115', semester: '1' },
  );
}
function prepareAi(view: ReturnType<typeof render>) {
  fireEvent.press(view.getByText('成績與學分'));
  fireEvent.changeText(view.getByLabelText('這批資料的學年度（例如 115）'), '115');
  fireEvent.changeText(view.getByLabelText('這批資料的學期（例如 1、2、暑期）'), '1');
  fireEvent.changeText(view.getByLabelText('貼上或修正原始文字'), aiSource);
}
function readyAi() {
  mockAiAvailability = {
    status: 'ready',
    title: '本機 AI 已就緒',
    detail: '使用已啟用的 Qwen2.5 模型。',
  };
}

test('AI results remain drafts until source review and explicit save', async () => {
  readyAi();
  jest.mocked(runMobilePersonalImportAi).mockResolvedValue(aiResult());
  const view = render(<PersonalImportScreen />);
  await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
  prepareAi(view);
  expect(runMobilePersonalImportAi).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('用 AI 整理文字'));
  await view.findByLabelText('已逐筆核對 AI 結果');
  expect(view.getByText(aiSource)).toBeTruthy();
  expect(jest.mocked(runMobilePersonalImportAi).mock.calls[0][1]).toMatchObject({
    kind: 'grades',
    schoolId: 'pu',
    academicYear: '115',
    semester: '1',
  });
  fireEvent.press(view.getByText('確認新增 1 筆'));
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
  fireEvent.press(view.getByLabelText('已逐筆核對 AI 結果'));
  fireEvent.press(view.getByText('確認新增 1 筆'));
  await waitFor(async () => expect((await loadPersonalImports(scope)).records).toHaveLength(1));
});

test('editing an AI field or changing selection requires a new acknowledgement', async () => {
  readyAi();
  jest.mocked(runMobilePersonalImportAi).mockResolvedValue(aiResult());
  const view = render(<PersonalImportScreen />);
  await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
  prepareAi(view);
  fireEvent.press(view.getByText('用 AI 整理文字'));
  await view.findByLabelText('已逐筆核對 AI 結果');
  fireEvent.press(view.getByLabelText('已逐筆核對 AI 結果'));
  fireEvent.press(view.getByText('編輯與連結課班'));
  fireEvent.changeText(view.getByLabelText('成績'), '90');
  expect(view.getByLabelText('已逐筆核對 AI 結果').props.accessibilityState.checked).toBe(false);
  fireEvent.press(view.getByLabelText('已逐筆核對 AI 結果'));
  fireEvent.press(view.getByLabelText('匯入 資料庫'));
  fireEvent.press(view.getByLabelText('匯入 資料庫'));
  expect(view.getByLabelText('已逐筆核對 AI 結果').props.accessibilityState.checked).toBe(false);
  fireEvent.press(view.getByText('確認新增 1 筆'));
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
});

test('an AI failure preserves the original text and offers the existing parser', async () => {
  readyAi();
  jest
    .mocked(runMobilePersonalImportAi)
    .mockRejectedValue(new Error('native error contains private source'));
  const view = render(<PersonalImportScreen />);
  prepareAi(view);
  fireEvent.press(view.getByText('用 AI 整理文字'));
  await view.findByText(/AI 未能完成這次整理/);
  expect(view.getByLabelText('貼上或修正原始文字').props.value).toBe(aiSource);
  expect(view.queryByText(/native error/)).toBeNull();
  expect(view.getByText('整理成可編輯資料')).toBeTruthy();
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
});

test('cancelled AI output cannot replace subsequently typed text', async () => {
  readyAi();
  let finish!: (value: ReturnType<typeof aiResult>) => void;
  jest.mocked(runMobilePersonalImportAi).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<PersonalImportScreen />);
  prepareAi(view);
  fireEvent.press(view.getByText('用 AI 整理文字'));
  fireEvent.press(view.getByText('取消 AI 整理'));
  expect(jest.mocked(runMobilePersonalImportAi).mock.calls[0][2].aborted).toBe(true);
  fireEvent.changeText(view.getByLabelText('貼上或修正原始文字'), '新的內容');
  await act(async () => finish(aiResult()));
  expect(view.getByLabelText('貼上或修正原始文字').props.value).toBe('新的內容');
  expect(view.queryByLabelText('已逐筆核對 AI 結果')).toBeNull();
});

test.each(['學年度', '學期'])(
  'changing %s during AI generation cancels the stale result',
  async (field) => {
    readyAi();
    let finish!: (value: ReturnType<typeof aiResult>) => void;
    jest.mocked(runMobilePersonalImportAi).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<PersonalImportScreen />);
    prepareAi(view);
    fireEvent.press(view.getByText('用 AI 整理文字'));
    fireEvent.changeText(
      view.getByLabelText(
        field === '學年度' ? '這批資料的學年度（例如 115）' : '這批資料的學期（例如 1、2、暑期）',
      ),
      field === '學年度' ? '116' : '2',
    );
    expect(jest.mocked(runMobilePersonalImportAi).mock.calls[0][2].aborted).toBe(true);
    await act(async () => finish(aiResult()));
    expect(view.queryByLabelText('已逐筆核對 AI 結果')).toBeNull();
  },
);

test('an authentication refresh cancels AI work even if the same account returns', async () => {
  readyAi();
  let finish!: (value: ReturnType<typeof aiResult>) => void;
  jest.mocked(runMobilePersonalImportAi).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<PersonalImportScreen />);
  prepareAi(view);
  fireEvent.press(view.getByText('用 AI 整理文字'));
  mockScope = null;
  view.rerender(<PersonalImportScreen />);
  expect(jest.mocked(runMobilePersonalImportAi).mock.calls[0][2].aborted).toBe(true);
  mockScope = { ...scope };
  view.rerender(<PersonalImportScreen />);
  await act(async () => finish(aiResult()));
  expect(view.queryByLabelText('已逐筆核對 AI 結果')).toBeNull();
  expect(view.getByLabelText('貼上或修正原始文字').props.value).toBe(aiSource);
});

test('model management mounts only after a deliberate tap and preserves the import text', async () => {
  const view = render(<PersonalImportScreen />);
  prepareAi(view);
  expect(view.queryByText('本機模型管理內容')).toBeNull();
  fireEvent.press(view.getByText('管理本機模型'));
  expect(view.getByText('本機模型管理內容')).toBeTruthy();
  fireEvent.press(view.getByText('回到資料匯入'));
  expect(view.queryByText('本機模型管理內容')).toBeNull();
  expect(view.getByLabelText('貼上或修正原始文字').props.value).toBe(aiSource);
  expect(runMobilePersonalImportAi).not.toHaveBeenCalled();
  await act(async () => {});
});

test('oversize AI sources remain intact and do not start generation', async () => {
  readyAi();
  const view = render(<PersonalImportScreen />);
  const longText = '文'.repeat(1001);
  fireEvent.changeText(view.getByLabelText('貼上或修正原始文字'), longText);
  fireEvent.press(view.getByText('用 AI 整理文字'));
  expect(runMobilePersonalImportAi).not.toHaveBeenCalled();
  expect(view.getByLabelText('貼上或修正原始文字').props.value).toBe(longText);
  await act(async () => {});
});

test('model management stays closed while the native engine is still working', async () => {
  mockAiAvailability = {
    status: 'busy',
    title: '本機模型仍在運算',
    detail: '請等候這次運算結束。',
  };
  const view = render(<PersonalImportScreen />);
  const manage = view.getByRole('button', { name: '管理本機模型' });
  expect(manage).toBeDisabled();
  fireEvent.press(manage);
  expect(view.queryByText('本機模型管理內容')).toBeNull();
  await act(async () => {});
});

test('review filter exposes invalid rows without changing which records will be imported', async () => {
  const view = render(<PersonalImportScreen />);
  await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
  fill(view, 'grades', '課程名稱,學分,成績\n資料庫,3,85\n英文,,90');
  fireEvent.press(view.getByText('只看待修正（1）'));
  expect(view.queryByLabelText('匯入 資料庫')).toBeNull();
  expect(view.getByLabelText('匯入 英文')).toBeTruthy();
  expect(view.getByText('確認新增 2 筆')).toBeTruthy();
  fireEvent.press(view.getByText('全部資料（2）'));
  expect(view.getByLabelText('匯入 資料庫')).toBeTruthy();
});

test('an issue-filtered editor stays mounted while a corrected grade is still being typed', async () => {
  const view = render(<PersonalImportScreen />);
  await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
  fill(view, 'grades', '課程名稱,學分,成績\n資料庫,3,');
  fireEvent.press(view.getByText('只看待修正（1）'));
  fireEvent.changeText(view.getByLabelText('成績'), '8');
  expect(view.getByLabelText('成績').props.value).toBe('8');
  fireEvent.changeText(view.getByLabelText('成績'), '85');
  expect(view.getByLabelText('成績').props.value).toBe('85');
  expect(view.getByLabelText('匯入 資料庫')).toBeTruthy();
  fireEvent.press(view.getByText('只看待修正（0）'));
  expect(view.queryByLabelText('匯入 資料庫')).toBeNull();
  fireEvent.press(view.getByText('全部資料（1）'));
  expect(view.getByLabelText('成績').props.value).toBe('85');
});

test('correcting the exclusive end of an AI multi-day event clears that field error and permits review', async () => {
  readyAi();
  const source = '讀書營 2026/10/20 至 2026/10/22 全天';
  const result = parsePersonalImportAiResponse(
    JSON.stringify({
      complete: true,
      rows: [{ title: '讀書營', date: '2026-10-20', allDay: true, evidence: source }],
    }),
    source,
    { kind: 'events', schoolId: 'pu', academicYear: '', semester: '' },
  );
  expect(
    result.issues.some((issue) => issue.code === 'unrecognized-field' && issue.field === 'endDate'),
  ).toBe(true);
  jest.mocked(runMobilePersonalImportAi).mockResolvedValue(result);
  const view = render(<PersonalImportScreen />);
  await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
  fireEvent.press(view.getByText('行事曆'));
  fireEvent.changeText(view.getByLabelText('貼上或修正原始文字'), source);
  fireEvent.press(view.getByText('用 AI 整理文字'));
  await view.findByLabelText('已逐筆核對 AI 結果');
  fireEvent.press(view.getByLabelText('已逐筆核對 AI 結果'));
  fireEvent.press(view.getByText('確認新增 1 筆'));
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
  fireEvent.press(view.getByText('編輯與連結課班'));
  fireEvent.changeText(view.getByLabelText('結束日期（選填；全天活動不含這一天）'), '2026-');
  expect(view.getByText(/來源包含多日全天活動/)).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('結束日期（選填；全天活動不含這一天）'), '2026-10-23');
  expect(view.queryByText(/來源包含多日全天活動/)).toBeNull();
  fireEvent.press(view.getByLabelText('已逐筆核對 AI 結果'));
  fireEvent.press(view.getByText('確認新增 1 筆'));
  await waitFor(async () =>
    expect((await loadPersonalImports(scope)).records[0]?.endDate).toBe('2026-10-23'),
  );
});

function prepareScreenshot() {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: 'file:///my-grades.png',
        width: 400,
        height: 800,
        mimeType: 'image/png',
        fileName: '成績.png',
      },
    ],
  });
  mockRecognize.mockResolvedValue('課程名稱,學分,成績\n資料庫,3,85');
}

test('original screenshot remains available after AI failure and is not saved with the record', async () => {
  readyAi();
  prepareScreenshot();
  jest.mocked(runMobilePersonalImportAi).mockRejectedValue(new Error('generation failed'));
  const view = render(<PersonalImportScreen />);
  await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
  prepareAi(view);
  fireEvent.press(view.getByText('選擇截圖'));
  const original = await view.findByLabelText('原始匯入截圖');
  expect(original.props.source).toEqual({ uri: 'file:///my-grades.png' });
  fireEvent.press(view.getByText('用 AI 整理文字'));
  await view.findByText(/AI 未能完成這次整理/);
  expect(view.getByLabelText('原始匯入截圖').props.source).toEqual({
    uri: 'file:///my-grades.png',
  });
  fireEvent.press(view.getByLabelText('放大核對原始截圖'));
  expect(view.getByLabelText('放大的原始匯入截圖').props.source).toEqual({
    uri: 'file:///my-grades.png',
  });
  fireEvent.press(view.getByText('回到核對清單'));
  fireEvent.press(view.getByText('整理成可編輯資料'));
  fireEvent.press(view.getByText('確認新增 1 筆'));
  await waitFor(() => expect(view.queryByLabelText('原始匯入截圖')).toBeNull());
  const ledger = await loadPersonalImports(scope);
  expect(ledger.records).toHaveLength(1);
  expect(JSON.stringify(ledger)).not.toContain('file:///');
});

test('accepting a different file or starting fresh pasted text clears the old screenshot', async () => {
  prepareScreenshot();
  const view = render(<PersonalImportScreen />);
  fireEvent.press(view.getByText('選擇截圖'));
  await view.findByLabelText('原始匯入截圖');
  mockFileText.mockResolvedValue('課程名稱,學分,成績\n英文,2,90');
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///new-grades.csv', name: 'new-grades.csv', size: 100 }],
  });
  fireEvent.press(view.getByText('選擇檔案'));
  await waitFor(() => expect(view.queryByLabelText('原始匯入截圖')).toBeNull());
  fireEvent.press(view.getByText('選擇截圖'));
  await view.findByLabelText('原始匯入截圖');
  fireEvent.changeText(view.getByLabelText('貼上或修正原始文字'), '');
  fireEvent.changeText(view.getByLabelText('貼上或修正原始文字'), '全新貼上的資料');
  expect(view.queryByLabelText('原始匯入截圖')).toBeNull();
});

test('an open screenshot viewer cannot survive an account switch or restore a stale URI', async () => {
  prepareScreenshot();
  const view = render(<PersonalImportScreen />);
  fireEvent.press(view.getByText('選擇截圖'));
  await view.findByLabelText('原始匯入截圖');
  fireEvent.press(view.getByLabelText('放大核對原始截圖'));
  expect(view.getByLabelText('放大的原始匯入截圖')).toBeTruthy();
  mockScope = { ...scope, owner: 'nuni:pa-b' };
  view.rerender(<PersonalImportScreen />);
  expect(view.queryByLabelText('放大的原始匯入截圖')).toBeNull();
  expect(view.queryByLabelText('原始匯入截圖')).toBeNull();
  mockScope = { ...scope };
  view.rerender(<PersonalImportScreen />);
  expect(view.queryByLabelText('原始匯入截圖')).toBeNull();
  await act(async () => {});
});

function nonstandardDocument(format: 'pdf' | 'xlsx' = 'xlsx'): PersonalImportDocument {
  return {
    format,
    name: `nonstandard.${format}`,
    warnings: [],
    sections: [
      {
        id: 'unusual',
        label: '修課紀錄',
        needsOcr: false,
        warnings: [],
        rows: [
          { line: 1, cells: ['不選取的私人備註'] },
          { line: 2, cells: ['所修學科', '權重', '結果'] },
          { line: 3, cells: ['商用英文', '2', '92'] },
        ],
      },
    ],
  };
}
function recognizeSelectedDocument(
  text: string,
  options: Parameters<typeof runMobilePersonalImportAi>[1],
) {
  const evidence = text.split('\n').find((line) => line.includes('商用英文'))!;
  return parsePersonalImportAiResponse(
    JSON.stringify({
      complete: true,
      rows: [{ title: '商用英文', credits: 2, grade: '92', evidence }],
    }),
    text,
    options,
  );
}
async function selectNonstandardDocument(
  view: ReturnType<typeof render>,
  format: 'pdf' | 'xlsx' = 'xlsx',
) {
  chooseDocument(nonstandardDocument(format));
  prepareAi(view);
  fireEvent.press(view.getByText('選擇檔案'));
  await view.findByText(`準備讀取：nonstandard.${format}`);
  fireEvent.press(view.getByText('□ 修課紀錄'));
  fireEvent.press(view.getByText('第 2 列'));
}

test.each(['pdf', 'xlsx'] as const)(
  '%s selected content reaches AI without requiring recognized table headers',
  async (format) => {
    readyAi();
    jest
      .mocked(runMobilePersonalImportAi)
      .mockImplementation(async (text, options) => recognizeSelectedDocument(text, options));
    const view = render(<PersonalImportScreen />);
    await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
    await selectNonstandardDocument(view, format);
    fireEvent.press(view.getByText('用 AI 整理選取內容'));
    await view.findByLabelText('已逐筆核對 AI 結果');
    const [text, options] = jest.mocked(runMobilePersonalImportAi).mock.calls[0];
    expect(text).toContain('所修學科');
    expect(text).toContain('商用英文');
    expect(text).not.toContain('不選取的私人備註');
    expect(options).toMatchObject({
      kind: 'grades',
      schoolId: 'pu',
      academicYear: '115',
      semester: '1',
      source: { type: 'file', name: expect.stringContaining(`nonstandard.${format}`) },
    });
    expect(view.queryByText(`準備讀取：nonstandard.${format}`)).toBeNull();
    expect(view.getByLabelText('貼上或修正原始文字').props.value).toBe(text);
    expect((await loadPersonalImports(scope)).records).toHaveLength(0);
    fireEvent.press(view.getByLabelText('已逐筆核對 AI 結果'));
    fireEvent.press(view.getByText('確認新增 1 筆'));
    await waitFor(async () =>
      expect((await loadPersonalImports(scope)).records[0]?.title).toBe('商用英文'),
    );
  },
);

test('failed document AI keeps the selected sections and starting rows for a retry', async () => {
  readyAi();
  jest
    .mocked(runMobilePersonalImportAi)
    .mockRejectedValueOnce(new Error('failed'))
    .mockImplementationOnce(async (text, options) => recognizeSelectedDocument(text, options));
  const view = render(<PersonalImportScreen />);
  await selectNonstandardDocument(view);
  fireEvent.press(view.getByText('用 AI 整理選取內容'));
  await view.findByText(/AI 未能完成這次整理/);
  expect(view.getByText('準備讀取：nonstandard.xlsx')).toBeTruthy();
  expect(view.getByText('☑ 修課紀錄')).toBeTruthy();
  const firstText = jest.mocked(runMobilePersonalImportAi).mock.calls[0][0];
  fireEvent.press(view.getByText('用 AI 整理選取內容'));
  await view.findByLabelText('已逐筆核對 AI 結果');
  expect(jest.mocked(runMobilePersonalImportAi).mock.calls[1][0]).toBe(firstText);
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
});

test('cancelled document AI cannot replace the retained document selection when its result arrives late', async () => {
  readyAi();
  let finish!: () => void;
  jest.mocked(runMobilePersonalImportAi).mockImplementation(
    (text, options) =>
      new Promise((resolve) => {
        finish = () => resolve(recognizeSelectedDocument(text, options));
      }),
  );
  const view = render(<PersonalImportScreen />);
  await selectNonstandardDocument(view, 'pdf');
  fireEvent.press(view.getByText('用 AI 整理選取內容'));
  fireEvent.press(view.getByText('取消 AI 整理'));
  expect(jest.mocked(runMobilePersonalImportAi).mock.calls[0][2].aborted).toBe(true);
  await act(async () => finish());
  expect(view.getByText('準備讀取：nonstandard.pdf')).toBeTruthy();
  expect(view.getByText('☑ 修課紀錄')).toBeTruthy();
  expect(view.queryByLabelText('已逐筆核對 AI 結果')).toBeNull();
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
});

test('an overlong document selection is preserved and never silently truncated for native AI', async () => {
  readyAi();
  const document = nonstandardDocument();
  document.sections[0].rows.push({ line: 4, cells: ['文'.repeat(1001)] });
  chooseDocument(document);
  const view = render(<PersonalImportScreen />);
  prepareAi(view);
  fireEvent.press(view.getByText('選擇檔案'));
  await view.findByText('準備讀取：nonstandard.xlsx');
  fireEvent.press(view.getByText('□ 修課紀錄'));
  fireEvent.press(view.getByText('用 AI 整理選取內容'));
  expect(runMobilePersonalImportAi).not.toHaveBeenCalled();
  expect(view.getByText('準備讀取：nonstandard.xlsx')).toBeTruthy();
  expect(view.getByText('☑ 修課紀錄')).toBeTruthy();
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
});

test('failed-range retry keeps edits made to completed rows', async () => {
  readyAi();
  const retrySource = '統計，學分 2，成績 91';
  const first = { ...aiResult(), retryBatches: [{ text: retrySource, startLine: 2 }] };
  jest.mocked(runMobilePersonalImportAi).mockResolvedValueOnce(first).mockImplementationOnce(async (_text, options) => {
    const next = parsePersonalImportAiResponse(JSON.stringify({ complete: true, rows: [{ title: '統計', credits: 2, grade: '91', evidence: retrySource }] }), retrySource, options);
    return { ...next, retryBatches: [] };
  });
  const view = render(<PersonalImportScreen />);
  prepareAi(view);
  fireEvent.changeText(view.getByLabelText('貼上或修正原始文字'), `${aiSource}\n${retrySource}`);
  fireEvent.press(view.getByText('用 AI 整理文字'));
  await view.findByLabelText('已逐筆核對 AI 結果');
  fireEvent.press(view.getByText('編輯與連結課班'));
  fireEvent.changeText(view.getByLabelText('成績'), '90');
  fireEvent.press(view.getByText('重試未完成段落'));
  await waitFor(() => expect(runMobilePersonalImportAi).toHaveBeenCalledTimes(2));
  await view.findByText('確認新增 2 筆');
  expect(jest.mocked(runMobilePersonalImportAi).mock.calls[1][3]?.retryBatches).toEqual(first.retryBatches);
  fireEvent.press(view.getAllByText('編輯與連結課班')[0]);
  expect(view.getByLabelText('成績').props.value).toBe('90');
});

test('completed progress is restored after leaving the screen before the next batch finishes', async () => {
  readyAi();
  let finish!: () => void;
  jest.mocked(runMobilePersonalImportAi).mockImplementation((_text, _options, _signal, request) => {
    request?.onProgress?.({ ...aiResult(), retryBatches: [{ text: '尚未完成的課程', startLine: 2 }] });
    return new Promise((resolve) => { finish = () => resolve(aiResult()); });
  });
  const view = render(<PersonalImportScreen />);
  prepareAi(view);
  fireEvent.changeText(view.getByLabelText('貼上或修正原始文字'), `${aiSource}\n尚未完成的課程`);
  fireEvent.press(view.getByText('用 AI 整理文字'));
  await view.findByLabelText('已逐筆核對 AI 結果');
  view.unmount();
  const restored = render(<PersonalImportScreen />);
  await restored.findByText('已恢復上次完成的待核對草稿；未完成段落可以重試。');
  expect(restored.getByLabelText('貼上或修正原始文字').props.value).toBe(`${aiSource}\n尚未完成的課程`);
  expect(restored.getByText('重試未完成段落')).toBeTruthy();
  expect(restored.getByText('確認新增 1 筆')).toBeTruthy();
  await act(async () => finish());
  expect(restored.getByText('確認新增 1 筆')).toBeTruthy();
});

async function startDocumentProgress(view: ReturnType<typeof render>, previousText = '') {
  let finish!: () => void;
  const pending = jest.mocked(runMobilePersonalImportAi);
  pending.mockImplementation(
    (text, options) =>
      new Promise((resolve) => {
        finish = () => resolve(recognizeSelectedDocument(text, options));
      }),
  );
  const document = nonstandardDocument();
  document.sections[0].rows.push({ line: 4, cells: ['統計', '2', '91'] });
  chooseDocument(document);
  prepareAi(view);
  fireEvent.changeText(view.getByLabelText('貼上或修正原始文字'), previousText);
  fireEvent.press(view.getByText('選擇檔案'));
  await view.findByText('準備讀取：nonstandard.xlsx');
  fireEvent.press(view.getByText('□ 修課紀錄'));
  fireEvent.press(view.getByText('第 2 列'));
  fireEvent.press(view.getByText('用 AI 整理選取內容'));
  const [text, options, signal, request] = pending.mock.calls[0];
  const lines = text.split('\n');
  const retryLine = lines.findIndex((line) => line.includes('統計'));
  const retryBatches = [{ text: lines[retryLine], startLine: retryLine + 1 }];
  const partial = { ...recognizeSelectedDocument(text, options), retryBatches };
  await act(async () => request?.onProgress?.(partial));
  await waitFor(async () =>
    expect(await loadPersonalImportDraft(scope)).toMatchObject({
      text,
      options: { source: options.source },
      retryBatches,
    }),
  );
  return { text, options, signal, request, partial, retryBatches, finish };
}

test.each(['', '先前貼上的其他內容'])(
  'cancelled document progress keeps the full source and retry range instead of %p through autosave and remount',
  async (previousText) => {
    readyAi();
    const view = render(<PersonalImportScreen />);
    await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
    const progress = await startDocumentProgress(view, previousText);
    fireEvent.press(view.getByText('取消 AI 整理'));
    expect(progress.signal.aborted).toBe(true);
    await waitFor(async () =>
      expect(await loadPersonalImportDraft(scope)).toMatchObject({
        text: progress.text,
        options: { source: progress.options.source },
        retryBatches: progress.retryBatches,
      }),
    );
    expect(view.getByLabelText('貼上或修正原始文字').props.value).toBe(progress.text);
    expect(view.getByText('重試未完成段落')).toBeTruthy();
    fireEvent.press(view.getByText('編輯與連結課班'));
    fireEvent.changeText(view.getByLabelText('成績'), '88');
    await waitFor(async () =>
      expect(await loadPersonalImportDraft(scope)).toMatchObject({
        text: progress.text,
        options: { source: progress.options.source },
        rows: [{ grade: '88', source: { type: 'file' } }],
        retryBatches: progress.retryBatches,
      }),
    );
    await act(async () => {
      progress.request?.onProgress?.({ ...progress.partial, retryBatches: [] });
      progress.finish();
    });
    expect(view.getByLabelText('成績').props.value).toBe('88');
    expect((await loadPersonalImportDraft(scope))?.retryBatches).toHaveLength(1);
    view.unmount();
    const restored = render(<PersonalImportScreen />);
    await restored.findByText('已恢復上次完成的待核對草稿；未完成段落可以重試。');
    expect(restored.getByLabelText('貼上或修正原始文字').props.value).toBe(progress.text);
    expect(restored.getByText('重試未完成段落')).toBeTruthy();
    fireEvent.press(restored.getByText('編輯與連結課班'));
    expect(restored.getByLabelText('成績').props.value).toBe('88');
    expect(await loadPersonalImportDraft(scope)).toMatchObject({
      text: progress.text,
      options: { source: progress.options.source },
      retryBatches: progress.retryBatches,
    });
    expect((await loadPersonalImports(scope)).records).toHaveLength(0);
  },
);

test.each([
  ['account', { ...scope, owner: 'nuni:pa-b' }],
  ['school', { ...scope, schoolId: 'other-school' }],
] as const)(
  'late document progress cannot write after a %s switch or alter the saved retry range',
  async (_label, nextScope) => {
    readyAi();
    const view = render(<PersonalImportScreen />);
    await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
    const progress = await startDocumentProgress(view);
    mockScope = nextScope;
    view.rerender(<PersonalImportScreen />);
    await waitFor(() => expect(view.queryByLabelText('讀取匯入紀錄')).toBeNull());
    expect(progress.signal.aborted).toBe(true);
    await act(async () => {
      progress.request?.onProgress?.({ ...progress.partial, retryBatches: [] });
      progress.finish();
    });
    expect(view.getByLabelText('貼上或修正原始文字').props.value).toBe('');
    expect(view.queryByText('確認新增 1 筆')).toBeNull();
    expect(await loadPersonalImportDraft(nextScope)).toBeNull();
    expect(await loadPersonalImportDraft(scope)).toMatchObject({
      text: progress.text,
      options: { source: progress.options.source },
      retryBatches: progress.retryBatches,
    });
    mockScope = { ...scope };
    view.rerender(<PersonalImportScreen />);
    await view.findByText('已恢復上次完成的待核對草稿；未完成段落可以重試。');
    expect(view.getByLabelText('貼上或修正原始文字').props.value).toBe(progress.text);
    expect(view.getByText('重試未完成段落')).toBeTruthy();
  },
);

test('late AsyncStorage draft recovery cannot replace freshly pasted input', async () => {
  let resolveDraft!: (value: string | null) => void;
  const getItem = AsyncStorage.getItem.bind(AsyncStorage);
  const spy = jest.spyOn(AsyncStorage, 'getItem').mockImplementation((key) =>
    key.startsWith('campus.personal-import-draft.v1:')
      ? new Promise((resolve) => { resolveDraft = resolve; })
      : getItem(key));
  try {
    const view = render(<PersonalImportScreen />);
    await waitFor(() => expect(resolveDraft).toBeDefined());
    fireEvent.changeText(view.getByLabelText('貼上或修正原始文字'), '新貼上的資料');
    await act(async () => resolveDraft(JSON.stringify({
      text: '舊草稿', options: { kind: 'grades', schoolId: 'pu', academicYear: '114', semester: '2' },
      rows: [], issues: [], retryBatches: [],
    })));
    expect(view.getByLabelText('貼上或修正原始文字').props.value).toBe('新貼上的資料');
    expect(view.queryByText('已恢復上次完成的待核對草稿；未完成段落可以重試。')).toBeNull();
  } finally { spy.mockRestore(); }
});
