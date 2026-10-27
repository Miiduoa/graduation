import React from 'react';
import { AppState } from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { SchoolPortalImportEntry } from '../components/SchoolPortalImport';
import { appendPersonalImports } from '../services/personalImports';
import { periodTimes, slotIndexForLabel } from '@campus/shared/src/timetable/periods';

let mockSchool = { id: 'pu', name: '靜宜大學' };
let mockScope: { owner: string; schoolId: string } | null = { owner: 'guest:device', schoolId: 'pu' };
let mockSerial = 0;
const mockInject = jest.fn();
const mockOpenRecords = jest.fn();
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/personalImportScope', () => ({ usePersonalImportScope: () => mockScope }));
jest.mock('../state/theme', () => ({ useThemeMode: () => ({ mode: 'light' }) }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => `request_${++mockSerial}_12345678` }));
jest.mock('react-native-webview', () => {
  const MockReact = jest.requireActual('react');
  const { View: MockView } = jest.requireActual('react-native');
  const MockWebView = MockReact.forwardRef(function MockPortalWebView(props: Record<string, unknown>, ref: unknown) {
    MockReact.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject, goBack: jest.fn() }));
    return MockReact.createElement(MockView, props);
  });
  return { WebView: MockWebView };
});
jest.mock('../ui/components', () => {
  const MockReact = jest.requireActual('react');
  const { Pressable, Text } = jest.requireActual('react-native');
  return { Button: ({ text, disabled, onPress }: { text: string; disabled?: boolean; onPress(): void }) =>
    MockReact.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: text, accessibilityState: { disabled: !!disabled }, disabled, onPress }, MockReact.createElement(Text, null, text)) };
});
jest.mock('../services/personalImports', () => ({ appendPersonalImports: jest.fn(), undoLastPersonalImport: jest.fn() }));
const origin = 'https://alcat.pu.edu.tw';
const html = (credit = '3', tail = '') => `<h2>115 學年度第 1 學期</h2><table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr><tr><td>統計學</td><td>${credit}</td><td>90</td></tr>${tail}</table>`;
const tree = () => <SchoolPortalImportEntry onOpenRecords={mockOpenRecords} />;
type Rendered = ReturnType<typeof render>;
function review(view: Rendered, content = html(), timetable = false) {
  fireEvent.press(view.getByText('在 App 內開啟校務網站匯入'));
  if (!timetable) fireEvent.press(view.getByText('改為成績'));
  fireEvent.press(view.getByText('同意並開啟校方網站'));
  act(() => view.getByTestId('school-portal-browser').props.onLoad());
  fireEvent.press(view.getByText('讀取這頁表格'));
  const script = String(mockInject.mock.calls[mockInject.mock.calls.length - 1][0]);
  const id = JSON.parse(/var id = ("[^"]+");/.exec(script)![1]);
  act(() => view.getByTestId('school-portal-browser').props.onMessage({ nativeEvent: { url: origin + '/grades',
    data: JSON.stringify({ version: 1, id, origin, html: content, blockedFrames: 0 }) } }));
  fireEvent.press(view.getByText(/表格 1 · \d+ 筆/));
  fireEvent.press(view.getByText('整理並核對匯入內容'));
}
const change = (view: Rendered, label: string, value: string) => fireEvent.changeText(view.getByLabelText(`修正：${label}`), value);
const save = async (view: Rendered, count = 1) => { await act(async () => fireEvent.press(view.getByText(`確認匯入 ${count} 筆`))); };
beforeEach(() => {
  jest.clearAllMocks(); mockSerial = 0;
  mockSchool = { id: 'pu', name: '靜宜大學' }; mockScope = { owner: 'guest:device', schoolId: 'pu' };
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  jest.mocked(appendPersonalImports).mockReset().mockResolvedValue({ added: 1, duplicates: 0,
    ledger: { version: 1, records: [], batches: [{ id: 'new', createdAt: '2026-10-27T15:00:00Z', count: 1 }] } });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

test('edits structured grade fields, preserves original evidence, and only writes on final confirmation', async () => {
  const view = render(tree()); review(view);
  fireEvent.press(view.getByText('修正欄位：統計學'));
  change(view, '課程名稱', '統計學修正'); change(view, '原始成績', '88'); change(view, '學分', '2');
  fireEvent.press(view.getByText('套用這筆修正'));
  expect(appendPersonalImports).not.toHaveBeenCalled();
  expect(view.getByText('已選：統計學修正')).toBeTruthy();
  expect(view.getByText('已手動修正，原始來源保留')).toBeTruthy();
  await save(view);
  const row = jest.mocked(appendPersonalImports).mock.calls[0][1][0];
  expect(row).toMatchObject({ title: '統計學修正', grade: '88', credits: 2, kind: 'grades', schoolId: 'pu' });
  expect(row.source.rawText).toContain('統計學'); expect(row.source.rawText).toContain('90');
  expect(row.source.rawText).not.toContain('統計學修正');
});

test('a real parser credit error is repairable without editing CSV or retaining stale validation errors', async () => {
  const view = render(tree()); review(view, html('3O'));
  expect(view.getByLabelText('確認匯入 1 筆').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByText('修正欄位：統計學'));
  change(view, '學分', '3'); fireEvent.press(view.getByText('套用這筆修正'));
  expect(view.getByLabelText('確認匯入 1 筆').props.accessibilityState.disabled).toBe(false);
  await save(view); expect(jest.mocked(appendPersonalImports).mock.calls[0][1][0].credits).toBe(3);
});

test('cancel discards uncommitted form values but keeps the parsed draft', async () => {
  const view = render(tree()); review(view);
  fireEvent.press(view.getByText('修正欄位：統計學')); change(view, '原始成績', '99');
  fireEvent.press(view.getByText('取消這筆修正')); await save(view);
  expect(jest.mocked(appendPersonalImports).mock.calls[0][1][0].grade).toBe('90');
});

test('prevents final import and raw-text changes while a row form is still open', () => {
  const view = render(tree()); review(view); fireEvent.press(view.getByText('修正欄位：統計學'));
  expect(view.getByLabelText('確認匯入 1 筆').props.accessibilityState.disabled).toBe(true);
  expect(view.getByLabelText('校務表格文字（可修正）').props.editable).toBe(false);
  expect(view.getByLabelText('回校方頁面核對').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByText('確認匯入 1 筆')); expect(appendPersonalImports).not.toHaveBeenCalled();
});

test('blocks invalid edits, including blank credits instead of silently writing zero', () => {
  const view = render(tree()); review(view); fireEvent.press(view.getByText('修正欄位：統計學'));
  change(view, '學分', '');
  expect(view.getByLabelText('套用這筆修正').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByText('套用這筆修正'));
  expect(view.getByTestId('portal-row-editor')).toBeTruthy(); expect(appendPersonalImports).not.toHaveBeenCalled();
});

test('shows original row evidence independently of edited values', () => {
  const view = render(tree()); review(view); fireEvent.press(view.getByText('修正欄位：統計學'));
  change(view, '原始成績', '98'); fireEvent.press(view.getByText('查看這筆原始來源'));
  expect(view.getByText(/來源第 2 行/)).toBeTruthy();
  expect(view.getAllByText(/統計學.*90/).length).toBeGreaterThan(0);
});

test('asks before reparsing the original text over applied manual corrections', () => {
  const view = render(tree()); review(view); fireEvent.press(view.getByText('修正欄位：統計學'));
  change(view, '原始成績', '88'); fireEvent.press(view.getByText('套用這筆修正'));
  fireEvent.press(view.getByText('整理並核對匯入內容'));
  expect(view.getByText(/重新整理會以原始表格取代/)).toBeTruthy();
  fireEvent.press(view.getByText('保留逐筆修正'));
  fireEvent.press(view.getByText('修正欄位：統計學')); expect(view.getByLabelText('修正：原始成績').props.value).toBe('88');
  fireEvent.press(view.getByText('取消這筆修正'));
  fireEvent.press(view.getByText('整理並核對匯入內容'));
  fireEvent.press(view.getByText('放棄逐筆修正並重新整理'));
  fireEvent.press(view.getByText('修正欄位：統計學')); expect(view.getByLabelText('修正：原始成績').props.value).toBe('90');
});

test('does not reselect an excluded row just because it was repaired', () => {
  const view = render(tree()); review(view, html('3O'));
  fireEvent.press(view.getByText('已選：統計學')); fireEvent.press(view.getByText('修正欄位：統計學'));
  change(view, '學分', '3'); fireEvent.press(view.getByText('套用這筆修正'));
  expect(view.getByText('未選：統計學')).toBeTruthy();
  expect(view.getByText('確認匯入 0 筆')).toBeTruthy(); expect(appendPersonalImports).not.toHaveBeenCalled();
});

test('selects valid rows only through an explicit action and does not silently delete invalid rows', async () => {
  const view = render(tree()); review(view, html('3O', '<tr><td>英文</td><td>2</td><td>A+</td></tr>'));
  expect(view.getByText('已選：統計學')).toBeTruthy();
  fireEvent.press(view.getByText('只選可匯入資料'));
  expect(view.getByText('未選：統計學')).toBeTruthy(); expect(view.getByText('已選：英文')).toBeTruthy();
  await save(view); expect(jest.mocked(appendPersonalImports).mock.calls[0][1]).toHaveLength(1);
  expect(jest.mocked(appendPersonalImports).mock.calls[0][1][0].title).toBe('英文');
});

test('changes the semester on one row without assigning it to another row', async () => {
  const view = render(tree()); review(view, html('3', '<tr><td>英文</td><td>2</td><td>90</td></tr>'));
  fireEvent.press(view.getByText('修正欄位：統計學')); change(view, '學年度', '114'); change(view, '學期', '2');
  fireEvent.press(view.getByText('套用這筆修正')); await save(view, 2);
  const rows = jest.mocked(appendPersonalImports).mock.calls[0][1];
  expect(rows.find((row) => row.title === '統計學')).toMatchObject({ academicYear: '114', semester: '2' });
  expect(rows.find((row) => row.title === '英文')).toMatchObject({ academicYear: '115', semester: '1' });
});

test('corrects timetable weekday, period and classroom with this school’s actual period mapping', async () => {
  const view = render(tree());
  review(view, '<h2>115 學年度第 1 學期</h2><table><tr><th>課程名稱</th><th>星期</th><th>開始節次</th><th>結束節次</th></tr><tr><td>資料庫</td><td>一</td><td>3</td><td>4</td></tr></table>', true);
  fireEvent.press(view.getByText('修正欄位：資料庫'));
  change(view, '星期（1 至 7）', '2'); change(view, '開始節次', '5'); change(view, '結束節次', '6'); change(view, '教室', '主顧305');
  fireEvent.press(view.getByText('套用這筆修正')); await save(view);
  const row = jest.mocked(appendPersonalImports).mock.calls[0][1][0]; const slot = slotIndexForLabel('5', 'pu')!;
  expect(row).toMatchObject({ dayOfWeek: 2, startPeriod: slot, location: '主顧305', startTime: periodTimes('pu')[slot - 1][0] });
});

test('destroys an open row editor when account scope changes', () => {
  const view = render(tree()); review(view); fireEvent.press(view.getByText('修正欄位：統計學'));
  change(view, '原始成績', '99'); mockScope = { owner: 'nuni:two', schoolId: 'pu' }; view.rerender(tree());
  expect(view.queryByTestId('portal-row-editor')).toBeNull(); expect(appendPersonalImports).not.toHaveBeenCalled();
});

test('preserves applied corrections through a storage failure and retry', async () => {
  const view = render(tree()); review(view); fireEvent.press(view.getByText('修正欄位：統計學'));
  change(view, '原始成績', '88'); fireEvent.press(view.getByText('套用這筆修正'));
  jest.mocked(appendPersonalImports).mockRejectedValueOnce(new Error('暫時無法儲存'));
  await save(view); expect(view.getByText('已手動修正，原始來源保留')).toBeTruthy();
  await save(view);
  expect(jest.mocked(appendPersonalImports).mock.calls.map((call) => call[1][0].grade)).toEqual(['88', '88']);
});

test('bulk selection includes rows below the first rendered page and remains reversible', () => {
  const tail = Array.from({ length: 24 }, (_, i) => `<tr><td>科目${i}</td><td>2</td><td>80</td></tr>`).join('');
  const view = render(tree()); review(view, html('3', tail));
  fireEvent.press(view.getByText('全部取消')); expect(view.getByText('確認匯入 0 筆')).toBeTruthy();
  fireEvent.press(view.getByText('全選資料')); expect(view.getByText('確認匯入 25 筆')).toBeTruthy();
  expect(appendPersonalImports).not.toHaveBeenCalled();
});
