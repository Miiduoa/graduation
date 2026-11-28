import React from 'react';
import { AccessibilityInfo, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { act, render, screen } from '@testing-library/react-native';
import { FullScreenLoader, LoadingState, Spinner } from '../../ui/components';
import { CourseChipLoading } from '../../ui/courseChipShell';

let changeMotion: (enabled: boolean) => void;

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((event, listener) => {
    if (event === 'reduceMotionChanged') changeMotion = listener as typeof changeMotion;
    return { remove: jest.fn() };
  });
});

afterEach(() => jest.restoreAllMocks());

test('changing the system motion preference replaces the spinning indicator in place', async () => {
  render(<Spinner size={30} accessibilityLabel="正在讀取成績" />);
  await act(async () => {});
  const status = screen.getByRole('progressbar', { name: '正在讀取成績' });
  expect(status).toBeBusy();
  expect(screen.UNSAFE_getByType(ActivityIndicator).props.size).toBe(30);

  act(() => changeMotion(true));
  expect(screen.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
  expect(screen.UNSAFE_getByType(Ionicons).props).toMatchObject({ name: 'time-outline', size: 30 });
  expect(screen.getByRole('progressbar')).toBe(status);

  act(() => changeMotion(false));
  expect(screen.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
});

test.each([
  ['課務', <LoadingState title="課務" subtitle="正在取得本週作業" hint="完成後會自動顯示" />],
  ['課程成績', <CourseChipLoading title="課程成績" subtitle="正在取得本週作業" accessibilityHint="完成後會自動顯示" />],
])('%s exposes the waiting message as a single busy status', async (title, element) => {
  render(element);
  await act(async () => {});
  expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  const status = screen.getByRole('progressbar', { name: title });
  expect(status).toBeBusy();
  expect(status).toHaveProp('accessibilityValue', { text: '正在取得本週作業' });
  expect(status).toHaveProp('accessibilityHint', '完成後會自動顯示');
  expect(screen.getByText('正在取得本週作業')).toBeOnTheScreen();
});

test.each([undefined, '準備你的校園體驗…'])('shows a visible full-screen message with motion reduced', async (message) => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  render(<FullScreenLoader message={message} />);
  await act(async () => {});
  const label = message ?? '載入中';
  expect(screen.getByText(label)).toBeOnTheScreen();
  expect(screen.getByRole('progressbar', { name: label })).toBeBusy();
  expect(screen.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
});
