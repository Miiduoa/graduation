import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { HealthScreen } from '../screens/HealthScreen';

let mockSchool = { id: 'pu' };
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').getCurrentTheme() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  mockSchool = { id: 'pu' };
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

test('opens the official counselling instructions without inventing a booking or health record', async () => {
  const view = render(<HealthScreen />);
  await act(async () => fireEvent.press(view.getByText('查看諮商申請方式')));
  expect(Linking.openURL).toHaveBeenCalledWith('https://osachc.pu.edu.tw/p/412-1067-1754.php?Lang=zh-tw');
  expect(view.queryByText(/BMI|疫苗紀錄|預約成功|症狀自評|運動處方/)).toBeNull();
});

test('keeps failed external navigation recoverable', async () => {
  jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('offline'));
  const view = render(<HealthScreen />);
  await act(async () => fireEvent.press(view.getByText('查看特約醫院')));
  expect(view.getByRole('alert')).toHaveTextContent(/無法開啟學校網頁/);
  await act(async () => fireEvent.press(view.getByText('查看特約醫院')));
  expect(Linking.openURL).toHaveBeenCalledTimes(2);
  expect(view.queryByRole('alert')).toBeNull();
});

test('does not expose PU services or late errors after the school changes', async () => {
  let reject!: (error: Error) => void;
  jest.mocked(Linking.openURL).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const view = render(<HealthScreen />);
  fireEvent.press(view.getByText('查看健檢公告'));
  mockSchool = { id: 'another-school' };
  view.rerender(<HealthScreen />);
  expect(view.queryByText('查看健檢公告')).toBeNull();
  await act(async () => reject(new Error('offline')));
  expect(view.queryByRole('alert')).toBeNull();
  expect(view.getByText(/尚未提供這所學校/)).toBeTruthy();
});

test('opens a link once while the device is still handling the first request', async () => {
  let resolve!: (value: unknown) => void;
  jest.mocked(Linking.openURL).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const view = render(<HealthScreen />);
  fireEvent.press(view.getByText('查看諮商申請方式'));
  fireEvent.press(view.getByText('查看特約醫院'));
  expect(Linking.openURL).toHaveBeenCalledTimes(1);
  await act(async () => resolve(undefined));
});
