import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import SchoolInfoScreen from '../screens/SchoolInfoScreen';

let mockUser: { uid: string } | null = { uid: 'student-a' };
let mockSchool = { id: 'pu', name: '靜宜大學' };

jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { resolve, reject, promise };
}

function retainPress(view: ReturnType<typeof render>, label: string) {
  const labelNode = view.getByText(label);
  let current: { props?: { onPress?: () => void }; parent?: unknown } | null = labelNode;
  while (current && typeof current.props?.onPress !== 'function') {
    current = (current.parent as typeof current) ?? null;
  }
  if (!current?.props?.onPress) {
    throw new Error(`Could not retain onPress for ${label}`);
  }
  return current.props.onPress;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { uid: 'student-a' };
  mockSchool = { id: 'pu', name: '靜宜大學' };
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  jest.mocked(Clipboard.setStringAsync).mockResolvedValue(true);
});

afterEach(() => jest.restoreAllMocks());

test('shows bundled public contact actions for the selected school', async () => {
  const view = render(<SchoolInfoScreen />);
  expect(view.getByText('靜宜大學')).toBeTruthy();
  expect(view.getByText(/臺中市沙鹿區臺灣大道七段200號/)).toBeTruthy();
  expect(view.getByText(/學校總機：\(04\)26328001/)).toBeTruthy();
  expect(view.getByText(/此頁提供公開聯絡方式；校務服務依學校目前開放項目使用/)).toBeTruthy();

  await act(async () => fireEvent.press(view.getByText('撥打學校總機')));
  expect(Linking.openURL).toHaveBeenCalledWith('tel:0426328001');

  await act(async () => fireEvent.press(view.getByText('開啟官方網站')));
  expect(Linking.openURL).toHaveBeenCalledWith('http://www.pu.edu.tw');

  await act(async () => fireEvent.press(view.getByText('用地圖搜尋校名與地址')));
  const maps = new URL(String(jest.mocked(Linking.openURL).mock.calls.at(-1)?.[0]));
  expect(maps.origin + maps.pathname).toBe('https://www.google.com/maps/search/');
  expect(maps.searchParams.get('query')).toContain('靜宜大學');
  expect(maps.searchParams.get('query')).not.toMatch(/-?\d+\.\d+,-?\d+\.\d+/);
  expect(view.getByText(/2026-10-24/)).toBeTruthy();
});

test('offers copy instead of dial for range and extension switchboards', async () => {
  mockSchool = { id: 'chu', name: '中華大學' };
  const view = render(<SchoolInfoScreen />);
  expect(view.getByText(/學校總機：\(03\)5374281~5/)).toBeTruthy();
  expect(view.queryByText('撥打學校總機')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('複製學校總機')));
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('(03)5374281~5');
  expect(Linking.openURL).not.toHaveBeenCalled();
  expect(view.getByText('已複製學校總機號碼。')).toBeTruthy();
});

test('keeps unknown and conflicting schools unavailable without a foreign fallback', () => {
  mockSchool = { id: 'unknown-campus', name: '未知學校' };
  const view = render(<SchoolInfoScreen />);
  expect(view.getByText(/目前沒有這所學校的公開聯絡資料/)).toBeTruthy();
  expect(view.queryByText('撥打學校總機')).toBeNull();

  mockSchool = { id: 'pu', name: '國立清華大學' };
  view.rerender(<SchoolInfoScreen />);
  expect(view.getByText(/目前沒有這所學校的公開聯絡資料/)).toBeTruthy();
  expect(view.queryByText('靜宜大學')).toBeNull();
});

test('switching schools replaces content and preserves a non-PU selection', async () => {
  const view = render(<SchoolInfoScreen />);
  expect(view.getByText('靜宜大學')).toBeTruthy();

  mockSchool = { id: 'nthu', name: '國立清華大學' };
  view.rerender(<SchoolInfoScreen />);
  expect(view.getByText('國立清華大學')).toBeTruthy();
  expect(view.queryByText('靜宜大學')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('開啟官方網站')));
  expect(Linking.openURL).toHaveBeenCalledWith('http://www.nthu.edu.tw');
});

test('stale open callbacks from a previous school do not open after a switch', async () => {
  const view = render(<SchoolInfoScreen />);
  fireEvent.press(view.getByText('開啟官方網站'));

  mockSchool = { id: 'nthu', name: '國立清華大學' };
  view.rerender(<SchoolInfoScreen />);
  expect(view.getByText('國立清華大學')).toBeTruthy();

  await act(async () => {});
  expect(Linking.openURL).not.toHaveBeenCalled();
  expect(view.queryByText('無法開啟連結')).toBeNull();
});

test('retained onPress after school switch does not open the previous website', async () => {
  const view = render(<SchoolInfoScreen />);
  const retained = retainPress(view, '開啟官方網站');

  mockSchool = { id: 'nthu', name: '國立清華大學' };
  view.rerender(<SchoolInfoScreen />);
  expect(view.getByText('國立清華大學')).toBeTruthy();

  await act(async () => {
    retained();
  });
  expect(Linking.openURL).not.toHaveBeenCalled();
});

test('retained onPress after same-ID name conflict does not open the previous contact', async () => {
  const view = render(<SchoolInfoScreen />);
  const retained = retainPress(view, '開啟官方網站');

  mockSchool = { id: 'pu', name: '國立清華大學' };
  view.rerender(<SchoolInfoScreen />);
  expect(view.getByText(/目前沒有這所學校的公開聯絡資料/)).toBeTruthy();
  expect(view.queryByText('靜宜大學')).toBeNull();

  await act(async () => {
    retained();
  });
  expect(Linking.openURL).not.toHaveBeenCalled();
});

test('retained onPress after unmount does not open', async () => {
  const view = render(<SchoolInfoScreen />);
  const retained = retainPress(view, '開啟官方網站');
  view.unmount();

  await act(async () => {
    retained();
  });
  expect(Linking.openURL).not.toHaveBeenCalled();
});

test('retained callbacks ignore completion errors after account switch', async () => {
  const pending = deferred<void>();
  jest.mocked(Linking.openURL).mockImplementationOnce(() => pending.promise as Promise<void>);

  const view = render(<SchoolInfoScreen />);
  await act(async () => fireEvent.press(view.getByText('開啟官方網站')));
  expect(Linking.openURL).toHaveBeenCalledWith('http://www.pu.edu.tw');

  mockUser = { uid: 'student-b' };
  view.rerender(<SchoolInfoScreen />);

  await act(async () => {
    pending.reject(new Error('offline'));
  });
  expect(view.queryByText('無法開啟連結')).toBeNull();

  jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('offline'));
  await act(async () => fireEvent.press(view.getByText('開啟官方網站')));
  expect(view.getByText('無法開啟連結，請確認裝置設定後重試。')).toBeTruthy();
});

test('rejected pending open after school switch does not show error on the new screen', async () => {
  const pending = deferred<void>();
  jest.mocked(Linking.openURL).mockImplementationOnce(() => pending.promise as Promise<void>);

  const view = render(<SchoolInfoScreen />);
  await act(async () => fireEvent.press(view.getByText('開啟官方網站')));

  mockSchool = { id: 'nthu', name: '國立清華大學' };
  view.rerender(<SchoolInfoScreen />);
  expect(view.getByText('國立清華大學')).toBeTruthy();

  await act(async () => {
    pending.reject(new Error('offline'));
  });
  expect(view.queryByText('無法開啟連結')).toBeNull();
  expect(view.getByText('國立清華大學')).toBeTruthy();
});
