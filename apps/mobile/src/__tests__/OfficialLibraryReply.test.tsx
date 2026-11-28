import React from 'react';
import { Animated, Linking } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { OfficialLibraryReply } from '../screens/OfficialLibraryReply';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const CATALOG = '開啟官方館藏查詢';
const HOURS = '查看開館時間頁面';

beforeEach(() => {
  jest.clearAllMocks();
  // The test renderer has no native view handle for TouchableOpacity's driver.
  jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() });
});
afterEach(() => jest.restoreAllMocks());

test('opens the directory catalog and hours pages only after an explicit tap', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const screen = render(<OfficialLibraryReply directory={{ schoolId: 'pu' }} />);
  expect(open).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(screen.getByRole('button', { name: CATALOG })));
  expect(open).toHaveBeenLastCalledWith('https://webpacx.lib.pu.edu.tw/');
  await act(async () => fireEvent.press(screen.getByRole('button', { name: HOURS })));
  expect(open).toHaveBeenLastCalledWith('https://library.pu.edu.tw/p/426-1054-32.php?Lang=zh-tw');
  expect(open).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a supplied url-like prop is ignored and the library name is not repeated', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const directory = { schoolId: 'pu', catalogUrl: 'https://evil.example/', name: '假圖書館' } as { schoolId: string };
  const screen = render(<OfficialLibraryReply directory={directory} />);
  expect(screen.queryByText(/蓋夏圖書館|假圖書館/)).toBeNull();
  await act(async () => fireEvent.press(screen.getByRole('button', { name: CATALOG })));
  expect(open).toHaveBeenCalledWith('https://webpacx.lib.pu.edu.tw/');
  expect(open).not.toHaveBeenCalledWith('https://evil.example/');
});

test('a failed launch shows a retryable alert', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('no handler'));
  const screen = render(<OfficialLibraryReply directory={{ schoolId: 'pu' }} />);
  await act(async () => fireEvent.press(screen.getByRole('button', { name: CATALOG })));
  expect(screen.getByRole('alert')).toHaveTextContent(/無法開啟校方網站/);
  open.mockResolvedValueOnce(true);
  await act(async () => fireEvent.press(screen.getByRole('button', { name: CATALOG })));
  expect(open).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a school without a published hours page shows only the catalog action', () => {
  const screen = render(<OfficialLibraryReply directory={{ schoolId: 'nycu' }} />);
  expect(screen.getByRole('button', { name: CATALOG })).toBeTruthy();
  expect(screen.queryByRole('button', { name: HOURS })).toBeNull();
  expect(screen.queryByText(/開館時間/)).toBeNull();
});

test('an unknown school renders no link or button', () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const screen = render(<OfficialLibraryReply directory={{ schoolId: 'not-a-school' }} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(open).not.toHaveBeenCalled();
});

test('disabled or stale replies cannot open a website', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const disabled = render(<OfficialLibraryReply directory={{ schoolId: 'pu' }} disabled />);
  await act(async () => {
    fireEvent.press(disabled.getByRole('button', { name: CATALOG }));
    fireEvent.press(disabled.getByRole('button', { name: HOURS }));
  });
  disabled.unmount();
  let current = true;
  const stale = render(<OfficialLibraryReply directory={{ schoolId: 'pu' }} isCurrent={() => current} />);
  current = false;
  await act(async () => {
    fireEvent.press(stale.getByRole('button', { name: CATALOG }));
    fireEvent.press(stale.getByRole('button', { name: HOURS }));
  });
  expect(open).not.toHaveBeenCalled();
});

test('rapid taps dispatch once and a stale failure shows no error', async () => {
  let reject!: (error: Error) => void;
  const open = jest.spyOn(Linking, 'openURL').mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
  let current = true;
  const screen = render(<OfficialLibraryReply directory={{ schoolId: 'pu' }} isCurrent={() => current} />);
  const button = screen.getByRole('button', { name: CATALOG });
  act(() => { fireEvent.press(button); fireEvent.press(button); });
  expect(open).toHaveBeenCalledTimes(1);
  current = false;
  await act(async () => reject(new Error('offline')));
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a launch failing after unmount does not set state', async () => {
  let reject!: (error: Error) => void;
  jest.spyOn(Linking, 'openURL').mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
  const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const screen = render(<OfficialLibraryReply directory={{ schoolId: 'pu' }} />);
  act(() => { fireEvent.press(screen.getByRole('button', { name: CATALOG })); });
  screen.unmount();
  await act(async () => reject(new Error('offline')));
  expect(errors).not.toHaveBeenCalled();
});

test('changing school drops an in-flight failure from the previous school', async () => {
  let reject!: (error: Error) => void;
  jest.spyOn(Linking, 'openURL').mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
  const screen = render(<OfficialLibraryReply directory={{ schoolId: 'pu' }} />);
  act(() => { fireEvent.press(screen.getByRole('button', { name: CATALOG })); });
  screen.rerender(<OfficialLibraryReply directory={{ schoolId: 'nycu' }} />);
  await act(async () => reject(new Error('offline')));
  expect(screen.queryByRole('alert')).toBeNull();
});
