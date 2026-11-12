import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { CourseCatalogScreen } from '../screens/CourseCatalogScreen';
import { queryCatalog } from '../services/courseCatalogClient';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { personalImportStorageKey } from '../services/personalImports';
let mockScope: { owner: string; schoolId: string } | null = { owner: 'guest:device', schoolId: 'ncnu' };
jest.mock('../state/personalImportScope', () => ({ usePersonalImportScope: () => mockScope }));
let mockSchoolId = 'ncnu';
const setBrowsingSchoolId = (value: string) => { mockSchoolId = value; };
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchoolId, name: mockSchoolId } }) }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));
jest.mock('../state/schedule', () => ({ useSchedule: () => ({ courses: [] }) }));
jest.mock('../services/courseCatalogClient', () => ({ queryCatalog: jest.fn() }));
jest.mock('../services/analytics', () => ({ analytics: {} }));
jest.mock('../services/tronClassWebUiGate', () => ({}));
jest.mock('../services/tronClassDataEnabled', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/navigationTheme', () => ({
  useTabBarContentBottomPadding: () => 0, TAB_BAR_CONTENT_BOTTOM_PADDING: 0,
}));
beforeEach(() => { jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never); });
afterEach(() => { jest.restoreAllMocks(); });

function ncnuJson(courses: unknown[], schoolId = 'ncnu') {
  return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({
    schoolId, sourceUrl: 'https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?cmd=resetall',
    truncated: false, courses,
  }) };
}
const ncnuDatabaseCourse = {
  code: '130032', section: '0', title: '資料庫管理系統', department: '資管系', teacher: '', time: '4efg',
  room: '管268', semester: '1151', credits: '3.0',
};

test('NCNU guest catalog opens directly and supports code search, empty results and the official guest link', async () => {
  setBrowsingSchoolId('ncnu');
  const original = globalThis.fetch;
  const fetchSource = jest.fn().mockResolvedValueOnce(ncnuJson([ncnuDatabaseCourse])).mockResolvedValueOnce(ncnuJson([]));
  try {
    globalThis.fetch = fetchSource;
    const view = render(<CourseCatalogScreen />);
    const input = await view.findByLabelText('搜尋暨大課程');
    fireEvent.changeText(input, '130032');
    fireEvent.press(view.getByText('查詢課程'));
    expect(await view.findByText('資料庫管理系統')).toBeTruthy();
    expect(view.getByText('星期四 e、f、g 節 · 13:30–16:20 · 管268')).toBeTruthy();
    expect(fetchSource).toHaveBeenCalledWith('https://nuni.tw/api/public-course-catalog?schoolId=ncnu&q=130032', expect.objectContaining({ credentials: 'omit' }));
    fireEvent.changeText(input, '其他');
    fireEvent.press(view.getByText('查詢課程'));
    expect(await view.findByText('找不到「其他」的開課資料。')).toBeTruthy();
    fireEvent.press(view.getByText('開啟暨大官方課程目錄'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?cmd=resetall');
    expect(queryCatalog).not.toHaveBeenCalled();
  } finally { globalThis.fetch = original; }
});

test('NCNU late response is cancelled on school switch and a different-campus payload fails closed', async () => {
  setBrowsingSchoolId('ncnu');
  const original = globalThis.fetch;
  let finish!: (data: ReturnType<typeof ncnuJson>) => void;
  const fetchSource = jest.fn().mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(ncnuJson([ncnuDatabaseCourse], 'pu'));
  try {
    globalThis.fetch = fetchSource;
    const view = render(<CourseCatalogScreen route={{ params: { filter: { keyword: '資料庫' } } }} />);
    await waitFor(() => expect(fetchSource).toHaveBeenCalledTimes(1));
    setBrowsingSchoolId('ncku');
    view.rerender(<CourseCatalogScreen />);
    await waitFor(() => expect(view.queryByLabelText('搜尋暨大課程')).toBeNull());
    expect(fetchSource.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { finish(ncnuJson([ncnuDatabaseCourse])); });
    expect(view.queryByText('資料庫管理系統')).toBeNull();
    setBrowsingSchoolId('ncnu');
    view.rerender(<CourseCatalogScreen route={{ params: { filter: { keyword: '資料庫' } } }} />);
    expect(await view.findByText('暫時無法讀取暨大課程，請重試或查看官方課程目錄。')).toBeTruthy();
    expect(view.queryByText('資料庫管理系統')).toBeNull();
  } finally { globalThis.fetch = original; }
});

const navigation = () => ({ navigate: jest.fn(), getState: () => ({ routeNames: ['PersonalTimetable', 'PersonalImport'] }) });
const draftKey = `${personalImportStorageKey({ owner: 'guest:device', schoolId: 'ncnu' })}:grid-draft:v1`;

test('暨大保留課表及匯入入口，查課後建立可核對的草稿再導向匯入頁', async () => {
  await AsyncStorage.clear();
  setBrowsingSchoolId('ncnu');
  mockScope = { owner: 'guest:device', schoolId: 'ncnu' };
  const original = globalThis.fetch;
  globalThis.fetch = jest.fn().mockResolvedValue(ncnuJson([ncnuDatabaseCourse]));
  try {
    const nav = navigation();
    const view = render(<CourseCatalogScreen navigation={nav} />);
    fireEvent.press(view.getByText('查看我的課表'));
    expect(nav.navigate).toHaveBeenLastCalledWith('PersonalTimetable', undefined);
    fireEvent.press(view.getByText('匯入我的資料'));
    expect(nav.navigate).toHaveBeenLastCalledWith('PersonalImport', undefined);
    fireEvent.press(view.getByText('查詢課程'));
    fireEvent.press(await view.findByText('帶入課表核對'));
    await waitFor(() => expect(nav.navigate).toHaveBeenLastCalledWith('PersonalImport', { kind: 'timetable' }));
    const draft = JSON.parse((await AsyncStorage.getItem(draftKey))!);
    expect(draft).toMatchObject({ version: 1, kind: 'timetable', academicYear: '115', semester: '1' });
    expect(draft.rows).toEqual([expect.objectContaining({ schoolId: 'ncnu', title: '資料庫管理系統', courseCode: '130032', className: '0', location: '管268', dayOfWeek: 4, startTime: '13:30', endTime: '16:20', credits: 3 })]);
    expect(draft.selected).toEqual(draft.rows.map((row: { id: string }) => row.id));
    expect(draft.issues.some((issue: { severity: string }) => issue.severity === 'error')).toBe(false);
  } finally { globalThis.fetch = original; }
});

test.each(['原有草稿', JSON.stringify({ version: 1, kind: 'grades', academicYear: '', semester: '', text: '尚未完成', source: { type: 'paste' }, rows: [], issues: [], selected: [], editedIds: [], backupPreview: null })])('既有或損壞草稿 %s 及未確認帳號不會被查課結果覆蓋', async (raw) => {
  setBrowsingSchoolId('ncnu');
  mockScope = { owner: 'guest:device', schoolId: 'ncnu' };
  await AsyncStorage.setItem(draftKey, raw);
  const original = globalThis.fetch;
  globalThis.fetch = jest.fn().mockResolvedValue(ncnuJson([ncnuDatabaseCourse]));
  try {
    const nav = navigation();
    const view = render(<CourseCatalogScreen navigation={nav} />);
    fireEvent.press(view.getByText('查詢課程'));
    fireEvent.press(await view.findByText('帶入課表核對'));
    await view.findByText('匯入頁已有待核對的草稿，請先前往「匯入我的資料」處理。');
    expect(await AsyncStorage.getItem(draftKey)).toBe(raw);
    mockScope = null;
    view.rerender(<CourseCatalogScreen navigation={nav} />);
    fireEvent.press(view.getByText('帶入課表核對'));
    await view.findByText('請先確認目前帳號與所選校園，再帶入課表核對。');
    expect(nav.navigate).not.toHaveBeenCalled();
  } finally { globalThis.fetch = original; mockScope = { owner: 'guest:device', schoolId: 'ncnu' }; }
});
