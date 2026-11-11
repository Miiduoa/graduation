import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import OralExamDemoScreen from '../screens/OralExamDemoScreen';
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

test('landing opens the isolated oral-exam workspace without school login', () => {
  const view = render(<LoginLandingScreen />);
  fireEvent.press(view.getByTestId('oral-exam-demo-start'));
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'OralExamDemo');
  expect(view.queryByText('示範工具')).toBeNull();
});

test('student can submit homework and check in on labelled demo data', () => {
  const view = render(<OralExamDemoScreen />);
  expect(view.getByTestId('oral-exam-demo')).toBeTruthy();
  expect(view.getAllByText(/示範學生王小明/).length).toBeGreaterThan(0);
  fireEvent.press(view.getByTestId('oral-exam-submit-hw'));
  fireEvent.press(view.getByTestId('oral-exam-check-in'));
  expect(view.getAllByText(/已繳交/).length).toBeGreaterThan(0);
  expect(view.getAllByText(/已簽到/).length).toBeGreaterThan(0);
});

test('teacher and merchant roles stay on the demo tenant', () => {
  const view = render(<OralExamDemoScreen />);
  fireEvent.press(view.getByTestId('oral-exam-role-teacher'));
  expect(view.getAllByText(/示範教師林佳蓉/).length).toBeGreaterThan(0);
  expect(view.getAllByText(/成績冊/).length).toBeGreaterThan(0);
  fireEvent.press(view.getByTestId('oral-exam-publish-grade'));
  expect(view.getAllByText(/已發布/).length).toBeGreaterThan(0);
  fireEvent.press(view.getByTestId('oral-exam-role-merchant'));
  expect(view.getAllByText(/示範店長黃阿英/).length).toBeGreaterThan(0);
  expect(view.getByText(/正式環境未開放線上點餐/)).toBeTruthy();
  fireEvent.press(view.getByTestId('oral-exam-ready-order'));
  expect(view.getAllByText(/可取餐/).length).toBeGreaterThan(0);
});

test('ops view does not claim access to other tenants', () => {
  const view = render(<OralExamDemoScreen />);
  fireEvent.press(view.getByTestId('oral-exam-role-ops'));
  expect(view.getAllByText(/示範營運吳平台/).length).toBeGreaterThan(0);
  expect(view.getByText(/其他租戶可見：否/)).toBeTruthy();
  expect(view.getByText(/學號登入：關/)).toBeTruthy();
});
