import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { PreAuthStack } from '../screens/PreAuthStack';
import { preAuthLinking } from '../app/preAuthLinking';

let mockBrowsingSchoolId = 'nthu';
jest.mock('../state/auth', () => ({
  useAuth: () => ({
    user: null,
    profile: null,
    loading: false,
    profileLoading: false,
  }),
}));
jest.mock('../state/school', () => ({
  useSchool: () => ({
    school: {
      id: mockBrowsingSchoolId,
      name: mockBrowsingSchoolId === 'pu' ? '靜宜大學' : '國立清華大學',
    },
  }),
}));
jest.mock('../state/theme', () => ({ useThemeMode: () => ({ themeMode: 'light' }) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('../state/nuniSession', () => ({
  useNuniSession: () => ({ session: null, loading: false, error: '', pendingLogout: false }),
}));
jest.mock('../screens/NuniWorkspaceScreen', () => ({
  NuniWorkspaceScreen: () => {
    const { Text } = require('react-native');
    return <Text testID="platform-workspace">Campus One 帳號</Text>;
  },
}));
jest.mock('../screens/SSOLoginScreen', () => ({
  SSOLoginScreen: () => {
    const { Text } = require('react-native');
    return <Text testID="school-login-form">登入學校帳號</Text>;
  },
}));
jest.mock('../screens/PersonalImportScreen', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text testID="personal-import-screen">匯入課表紀錄</Text> };
});
jest.mock('../screens/PersonalTimetableScreen', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text testID="personal-timetable-screen">整週個人課表</Text> };
});
jest.mock('../screens/GoogleMapsLikeScreen', () => {
  const { Text } = require('react-native');
  return { GoogleMapsLikeScreen: () => <Text testID="public-map-screen">校園地圖</Text> };
});
jest.mock('../screens/BusAiFirstScreen', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text testID="public-bus-screen">公車查詢</Text> };
});
jest.mock('../screens/LibraryAiFirstScreen', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text testID="public-library-screen">圖書館</Text> };
});
jest.mock('../screens/LibraryCatalogScreen', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text testID="public-library-catalog">館藏查詢</Text> };
});
jest.mock('../screens/CampusContentScreens', () => {
  const { Text } = require('react-native');
  return {
    CampusAnnouncementsScreen: () => <Text testID="public-announcements-screen">公开公告</Text>,
    CampusAnnouncementDetailScreen: () => <Text testID="public-announcement-screen">公告詳情</Text>,
  };
});
// Intentionally keep the real SchoolInfoScreen mounted for this navigation check.
jest.unmock('@react-navigation/native');

let mockInitialUrl: string | null = null;
jest.mock('expo-linking', () => ({
  createURL: () => 'campus://',
  getInitialURL: async () => mockInitialUrl,
  addEventListener: () => ({ remove: jest.fn() }),
}));

beforeEach(() => {
  mockBrowsingSchoolId = 'nthu';
  mockInitialUrl = null;
});

test('guest landing opens the real school-info screen for a non-PU selection', async () => {
  const navigation = createNavigationContainerRef();
  const view = render(
    <NavigationContainer ref={navigation}>
      <PreAuthStack />
    </NavigationContainer>,
  );
  fireEvent.press(await view.findByTestId('public-SchoolInfo'));
  await waitFor(() => expect(navigation.isReady() && navigation.getCurrentRoute()?.name).toBe('SchoolInfo'));
  expect(view.getByText('國立清華大學')).toBeTruthy();
  expect(view.getByText(/學校總機：/)).toBeTruthy();
  expect(view.getByText('撥打學校總機')).toBeTruthy();
  expect(view.queryByText('靜宜大學')).toBeNull();
});

test('cold-start campus://school-info opens the real screen without authentication', async () => {
  mockInitialUrl = 'campus://school-info';
  const navigation = createNavigationContainerRef();
  const view = render(
    <NavigationContainer ref={navigation} linking={preAuthLinking}>
      <PreAuthStack />
    </NavigationContainer>,
  );
  await waitFor(() => expect(navigation.isReady() && navigation.getCurrentRoute()?.name).toBe('SchoolInfo'));
  expect(view.getByText('國立清華大學')).toBeTruthy();
  expect(view.getByText('開啟官方網站')).toBeTruthy();
  expect(view.getByText(/學校總機：/)).toBeTruthy();
  expect(view.getByText(/此頁提供公開聯絡方式；校務服務依學校目前開放項目使用/)).toBeTruthy();
  expect(view.queryByText('靜宜大學')).toBeNull();
});
