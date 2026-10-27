import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import CreditPlanningScreen from '../screens/CreditPlanningScreen';
import { emptyCreditPlan, type CreditPlan } from '@campus/shared/src/creditPlanner';
import {
  readMobileCreditPlan,
  writeMobileCreditPlan,
} from '../features/academics/creditPlanRepository';

let mockUid: string | null = 'student-a';
let mockSchool = { id: 'pu', name: '靜宜大學' };

jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUid ? { uid: mockUid } : null }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/theme', () => ({ useThemeMode: () => 'light' }));
jest.mock('../ui/components', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    Screen: ({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) =>
      React.createElement(
        View,
        null,
        React.createElement(Text, null, title),
        React.createElement(Text, null, subtitle),
        children,
      ),
    Spinner: () => null,
  };
});
jest.mock('../ui/navigationTheme', () => ({ TAB_BAR_CONTENT_BOTTOM_PADDING: 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { cache: '/tmp' } }));
jest.mock('../features/academics/creditPlanRepository', () => ({
  CREDIT_PLAN_BACKUP_MAX_BYTES: 90_000,
  mobileCreditPlanKey: (uid: string | null, schoolId: string) => `plan:${uid ?? 'guest'}:${schoolId}`,
  readMobileCreditPlan: jest.fn(),
  writeMobileCreditPlan: jest.fn(),
  parsePortableCreditPlan: jest.fn(),
  portableCreditPlanJson: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'student-a';
  mockSchool = { id: 'pu', name: '靜宜大學' };
  jest.mocked(readMobileCreditPlan).mockResolvedValue(emptyCreditPlan());
  jest.mocked(writeMobileCreditPlan).mockResolvedValue(undefined);
});

test('student can set goals and add a hypothetical future course without altering official grades', async () => {
  const view = render(<CreditPlanningScreen />);
  await view.findByText('把未來的學分，排成可執行的計畫。');
  fireEvent.changeText(view.getByLabelText('已確認可採計學分'), '60');
  fireEvent.changeText(view.getByLabelText('希望累計的學分'), '128');
  fireEvent.press(view.getByText('儲存學分目標'));
  await waitFor(() => expect(writeMobileCreditPlan).toHaveBeenCalledWith(
    'plan:student-a:pu', expect.objectContaining({ recognized: '60', target: '128' }),
  ));
  await view.findByText('個人目標已保存在這台裝置。');
  fireEvent.changeText(view.getByLabelText('課程名稱'), '資料庫管理');
  fireEvent.press(view.getByText('加入修課規劃'));
  await waitFor(() => {
    const calls = jest.mocked(writeMobileCreditPlan).mock.calls;
    const latest = calls[calls.length - 1]?.[1] as CreditPlan;
    expect(latest.courses[0]).toMatchObject({
      name: '資料庫管理', credits: 3, term: 1, category: 'elective', status: 'considering',
    });
    expect(latest.recognized).toBe('60');
  });
});

test('mobile displays honest average load and does not allocate unscheduled credits to a term', async () => {
  const plan = {
    ...emptyCreditPlan(), recognized: '60', target: '128', extra: '20',
  };
  jest.mocked(readMobileCreditPlan).mockResolvedValue(plan);
  const view = render(<CreditPlanningScreen />);
  await view.findByText('學期負擔與下一步');
  expect(view.getByText('平均每學期還需')).toBeTruthy();
  expect(view.getByText('尚未排入學期')).toBeTruthy();
  expect(view.getByText(/學期推演不會把/)).toBeTruthy();
  expect(view.getByText('累積 60')).toBeTruthy();
});

test('changing school/account reloads a fresh isolated plan without saving prior state into the new scope', async () => {
  const view = render(<CreditPlanningScreen />);
  await view.findByText('把未來的學分，排成可執行的計畫。');
  mockUid = 'student-b';
  mockSchool = { id: 'nchu', name: '中興大學' };
  view.rerender(<CreditPlanningScreen />);
  await waitFor(() => expect(readMobileCreditPlan).toHaveBeenCalledWith('plan:student-b:nchu'));
  expect(writeMobileCreditPlan).not.toHaveBeenCalledWith('plan:student-b:nchu', expect.anything());
});

test('damaged local storage shows a recoverable error, never an empty replacement success', async () => {
  jest.mocked(readMobileCreditPlan).mockRejectedValueOnce(new Error('invalid local plan'));
  const view = render(<CreditPlanningScreen />);
  await view.findByText('invalid local plan');
  expect(view.getByText(/原有資料沒有被重設或覆寫/)).toBeTruthy();
  expect(writeMobileCreditPlan).not.toHaveBeenCalled();
});
