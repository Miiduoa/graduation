import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SchoolPortalImportEntry } from '../components/SchoolPortalImportEntry';
import { appendPersonalImports, type PersonalImportScope } from '../services/personalImports';

let mockSchool = { id: 'ntu', name: '國立臺灣大學' };
let mockScope: PersonalImportScope | null = { owner: 'nuni:one', schoolId: 'ntu' };
const mockWeb = { injectJavaScript: jest.fn(), stopLoading: jest.fn(), reload: jest.fn(), goBack: jest.fn() };
const requestId = '12345678-1234-1234-1234-123456789012';
const url = 'https://my.ntu.edu.tw/grades';
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/personalImportScope', () => ({ usePersonalImportScope: () => mockScope }));
jest.mock('../services/personalImports', () => ({ appendPersonalImports: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '12345678-1234-1234-1234-123456789012' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../ui/useThemeStyleSheet', () => ({ useThemeStyleSheet: (make: () => unknown) => make() }));
jest.mock('../ui/components', () => ({
  Button: ({ text, onPress, disabled }: { text: string; onPress: () => void; disabled?: boolean }) => {
    const R = require('react'); const { Pressable, Text } = require('react-native');
    return R.createElement(Pressable, { onPress, disabled, accessibilityRole: 'button', accessibilityLabel: text, accessibilityState: { disabled: !!disabled } }, R.createElement(Text, null, text));
  },
}));
jest.mock('react-native-webview', () => {
  const R = require('react'); const { View } = require('react-native');
  return { WebView: R.forwardRef((props: object, ref: unknown) => {
    R.useImperativeHandle(ref, () => mockWeb);
    return R.createElement(View, props);
  }) };
});
const html = '<h2>115 學年度 第 1 學期</h2><table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr><tr><td>統計學</td><td>3</td><td>88</td></tr></table>';
const message = (id = requestId) => ({ nativeEvent: { url, data: JSON.stringify({ type: 'campus-school-tables', id, html }) } });
beforeEach(() => {
  jest.clearAllMocks(); mockSchool = { id: 'ntu', name: '國立臺灣大學' };
  mockScope = { owner: 'nuni:one', schoolId: 'ntu' };
  jest.mocked(appendPersonalImports).mockResolvedValue({ added: 1, duplicates: 0, ledger: { version: 1, records: [], batches: [] } });
});
afterEach(() => { cleanup(); jest.useRealTimers(); });
function open() {
  const onImported = jest.fn();
  const view = render(<SchoolPortalImportEntry onImported={onImported} />);
  fireEvent.press(view.getByText('在學校網站登入並匯入（試行）'));
  fireEvent.press(view.getByText('成績與學分'));
  fireEvent.press(view.getByText('同意並開啟學校網站'));
  const browser = view.getByTestId('school-portal-webview');
  fireEvent(browser, 'loadEnd', { nativeEvent: { url } });
  return { view, browser, onImported };
}
function review() {
  const opened = open();
  fireEvent.press(opened.view.getByText('讀取目前成績'));
  fireEvent(opened.browser, 'message', message());
  fireEvent.press(opened.view.getByText(/表格 1 · 1 筆/));
  return opened;
}
it('does not open a browser or collect anything before explicit consent', () => {
  const view = render(<SchoolPortalImportEntry onImported={jest.fn()} />);
  expect(view.queryByTestId('school-portal-webview')).toBeNull();
  fireEvent.press(view.getByText('在學校網站登入並匯入（試行）'));
  expect(view.queryByTestId('school-portal-webview')).toBeNull();
  expect(mockWeb.injectJavaScript).not.toHaveBeenCalled();
  expect(appendPersonalImports).not.toHaveBeenCalled();
});
it('provides no unverified entry for an unknown school', () => {
  mockSchool = { id: 'unknown', name: '其他學校' };
  expect(render(<SchoolPortalImportEntry onImported={jest.fn()} />).queryByText('在學校網站登入並匯入（試行）')).toBeNull();
});
it('reads only on tap, then requires a separate review and confirmation to save', async () => {
  const { view, onImported } = review();
  expect(mockWeb.injectJavaScript).toHaveBeenCalledTimes(1);
  expect(appendPersonalImports).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('核對並儲存 1 筆'));
  expect(appendPersonalImports).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('確認加入我的資料'));
  await view.findByText('已加入個人資料');
  expect(appendPersonalImports).toHaveBeenCalledTimes(1);
  expect(jest.mocked(appendPersonalImports).mock.calls[0][0]).toEqual(mockScope);
  expect(jest.mocked(appendPersonalImports).mock.calls[0][1][0]).toMatchObject({ title: '統計學', schoolId: 'ntu', academicYear: '115', semester: '1', grade: '88' });
  fireEvent.press(view.getByText('查看我的匯入紀錄'));
  expect(onImported).toHaveBeenCalledWith('grades');
});
it('ignores unsolicited or mismatched page messages', () => {
  const { view, browser } = open();
  fireEvent(browser, 'message', message());
  expect(view.queryByText(/候選表格/)).toBeNull();
  fireEvent.press(view.getByText('讀取目前成績'));
  fireEvent(browser, 'message', message('not-our-read'));
  expect(view.queryByText(/候選表格/)).toBeNull();
});
it('blocks cross-school navigation and never opens it through the OS', () => {
  const { browser } = open();
  let allowed = true;
  act(() => { allowed = browser.props.onShouldStartLoadWithRequest({ url: 'https://alcat.pu.edu.tw/' }); });
  expect(allowed).toBe(false);
  expect(appendPersonalImports).not.toHaveBeenCalled();
});
it('cancels the pending read when the page navigates', () => {
  const { view, browser } = open();
  fireEvent.press(view.getByText('讀取目前成績'));
  fireEvent(browser, 'loadStart', { nativeEvent: { url } });
  fireEvent(browser, 'message', message());
  expect(view.queryByText(/候選表格/)).toBeNull();
});
it('times out without silently returning an empty success', () => {
  jest.useFakeTimers();
  const { view } = open(); fireEvent.press(view.getByText('讀取目前成績'));
  act(() => jest.advanceTimersByTime(10000));
  expect(view.getByText(/讀取逾時/)).toBeTruthy();
  expect(appendPersonalImports).not.toHaveBeenCalled();
});
it('supports correcting a row before confirmation', async () => {
  const { view } = review();
  fireEvent.press(view.getByText('修正 統計學'));
  fireEvent.changeText(view.getByLabelText('統計學：成績'), '0');
  fireEvent.press(view.getByText('核對並儲存 1 筆'));
  fireEvent.press(view.getByText('確認加入我的資料'));
  await view.findByText('已加入個人資料');
  expect(jest.mocked(appendPersonalImports).mock.calls[0][1][0].grade).toBe('0');
});
it('hides old review data immediately when account scope is unresolved', () => {
  const { view, onImported } = review();
  mockScope = null; view.rerender(<SchoolPortalImportEntry onImported={onImported} />);
  expect(view.queryByText('統計學')).toBeNull();
  expect(view.getByText(/帳號或校園狀態已變更/)).toBeTruthy();
});
it('retains the draft on failure and distinguishes actual duplicate receipts', async () => {
  jest.mocked(appendPersonalImports).mockRejectedValueOnce(new Error('storage failed'));
  const { view } = review(); fireEvent.press(view.getByText('核對並儲存 1 筆'));
  fireEvent.press(view.getByText('確認加入我的資料'));
  await view.findByText(/這次沒有確認儲存成功/);
  expect(view.getByText('統計學')).toBeTruthy();
  jest.mocked(appendPersonalImports).mockResolvedValueOnce({ added: 0, duplicates: 1, ledger: { version: 1, records: [], batches: [] } });
  fireEvent.press(view.getByText('確認加入我的資料'));
  await view.findByText('新增 0 筆，略過 1 筆重複資料。');
});
it('locks same-tick duplicate saves and rejects a result after account switching', async () => {
  let finish!: (value: Awaited<ReturnType<typeof appendPersonalImports>>) => void;
  jest.mocked(appendPersonalImports).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { view, onImported } = review(); fireEvent.press(view.getByText('核對並儲存 1 筆'));
  const submit = view.getByRole('button', { name: '確認加入我的資料' }).props.onPress;
  act(() => { submit(); submit(); });
  expect(appendPersonalImports).toHaveBeenCalledTimes(1);
  const active = jest.mocked(appendPersonalImports).mock.calls[0][2]!;
  mockScope = { owner: 'nuni:two', schoolId: 'ntu' };
  view.rerender(<SchoolPortalImportEntry onImported={onImported} />);
  expect(active()).toBe(false);
  await act(async () => finish({ added: 1, duplicates: 0, ledger: { version: 1, records: [], batches: [] } }));
  await waitFor(() => expect(view.queryByText('已加入個人資料')).toBeNull());
});
