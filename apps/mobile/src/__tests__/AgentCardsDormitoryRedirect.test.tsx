import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockSafeNavigate = jest.fn();
const mockNavigate = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: () => jest.fn() }));
jest.mock('../firebase', () => ({ getFunctionsInstance: () => ({}) }));
jest.mock('../utils/safeNavigate', () => ({
  safeNavigate: (_nav: unknown, route: string, params?: Record<string, unknown>) =>
    mockSafeNavigate(route, params),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

import { AgentCardList } from '../components/AgentCards';

beforeEach(() => {
  mockSafeNavigate.mockReset();
  mockNavigate.mockReset();
});

test('宿舍報修成功卡改走今天，不再導向已刪的 DormitoryScreen', () => {
  const view = render(
    <AgentCardList
      cards={[
        {
          kind: 'repair_submitted',
          payload: { location: '女一舍', category: '水電', repairId: 'R1' },
        },
      ]}
    />,
  );
  fireEvent.press(view.getByText('查看報修紀錄'));
  expect(mockSafeNavigate).toHaveBeenCalledWith('TodayHome', undefined);
  expect(mockNavigate).not.toHaveBeenCalledWith('DormitoryScreen');
  expect(mockNavigate).not.toHaveBeenCalledWith('Dormitory');
});

test('導覽卡遇到舊宿舍路由名也改走今天', () => {
  const view = render(
    <AgentCardList
      cards={[{ kind: 'navigate', payload: { screen: 'DormitoryScreen', reason: '查看宿舍' } }]}
    />,
  );
  fireEvent.press(view.getByText('前往Dormitory'));
  expect(mockSafeNavigate).toHaveBeenCalledWith('TodayHome', {});
  expect(mockNavigate).not.toHaveBeenCalled();
});
