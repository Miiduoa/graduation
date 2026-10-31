import React from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NextClassLiveActivitySetting } from '../widgets/NextClassLiveActivitySetting';
const mockStatus = jest.fn();
const mockEnable = jest.fn().mockResolvedValue(undefined);
const mockRefresh = jest.fn().mockResolvedValue(undefined);
jest.mock('expo', () => ({
  requireOptionalNativeModule: () => ({
    liveActivityStatus: () => mockStatus(),
    setLiveActivityEnabled: (value: boolean) => mockEnable(value),
  }),
}));
jest.mock('../widgets/nextClassBridge', () => ({
  nextClassWriter: { refreshActivity: () => mockRefresh() },
}));
afterEach(() => jest.restoreAllMocks());
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  mockStatus.mockResolvedValue({ supported: true, allowed: true, enabled: false });
});
test('requires an explicit opt-in and refreshes the existing snapshot', async () => {
  const view = render(<NextClassLiveActivitySetting />);
  await waitFor(() => expect(view.getByLabelText('下一堂課即時動態')).toBeTruthy());
  expect(mockEnable).not.toHaveBeenCalled();
  fireEvent(view.getByLabelText('下一堂課即時動態'), 'valueChange', true);
  await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  expect(mockEnable).toHaveBeenCalledWith(true);
});
test('denied permission offers in-app timetable fallback and system settings', async () => {
  mockStatus.mockResolvedValue({ supported: true, allowed: false, enabled: true });
  const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  const view = render(<NextClassLiveActivitySetting />);
  await waitFor(() => expect(view.getByText(/下一堂課還是可以在 App 的課表裡查看/)).toBeTruthy());
  expect(view.getByLabelText('下一堂課即時動態').props.disabled).toBe(false);
  fireEvent.press(view.getByText('前往系統設定'));
  expect(open).toHaveBeenCalled();
  open.mockRestore();
});
test.each(['android', 'web'] as const)('hides the entry on %s', (os) => {
  const original = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  try {
    const view = render(<NextClassLiveActivitySetting />);
    expect(view.toJSON()).toBeNull();
    expect(mockStatus).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(Platform, 'OS', { value: original });
  }
});
test('unsupported iOS hides the entry and cleans the foreground listener', async () => {
  mockStatus.mockResolvedValue({ supported: false, allowed: false, enabled: false });
  const remove = jest.fn();
  const listener = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove });
  const view = render(<NextClassLiveActivitySetting />);
  await waitFor(() => expect(mockStatus).toHaveBeenCalled());
  expect(view.toJSON()).toBeNull();
  view.unmount();
  expect(remove).toHaveBeenCalled();
  listener.mockRestore();
});

test('turning off ends through the native setting and reconciles without another timetable load', async () => {
  mockStatus.mockResolvedValue({ supported: true, allowed: true, enabled: true });
  const view = render(<NextClassLiveActivitySetting />);
  await waitFor(() => expect(view.getByLabelText('下一堂課即時動態')).toBeTruthy());
  fireEvent(view.getByLabelText('下一堂課即時動態'), 'valueChange', false);
  await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  expect(mockEnable).toHaveBeenCalledWith(false);
});
test('returning from settings rechecks revoked permission', async () => {
  let onChange!: (state: string) => void;
  const listener = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, callback) => {
      onChange = callback;
      return { remove: jest.fn() };
    });
  const view = render(<NextClassLiveActivitySetting />);
  await waitFor(() => expect(view.getByLabelText('下一堂課即時動態')).toBeTruthy());
  mockStatus.mockResolvedValue({ supported: true, allowed: false, enabled: true });
  onChange('active');
  await waitFor(() => expect(view.getByText('前往系統設定')).toBeTruthy());
  listener.mockRestore();
});

test('系統禁止時仍可關閉偏好，關閉後禁止重新開啟', async () => {
  mockStatus.mockResolvedValue({ supported: true, allowed: false, enabled: true });
  const view = render(<NextClassLiveActivitySetting />);
  await waitFor(() => expect(view.getByLabelText('下一堂課即時動態')).toBeTruthy());
  mockStatus.mockResolvedValue({ supported: true, allowed: false, enabled: false });
  fireEvent(view.getByLabelText('下一堂課即時動態'), 'valueChange', false);
  await waitFor(() => expect(view.getByLabelText('下一堂課即時動態').props.value).toBe(false));
  expect(mockEnable).toHaveBeenCalledWith(false);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('下一堂課即時動態').props.disabled).toBe(true);
  fireEvent(view.getByLabelText('下一堂課即時動態'), 'valueChange', true);
  expect(mockEnable).toHaveBeenCalledTimes(1);
});
