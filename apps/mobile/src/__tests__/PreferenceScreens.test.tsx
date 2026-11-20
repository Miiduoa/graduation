import React from 'react';
import { AccessibilityInfo, Linking } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider } from '../state/theme';
import { ThemePreviewScreen } from '../screens/ThemePreviewScreen';
import { AccessibilitySettingsScreen } from '../screens/AccessibilitySettingsScreen';
import { HelpScreen } from '../screens/HelpScreen';
import { LanguageSettingsScreen } from '../screens/LanguageSettingsScreen';
import { I18nProvider } from '../i18n';
import { applyTheme } from '../ui/theme';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('../services/release', () => ({ getLegalUrl: () => null }));
jest.mock('../services/tronClassDataEnabled', () => ({ isTronClassPuHostedUrl: () => false }));
jest.mock('../services/tronClassWebUiGate', () => ({ linkingOpenWithPuTronClassGate: jest.fn() }));
jest.mock('expo-constants', () => ({ expoConfig: { version: '2.4.6' } }));

const navigation = { navigate: jest.fn(), goBack: jest.fn() };
function wrap(screen: React.ReactNode) {
  return <ThemeProvider>{screen}</ThemeProvider>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  applyTheme('light');
});
afterEach(() => jest.restoreAllMocks());

test('appearance changes the real theme and restores the saved choice on the next visit', async () => {
  const view = render(wrap(<ThemePreviewScreen navigation={navigation} />));
  await waitFor(() =>
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('campus.themeMode.v2', 'light'),
  );
  fireEvent.press(view.getByRole('radio', { name: '深色' }));
  expect(view.getByRole('radio', { name: '深色' })).toHaveAccessibilityState({ checked: true });
  await waitFor(() =>
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('campus.themeMode.v2', 'dark'),
  );
  view.unmount();
  applyTheme('light');
  const next = render(wrap(<ThemePreviewScreen navigation={navigation} />));
  await waitFor(() =>
    expect(next.getByRole('radio', { name: '深色' })).toHaveAccessibilityState({ checked: true }),
  );
  expect(next.queryByText(/HEX|元件預覽|學校 ID|mock/)).toBeNull();
});

test('help uses actual version and feedback route, with searchable answers and no invented support details', async () => {
  const view = render(wrap(<HelpScreen navigation={navigation} />));
  await act(async () => {});
  expect(view.getByText('2.4.6')).toBeTruthy();
  expect(view.queryByText(/support@|MVP|2024 年|影片和圖文/)).toBeNull();
  fireEvent.changeText(view.getByLabelText('搜尋常見問題'), '深色');
  fireEvent.press(view.getByRole('button', { name: '如何切換深色模式？' }));
  expect(view.getByText(/選擇後立即套用/)).toBeTruthy();
  expect(view.queryByText('忘記學校帳號密碼怎麼辦？')).toBeNull();
  fireEvent.changeText(view.getByLabelText('搜尋常見問題'), '找不到的問題');
  expect(view.getByText('找不到相關說明')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '清除搜尋' }));
  expect(view.getByText('忘記學校帳號密碼怎麼辦？')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '前往意見回饋' }));
  expect(navigation.navigate).toHaveBeenCalledWith('Feedback');
});

test('accessibility displays live system state and cleans up both subscriptions', async () => {
  const initialReader = deferred<boolean>();
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockReturnValue(initialReader.promise);
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  const listeners: Record<string, (enabled: boolean) => void> = {};
  const removals: jest.Mock[] = [];
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((event, listener) => {
    listeners[event] = listener as (enabled: boolean) => void;
    const remove = jest.fn();
    removals.push(remove);
    return { remove };
  });
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  const view = render(wrap(<AccessibilitySettingsScreen navigation={navigation} />));
  await waitFor(() => expect(view.getByText('未開啟')).toBeTruthy());
  act(() => listeners.screenReaderChanged(true));
  await act(async () => initialReader.resolve(false));
  expect(view.getByText('已開啟')).toBeTruthy();
  expect(view.queryAllByRole('switch')).toHaveLength(0);
  fireEvent.press(view.getByRole('button', { name: '開啟 App 系統設定' }));
  expect(openSettings).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(removals).toHaveLength(2);
  for (const remove of removals) expect(remove).toHaveBeenCalledTimes(1);
});

test('unavailable system state and settings failures are visible instead of reported as success', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isScreenReaderEnabled')
    .mockRejectedValue(new Error('unavailable'));
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockRejectedValue(new Error('unavailable'));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  jest.spyOn(Linking, 'openSettings').mockRejectedValue(new Error('unsupported'));
  const view = render(wrap(<AccessibilitySettingsScreen navigation={navigation} />));
  await waitFor(() => expect(view.getAllByText('目前無法讀取')).toHaveLength(2));
  fireEvent.press(view.getByRole('button', { name: '開啟 App 系統設定' }));
  await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent(/無法直接開啟設定/));
});

test('language choices use the actual saved language and explain the available translation coverage', async () => {
  const view = render(
    wrap(
      <I18nProvider>
        <LanguageSettingsScreen navigation={navigation} />
      </I18nProvider>,
    ),
  );
  await act(async () => {});
  fireEvent.press(view.getByRole('radio', { name: 'English' }));
  await waitFor(() =>
    expect(view.getByRole('radio', { name: 'English' })).toHaveAccessibilityState({
      checked: true,
    }),
  );
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('@app_language', 'en');
  expect(view.getByText('Language')).toBeTruthy();
  expect(view.getByText(/尚未翻譯的頁面仍會顯示繁體中文/)).toBeTruthy();
  expect(view.queryByText(/志工翻譯|翻譯貢獻者/)).toBeNull();
});
