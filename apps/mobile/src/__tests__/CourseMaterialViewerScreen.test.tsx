import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import CourseMaterialViewerScreen from '../screens/CourseMaterialViewerScreen';

const mockGoBack = jest.fn();
type MockWebProps = {
  onLoadStart: () => void;
  onLoad: () => void;
  onLoadEnd: () => void;
  onError: (event: { nativeEvent: { description: string } }) => void;
  onHttpError: (event: { nativeEvent: { statusCode: number } }) => void;
};
let mockWebProps: MockWebProps;
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ canGoBack: () => true, goBack: mockGoBack }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/PuWebView', () => ({ PuWebView: (props: MockWebProps) => { mockWebProps = props; return null; } }));
jest.mock('../services/tronClassDataEnabled', () => ({ isTronClassPuHostedUrl: () => false }));

beforeEach(() => jest.clearAllMocks());
const screen = () => render(<CourseMaterialViewerScreen route={{ params: { url: 'https://files.example.test/private?token=synthetic', title: '合成教材' } }} />);
it.each([[403, '沒有查看權限'], [404, '已不存在'], [500, '暫時沒有回應']])('explains HTTP %s and offers a safe return', (statusCode, copy) => {
  const view = screen();
  act(() => mockWebProps.onHttpError({ nativeEvent: { statusCode } }));
  expect(view.getByText(new RegExp(copy))).toBeTruthy();
  fireEvent.press(view.getByText('返回課程'));
  expect(mockGoBack).toHaveBeenCalled();
});
it('offers retry after connection loss', () => {
  const view = screen();
  act(() => mockWebProps.onError({ nativeEvent: { description: 'offline' } }));
  expect(view.getByText(/連線中斷/)).toBeTruthy();
  fireEvent.press(view.getByText('再試一次'));
  expect(view.queryByText(/連線中斷/)).toBeNull();
});
it('does not expose a credential-bearing preview URL through sharing', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = screen();
  fireEvent.press(view.getByLabelText('分享此教材連結'));
  expect(alert).toHaveBeenCalledWith('請從課程分享教材', expect.not.stringContaining('token=synthetic'));
  alert.mockRestore();
});

afterEach(() => jest.useRealTimers());
it('clears the timeout only when a slow preview succeeds', () => {
  jest.useFakeTimers();
  const view = screen();
  act(() => jest.advanceTimersByTime(31000));
  expect(view.getByText(/載入等得有點久/)).toBeTruthy();
  act(() => mockWebProps.onLoadEnd());
  expect(view.getByText(/載入等得有點久/)).toBeTruthy();
  act(() => mockWebProps.onLoad());
  expect(view.queryByText(/載入等得有點久/)).toBeNull();
  expect(view.queryByText('再試一次')).toBeNull();
  jest.useRealTimers();
});
it('preserves a failed load through completion and success callbacks', () => {
  const view = screen();
  act(() => {
    mockWebProps.onHttpError({ nativeEvent: { statusCode: 403 } });
    mockWebProps.onLoadEnd();
    mockWebProps.onLoad();
  });
  expect(view.getByText(/沒有查看權限/)).toBeTruthy();
});
it('ignores old preview events while retrying', () => {
  jest.useFakeTimers();
  const view = screen();
  const old = mockWebProps;
  act(() => jest.advanceTimersByTime(30000));
  fireEvent.press(view.getByText('再試一次'));
  act(() => {
    old.onLoadStart();
    old.onError({ nativeEvent: { description: 'offline' } });
    old.onHttpError({ nativeEvent: { statusCode: 403 } });
    old.onLoadEnd();
    old.onLoad();
    jest.advanceTimersByTime(30000);
  });
  expect(view.getByText(/載入等得有點久/)).toBeTruthy();
  act(() => old.onLoad());
  expect(view.getByText(/載入等得有點久/)).toBeTruthy();
  act(() => mockWebProps.onLoad());
  expect(view.queryByText('再試一次')).toBeNull();
  jest.useRealTimers();
});
