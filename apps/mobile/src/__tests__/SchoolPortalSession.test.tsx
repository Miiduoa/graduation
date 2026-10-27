import React from 'react';
import { AppState, Modal } from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { SchoolPortalImportEntry } from '../components/SchoolPortalImport';
import { appendPersonalImports, undoLastPersonalImport } from '../services/personalImports';

let mockSchool = { id: 'pu', name: '靜宜大學' };
let mockScope: { owner: string; schoolId: string } | null = { owner: 'guest:device', schoolId: 'pu' };
let mockSerial = 0;
const mockInject = jest.fn();
const mockMount = jest.fn();
const mockUnmount = jest.fn();
const mockOpenRecords = jest.fn();
let mockAppState: ((state: string) => void) | undefined;
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
    MockReact.useEffect(() => { mockMount(); return () => { mockUnmount(); }; }, []);
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
const gradeHtml = (year = '115', semester = '1', score = '90') =>
  `<h2>${year} 學年度第 ${semester} 學期</h2><table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr><tr><td>統計學</td><td>3</td><td>${score}</td></tr></table>`;
const tree = () => <SchoolPortalImportEntry onOpenRecords={mockOpenRecords} />;
type Rendered = ReturnType<typeof render>;
const browser = (view: Rendered) => view.getByTestId('school-portal-browser', { includeHiddenElements: true });
function open(view: Rendered) {
  fireEvent.press(view.getByText('在 App 內開啟校務網站匯入'));
  fireEvent.press(view.getByText('改為成績'));
  fireEvent.press(view.getByText('同意並開啟校方網站'));
  act(() => browser(view).props.onLoad());
}
function message(html = gradeHtml()) {
  const script = String(mockInject.mock.calls[mockInject.mock.calls.length - 1][0]);
  const id = JSON.parse(/var id = ("[^"]+");/.exec(script)![1]);
  return { nativeEvent: { url: origin + '/grades', data: JSON.stringify({ version: 1, id, origin, html, blockedFrames: 0 }) } };
}
function capture(view: Rendered, html = gradeHtml()) {
  fireEvent.press(view.getByText('讀取這頁表格'));
  act(() => browser(view).props.onMessage(message(html)));
}
function selectAndPreview(view: Rendered) {
  fireEvent.press(view.getByText(/表格 1 · 1 筆/));
  fireEvent.press(view.getByText('整理並核對匯入內容'));
}
function review(view: Rendered) { open(view); capture(view); selectAndPreview(view); }
function saved(batchId: string) {
  return { added: 1, duplicates: 0, ledger: { version: 1 as const, records: [], batches: [{ id: batchId, createdAt: '2026-10-27T14:00:00Z', count: 1 }] } };
}
const save = async (view: Rendered) => { await act(async () => fireEvent.press(view.getByText('確認匯入 1 筆'))); };
beforeEach(() => {
  jest.clearAllMocks(); mockSerial = 0; mockInject.mockReset();
  mockSchool = { id: 'pu', name: '靜宜大學' }; mockScope = { owner: 'guest:device', schoolId: 'pu' };
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    mockAppState = callback as (state: string) => void;
    return { remove: jest.fn() };
  });
  jest.mocked(appendPersonalImports).mockReset().mockResolvedValue(saved('new-batch'));
  jest.mocked(undoLastPersonalImport).mockReset().mockResolvedValue({ removed: 1, ledger: { version: 1, records: [], batches: [] } });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

test('mounts no browser before consent and keeps one instance across capture and review', () => {
  const view = render(tree());
  fireEvent.press(view.getByText('在 App 內開啟校務網站匯入'));
  expect(mockMount).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('改為成績'));
  fireEvent.press(view.getByText('同意並開啟校方網站'));
  act(() => browser(view).props.onLoad());
  const initialSource = browser(view).props.source;
  capture(view); selectAndPreview(view);
  expect(mockMount).toHaveBeenCalledTimes(1);
  expect(mockUnmount).not.toHaveBeenCalled();
  expect(browser(view).props.source).toBe(initialSource);
  expect(appendPersonalImports).not.toHaveBeenCalled();
});

test('the retained browser cannot be touched or discovered by accessibility during review', () => {
  const view = render(tree()); review(view);
  const container = view.getByTestId('school-portal-browser-container', { includeHiddenElements: true });
  expect(container.props.pointerEvents).toBe('none');
  expect(container.props.accessibilityElementsHidden).toBe(true);
  expect(container.props.importantForAccessibility).toBe('no-hide-descendants');
  expect(view.queryByTestId('school-portal-browser')).toBeNull();
  expect(view.queryByText('讀取這頁表格')).toBeNull();
  expect(browser(view).props.incognito).toBe(true);
  expect(browser(view).props.sharedCookiesEnabled).toBe(false);
});

test('returns to the same school page without losing corrected text, term or excluded rows', () => {
  const view = render(tree()); review(view);
  fireEvent.changeText(view.getByLabelText('學年度'), '114');
  fireEvent.changeText(view.getByLabelText('學期'), '2');
  const corrected = view.getByLabelText('校務表格文字（可修正）').props.value.replace('統計學', '統計學修正');
  fireEvent.changeText(view.getByLabelText('校務表格文字（可修正）'), corrected);
  fireEvent.press(view.getByText('整理並核對匯入內容'));
  fireEvent.press(view.getByText('已選：統計學修正'));
  fireEvent.press(view.getByText('回校方頁面核對'));
  expect(view.getByTestId('school-portal-browser')).toBeTruthy();
  fireEvent.press(view.getByText('繼續核對未儲存表格'));
  expect(view.getByLabelText('學年度').props.value).toBe('114');
  expect(view.getByLabelText('學期').props.value).toBe('2');
  expect(view.getByLabelText('校務表格文字（可修正）').props.value).toBe(corrected);
  expect(view.getByText('未選：統計學修正')).toBeTruthy();
  expect(mockMount).toHaveBeenCalledTimes(1);
  expect(mockInject).toHaveBeenCalledTimes(1);
});

test('preserves table selection when returning to the portal before picking a candidate', () => {
  const view = render(tree()); open(view); capture(view);
  fireEvent.press(view.getByText('返回校方頁面'));
  fireEvent.press(view.getByText('繼續核對未儲存表格'));
  expect(view.getByText(/找到 1 張表格/)).toBeTruthy();
  expect(view.queryByLabelText('校務表格文字（可修正）')).toBeNull();
  expect(mockMount).toHaveBeenCalledTimes(1);
});

test('imports another semester in the same browser without inheriting the previous term', async () => {
  const view = render(tree()); review(view); await save(view);
  fireEvent.press(view.getByText('繼續匯入其他學期'));
  expect(mockMount).toHaveBeenCalledTimes(1);
  expect(mockInject).toHaveBeenCalledTimes(1);
  expect(appendPersonalImports).toHaveBeenCalledTimes(1);
  capture(view, gradeHtml('114', '2', '88')); selectAndPreview(view); await save(view);
  const calls = jest.mocked(appendPersonalImports).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[0][1][0]).toMatchObject({ academicYear: '115', semester: '1', grade: '90' });
  expect(calls[1][1][0]).toMatchObject({ academicYear: '114', semester: '2', grade: '88', kind: 'grades' });
  expect(mockMount).toHaveBeenCalledTimes(1);
  expect(mockUnmount).not.toHaveBeenCalled();
});

test('can continue from grades to timetable with a fresh parser kind and explicit confirmation', async () => {
  const view = render(tree()); review(view); await save(view);
  fireEvent.press(view.getByText('接著匯入課表'));
  expect(appendPersonalImports).toHaveBeenCalledTimes(1);
  capture(view, '<h2>115 學年度第 1 學期</h2><table><tr><th>課程名稱</th><th>星期</th><th>開始節次</th><th>結束節次</th></tr><tr><td>資料庫</td><td>一</td><td>3</td><td>4</td></tr></table>');
  selectAndPreview(view); await save(view);
  expect(jest.mocked(appendPersonalImports).mock.calls[1][1][0]).toMatchObject({ kind: 'timetable', title: '資料庫', dayOfWeek: 1 });
  fireEvent.press(view.getByText('查看與編輯已匯入資料'));
  expect(mockOpenRecords).toHaveBeenCalledWith('timetable');
});

test('asks before replacing an unsaved draft and never captures on cancel', () => {
  const view = render(tree()); review(view);
  fireEvent.press(view.getByText('回校方頁面核對'));
  fireEvent.press(view.getByText('讀取這頁表格'));
  expect(mockInject).toHaveBeenCalledTimes(1);
  expect(view.getByText(/重新讀取成功後會取代未儲存的草稿/)).toBeTruthy();
  fireEvent.press(view.getByText('保留原稿'));
  fireEvent.press(view.getByText('繼續核對未儲存表格'));
  expect(view.getByText('已選：統計學')).toBeTruthy();
  expect(mockInject).toHaveBeenCalledTimes(1);
});

test('a failed replacement read leaves the previous draft recoverable', () => {
  const view = render(tree()); review(view);
  fireEvent.press(view.getByText('回校方頁面核對'));
  fireEvent.press(view.getByText('讀取這頁表格'));
  mockInject.mockImplementationOnce(() => { throw new Error('web process unavailable'); });
  fireEvent.press(view.getByText('讀取新表格並取代草稿'));
  expect(view.getByText(/未能讀取這個頁面/)).toBeTruthy();
  fireEvent.press(view.getByText('繼續核對未儲存表格'));
  expect(view.getByText('已選：統計學')).toBeTruthy();
  expect(appendPersonalImports).not.toHaveBeenCalled();
});

test('resuming a draft invalidates an in-flight replacement and rejects its late result', () => {
  const view = render(tree()); review(view);
  fireEvent.press(view.getByText('回校方頁面核對'));
  fireEvent.press(view.getByText('讀取這頁表格'));
  fireEvent.press(view.getByText('讀取新表格並取代草稿'));
  const late = message(gradeHtml('114', '2', '99'));
  fireEvent.press(view.getByText('繼續核對未儲存表格'));
  act(() => browser(view).props.onMessage(late));
  expect(view.getByLabelText('學年度').props.value).toBe('115');
  expect(view.getByLabelText('校務表格文字（可修正）').props.value).toContain('90');
});

test('close confirmation preserves drafts on cancel and destroys the session only after confirmation', () => {
  const view = render(tree()); review(view);
  fireEvent.press(view.getByText('關閉校務匯入'));
  expect(view.getByText(/這份表格尚未儲存/)).toBeTruthy();
  expect(mockUnmount).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('繼續核對'));
  expect(view.getByText('已選：統計學')).toBeTruthy();
  fireEvent.press(view.getByText('關閉校務匯入'));
  fireEvent.press(view.getByText('放棄未儲存資料並關閉'));
  expect(mockUnmount).toHaveBeenCalledTimes(1);
  open(view);
  expect(mockMount).toHaveBeenCalledTimes(2);
  expect(view.queryByLabelText('校務表格文字（可修正）')).toBeNull();
});

test('native back requests use the same unsaved-data confirmation', () => {
  const view = render(tree()); review(view);
  act(() => view.UNSAFE_getByType(Modal).props.onRequestClose());
  expect(view.getByText(/這份表格尚未儲存/)).toBeTruthy();
  expect(mockUnmount).not.toHaveBeenCalled();
  expect(appendPersonalImports).not.toHaveBeenCalled();
});

test('native back cannot close a pending confirmed save', async () => {
  let finish!: (value: Awaited<ReturnType<typeof appendPersonalImports>>) => void;
  jest.mocked(appendPersonalImports).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(tree()); review(view);
  fireEvent.press(view.getByText('確認匯入 1 筆'));
  act(() => view.UNSAFE_getByType(Modal).props.onRequestClose());
  expect(mockUnmount).not.toHaveBeenCalled();
  expect(view.queryByText(/這份表格尚未儲存/)).toBeNull();
  await act(async () => finish(saved('confirmed-batch')));
  expect(view.getByText('匯入完成')).toBeTruthy();
});

test('account switching destroys a retained hidden page immediately without waiting for a discard prompt', () => {
  const view = render(tree()); review(view);
  mockScope = { owner: 'nuni:two', schoolId: 'pu' }; view.rerender(tree());
  expect(view.queryByTestId('school-portal-browser', { includeHiddenElements: true })).toBeNull();
  expect(mockUnmount).toHaveBeenCalledTimes(1);
  expect(view.queryByText(/這份表格尚未儲存/)).toBeNull();
  expect(view.getByText(/帳號或學校正在變更/)).toBeTruthy();
});

test('browser process loss leaves the review intact and an explicit restart preserves the draft', () => {
  const view = render(tree()); review(view);
  act(() => browser(view).props.onContentProcessDidTerminate());
  expect(view.getByText('已選：統計學')).toBeTruthy();
  fireEvent.press(view.getByText('回校方頁面核對'));
  expect(view.getByText(/校務瀏覽器已中斷/)).toBeTruthy();
  expect(view.getByLabelText('讀取這頁表格').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByText('重新載入入口'));
  expect(mockMount).toHaveBeenCalledTimes(2);
  expect(mockUnmount).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByText('繼續核對未儲存表格'));
  expect(view.getByText('已選：統計學')).toBeTruthy();
});

test('new batches do not inherit an earlier undo confirmation or batch identifier', async () => {
  jest.mocked(appendPersonalImports).mockResolvedValueOnce(saved('first')).mockResolvedValueOnce(saved('second'));
  const view = render(tree()); review(view); await save(view);
  fireEvent.press(view.getByText('撤回這次匯入'));
  fireEvent.press(view.getByText('繼續匯入其他學期'));
  capture(view, gradeHtml('114', '2')); selectAndPreview(view); await save(view);
  expect(view.queryByText('確認撤回這次匯入')).toBeNull();
  fireEvent.press(view.getByText('撤回這次匯入'));
  expect(undoLastPersonalImport).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('確認撤回這次匯入')));
  expect(undoLastPersonalImport).toHaveBeenCalledWith(mockScope, 'second', expect.any(Function));
});

test('hidden or background pages cannot open windows or initiate navigation', () => {
  const view = render(tree()); review(view);
  act(() => {
    expect(browser(view).props.onShouldStartLoadWithRequest({ url: origin + '/next' })).toBe(false);
    browser(view).props.onOpenWindow({ nativeEvent: { targetUrl: origin + '/next' } });
  });
  fireEvent.press(view.getByText('回校方頁面核對'));
  const source = browser(view).props.source;
  act(() => mockAppState?.('background'));
  act(() => {
    expect(browser(view).props.onShouldStartLoadWithRequest({ url: origin + '/next' })).toBe(false);
    browser(view).props.onOpenWindow({ nativeEvent: { targetUrl: origin + '/next' } });
  });
  act(() => mockAppState?.('active'));
  expect(browser(view).props.source).toBe(source);
  expect(mockInject).toHaveBeenCalledTimes(1);
});

test('requesting close cancels a replacement capture before its late result can dismiss the prompt', () => {
  const view = render(tree()); review(view);
  fireEvent.press(view.getByText('回校方頁面核對'));
  fireEvent.press(view.getByText('讀取這頁表格'));
  fireEvent.press(view.getByText('讀取新表格並取代草稿'));
  const late = message(gradeHtml('114', '2'));
  fireEvent.press(view.getByText('關閉校務匯入'));
  act(() => browser(view).props.onMessage(late));
  expect(view.getByText(/這份表格尚未儲存/)).toBeTruthy();
  expect(view.queryByText(/找到 1 張表格/)).toBeNull();
});
