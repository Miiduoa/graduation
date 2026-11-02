import { classMeetingKey } from '@campus/shared';
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { PersonalImportRecord } from '@campus/shared';
import PersonalTimetableScreen from '../screens/PersonalTimetableScreen';
import { loadPersonalTimetable, loadPersonalTimetableDraft, savePersonalTimetable } from '../services/personalTimetable';
import { loadPersonalImports } from '../services/personalImports';

let mockUser: { uid: string } | null = null;
let mockSchool = { id: 'ncku', name: '國立成功大學' };
let mockRoute: { params?: { term: string; courseId?: string; schoolId?: string; date?: string } } = {};
let mockScope: { owner: string; schoolId: string } | null = {
  owner: 'nuni:account-a',
  schoolId: 'ncku',
};
const mockNavigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => false };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/personalImportScope', () => ({ usePersonalImportScope: () => mockScope }));
jest.mock('../services/personalImports', () => ({
  ...jest.requireActual('../services/personalImports'),
  loadPersonalImports: jest.fn(),
}));
jest.mock('../firebase', () => ({ getDb: jest.fn(), getFunctionsInstance: jest.fn() }));
jest.mock('../services/personalTimetable', () => ({
  ...jest.requireActual('../services/personalTimetable'),
  loadPersonalTimetable: jest.fn(),
  loadPersonalTimetableDraft: jest.fn(),
  savePersonalTimetable: jest.fn(),
}));
jest.mock('../components/PersonalImportSummary', () => ({ PersonalImportSummary: () => null }));
jest.mock('../services/friends', () => ({
  listAcceptedFriends: jest.fn(async () => []),
  opponentUidFromFriendship: jest.fn(),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => mockRoute,
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));

const record = (overrides: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({
  id: 'course-a',
  batchId: 'batch-a',
  importedAt: '2026-10-18T00:00:00Z',
  kind: 'timetable',
  schoolId: 'ncku',
  academicYear: '115',
  semester: '1',
  title: '成大課程',
  dayOfWeek: 1,
  startPeriod: 2,
  endPeriod: 3,
  location: '教室 303',
  source: { type: 'paste', line: 1, rawText: '' },
  ...overrides,
});
beforeEach(() => {
  // Pin to a Sunday so ClassExceptions "today" does not also list Monday fixtures.
  jest.useFakeTimers({
    now: new Date('2026-10-25T04:00:00.000Z'),
    doNotFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'setImmediate',
      'clearImmediate',
      'nextTick',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'performance',
      'hrtime',
    ],
  });
  jest.clearAllMocks();
  mockUser = null;
  mockSchool = { id: 'ncku', name: '國立成功大學' };
  mockScope = { owner: 'nuni:account-a', schoolId: 'ncku' };
  mockRoute = {};
  jest
    .mocked(loadPersonalTimetable)
    .mockReset()
    .mockResolvedValue({
      courses: [],
      schoolId: 'ncku',
      shareWithFriends: false,
      updatedAt: '2026-10-18T00:00:00Z',
      meta: { year: '', semester: '', school: '', className: '', credits: 0, title: '' },
    });
  jest
    .mocked(loadPersonalImports)
    .mockReset()
    .mockResolvedValue({ version: 1, records: [record()], batches: [] });
});
afterEach(() => {
  jest.useRealTimers();
});

test('the full timetable and editor use NCKU period labels and times, without inheriting a guest timetable', async () => {
  const view = render(<PersonalTimetableScreen />);
  await view.findByText('成大課程');
  fireEvent.changeText(view.getByLabelText('匯出開始日期'), '2026-11-02');
  fireEvent.changeText(view.getByLabelText('匯出結束日期'), '2026-11-08');
  expect(view.getByText('將匯出 1 堂課；略過 0 門時間未確認的課程。')).toBeTruthy();
  expect(view.getByText('星期一 · 08:00–09:50')).toBeTruthy();
  expect(view.queryByText(/09:10–11:00/)).toBeNull();
  expect(loadPersonalTimetable).toHaveBeenCalledWith(null, 'ncku', 'nuni:account-a');
  fireEvent.press(view.getByText('新增'));
  fireEvent.press(view.getByText('開始 N'));
  fireEvent.press(view.getByText('結束 5'));
  expect(view.getByText('12:10–14:00')).toBeTruthy();
  fireEvent.press(view.getByText('開始 0'));
  fireEvent.press(view.getByText('結束 0'));
  expect(view.getByText('07:00–07:50')).toBeTruthy();
  fireEvent.press(view.getByText('開始 A'));
  fireEvent.press(view.getByText('結束 D'));
  expect(view.getByText('18:20–21:55')).toBeTruthy();
});

test('the term selected on Today remains selected in the complete timetable', async () => {
  mockRoute = { params: { term: '114|1' } };
  jest
    .mocked(loadPersonalImports)
    .mockResolvedValue({
      version: 1,
      records: [record(), record({ id: 'old', academicYear: '114', title: '前學期課程' })],
      batches: [],
    });
  const view = render(<PersonalTimetableScreen />);
  await view.findByText('前學期課程');
  expect(view.queryByText('成大課程')).toBeNull();
});

test('unknown school clock times remain readable without borrowing another school period table', async () => {
  mockSchool = { id: 'unknown', name: '其他學校' };
  mockScope = { owner: 'guest:device', schoolId: 'unknown' };
  jest
    .mocked(loadPersonalImports)
    .mockResolvedValue({
      version: 1,
      records: [
        record({
          schoolId: 'unknown',
          title: '週末課程',
          dayOfWeek: 6,
          startPeriod: undefined,
          endPeriod: undefined,
          startTime: '09:00',
          endTime: '10:00',
        }),
      ],
      batches: [],
    });
  const view = render(<PersonalTimetableScreen />);
  await view.findByText('週末課程');
  expect(view.getByText(/週六 · 09:00–10:00/)).toBeTruthy();
  expect(view.getByRole('button', { name: '格子' })).toBeDisabled();
  expect(view.getByRole('button', { name: '今天空堂' })).toBeDisabled();
});

test('unresolved logout never loads a guest or account timetable', () => {
  mockScope = null;
  const view = render(<PersonalTimetableScreen />);
  expect(view.getByText(/正在確認帳號/)).toBeTruthy();
  expect(loadPersonalTimetable).not.toHaveBeenCalled();
  expect(loadPersonalImports).not.toHaveBeenCalled();
});

test('a manual course without a semester opens the same manual timetable from Today', async () => {
  mockRoute = { params: { term: '未填|未填' } };
  jest.mocked(loadPersonalTimetable).mockResolvedValue({
    courses: [{ id: 'manual-a', name: '手排課程', day: 1, start: 2, end: 3, teacher: '', room: '', color: 'blue' }],
    schoolId: 'ncku', shareWithFriends: false, updatedAt: '2026-10-18T00:00:00Z',
    meta: { year: '', semester: '', school: '', className: '', credits: 0, title: '' },
  });
  const view = render(<PersonalTimetableScreen />);
  await view.findByText('手排課程');
  expect(view.queryByText('成大課程')).toBeNull();
  expect(view.getByText('星期一 · 08:00–09:50')).toBeTruthy();
});

test('a failed import read cannot be treated as free time and can be retried in place', async () => {
  jest.mocked(loadPersonalImports).mockRejectedValueOnce(new Error('storage unavailable'));
  const view = render(<PersonalTimetableScreen />);
  await view.findByText('匯入課表暫時讀不到，目前不能確認空堂，請重新讀取。');
  expect(view.getByRole('button', { name: '今天空堂' })).toBeDisabled();
  expect(view.getByRole('button', { name: '排讀書時間' })).toBeDisabled();
  fireEvent.press(view.getByRole('button', { name: '重試匯入課表' }));
  await view.findByText('成大課程');
  expect(view.getByRole('button', { name: '今天空堂' })).not.toBeDisabled();
  expect(view.queryByText('匯入課表暫時讀不到，目前不能確認空堂，請重新讀取。')).toBeNull();
});

test('a matching manual and imported class appears once and does not disable free-time planning', async () => {
  jest.mocked(loadPersonalTimetable).mockResolvedValue({
    courses: [{ id: 'manual-a', name: '成大課程', day: 1, start: 2, end: 3, teacher: '', room: '教室 303', color: 'blue' }],
    schoolId: 'ncku', shareWithFriends: false, updatedAt: '2026-10-18T00:00:00Z',
    meta: { year: '115', semester: '1', school: '', className: '', credits: 0, title: '' },
  });
  const view = render(<PersonalTimetableScreen />);
  await view.findByText('成大課程');
  expect(view.getAllByText('成大課程')).toHaveLength(1);
  expect(view.getByRole('button', { name: '今天空堂' })).not.toBeDisabled();
  expect(view.queryByText(/部分課程無法對應節次/)).toBeNull();
});

test('a later manual timetable read failure keeps its prior data but blocks free-time calculations', async () => {
  jest.mocked(loadPersonalImports).mockRejectedValueOnce(new Error('storage unavailable'));
  const view = render(<PersonalTimetableScreen />);
  await view.findByText('匯入課表暫時讀不到，目前不能確認空堂，請重新讀取。');
  jest.mocked(loadPersonalTimetable).mockRejectedValueOnce(new Error('manual unavailable'));
  fireEvent.press(view.getByRole('button', { name: '重試匯入課表' }));
  await view.findByText('手動課表暫時讀不到，先保留上次讀取的內容；目前不能確認空堂。');
  expect(view.getByRole('button', { name: '今天空堂' })).toBeDisabled();
  fireEvent.press(view.getByRole('button', { name: '重試課表' }));
  await waitFor(() => expect(view.getByRole('button', { name: '今天空堂' })).not.toBeDisabled());
});


test('widget links locate the saved course and room, while removed courses fall back safely', async () => {
  mockRoute = { params: { term: '115|1', courseId: 'course-a', schoolId: 'ncku' } };
  const view = render(<PersonalTimetableScreen />);
  await waitFor(() => expect(view.getAllByText('成大課程').length).toBeGreaterThan(1));
  expect(view.getByText('教室 303')).toBeTruthy();
  mockRoute = { params: { term: '115|1', courseId: 'removed', schoolId: 'ncku' } };
  view.rerender(<PersonalTimetableScreen />);
  await view.findByText('這堂課已變更，請核對目前課表');
});

test('a dated widget link shows the makeup room and date rather than the weekly room', async () => {
  const original = record();
  const timetable = await jest.mocked(loadPersonalTimetable)(null, 'ncku', 'nuni:account-a');
  jest.mocked(loadPersonalTimetable).mockResolvedValue({ ...timetable, classExceptions: [{
    id: 'move', courseKey: classMeetingKey(original), originalDate: '2026-11-02', kind: 'move',
    date: '2026-11-03', endDate: '2026-11-04', startTime: '23:30', endTime: '01:00',
    location: '補課教室', createdAt: '', original,
  }] });
  mockRoute = { params: { term: '115|1', courseId: original.id, schoolId: 'ncku', date: '2026-11-03' } };
  const view = render(<PersonalTimetableScreen />);
  await view.findByText('2026-11-03 · 23:30–01:00 · 補課教室');
  expect(view.getByLabelText('查看日期').props.value).toBe('2026-11-03');
});


test('cloud reload and draft preview are explicit and sharing does not edit exceptions', async () => {
  mockUser = { uid: 'synthetic' };
  mockScope = { owner: 'firebase:synthetic', schoolId: 'ncku' };
  const base = await jest.mocked(loadPersonalTimetable)(null, 'ncku');
  jest.mocked(loadPersonalTimetable).mockResolvedValue({ ...base, classExceptions: [], classExceptionsRevision: 2 });
  jest.mocked(loadPersonalTimetableDraft).mockResolvedValue({ ...base, courses: [{ id: 'offline', name: '離線新增課', teacher: '', room: '', day: 1, start: 1, end: 2, color: 'blue' }], meta: { ...base.meta, title: '離線標題' }, shareWithFriends: true, pendingBase: true, pendingExceptions: false, classExceptions: [], classExceptionsRevision: 1 });
  jest.mocked(savePersonalTimetable).mockResolvedValue({ stored: 'cloud', timetable: { ...base, classExceptionsRevision: 2 } });
  const view = render(<PersonalTimetableScreen />);
  await view.findByText('成大課程');
  fireEvent.press(view.getByText('檢視這台裝置未同步草稿'));
  await view.findByText('目前預覽未同步課表；請核對每週基準與單次安排，分別儲存。重新讀取可回到雲端版本。');
  expect(loadPersonalTimetableDraft).toHaveBeenCalledWith('synthetic', 'ncku');
  await view.findByText('離線新增課');
  fireEvent.press(view.getByText('儲存每週基準課表'));
  await waitFor(() => expect(savePersonalTimetable).toHaveBeenCalledWith('synthetic', expect.objectContaining({ courses: [expect.objectContaining({ id: 'offline' })], meta: expect.objectContaining({ title: '離線標題' }), shareWithFriends: true, classExceptionsRevision: 2 }), undefined, false));
  fireEvent.press(view.getByText('重新讀取雲端課表'));
  await waitFor(() => expect(loadPersonalTimetable).toHaveBeenLastCalledWith('synthetic', 'ncku', undefined));
  fireEvent.press(view.getByText('目前好友看不到這份課表（點一下開放）'));
  await waitFor(() => expect(savePersonalTimetable).toHaveBeenCalledWith('synthetic', expect.objectContaining({ shareWithFriends: true, classExceptionsRevision: 2 }), undefined, false));
});
