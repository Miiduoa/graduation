import React from 'react';
import { AppState } from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { SchoolPortalImportEntry } from '../components/SchoolPortalImport';
import { appendPersonalImports } from '../services/personalImports';

let mockSchool = { id: 'pu', name: '靜宜大學' };
let mockScope: { owner: string; schoolId: string } | null = { owner: 'guest:device', schoolId: 'pu' };
let mockSerial = 0;
const mockInject = jest.fn(), mockOpenRecords = jest.fn();
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/personalImportScope', () => ({ usePersonalImportScope: () => mockScope }));
jest.mock('../state/theme', () => ({ useThemeMode: () => ({ mode: 'light' }) }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `request_${++mockSerial}_12345678` }));
jest.mock('react-native-webview', () => {
  const R = jest.requireActual('react'), { View } = jest.requireActual('react-native');
  return { WebView: R.forwardRef(function MockBrowser(props: Record<string, unknown>, ref: unknown) {
    R.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject, goBack: jest.fn() }));
    return R.createElement(View, props);
  }) };
});
jest.mock('../ui/components', () => {
  const R = jest.requireActual('react'), { Pressable, Text } = jest.requireActual('react-native');
  return { Button: ({ text, disabled, onPress }: { text: string; disabled?: boolean; onPress(): void }) =>
    R.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: text, accessibilityState: { disabled: !!disabled }, disabled, onPress }, R.createElement(Text, null, text)) };
});
jest.mock('../services/personalImports', () => ({ appendPersonalImports: jest.fn(), undoLastPersonalImport: jest.fn() }));
jest.mock('../components/SchoolPortalReimport', () => {
  const R = jest.requireActual('react'), { View } = jest.requireActual('react-native');
  return { SchoolPortalReimport: (props: Record<string, unknown>) => R.createElement(View, { ...props, testID: 'batch-reimport-review' }) };
});
const table = (title = '統計學', grade = '80', credit = '3') => `<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr><tr><td>${title}</td><td>${credit}</td><td>${grade}</td></tr></table>`;
const tree = () => <SchoolPortalImportEntry onOpenRecords={mockOpenRecords} />;
type Rendered = ReturnType<typeof render>;
function open(view: Rendered, html = table() + table('英文', '90')) {
  fireEvent.press(view.getByText('在 App 內開啟校務網站匯入'));
  fireEvent.press(view.getByText('改為成績'));
  fireEvent.press(view.getByText('同意並開啟校方網站'));
  act(() => view.getByTestId('school-portal-browser').props.onLoad());
  fireEvent.press(view.getByText('讀取這頁表格'));
  const script = String(mockInject.mock.calls[mockInject.mock.calls.length - 1][0]);
  const id = JSON.parse(/var id = ("[^"]+");/.exec(script)![1]);
  const origin = 'https://alcat.pu.edu.tw';
  act(() => view.getByTestId('school-portal-browser').props.onMessage({ nativeEvent: { url: origin + '/grades',
    data: JSON.stringify({ version: 1, id, origin, html, blockedFrames: 0 }) } }));
  fireEvent.press(view.getByText('一次核對多張表格'));
}
function pick(view: Rendered, number: number, year = '115', semester = '1') {
  fireEvent.press(view.getByLabelText(`選取表格 ${number}`));
  fireEvent.changeText(view.getByLabelText(`表格 ${number} 學年度`), year);
  fireEvent.changeText(view.getByLabelText(`表格 ${number} 學期`), semester);
}
function prepare(view: Rendered) { pick(view, 1, '114', '2'); pick(view, 2); fireEvent.press(view.getByText('核對所選 2 張表格')); }
const save = async (view: Rendered, count = 2) => { await act(async () => fireEvent.press(view.getByText(`確認匯入 ${count} 筆`))); };
beforeEach(() => {
  jest.clearAllMocks(); mockSerial = 0;
  mockSchool = { id: 'pu', name: '靜宜大學' }; mockScope = { owner: 'guest:device', schoolId: 'pu' };
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  jest.mocked(appendPersonalImports).mockReset().mockResolvedValue({ added: 2, duplicates: 0,
    ledger: { version: 1, records: [], batches: [{ id: 'both-terms', createdAt: '2026-10-28T00:00:00Z', count: 2 }] } });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

test('does not preselect tables or save on capture, selection or preparation', async () => {
  const view = render(tree()); open(view);
  expect(view.getByLabelText('選取表格 1').props.accessibilityState.checked).toBe(false);
  expect(view.getByLabelText('核對所選 0 張表格').props.accessibilityState.disabled).toBe(true);
  prepare(view);
  expect(appendPersonalImports).not.toHaveBeenCalled(); expect(mockInject).toHaveBeenCalledTimes(1);
  expect(view.getByText(/已整理 2 張表格/)).toBeTruthy();
  await save(view);
  expect(appendPersonalImports).toHaveBeenCalledTimes(1);
  expect(jest.mocked(appendPersonalImports).mock.calls[0][1].map((row) => [row.title, row.academicYear, row.semester])).toEqual([['統計學', '114', '2'], ['英文', '115', '1']]);
});
test('keeps same-name records from different terms distinct', async () => {
  const view = render(tree()); open(view, table() + table('統計學', '90')); prepare(view); await save(view);
  const rows = jest.mocked(appendPersonalImports).mock.calls[0][1];
  expect(rows).toHaveLength(2); expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  expect(rows.map((row) => row.grade)).toEqual(['80', '90']);
});
test('only sends explicitly chosen tables, even when selecting in reverse source order', async () => {
  const view = render(tree()); open(view, table() + table('英文') + table('經濟'));
  pick(view, 3); pick(view, 1); fireEvent.press(view.getByText('核對所選 2 張表格')); await save(view);
  expect(jest.mocked(appendPersonalImports).mock.calls[0][1].map((row) => row.title)).toEqual(['統計學', '經濟']);
});
test('keeps missing terms visible as errors instead of borrowing a neighboring semester', () => {
  const view = render(tree()); open(view); pick(view, 1); pick(view, 2, '', '');
  fireEvent.press(view.getByText('核對所選 2 張表格'));
  expect(view.getByLabelText('確認匯入 2 筆').props.accessibilityState.disabled).toBe(true);
  expect(view.getByText(/待修正 1 筆/)).toBeTruthy();
  fireEvent.press(view.getByText('確認匯入 2 筆')); expect(appendPersonalImports).not.toHaveBeenCalled();
});
test('edits a bad second-table credit without losing its origin or touching the first row', async () => {
  const view = render(tree()); open(view, table() + table('英文', '90', '3O')); prepare(view);
  expect(view.getByLabelText('確認匯入 2 筆').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByText('修正欄位：英文'));
  fireEvent.changeText(view.getByLabelText('修正：學分'), '2');
  fireEvent.press(view.getByText('套用這筆修正')); await save(view);
  const rows = jest.mocked(appendPersonalImports).mock.calls[0][1];
  expect(rows[0].credits).toBe(3); expect(rows[1].credits).toBe(2);
  expect(rows[1].source.name).toContain('表格 2'); expect(rows[1].source.rawText).toContain('3O');
});
test('keeps the batch and term boundaries after returning to the same school page', async () => {
  const view = render(tree()); open(view); prepare(view);
  fireEvent.press(view.getByText('回校方頁面核對'));
  fireEvent.press(view.getByText('繼續核對未儲存表格'));
  expect(view.getByText(/已整理 2 張表格/)).toBeTruthy();
  expect(mockInject).toHaveBeenCalledTimes(1); await save(view);
  expect(jest.mocked(appendPersonalImports).mock.calls[0][1][0].academicYear).toBe('114');
});
test('requires confirmation before replacing multi-table corrections by original data', async () => {
  const view = render(tree()); open(view); prepare(view);
  fireEvent.press(view.getByText('修正欄位：統計學'));
  fireEvent.changeText(view.getByLabelText('修正：原始成績'), '88'); fireEvent.press(view.getByText('套用這筆修正'));
  fireEvent.press(view.getByText('整理並核對匯入內容'));
  expect(view.getByText(/重新整理會以原始表格取代/)).toBeTruthy();
  fireEvent.press(view.getByText('保留逐筆修正')); await save(view);
  expect(jest.mocked(appendPersonalImports).mock.calls[0][1][0].grade).toBe('88');
});
test('explicit reparse restores each table with its own fallback semester', async () => {
  const view = render(tree()); open(view); prepare(view);
  fireEvent.press(view.getByText('修正欄位：統計學'));
  fireEvent.changeText(view.getByLabelText('修正：原始成績'), '88'); fireEvent.press(view.getByText('套用這筆修正'));
  fireEvent.press(view.getByText('整理並核對匯入內容'));
  fireEvent.press(view.getByText('放棄逐筆修正並重新整理')); await save(view);
  const rows = jest.mocked(appendPersonalImports).mock.calls[0][1];
  expect(rows[0]).toMatchObject({ grade: '80', academicYear: '114', semester: '2' });
  expect(rows[1]).toMatchObject({ academicYear: '115', semester: '1' });
});
test('cancelling the multi-table picker leaves the original single-table workflow intact', () => {
  const view = render(tree()); open(view); pick(view, 1);
  fireEvent.press(view.getByText('返回單表選擇'));
  fireEvent.press(view.getByText(/表格 2 · 1 筆/));
  expect(view.getByLabelText('校務表格文字（可修正）').props.value).toContain('英文');
  expect(view.queryByText(/已整理 2 張表格/)).toBeNull();
});
test('keeps a multi-table preview after storage failure and allows deliberate retry', async () => {
  const view = render(tree()); open(view); prepare(view);
  jest.mocked(appendPersonalImports).mockRejectedValueOnce(new Error('儲存空間不足'));
  await save(view); expect(view.queryByText('匯入完成')).toBeNull();
  expect(view.getByText(/已整理 2 張表格/)).toBeTruthy(); await save(view);
  expect(appendPersonalImports).toHaveBeenCalledTimes(2);
});
test('passes all selected terms into the existing reimport review without writing on entry', () => {
  const view = render(tree()); open(view); prepare(view);
  fireEvent.press(view.getByText('核對重複與更新既有資料'));
  expect(view.getByTestId('batch-reimport-review').props.rows.map((row: { academicYear: string }) => row.academicYear)).toEqual(['114', '115']);
  expect(appendPersonalImports).not.toHaveBeenCalled();
});
test('destroys prepared multi-table data after account change', () => {
  const view = render(tree()); open(view); prepare(view);
  mockScope = { owner: 'nuni:other', schoolId: 'pu' }; view.rerender(tree());
  expect(view.queryByText(/已整理 2 張表格/)).toBeNull();
  expect(view.queryByText('確認匯入 2 筆')).toBeNull(); expect(appendPersonalImports).not.toHaveBeenCalled();
});
