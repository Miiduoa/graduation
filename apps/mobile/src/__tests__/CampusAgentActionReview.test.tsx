import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { safeNavigate } from '../utils/safeNavigate';

const mockConfirm = jest.fn();
jest.mock('../features/campusAssistantActions', () => ({
  confirmCampusAgentWrite: (...args: unknown[]) => mockConfirm(...args),
}));

import { CampusAgentActionReview } from '../screens/CampusAgentActionReview';

const proposal = {
  toolName: 'reserveSeat' as const,
  label: '預約座位',
  input: { seatId: 'A1', date: '2030-01-02', startTime: '09:00', endTime: '10:00' },
  agentRunId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
};

beforeEach(() => {
  mockConfirm.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test.each(['Today', '學習', '我的'])(
  '%s 的 permission-denied 可經真 safeNavigate 前往設定，不重送寫入',
  async (tab) => {
    mockConfirm.mockRejectedValue(
      Object.assign(new Error('你在設定關閉了「預約座位」，可到設定頁開啟。'), {
        code: 'functions/permission-denied',
      }),
    );
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const navigation = {
      navigate: jest.fn(),
      getState: () => ({
        routeNames:
          tab === '我的' ? ['MeHome', 'Settings', 'AssistantPermissions'] : ['CampusAssistant'],
      }),
      getParent: () => ({
        getState: () => ({ routeNames: ['Today', '學習', '我的'] }),
        getParent: () => null,
      }),
    };
    const view = render(
      <CampusAgentActionReview
        proposal={proposal}
        userId="alice"
        schoolId="pu"
        isCurrent={() => true}
        onOpenSettings={() => safeNavigate(navigation, 'AssistantPermissions')}
      />,
    );
    await act(async () => {
      fireEvent.press(view.getByText('檢視任務草稿'));
    });
    await act(async () => {
      fireEvent.press(view.getByText('確認並執行'));
    });
    await waitFor(() => {
      expect(view.getAllByText('設定已關閉此寫入動作').length).toBeGreaterThan(0);
    });
    expect(view.getByText(/你在設定關閉了「預約座位」/)).toBeTruthy();
    expect(view.queryByText('執行狀態尚未確認')).toBeNull();
    await act(async () => {
      fireEvent.press(view.getByText('前往設定'));
    });
    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    if (tab === '我的') {
      expect(navigation.navigate).toHaveBeenCalledWith('AssistantPermissions', undefined);
    } else {
      expect(navigation.navigate).toHaveBeenCalledWith('我的', {
        screen: 'AssistantPermissions',
        params: undefined,
      });
    }
    expect(alert).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(view.queryByText('確認並執行')).toBeNull();
    expect(view.queryByText('伺服器已確認執行成功')).toBeNull();
  },
);
