import React from 'react';
import { Text, View } from 'react-native';
import { render } from '@testing-library/react-native';
const mockCall = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockCall }));
jest.mock('../firebase', () => ({ getFunctionsInstance: () => ({}) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'pu' } }) }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: 'staff' } }) }));
jest.mock('../components/dorm/DormWorkflow', () => {
  const { Text } = require('react-native');
  return { DormWorkflow: () => <Text>實際宿舍工作台</Text> };
});
jest.mock('../ui/aiFirst', () => {
  const { Text, View } = require('react-native');
  return {
    AIDetailScreen: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    AICard: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    AIButton: ({ label }: { label: string }) => <Text>{label}</Text>,
  };
});
import { DormStaffHome } from '../screens/DormStaffHome';
afterEach(() => jest.clearAllMocks());
test('enabled service operator enters the staff workspace', async () => {
  mockCall.mockResolvedValue({ data: { enabled: true, repairs: true } });
  const view = render(<DormStaffHome fallback={<Text>原本校務服務</Text>} onOpen={jest.fn()} />);
  expect(await view.findByText('實際宿舍工作台')).toBeTruthy();
});
test('disabled school keeps the existing staff entry', async () => {
  mockCall.mockResolvedValue({ data: { enabled: false, repairs: true } });
  const view = render(<DormStaffHome fallback={<Text>原本校務服務</Text>} onOpen={jest.fn()} />);
  expect(await view.findByText('原本校務服務')).toBeTruthy();
  expect(view.queryByText('實際宿舍工作台')).toBeNull();
});
