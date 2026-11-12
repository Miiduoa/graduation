import React from 'react';
import { render } from '@testing-library/react-native';
import LoginLandingScreen from '../screens/LoginLandingScreen';
import { safeNavigate } from '../utils/safeNavigate';

const mockNavigation = { navigate: jest.fn() };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
}));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../state/nuniSession', () => ({
  useNuniSession: () => ({ session: null, loading: false, pendingLogout: false, error: '' }),
}));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: 'pu', name: '靜宜大學' }, selectionReady: true }),
}));
jest.mock('../components/SchoolBrowsingControl', () => ({ SchoolBrowsingControl: () => null }));
jest.mock('../components/TodayTimetablePanel', () => ({ TodayTimetablePanel: () => null }));
jest.mock('../services/schoolLoginAvailability', () => ({
  isSchoolLoginEntryAvailable: () => false,
  loadSchoolLoginProviderKinds: jest.fn(async () => []),
}));
jest.mock('../ui/useThemeStyleSheet', () => ({
  useThemeStyleSheet: <T,>(create: () => T) => create(),
}));

test('landing keeps account and personal tools without a separate oral-exam entry', () => {
  const view = render(<LoginLandingScreen />);
  expect(view.queryByTestId('oral-exam-demo-start')).toBeNull();
  expect(view.queryByText('口試示範工作區')).toBeNull();
  expect(view.getByTestId('public-PersonalCalendar')).toBeTruthy();
  expect(safeNavigate).not.toHaveBeenCalledWith(mockNavigation, 'OralExamDemo');
});
