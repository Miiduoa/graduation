import React from 'react';
import { AppState } from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { SchoolPortalImportEntry } from '../components/SchoolPortalImport';
import { Button } from '../ui/components';
import { appendPersonalImports, undoLastPersonalImport } from '../services/personalImports';
import { PORTAL_CAPTURE_TIMEOUT } from '@campus/shared/src/imports/portalCapture';

let mockSchool = { id: 'pu', name: '靜宜大學' };
let mockScope: { owner: string; schoolId: string } | null = { owner: 'guest:device', schoolId: 'pu' };
let mockSerial = 0;
const mockInject = jest.fn();
const mockBack = jest.fn();
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
    MockReact.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject, goBack: mockBack }));
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
const html = '<h2>115 學年度第 1 學期</h2><table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr><tr><td>統計學</td><td>3</td><td>90</td></tr></table>';
const origin = 'https://alcat.pu.edu.tw';
const tree = () => <SchoolPortalImportEntry onOpenRecords={mockOpenRecords} />;
type Rendered = ReturnType<typeof render>;
function open(view: Rendered) {
  fireEvent.press(view.getByText('在 App 內開啟校務網站匯入'));
  fireEvent.press(view.getByText('改為成績'));
  fireEvent.press(view.getByText('同意並開啟校方網站'));
  act(() => view.getByTestId('school-portal-browser').props.onLoad());
}
function message(patch: Record<string, unknown> = {}) {
  const script = String(mockInject.mock.calls[mockInject.mock.calls.length - 1][0]);
  const id = JSON.parse(/var id = ("[^"]+");/.exec(script)![1]);
  return { nativeEvent: { url: origin + '/grades', data: JSON.stringify({ version: 1, id, origin, html, blockedFrames: 0, ...patch }) } };
}
function capture(view: Rendered, patch = {}) {
  fireEvent.press(view.getByText('讀取這頁表格'));
  act(() => view.getByTestId('school-portal-browser').props.onMessage(message(patch)));
}
function review(view: Rendered) {
  open(view); capture(view);
  fireEvent.press(view.getByText(/表格 1 · 1 筆/));
  fireEvent.press(view.getByText('整理並核對匯入內容'));
}
beforeEach(() => {
  jest.clearAllMocks(); mockSerial = 0;
  mockSchool = { id: 'pu', name: '靜宜大學' }; mockScope = { owner: 'guest:device', schoolId: 'pu' };
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    mockAppState = callback as (state: string) => void;
    return { remove: jest.fn() };
  });
  jest.mocked(appendPersonalImports).mockReset().mockResolvedValue({ added: 1, duplicates: 0, ledger: { version: 1, records: [], batches: [{ id: 'new-batch', createdAt: new Date().toISOString(), count: 1 }] } });
  jest.mocked(undoLastPersonalImport).mockReset().mockResolvedValue({ removed: 1, ledger: { version: 1, records: [], batches: [] } });
});
afterEach(() => { cleanup(); jest.useRealTimers(); jest.restoreAllMocks(); });

test('never opens a remote page or reads a table before the user consents', () => {
  const view = render(tree());
  expect(view.queryByTestId('school-portal-browser')).toBeNull();
  fireEvent.press(view.getByText('在 App 內開啟校務網站匯入'));
  expect(view.queryByTestId('school-portal-browser')).toBeNull();
  expect(mockInject).not.toHaveBeenCalled();
  expect(appendPersonalImports).not.toHaveBeenCalled();
});
test('reads only on explicit action and saves only after review and confirmation', async () => {
  const view = render(tree()); open(view);
  expect(mockInject).not.toHaveBeenCalled(); capture(view);
  expect(appendPersonalImports).not.toHaveBeenCalled();
  fireEvent.press(view.getByText(/表格 1 · 1 筆/));
  expect(view.getByLabelText('學年度').props.value).toBe('115');
  expect(view.getByLabelText('學期').props.value).toBe('1');
  fireEvent.press(view.getByText('整理並核對匯入內容'));
  expect(appendPersonalImports).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('確認匯入 1 筆')));
  expect(appendPersonalImports).toHaveBeenCalledTimes(1);
  expect(jest.mocked(appendPersonalImports).mock.calls[0][0]).toEqual(mockScope);
  expect(jest.mocked(appendPersonalImports).mock.calls[0][1][0]).toMatchObject({ title: '統計學', academicYear: '115', semester: '1', grade: '90' });
  expect(await view.findByText('匯入完成')).toBeTruthy();
  fireEvent.press(view.getByText('查看與編輯已匯入資料'));
  expect(mockOpenRecords).toHaveBeenCalledTimes(1);
  expect(mockOpenRecords).toHaveBeenCalledWith('grades');
});
test('uses the exact same ledger contract for another configured campus', async () => {
  mockSchool = { id: 'nchu', name: '中興' }; mockScope = { owner: 'nuni:one', schoolId: 'nchu' };
  const view = render(tree()); open(view);
  fireEvent.press(view.getByText('讀取這頁表格'));
  const event = message({ origin: 'https://portal.nchu.edu.tw' }); event.nativeEvent.url = 'https://portal.nchu.edu.tw/grades';
  act(() => view.getByTestId('school-portal-browser').props.onMessage(event));
  fireEvent.press(view.getByText(/表格 1 · 1 筆/)); fireEvent.press(view.getByText('整理並核對匯入內容'));
  await act(async () => fireEvent.press(view.getByText('確認匯入 1 筆')));
  expect(jest.mocked(appendPersonalImports).mock.calls[0][0]).toEqual(mockScope);
  expect(jest.mocked(appendPersonalImports).mock.calls[0][1][0].schoolId).toBe('nchu');
});
test('does not claim an unsupported school has a working portal reader', () => {
  mockSchool = { id: 'other', name: '其他學校' };
  expect(render(tree()).queryByText('在 App 內開啟校務網站匯入')).toBeNull();
});
test('blocks external navigation and special schemes instead of opening another app', () => {
  const view = render(tree()); open(view);
  const should = view.getByTestId('school-portal-browser').props.onShouldStartLoadWithRequest;
  act(() => { expect(should({ url: 'intent://private' })).toBe(false); expect(should({ url: 'https://pu.edu.tw.evil.example/' })).toBe(false); });
  expect(appendPersonalImports).not.toHaveBeenCalled();
  expect(view.getByText(/已阻止離開此校園的網站/)).toBeTruthy();
});
test('ignores wrong-origin and nonce messages without opening review', () => {
  const view = render(tree()); open(view); fireEvent.press(view.getByText('讀取這頁表格'));
  const handler = view.getByTestId('school-portal-browser').props.onMessage;
  act(() => handler(message({ id: 'old_12345678' })));
  act(() => handler({ nativeEvent: { ...message().nativeEvent, url: 'https://evil.example/' } }));
  expect(view.queryByText(/找到 1 張表格/)).toBeNull();
  expect(appendPersonalImports).not.toHaveBeenCalled();
});
test('discards capture responses after navigation even within the same origin', () => {
  const view = render(tree()); open(view); fireEvent.press(view.getByText('讀取這頁表格'));
  const browser = view.getByTestId('school-portal-browser').props; const late = message();
  act(() => browser.onLoadStart());
  act(() => browser.onMessage(late));
  expect(view.queryByText(/找到 1 張表格/)).toBeNull();
});
test('times out and rejects late data rather than reporting an empty import success', () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  try {
    const view = render(tree()); open(view); fireEvent.press(view.getByText('讀取這頁表格'));
    const browser = view.getByTestId('school-portal-browser').props; const late = message();
    act(() => jest.advanceTimersByTime(PORTAL_CAPTURE_TIMEOUT));
    expect(view.getByText(/讀取逾時/)).toBeTruthy();
    act(() => browser.onMessage(late));
    expect(view.queryByText(/找到 1 張表格/)).toBeNull();
    expect(appendPersonalImports).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});
test('clears the active capture when the app leaves the foreground', () => {
  const view = render(tree()); open(view); fireEvent.press(view.getByText('讀取這頁表格'));
  const browser = view.getByTestId('school-portal-browser').props; const late = message();
  act(() => mockAppState?.('background'));
  act(() => browser.onMessage(late));
  act(() => mockAppState?.('active'));
  act(() => browser.onMessage(late));
  expect(view.queryByText(/找到 1 張表格/)).toBeNull();
});
test('does not reuse a page response after the signed-in account changes', () => {
  const view = render(tree()); open(view); fireEvent.press(view.getByText('讀取這頁表格'));
  const browser = view.getByTestId('school-portal-browser').props; const late = message();
  mockScope = { owner: 'nuni:two', schoolId: 'pu' }; view.rerender(tree());
  act(() => browser.onMessage(late));
  expect(view.queryByTestId('school-portal-browser')).toBeNull();
  expect(view.getByText(/帳號或學校正在變更/)).toBeTruthy();
  expect(appendPersonalImports).not.toHaveBeenCalled();
});
test('closes the modal on school selection changes', () => {
  const view = render(tree()); open(view);
  mockSchool = { id: 'ncu', name: '中央' }; mockScope = { owner: 'guest:device', schoolId: 'ncu' };
  view.rerender(tree()); expect(view.queryByTestId('school-portal-browser')).toBeNull();
});
test('warns that inaccessible frames are incomplete rather than certifying all records', () => {
  const view = render(tree()); open(view); capture(view, { blockedFrames: 1 });
  expect(view.getByText(/部分內嵌頁面無法讀取/)).toBeTruthy();
});
test('editing the original text invalidates a previously prepared save', () => {
  const view = render(tree()); review(view);
  expect(view.getByText('確認匯入 1 筆')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('校務表格文字（可修正）'), '未完成的修改');
  expect(view.queryByText('確認匯入 1 筆')).toBeNull(); expect(appendPersonalImports).not.toHaveBeenCalled();
});
test('keeps reviewed data after a storage error and allows a deliberate retry', async () => {
  jest.mocked(appendPersonalImports).mockRejectedValueOnce(new Error('空間不足'));
  const view = render(tree()); review(view);
  await act(async () => fireEvent.press(view.getByText('確認匯入 1 筆')));
  expect(view.getByLabelText('校務表格文字（可修正）').props.value).toContain('統計學');
  expect(view.queryByText('匯入完成')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('確認匯入 1 筆')));
  expect(view.getByText('匯入完成')).toBeTruthy(); expect(appendPersonalImports).toHaveBeenCalledTimes(2);
});
test('blocks duplicate same-tick saves using a synchronous lock', async () => {
  let finish!: (value: Awaited<ReturnType<typeof appendPersonalImports>>) => void;
  jest.mocked(appendPersonalImports).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(tree()); review(view);
  const press = view.UNSAFE_getAllByType(Button).find((button) => button.props.text === '確認匯入 1 筆')!.props.onPress;
  act(() => { press(); press(); });
  expect(appendPersonalImports).toHaveBeenCalledTimes(1);
  await act(async () => finish({ added: 1, duplicates: 0, ledger: { version: 1, records: [], batches: [{ id: 'new', createdAt: new Date().toISOString(), count: 1 }] } }));
  expect(view.getByText('匯入完成')).toBeTruthy();
});
test('does not expose undo for an earlier batch when all incoming rows are duplicates', async () => {
  jest.mocked(appendPersonalImports).mockResolvedValueOnce({ added: 0, duplicates: 1, ledger: { version: 1, records: [], batches: [{ id: 'older-batch', createdAt: new Date().toISOString(), count: 2 }] } });
  const view = render(tree()); review(view);
  await act(async () => fireEvent.press(view.getByText('確認匯入 1 筆')));
  expect(view.getByText('已新增 0 筆，相同資料 1 筆未重複新增。')).toBeTruthy();
  expect(view.queryByText('撤回這次匯入')).toBeNull();
});
test('undo requires a second confirmation and targets only the returned batch', async () => {
  const view = render(tree()); review(view);
  await act(async () => fireEvent.press(view.getByText('確認匯入 1 筆')));
  fireEvent.press(view.getByText('撤回這次匯入')); expect(undoLastPersonalImport).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('確認撤回這次匯入')));
  expect(undoLastPersonalImport).toHaveBeenCalledWith(mockScope, 'new-batch', expect.any(Function));
  expect(view.getByText('已撤回這次新增資料')).toBeTruthy();
});
