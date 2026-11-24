import React from 'react';
import { AccessibilityInfo, Appearance, Linking, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider, useThemeMode } from '../state/theme';
import { ThemePreviewScreen } from '../screens/ThemePreviewScreen';
import { AccessibilitySettingsScreen } from '../screens/AccessibilitySettingsScreen';
import { HelpScreen } from '../screens/HelpScreen';
import { LanguageSettingsScreen } from '../screens/LanguageSettingsScreen';
import { I18nProvider } from '../i18n';
import { PreferencesProvider, usePreferences } from '../state/preferences';
import { applyTheme, getCurrentTheme } from '../ui/theme';

jest.unmock('react-native/Libraries/Utilities/useColorScheme');
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

function deviceMode(initial: 'light' | 'dark') {
  let current = initial;
  const listeners = new Set<(event: { colorScheme: 'light' | 'dark' }) => void>();
  jest.spyOn(Appearance, 'getColorScheme').mockImplementation(() => current);
  jest.spyOn(Appearance, 'addChangeListener').mockImplementation((listener) => {
    listeners.add(listener);
    return {
      remove: () => {
        listeners.delete(listener);
      },
    };
  });
  return (next: 'light' | 'dark') =>
    act(() => {
      current = next;
      listeners.forEach((notify) => notify({ colorScheme: next }));
    });
}

test('fresh appearance follows the system without saving the resolved color; manual choices persist', async () => {
  const changeDevice = deviceMode('dark');
  const view = render(wrap(<ThemePreviewScreen navigation={navigation} />));
  await act(async () => {});
  const radio = (name: string) => view.getByRole('radio', { name });
  expect(radio('跟隨系統')).toHaveAccessibilityState({ checked: true });
  expect(getCurrentTheme().mode).toBe('dark');
  changeDevice('light');
  expect(getCurrentTheme().mode).toBe('light');
  expect(await AsyncStorage.getItem('campus.themeMode.v2')).toBeNull();
  fireEvent.press(radio('深色'));
  changeDevice('dark');
  changeDevice('light');
  expect(getCurrentTheme().mode).toBe('dark');
  expect(radio('深色')).toHaveAccessibilityState({ checked: true });
  view.unmount();

  const restored = render(wrap(<ThemePreviewScreen navigation={navigation} />));
  await waitFor(() =>
    expect(restored.getByRole('radio', { name: '深色' })).toHaveAccessibilityState({
      checked: true,
    }),
  );
  fireEvent.press(restored.getByRole('radio', { name: '跟隨系統' }));
  expect(getCurrentTheme().mode).toBe('light');
  changeDevice('dark');
  expect(getCurrentTheme().mode).toBe('dark');
  await waitFor(() =>
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('campus.themeMode.v2', 'system'),
  );
});

test('legacy light takes priority over general preferences; import, export and reset share the active mode', async () => {
  deviceMode('dark');
  await AsyncStorage.setItem('@user_preferences', JSON.stringify({ appearanceMode: 'dark' }));
  await AsyncStorage.setItem('campus.themeMode.v2', 'light');
  let prefs!: ReturnType<typeof usePreferences>;
  function Probe() {
    prefs = usePreferences();
    const { mode, appearanceMode } = useThemeMode();
    return <Text>{[mode, appearanceMode, prefs.preferences.appearanceMode].join('/')}</Text>;
  }
  const view = render(
    wrap(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    ),
  );
  await waitFor(() => expect(view.getByText('light/light/light')).toBeTruthy());
  expect(JSON.parse(await prefs.exportPreferences()).appearanceMode).toBe('light');
  await act(() => prefs.importPreferences(JSON.stringify({ appearanceMode: 'dark' })));
  expect(view.getByText('dark/dark/dark')).toBeTruthy();
  await act(() => prefs.resetToDefaults());
  expect(view.getByText('dark/system/system')).toBeTruthy();
  expect(JSON.parse(await prefs.exportPreferences()).appearanceMode).toBe('system');
});

test('a general preference from an older settings export is honored if the standalone key is absent', async () => {
  deviceMode('dark');
  await AsyncStorage.setItem('@user_preferences', JSON.stringify({ appearanceMode: 'light' }));
  const view = render(wrap(<ThemePreviewScreen navigation={navigation} />));
  await waitFor(() =>
    expect(view.getByRole('radio', { name: '淺色' })).toHaveAccessibilityState({ checked: true }),
  );
  expect(getCurrentTheme().mode).toBe('light');
  expect(await AsyncStorage.getItem('campus.themeMode.v2')).toBeNull();
});

test('a late storage read cannot revert a selection made in the open settings screen', async () => {
  deviceMode('light');
  const pending = deferred<string | null>();
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(() => pending.promise);
  const view = render(wrap(<ThemePreviewScreen navigation={navigation} />));
  await act(async () => {});
  fireEvent.press(view.getByRole('radio', { name: '深色' }));
  await act(async () => {
    pending.resolve('light');
  });
  expect(view.getByRole('radio', { name: '深色' })).toHaveAccessibilityState({ checked: true });
  expect(getCurrentTheme().mode).toBe('dark');
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
