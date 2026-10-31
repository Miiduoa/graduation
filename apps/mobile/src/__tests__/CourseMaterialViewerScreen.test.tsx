import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import CourseMaterialViewerScreen from '../screens/CourseMaterialViewerScreen';

const mockGoBack = jest.fn();
let mockWebProps: any;
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ canGoBack: () => true, goBack: mockGoBack }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/PuWebView', () => ({ PuWebView: (props: any) => { mockWebProps = props; return null; } }));
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
