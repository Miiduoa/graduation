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

let mockScope: { owner: string; schoolId: string } | null;
const mockRequest = jest.fn();
let mockPlatform: ReturnType<typeof useNuniSession>;
const mockRecognize = jest.fn();
const mockDocumentRead = jest.fn();
const mockDocumentCancel = jest.fn();
const mockFileText = jest.fn();
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
jest.mock(
  '../components/DocumentImportHost',
  () => ({
    DocumentImportHost: require('react').forwardRef((_: unknown, ref: unknown) => {
      require('react').useImperativeHandle(ref, () => ({
        read: mockDocumentRead,
        cancel: mockDocumentCancel,
      }));
      return null;
    }),
  }),
);
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
  const html = '<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>' +
    '<tr><td>離散數學</td><td>3</td><td>92</td></tr></table>';
  mockFileText.mockResolvedValue(html);
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///grades.html', name: 'grades.html', size: html.length, mimeType: 'text/html' }],
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
