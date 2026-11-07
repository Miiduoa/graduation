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

test('平台報修卡只開啟宿舍服務，不把平台案件編號帶入個人紀錄', () => {
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
  expect(view.getByText('平台案件編號：')).toBeTruthy();
  fireEvent.press(view.getByText('開啟宿舍服務'));
  expect(mockSafeNavigate).toHaveBeenCalledWith('Dormitory', undefined);
  expect(mockNavigate).not.toHaveBeenCalledWith('DormitoryScreen');
  expect(mockNavigate).not.toHaveBeenCalledWith('Dormitory');
});

test.each(['DormitoryScreen', 'Dormitory'])('導覽卡的 %s 開啟目前校園宿舍', (screen) => {
  const view = render(
    <AgentCardList
      cards={[{ kind: 'navigate', payload: { screen, reason: '查看宿舍', params: { repairId: 'R1', schoolId: 'other' } } }]}
    />,
  );
  fireEvent.press(view.getByText('前往宿舍服務'));
  expect(mockSafeNavigate).toHaveBeenCalledWith('Dormitory', undefined);
  expect(mockNavigate).not.toHaveBeenCalled();
});
