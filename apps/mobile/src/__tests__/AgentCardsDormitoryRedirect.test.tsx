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

import { DORM_REPAIR_COPY } from '@campus/shared/src/dormitory';
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
  expect(view.getByText('已存成報修備忘')).toBeTruthy();
  expect(view.queryByText('平台案件編號：')).toBeNull();
  expect(view.queryByText('R1')).toBeNull();
  fireEvent.press(view.getByText('開啟宿舍服務'));
  expect(mockSafeNavigate).toHaveBeenCalledWith('Dormitory', undefined);
  expect(mockNavigate).not.toHaveBeenCalledWith('DormitoryScreen');
  expect(mockNavigate).not.toHaveBeenCalledWith('Dormitory');
});

test('報修列表卡用備忘標題與狀態，不暗示校方已在處理', () => {
  const view = render(
    <AgentCardList
      cards={[
        {
          kind: 'repair_list',
          payload: {
            count: 2,
            items: [
              { category: '冷氣', status: 'pending', dormitory: 'A棟', room: '301' },
              { category: '水管', status: 'in_progress', dormitory: 'B棟', room: '102' },
            ],
          },
        },
      ]}
    />,
  );
  expect(view.getByText(`${DORM_REPAIR_COPY.assistantListTitle}（2 筆）`)).toBeTruthy();
  expect(view.getAllByText(new RegExp(DORM_REPAIR_COPY.assistantStatusSaved))).toHaveLength(2);
  expect(view.queryByText('報修紀錄（2 筆）')).toBeNull();
  expect(view.queryByText('待處理')).toBeNull();
  expect(view.queryByText('處理中')).toBeNull();
  expect(view.queryByText('已完成')).toBeNull();
});

test('報修列表卡空狀態寫備忘，不寫報修紀錄', () => {
  const view = render(
    <AgentCardList cards={[{ kind: 'repair_list', payload: { count: 0, items: [] } }]} />,
  );
  expect(view.getByText(`${DORM_REPAIR_COPY.assistantListTitle}（0 筆）`)).toBeTruthy();
  expect(view.getByText(DORM_REPAIR_COPY.assistantListEmpty)).toBeTruthy();
  expect(view.queryByText('目前沒有任何報修紀錄。')).toBeNull();
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
