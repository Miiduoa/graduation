import type { ReactNode } from 'react';
import type { useNuniSession } from '../state/nuniSession';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import {
  PERSONAL_IMPORT_IMAGE_UNREADABLE,
  personalImportSavedNotice,
  personalImportUndoBody,
  personalImportUndoneNotice,
} from '@campus/shared';
import PersonalImportScreen from '../screens/PersonalImportScreen';
import { loadPersonalImports } from '../services/personalImports';

let mockScope: { owner: string; schoolId: string } | null;
const mockRequest = jest.fn();
let mockPlatform: ReturnType<typeof useNuniSession>;
const mockRecognize = jest.fn();
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
  jest
    .mocked(ImagePicker.launchImageLibraryAsync)
    .mockResolvedValue({
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
