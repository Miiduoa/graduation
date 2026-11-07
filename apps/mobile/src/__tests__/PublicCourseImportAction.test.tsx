import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PublicCatalogCourse } from '@campus/shared/src/publicCourseCatalog';
import { PublicCourseImportAction } from '../components/PublicCourseImportAction';
import { preparePublicCourseTimetableImport } from '../services/publicCourseTimetableImport';
import * as ledger from '../services/personalImports';
import { safeNavigate } from '../utils/safeNavigate';

let mockScope: ledger.PersonalImportScope | null;
const mockFocus = { enter: () => {}, leave: () => {} };
jest.mock('../state/personalImportScope', () => ({ usePersonalImportScope: () => mockScope }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn(() => true) }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => undefined | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {
      let cleanup = effect();
      const enter = () => { cleanup?.(); cleanup = effect(); };
      const leave = () => { cleanup?.(); cleanup = undefined; };
      mockFocus.enter = enter;
      mockFocus.leave = leave;
      return () => {
        leave();
        if (mockFocus.enter === enter) { mockFocus.enter = () => {}; mockFocus.leave = () => {}; }
      };
    }, [effect]);
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/navigationTheme', () => ({
  // Preserve layout hooks used by the real Button and its loading overlay.
  ...jest.requireActual('../ui/navigationTheme'),
  useTabBarContentBottomPadding: () => 0, TAB_BAR_CONTENT_BOTTOM_PADDING: 0,
}));

const scope = { owner: 'guest:device', schoolId: 'nthu' };
const nthu: PublicCatalogCourse = {
  code: '11510AES 520300', section: '00', title: '分析化學專題', department: 'AES', teacher: '王老師',
  time: 'M3M4\nR5R6', room: '教室甲\n教室乙', semester: '1151', credits: '3',
  meetings: [{ time: 'M3M4', room: '教室甲' }, { time: 'R5R6', room: '教室乙' }],
};
const ncnu: PublicCatalogCourse = {
  code: '130032', section: '0', title: '資料庫管理系統', department: '資管系', teacher: '',
  time: '4efg', room: '管268', semester: '1151', credits: '3.0',
};
const navigation = { navigate: jest.fn() };
const renderAction = () => render(<PublicCourseImportAction schoolId="nthu" course={nthu} navigation={navigation} />);
const rerenderAction = (view: ReturnType<typeof render>) => view.rerender(
  <PublicCourseImportAction schoolId="nthu" course={nthu} navigation={navigation} />,
);
function review(view: ReturnType<typeof render>) { fireEvent.press(view.getByText('核對並加入課表')); }
function confirm(view: ReturnType<typeof render>) { fireEvent.press(view.getByText('確認加入個人課表')); }

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockScope = scope;
});
afterEach(() => { jest.restoreAllMocks(); });

test('uses real serializers and parser for both schools and preserves padded codes and room pairs', () => {
  const preview = preparePublicCourseTimetableImport('nthu', nthu)!;
  expect(preview.term).toBe('115|1');
  expect(preview.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  expect(preview.rows).toEqual([
    expect.objectContaining({ schoolId: 'nthu', courseCode: nthu.code, className: '00', dayOfWeek: 1, startTime: '10:10', endTime: '12:00', location: '教室甲' }),
    expect.objectContaining({ schoolId: 'nthu', courseCode: nthu.code, className: '00', dayOfWeek: 4, startTime: '13:20', endTime: '15:10', location: '教室乙' }),
  ]);
  expect(preparePublicCourseTimetableImport('ncnu', ncnu)?.rows).toEqual([
    expect.objectContaining({ schoolId: 'ncnu', courseCode: '130032', dayOfWeek: 4, startTime: '13:30', endTime: '16:20', location: '管268' }),
  ]);
});

test('unverified semesters, missing meetings and invalid identities have no direct-add action', () => {
  expect(preparePublicCourseTimetableImport('nthu', { ...nthu, semester: '1161', code: '11610AES 520300' })).toBeNull();
  expect(preparePublicCourseTimetableImport('ncnu', { ...ncnu, semester: '1161' })).toBeNull();
  expect(preparePublicCourseTimetableImport('nthu', { ...nthu, code: 'not-a-course' })).toBeNull();
  const view = render(<PublicCourseImportAction schoolId="nthu" course={{ ...nthu, meetings: [] }} />);
  expect(view.queryByText('核對並加入課表')).toBeNull();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('requires explicit review and confirmation, preserves existing records and both draft stores', async () => {
  const existing = preparePublicCourseTimetableImport('nthu', {
    ...nthu, code: '11510AES 520400', title: '既有課程', meetings: [{ time: 'T1T2', room: '原教室' }],
  })!;
  await ledger.appendPersonalImports(scope, existing.rows);
  const key = ledger.personalImportStorageKey(scope);
  const gridKey = `${key}:grid-draft:v1`;
  const partialKey = 'campus.personal-import-draft.v1:guest%3Adevice:nthu';
  await AsyncStorage.multiSet([[gridKey, 'original-grid-draft'], [partialKey, 'original-partial-draft']]);
  jest.clearAllMocks();
  const append = jest.spyOn(ledger, 'appendPersonalImports');
  const view = renderAction();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  review(view);
  expect(view.getByText(/分析化學專題 · 星期一 10:10–12:00/)).toBeTruthy();
  expect(view.getByText(/分析化學專題 · 星期四 13:20–15:10/)).toBeTruthy();
  expect(view.getByText(/不代表校方選課成功/)).toBeTruthy();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(append).not.toHaveBeenCalled();
  confirm(view);
  await view.findByText('已加入 2 個上課時段。');
  expect(append).toHaveBeenCalledTimes(1);
  const saved = await ledger.loadPersonalImports(scope);
  expect(saved.records).toHaveLength(3);
  expect(saved.records.filter((row) => row.title === '既有課程')).toHaveLength(1);
  expect(jest.mocked(AsyncStorage.setItem).mock.calls.map(([path]) => path)).toEqual([key]);
  expect(await AsyncStorage.getItem(gridKey)).toBe('original-grid-draft');
  expect(await AsyncStorage.getItem(partialKey)).toBe('original-partial-draft');
  fireEvent.press(view.getByText('查看個人課表'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'PersonalTimetable', {
    term: '115|1', reminderScope: JSON.stringify(scope),
  });
});

test('NCNU confirmation saves the verified Thursday clock without clipboard or importer navigation', async () => {
  mockScope = { owner: 'nuni:student-a', schoolId: 'ncnu' };
  const view = render(<PublicCourseImportAction schoolId="ncnu" course={ncnu} />);
  review(view);
  confirm(view);
  await view.findByText('已加入 1 個上課時段。');
  const saved = await ledger.loadPersonalImports(mockScope);
  expect(saved.records[0]).toMatchObject({ dayOfWeek: 4, startTime: '13:30', endTime: '16:20', location: '管268' });
  expect(safeNavigate).not.toHaveBeenCalled();
});

test('reopening and confirming the same course uses ledger deduplication', async () => {
  const view = renderAction();
  review(view); confirm(view);
  await view.findByText('已加入 2 個上課時段。');
  fireEvent.press(view.getByText('收起核對'));
  review(view); confirm(view);
  await view.findByText('這些時段已在個人課表，沒有重複新增。');
  expect((await ledger.loadPersonalImports(scope)).records).toHaveLength(2);
});

test('partial duplicates keep existing rows and add only the missing meeting', async () => {
  const preview = preparePublicCourseTimetableImport('nthu', nthu)!;
  await ledger.appendPersonalImports(scope, [preview.rows[0]]);
  const view = renderAction();
  review(view); confirm(view);
  await view.findByText('已加入 1 個上課時段。另有 1 個重複時段未新增。');
  expect((await ledger.loadPersonalImports(scope)).records).toHaveLength(2);
});

test.each([null, { owner: 'guest:device', schoolId: 'ncnu' }])('unresolved or different-school scope cannot confirm (%j)', (nextScope) => {
  mockScope = nextScope;
  const view = renderAction();
  review(view);
  expect(view.queryByText('確認加入個人課表')).toBeNull();
  expect(view.getByText(/請先確認目前帳號與所選學校/)).toBeTruthy();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('storage failure is not success, and retry works without losing the preview', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('device unavailable'));
  const view = renderAction();
  review(view); confirm(view);
  await view.findByText(/未能確認加入結果/);
  expect(view.queryByText('查看個人課表')).toBeNull();
  confirm(view);
  await view.findByText('已加入 2 個上課時段。');
  expect((await ledger.loadPersonalImports(scope)).records).toHaveLength(2);
});

test('a changed instructor cannot create a second catalog class slot', async () => {
  const preview = preparePublicCourseTimetableImport('nthu', nthu)!;
  await ledger.appendPersonalImports(scope, preview.rows.map((row) => ({ ...row, teacher: '本人修正的教師' })));
  const before = await AsyncStorage.getItem(ledger.personalImportStorageKey(scope));
  jest.clearAllMocks();
  const view = renderAction();
  review(view); confirm(view);
  await view.findByText(/未能確認加入結果/);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(ledger.personalImportStorageKey(scope))).toBe(before);
});

test.each(['account', 'school', 'unresolved', 'away-and-back'])('a delayed read cannot save after scope changes: %s', async (change) => {
  let finish!: (value: string | null) => void;
  const read = jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = renderAction();
  review(view); confirm(view);
  await waitFor(() => expect(read).toHaveBeenCalled());
  mockScope = change === 'school' ? { owner: scope.owner, schoolId: 'ncnu' }
    : change === 'unresolved' ? null : { owner: 'nuni:another-student', schoolId: 'nthu' };
  rerenderAction(view);
  if (change === 'away-and-back') { mockScope = scope; rerenderAction(view); }
  await act(async () => { finish(null); });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(view.queryByText('已加入 2 個上課時段。')).toBeNull();
  expect(view.queryByText(/未能確認加入結果/)).toBeNull();
  expect(safeNavigate).not.toHaveBeenCalled();
});

test('leaving and returning invalidates pending work, rejects double taps and permits a fresh retry', async () => {
  let finish!: (value: string | null) => void;
  const read = jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const append = jest.spyOn(ledger, 'appendPersonalImports');
  const view = renderAction();
  review(view);
  const button = view.getByText('確認加入個人課表');
  fireEvent.press(button); fireEvent.press(button);
  await waitFor(() => expect(read).toHaveBeenCalled());
  expect(append).toHaveBeenCalledTimes(1);
  act(() => { mockFocus.leave(); });
  act(() => { mockFocus.enter(); });
  await act(async () => { finish(null); });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(view.queryByText('已加入 2 個上課時段。')).toBeNull();
  confirm(view);
  await view.findByText('已加入 2 個上課時段。');
  expect(append).toHaveBeenCalledTimes(2);
});
