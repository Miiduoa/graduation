import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
const mockCall = jest.fn();
let mockUid = 'staff';
let mockSchoolId = 'pu';
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockCall }));
jest.mock('../firebase', () => ({ getFunctionsInstance: () => ({}) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchoolId } }) }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: mockUid } }) }));
jest.mock('../ui/theme', () => ({
  getThemeVersion: () => 0,
  subscribeToTheme: () => () => {},
}));
jest.mock('../components/dorm/DormWorkflow', () => {
  const { Text } = require('react-native');
  return { DormWorkflow: () => <Text>實際宿舍工作台</Text> };
});
jest.mock('../ui/aiFirst', () => {
  const { Text, View } = require('react-native');
  return {
    aiTokens: {},
    AIDetailScreen: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    AICard: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    AIButton: ({ label }: { label: string }) => <Text>{label}</Text>,
  };
});
import { DormStaffHome } from '../screens/DormStaffHome';
import { UnavailableFeatureScreen } from '../screens/UnavailableFeatureScreen';

const home = () => (
  <DormStaffHome
    fallback={(children) => (
      <UnavailableFeatureScreen title="校務服務">{children}</UnavailableFeatureScreen>
    )}
    onOpen={jest.fn()}
  />
);
const expectOriginalEntries = (view: ReturnType<typeof render>) => {
  expect(view.getByText('查看校方公告')).toBeTruthy();
  expect(view.getByText('查看校園活動')).toBeTruthy();
};
beforeEach(() => {
  mockCall.mockReset();
  mockUid = 'staff';
  mockSchoolId = 'pu';
});
test('confirmed capability adds dorm workspace while keeping original entries', async () => {
  mockCall.mockResolvedValue({ data: { enabled: true, repairs: true } });
  const view = render(home());
  expectOriginalEntries(view);
  expect(view.queryByText('實際宿舍工作台')).toBeNull();
  expect(await view.findByText('實際宿舍工作台')).toBeTruthy();
  expect(view.getByText('宿舍服務')).toBeTruthy();
  expectOriginalEntries(view);
});
test('disabled school keeps the original home', async () => {
  mockCall.mockResolvedValue({ data: { enabled: false, repairs: true } });
  const view = render(home());
  await waitFor(() => expect(mockCall).toHaveBeenCalledTimes(1));
  expectOriginalEntries(view);
  expect(view.queryByText('實際宿舍工作台')).toBeNull();
  expect(view.queryByText('宿舍服務')).toBeNull();
});
test('failed capability query keeps the original home intact', async () => {
  mockCall.mockRejectedValue(new Error('offline'));
  const view = render(home());
  await waitFor(() => expect(mockCall).toHaveBeenCalledTimes(1));
  expectOriginalEntries(view);
  expect(view.queryByText('實際宿舍工作台')).toBeNull();
  expect(view.queryByText('宿舍服務')).toBeNull();
});
test.each(['account', 'school'])(
  '%s changes require capability confirmation again',
  async (change) => {
    mockCall.mockResolvedValue({ data: { enabled: true, packages: true } });
    const view = render(home());
    expect(await view.findByText('實際宿舍工作台')).toBeTruthy();
    mockCall.mockImplementation(() => new Promise(() => {}));
    if (change === 'account') mockUid = 'other-staff';
    else mockSchoolId = 'ntnu';
    view.rerender(home());
    expectOriginalEntries(view);
    expect(view.queryByText('實際宿舍工作台')).toBeNull();
    expect(view.queryByText('宿舍服務')).toBeNull();
  },
);
