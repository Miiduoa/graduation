import React from 'react';
import { Animated, Linking } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ASSISTANT_SERVICES } from '@campus/shared/src/assistantServices';
import { AssistantServiceReply } from '../screens/AssistantServiceReply';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  // The test renderer has no native view handle for TouchableOpacity's driver.
  // Keep the real controls and state changes; animation delivery is device QA.
  jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() });
});
afterEach(() => jest.restoreAllMocks());

test('service discovery groups the real catalog and opens a native public page after selection', () => {
  const navigation = { navigate: jest.fn(), getState: () => ({ routeNames: ['Map', 'PersonalTimetable'] }) };
  const screen = render(<AssistantServiceReply
    selection={{ kind: 'catalog', serviceIds: ASSISTANT_SERVICES.map((service) => service.id) }}
    audience="platform" navigation={navigation} disabled={false} isCurrent={() => true} />);
  expect(screen.getByRole('button', { name: '開啟我的課表' })).toBeTruthy();
  fireEvent.press(screen.getByRole('tab', { name: '校園' }));
  expect(screen.getByRole('tab', { name: '校園' }).props.accessibilityState.selected).toBe(true);
  fireEvent.press(screen.getByRole('button', { name: '開啟校園地圖' }));
  expect(navigation.navigate).toHaveBeenCalledWith('Map', undefined);
});

test('unsupported native service asks for an explicit website click without forwarding a question or credentials', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const navigation = { navigate: jest.fn(), getState: () => ({ routeNames: ['NuniWorkspace'] }) };
  const screen = render(<AssistantServiceReply selection={{ kind: 'open', serviceIds: ['clubs'] }}
    audience="platform" navigation={navigation} disabled={false} isCurrent={() => true} />);
  expect(open).not.toHaveBeenCalled();
  expect(screen.getByText(/請在網頁確認登入帳號與學校/)).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByRole('button', { name: '在網頁開啟社團' })));
  expect(open).toHaveBeenCalledWith('https://nuni.tw/clubs');
  expect(navigation.navigate).not.toHaveBeenCalled();
});

test('old account or school controls cannot navigate or open a website', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const navigation = { navigate: jest.fn(), getState: () => ({ routeNames: ['Map'] }) };
  let current = true;
  const screen = render(<AssistantServiceReply selection={{ kind: 'open', serviceIds: ['map', 'clubs'] }}
    audience="platform" navigation={navigation} disabled={false} isCurrent={() => current} />);
  current = false;
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: '開啟校園地圖' }));
    fireEvent.press(screen.getByRole('button', { name: '在網頁開啟社團' }));
  });
  expect(open).not.toHaveBeenCalled();
  expect(navigation.navigate).not.toHaveBeenCalled();
});

test('a failed website launch stays retryable and rapid taps only dispatch once', async () => {
  let reject!: (error: Error) => void;
  const open = jest.spyOn(Linking, 'openURL').mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
  const screen = render(<AssistantServiceReply selection={{ kind: 'open', serviceIds: ['clubs'] }}
    audience="platform" navigation={undefined} disabled={false} isCurrent={() => true} />);
  const button = screen.getByRole('button', { name: '在網頁開啟社團' });
  act(() => { fireEvent.press(button); fireEvent.press(button); });
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('offline')));
  expect(screen.getByRole('alert')).toHaveTextContent(/無法開啟網頁/);
  open.mockResolvedValueOnce(true);
  await act(async () => fireEvent.press(button));
  expect(open).toHaveBeenCalledTimes(2);
});
