import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Text } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { buildPersonalToday, validatePersonalImportRow, type PersonalImportRecord } from '@campus/shared';
import { SchoolTimetableImport } from '../components/SchoolTimetableImport';
import { loadOwnedSchoolCourses } from '../services/ownedSchoolAcademicRecords';
import { loadPersonalImports, personalImportCourses, personalImportStorageKey, type PersonalImportScope } from '../services/personalImports';
import { previewSchoolTimetable } from '../services/schoolTimetableImport';
import { useTodayTimetableData } from '../hooks/useTodayTimetableData';
import type { PUCourse, PUCourseResult } from '../services/puDirectScraper';
import PersonalTimetableScreen from '../screens/PersonalTimetableScreen';
import { loadPersonalTimetable } from '../services/personalTimetable';

let mockUser: { uid: string } | null = { uid: 'student-a' };
let mockScope: PersonalImportScope = { owner: 'nuni:account-a', schoolId: 'pu' };
const mockSaved = jest.fn(), mockConnect = jest.fn(), mockOpenImports = jest.fn();
jest.mock('../firebase', () => ({ getAuthInstance: () => ({ currentUser: mockUser }) }));
jest.mock('../services/ownedSchoolAcademicRecords', () => ({ loadOwnedSchoolCourses: jest.fn() }));
jest.mock('../state/theme', () => ({ useThemeMode: () => ({ mode: 'light' }) }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'pu', name: '靜宜大學' } }) }));
jest.mock('../state/personalImportScope', () => ({ usePersonalImportScope: () => mockScope }));
jest.mock('../components/PersonalImportSummary', () => ({ PersonalImportSummary: () => null }));
jest.mock('../services/personalTimetable', () => ({
  loadPersonalTimetable: jest.fn(),
  personalTimetableRecords: () => [],
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({}),
}));
jest.mock('../ui/components', () => {
  const React = jest.requireActual('react'), { Pressable, Text, View } = jest.requireActual('react-native');
  return { Screen: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
    Button: ({ text, disabled, onPress }: { text: string; disabled?: boolean; onPress(): void }) =>
    React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: text, accessibilityState: { disabled: !!disabled }, disabled, onPress }, React.createElement(Text, null, text)) };
});

const course = (patch: Partial<PUCourse> = {}): PUCourse => ({
  code: 'CS101', classOffered: '資工一甲', name: '程式設計', nameEn: 'Programming',
  courseType: '必修', credits: 3, dayOfWeek: 1, periods: [2, 3], startTime: '09:10', endTime: '11:00',
  location: '主顧 303', timePlaceRaw: '星期一 2,3 主顧 303', teacherEmail: 'teacher@school.invalid',
  ...patch,
});
const result = (courses = [course()], semester: string | null = '1151'): PUCourseResult => ({
  courses, semester, totalCredits: courses.reduce((total, row) => total + row.credits, 0),
  studentInfo: { studentId: 'S123', name: '本人', className: null, currentSemester: '1151', department: null, grade: null, enrollmentStatus: null },
});
const existing = (): PersonalImportRecord => ({
  id: 'old', kind: 'timetable', title: '舊學期課程', schoolId: 'pu', academicYear: '114', semester: '2',
  courseCode: 'OLD', dayOfWeek: 5, startPeriod: 1, endPeriod: 1,
  source: { type: 'paste', line: 1, rawText: '原有匯入' }, batchId: 'old-batch', importedAt: '2026-10-20T00:00:00Z',
});
const panel = (scope = mockScope, uid: string | null = mockUser?.uid ?? null, isCurrent = () => true) =>
  <SchoolTimetableImport scope={scope} uid={uid} isCurrent={isCurrent} onSaved={mockSaved} onConnect={mockConnect} onOpenImports={mockOpenImports} />;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
async function read(view: ReturnType<typeof render>) {
  fireEvent.press(view.getByText('讀取校方課表'));
  await view.findByText(/本次課程合計/);
}
async function confirm(view: ReturnType<typeof render>, count: number) {
  fireEvent.press(view.getByText(`核對並帶入 ${count} 筆`));
  await view.findByText(`確認新增 ${count} 筆、更新 0 筆`);
  await act(async () => fireEvent.press(view.getByText(`確認新增 ${count} 筆、更新 0 筆`)));
}
beforeEach(async () => {
  await AsyncStorage.clear(); jest.clearAllMocks();
  mockUser = { uid: 'student-a' }; mockScope = { owner: 'nuni:account-a', schoolId: 'pu' };
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  jest.mocked(loadOwnedSchoolCourses).mockReset().mockResolvedValue(result());
  jest.mocked(loadPersonalTimetable).mockReset().mockResolvedValue({
    schoolId: 'pu', courses: [], shareWithFriends: false, updatedAt: '2026-10-27T00:00:00Z',
    meta: { year: '114', semester: '2', school: '', className: '', credits: 0, title: '' },
  });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

test('the preview preserves every source row, zero credits, weekends and unknown schedules without guessing', () => {
  const source = result([
    course({ credits: 0 }),
    course({ code: 'SAT', name: '週末課程', dayOfWeek: 6 }),
    course({ code: 'UNPLACED', name: '專題', dayOfWeek: null, periods: [], startTime: null, endTime: null, timePlaceRaw: '時間另訂' }),
    course({ code: 'GAPS', name: '分段課程', periods: [1, 3], startTime: '08:10' }),
  ]);
  const preview = previewSchoolTimetable(source);
  expect(preview.termKey).toBe('115|1');
  expect(preview.courses).toHaveLength(4);
  expect(preview.courses[0].row).toMatchObject({ credits: 0, startPeriod: 2, endPeriod: 3 });
  expect(preview.courses[0].row.teacher).toBeUndefined();
  expect(preview.courses[1].reasons).toEqual([]);
  expect(preview.courses[1].row.dayOfWeek).toBe(6);
  expect(preview.courses[2].row).not.toHaveProperty('startTime');
  expect(preview.courses[2].reasons.length).toBeGreaterThan(0);
  expect(preview.courses[3].reasons).toContain('原始節次不連續或無法辨識，請在個人匯入分開核對時段。');
  expect(JSON.parse(preview.courses[3].row.source.rawText).periods).toEqual([1, 3]);
  expect(preview.courses[3].row.startTime).toBeUndefined();
  expect(preview.courses[3].row.startPeriod).toBeUndefined();
  expect(preview.courses.every((item) => !item.row.source.rawText.includes('S123'))).toBe(true);
  expect(source.courses[3].periods).toEqual([1, 3]);
});

test('unrecognised semester and malformed source cannot turn into an empty success or a current term', () => {
  const preview = previewSchoolTimetable(result([course()], null));
  expect(preview.termKey).toBeNull();
  expect(preview.courses[0].row.academicYear).toBe('');
  expect(preview.courses[0].reasons).toContain('校方未提供可辨識的學期，請先核對來源學期。');
  expect(() => previewSchoolTimetable({ ...result([course({ credits: Number.NaN })]), totalCredits: 3 })).toThrow(/學分資訊/);
  expect(() => previewSchoolTimetable({ ...result(), courses: null } as unknown as PUCourseResult)).toThrow(/格式/);
});

test('credits reflect the returned course rows when the source total defaults to zero', async () => {
  const source = { ...result([
    course(),
    course({ code: 'LAB', name: '實驗課程', credits: 1.5 }),
    course({ code: 'SERVICE', name: '服務學習', credits: 0 }),
  ]), totalCredits: 0 };
  expect(previewSchoolTimetable(source).listedCredits).toBe(4.5);
  jest.mocked(loadOwnedSchoolCourses).mockResolvedValue(source);
  const view = render(panel()); await read(view);
  expect(view.getByText('本次課程合計 4.5 學分 · 3 筆課程')).toBeTruthy();
  expect(view.queryByText(/校方列示/)).toBeNull();
  expect(source.totalCredits).toBe(0);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('read and review do not write; explicit confirmation preserves existing data and appears in the real Today hook', async () => {
  const old = existing();
  await AsyncStorage.setItem(personalImportStorageKey(mockScope), JSON.stringify({ version: 1, records: [old], batches: [{ id: old.batchId, createdAt: old.importedAt, count: 1 }] }));
  jest.mocked(AsyncStorage.setItem).mockClear();
  const view = render(panel());
  await read(view);
  expect(loadOwnedSchoolCourses).toHaveBeenCalledWith('student-a');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('核對並帶入 1 筆'));
  await view.findByText('確認新增 1 筆、更新 0 筆');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('確認新增 1 筆、更新 0 筆')));
  expect(mockSaved).toHaveBeenCalledWith('115|1');
  const ledger = await loadPersonalImports(mockScope);
  expect(ledger.records).toHaveLength(2);
  expect(ledger.records[0]).toEqual(old);
  expect(ledger.records[1]).toMatchObject({ title: '程式設計', credits: 3, academicYear: '115', semester: '1', startTime: '09:10' });
  expect(personalImportCourses(ledger.records, 'pu').map((item) => item.name)).toContain('程式設計');
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  view.unmount();
  function Today() {
    const today = useTodayTimetableData(new Date('2026-10-26T00:00:00Z'));
    return <Text>{`${today.status} ${today.termKey} ${today.classes.map((item) => `${item.title} ${item.location}`).join(',')}`}</Text>;
  }
  const today = render(<Today />);
  expect(await today.findByText('ready 115|1 程式設計 主顧 303')).toBeTruthy();
});

test('weekend and exact off-grid clocks persist and feed Today without invented periods', async () => {
  jest.mocked(loadOwnedSchoolCourses).mockResolvedValue(result([
    course({ code: 'SAT', name: '週末實習', dayOfWeek: 6, periods: [], startTime: '09:15', endTime: '12:20', timePlaceRaw: '星期六 09:15–12:20' }),
    course({ code: 'EXACT', name: '時鐘課程', periods: [], startTime: '08:10', endTime: '10:50' }),
  ]));
  const view = render(panel()); await read(view); await confirm(view, 2);
  const ledger = await loadPersonalImports(mockScope);
  expect(ledger.records).toHaveLength(2);
  expect(ledger.records.map((row) => [row.startPeriod, row.endPeriod])).toEqual([[undefined, undefined], [undefined, undefined]]);
  expect(ledger.records[0]).toMatchObject({ dayOfWeek: 6, startTime: '09:15', endTime: '12:20' });
  expect(personalImportCourses(ledger.records, 'pu')).toEqual([]);
  const today = buildPersonalToday(ledger.records, { schoolId: 'pu', now: new Date('2026-10-31T00:00:00Z') });
  expect(today.today).toHaveLength(1);
  expect(today.today[0]).toMatchObject({ startTime: '09:15', endTime: '12:20', row: { title: '週末實習' } });
  const conflict = { ...ledger.records[1], startPeriod: 2, endPeriod: 3 };
  expect(validatePersonalImportRow(conflict, { periodProfile: 'pu' })).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'period-time-conflict', severity: 'error' })]));
});

test('the primary timetable entry saves the chosen school term and displays weekend classes after leaving the preview', async () => {
  jest.mocked(loadOwnedSchoolCourses).mockResolvedValue(result([
    course(), course({ code: 'SUN', name: '週日實作', dayOfWeek: 7, startTime: null, endTime: null }),
  ]));
  const view = render(<PersonalTimetableScreen />);
  await view.findByText('讀取校方課表');
  await read(view); await confirm(view, 2);
  await view.findByText('週日實作');
  expect(view.getByText(/週日 · 09:10–11:00/)).toBeTruthy();
  expect(view.getByText('程式設計')).toBeTruthy();
  expect(view.getByText(/正在查看：115／1/)).toBeTruthy();
  view.unmount();
  const reopened = render(<PersonalTimetableScreen />);
  await reopened.findByText('週日實作');
  expect(reopened.getByText(/週日 · 09:10–11:00/)).toBeTruthy();
  expect(reopened.queryByText('週日實作 · 3 學分')).toBeNull();
  expect(loadOwnedSchoolCourses).toHaveBeenCalledTimes(1);
});

test('unknown time stays visible, cannot be selected and cannot silently create a default class', async () => {
  jest.mocked(loadOwnedSchoolCourses).mockResolvedValue(result([course(), course({ code: 'PROJECT', name: '專題研究', dayOfWeek: null, periods: [], startTime: null, endTime: null, timePlaceRaw: '時間另訂' })]));
  const view = render(panel()); await read(view);
  expect(view.getByText('校方原文：時間另訂')).toBeTruthy();
  expect(view.getByLabelText('帶入專題研究，來源第 2 筆').props.accessibilityState.disabled).toBe(true);
  await confirm(view, 1);
  expect(view.getByText('校方原文：時間另訂')).toBeTruthy();
  expect((await loadPersonalImports(mockScope)).records.map((row) => row.title)).toEqual(['程式設計']);
});

test('missing term and time can be corrected in place without changing original evidence or writing before confirmation', async () => {
  jest.mocked(loadOwnedSchoolCourses).mockResolvedValue(result([course({ name: '專題研究', dayOfWeek: null, periods: [], startTime: null, endTime: null, timePlaceRaw: '時間另訂' })], null));
  const view = render(panel()); await read(view);
  fireEvent.press(view.getByText('補齊這筆資料：專題研究'));
  fireEvent.changeText(view.getByLabelText('修正：學年度'), '115');
  fireEvent.changeText(view.getByLabelText('修正：學期'), '1');
  fireEvent.changeText(view.getByLabelText('修正：星期（1 至 7）'), '7');
  fireEvent.changeText(view.getByLabelText('修正：開始節次'), '2');
  fireEvent.changeText(view.getByLabelText('修正：結束節次'), '3');
  fireEvent.press(view.getByText('套用這筆修正'));
  expect(view.getByText(/個人帶入內容：115／1 · 週日 · 09:10–11:00/)).toBeTruthy();
  expect(view.getByText('校方原文：時間另訂')).toBeTruthy();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  await confirm(view, 1);
  const ledger = await loadPersonalImports(mockScope);
  expect(ledger.records[0]).toMatchObject({ academicYear: '115', semester: '1', dayOfWeek: 7, startTime: '09:10', endTime: '11:00' });
  expect(JSON.parse(ledger.records[0].source.rawText)).toMatchObject({ dayOfWeek: null, periods: [], timePlaceRaw: '時間另訂' });
  expect(mockSaved).toHaveBeenCalledWith('115|1');
});

test('duplicate source rows remain visible, deduplicate at confirmation and repeated reads never add another copy', async () => {
  jest.mocked(loadOwnedSchoolCourses).mockResolvedValue(result([course(), course()]));
  const view = render(panel()); await read(view);
  expect(view.getAllByText('程式設計 · 3 學分')).toHaveLength(2);
  fireEvent.press(view.getByText('核對並帶入 2 筆'));
  await view.findByText('確認新增 1 筆、更新 0 筆');
  await act(async () => fireEvent.press(view.getByText('確認新增 1 筆、更新 0 筆')));
  expect((await loadPersonalImports(mockScope)).records).toHaveLength(1);
  expect(view.getByText('已新增 1 筆、更新 0 筆；相同略過 1 筆、保留原有資料 0 筆。')).toBeTruthy();
  jest.mocked(AsyncStorage.setItem).mockClear();
  fireEvent.press(view.getByText('重新讀取校方課表'));
  await waitFor(() => expect(loadOwnedSchoolCourses).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.getByLabelText('核對並帶入 2 筆').props.accessibilityState.disabled).toBe(false));
  fireEvent.press(view.getByText('核對並帶入 2 筆'));
  await view.findByText('確認新增 0 筆、更新 0 筆');
  await act(async () => fireEvent.press(view.getByText('確認新增 0 筆、更新 0 筆')));
  expect((await loadPersonalImports(mockScope)).records).toHaveLength(1);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('failed refresh keeps the previous source readable and never erases saved classes', async () => {
  const view = render(panel()); await read(view); await confirm(view, 1);
  const before = await loadPersonalImports(mockScope);
  jest.mocked(AsyncStorage.setItem).mockClear();
  jest.mocked(loadOwnedSchoolCourses).mockRejectedValueOnce(new Error('校方暫時無法回應'));
  fireEvent.press(view.getByText('重新讀取校方課表'));
  await view.findByText('校方暫時無法回應');
  expect(view.getByText('程式設計 · 3 學分')).toBeTruthy();
  expect(view.getByLabelText('核對並帶入 1 筆').props.accessibilityState.disabled).toBe(true);
  expect(await loadPersonalImports(mockScope)).toEqual(before);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('late school reads and an open review cannot cross either school or platform account boundaries', async () => {
  const pending = deferred<PUCourseResult>();
  jest.mocked(loadOwnedSchoolCourses).mockReturnValueOnce(pending.promise);
  const view = render(panel()); fireEvent.press(view.getByText('讀取校方課表'));
  mockUser = { uid: 'student-b' }; mockScope = { owner: 'nuni:account-b', schoolId: 'pu' };
  view.rerender(panel());
  await act(async () => pending.resolve(result()));
  expect(view.queryByText('程式設計 · 3 學分')).toBeNull();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  await read(view);
  fireEvent.press(view.getByText('核對並帶入 1 筆'));
  await view.findByText('確認新增 1 筆、更新 0 筆');
  mockScope = { owner: 'nuni:account-c', schoolId: 'pu' };
  view.rerender(panel());
  expect(view.queryByText('確認新增 1 筆、更新 0 筆')).toBeNull();
  expect((await loadPersonalImports(mockScope)).records).toEqual([]);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('scope invalidation blocks confirmation and two-step undo restores only the completed transaction', async () => {
  let valid = true;
  const view = render(panel(mockScope, mockUser!.uid, () => valid));
  await read(view); fireEvent.press(view.getByText('核對並帶入 1 筆'));
  await view.findByText('確認新增 1 筆、更新 0 筆');
  valid = false;
  await act(async () => fireEvent.press(view.getByText('確認新增 1 筆、更新 0 筆')));
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  valid = true;
  await act(async () => fireEvent.press(view.getByText('確認新增 1 筆、更新 0 筆')));
  expect((await loadPersonalImports(mockScope)).records).toHaveLength(1);
  fireEvent.press(view.getByText('撤回這次帶入'));
  expect((await loadPersonalImports(mockScope)).records).toHaveLength(1);
  await act(async () => fireEvent.press(view.getByText('確認撤回這次帶入')));
  expect((await loadPersonalImports(mockScope)).records).toEqual([]);
  expect(view.getByText('已撤回這次帶入，恢復核對前的個人紀錄。')).toBeTruthy();
});

test('guests are offered the existing school connection flow without attempting a read', () => {
  mockUser = null;
  const view = render(panel());
  fireEvent.press(view.getByText('連線學校帳號讀取課表'));
  expect(mockConnect).toHaveBeenCalledTimes(1);
  expect(loadOwnedSchoolCourses).not.toHaveBeenCalled();
});
