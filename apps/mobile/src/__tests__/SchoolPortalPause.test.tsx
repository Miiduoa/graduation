import React from 'react';
import { AppState } from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import * as policy from '@campus/shared/src/puEcampusDataPolicy';
import { parsePersonalImport } from '@campus/shared';
import { SchoolPortalImportEntry } from '../components/SchoolPortalImport';
import { Button } from '../ui/components';
import { appendPersonalImports } from '../services/personalImports';

let mockSchool = { id: 'pu', name: '靜宜大學' };
const mockInject = jest.fn();
const mockMount = jest.fn();
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/personalImportScope', () => ({
  usePersonalImportScope: () => ({ owner: 'guest:device', schoolId: mockSchool.id }),
}));
jest.mock('../state/theme', () => ({ useThemeMode: () => ({ mode: 'light' }) }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'request_12345678' }));
jest.mock('react-native-webview', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return { WebView: React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject, goBack: jest.fn() }));
    React.useEffect(() => { mockMount(); }, []);
    return React.createElement(View, props);
  }) };
});
jest.mock('../ui/components', () => {
  const React = jest.requireActual('react');
  const { Pressable, Text } = jest.requireActual('react-native');
  return { Button: ({ text, disabled, onPress }: { text: string; disabled?: boolean; onPress(): void }) =>
    React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: text,
      accessibilityState: { disabled: !!disabled }, disabled, onPress }, React.createElement(Text, null, text)) };
});
jest.mock('../services/personalImports', () => ({ appendPersonalImports: jest.fn(), undoLastPersonalImport: jest.fn() }));

const tree = () => <SchoolPortalImportEntry onOpenRecords={jest.fn()} />;
beforeEach(() => {
  jest.clearAllMocks();
  mockSchool = { id: 'pu', name: '靜宜大學' };
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

test.each(['pu', 'tw-pu'])('E-campus %s displays the pause and cannot open even through the raw entry handler', (schoolId) => {
  mockSchool = { id: schoolId, name: '靜宜大學' };
  const view = render(tree());
  expect(view.getByText(/E校園資料擷取已暫停/)).toBeTruthy();
  expect(view.getByText(/仍可使用檔案或文字匯入/)).toBeTruthy();
  expect(view.getByLabelText('在 App 內開啟校務網站匯入').props.accessibilityState.disabled).toBe(true);
  act(() => view.UNSAFE_getByType(Button).props.onPress());
  expect(view.queryByText('同意並開啟校方網站')).toBeNull();
  expect(view.queryByTestId('school-portal-browser')).toBeNull();
  expect(mockMount).not.toHaveBeenCalled();
  expect(mockInject).not.toHaveBeenCalled();
});

test('an already-open portal refuses stale navigation and capture handlers once paused', () => {
  const enabled = jest.spyOn(policy, 'isPuEcampusDataFetchEnabled').mockReturnValue(true);
  const view = render(tree());
  fireEvent.press(view.getByText('在 App 內開啟校務網站匯入'));
  fireEvent.press(view.getByText('同意並開啟校方網站'));
  const browser = view.getByTestId('school-portal-browser');
  act(() => browser.props.onLoad());
  const read = view.UNSAFE_getAllByType(Button).find((node) => node.props.text === '讀取這頁表格')!.props.onPress;
  enabled.mockReturnValue(false);
  act(() => {
    read();
    expect(browser.props.onShouldStartLoadWithRequest({ url: 'https://alcat.pu.edu.tw/' })).toBe(false);
    browser.props.onMessage({ nativeEvent: { url: 'https://alcat.pu.edu.tw/', data: '{}' } });
  });
  expect(mockInject).not.toHaveBeenCalled();
  expect(appendPersonalImports).not.toHaveBeenCalled();
  view.rerender(tree());
  expect(view.queryByTestId('school-portal-browser')).toBeNull();
});

test('another school can still open and explicitly capture its own portal', () => {
  mockSchool = { id: 'nchu', name: '中興大學' };
  const view = render(tree());
  expect(view.queryByText(/E校園資料擷取已暫停/)).toBeNull();
  fireEvent.press(view.getByText('在 App 內開啟校務網站匯入'));
  fireEvent.press(view.getByText('同意並開啟校方網站'));
  const browser = view.getByTestId('school-portal-browser');
  expect(browser.props.source.uri).toBe('https://portal.nchu.edu.tw/');
  act(() => browser.props.onLoad());
  fireEvent.press(view.getByText('讀取這頁表格'));
  expect(mockInject).toHaveBeenCalledTimes(1);
  expect(appendPersonalImports).not.toHaveBeenCalled();
});

test('offline text parsing remains available for Providence while capture is paused', () => {
  const result = parsePersonalImport('課程名稱,學分,成績\n統計學,3,90', {
    kind: 'grades', schoolId: 'pu', academicYear: '115', semester: '1',
    source: { type: 'paste', name: 'local transcript' },
  });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({ schoolId: 'pu', title: '統計學', grade: '90' });
  expect(mockMount).not.toHaveBeenCalled();
});
