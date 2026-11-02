import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

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

test('permission-denied 顯示後端訊息與前往設定，不顯示結果不確定', async () => {
  mockConfirm.mockRejectedValue(
    Object.assign(new Error('你在設定關閉了「預約座位」，可到設定頁開啟。'), {
      code: 'functions/permission-denied',
    }),
  );
  const onOpenSettings = jest.fn();
  const view = render(
    <CampusAgentActionReview
      proposal={proposal}
      userId="alice"
      schoolId="pu"
      isCurrent={() => true}
      onOpenSettings={onOpenSettings}
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
  expect(onOpenSettings).toHaveBeenCalled();
});
