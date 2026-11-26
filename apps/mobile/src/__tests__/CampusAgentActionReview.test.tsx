import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { safeNavigate } from '../utils/safeNavigate';

const mockConfirm = jest.fn();
jest.mock('../features/campusAssistantActions', () => ({
  ...jest.requireActual('../features/campusAssistantActions'),
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
        initial: false,
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

test('報修確認成功只說備忘已存好，不用通用送出句', async () => {
  mockConfirm.mockResolvedValue({
    success: true, toolName: 'createDormRepairRequest', repairId: 'repair-123',
  });
  const view = render(
    <CampusAgentActionReview
      proposal={{
        toolName: 'createDormRepairRequest',
        label: '確認存成報修備忘',
        input: { dormitory: 'A棟', room: '301', category: '冷氣', description: '不冷' },
        agentRunId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }}
      userId="alice"
      schoolId="pu"
      isCurrent={() => true}
    />,
  );
  await act(async () => {
    fireEvent.press(view.getByText('檢視任務草稿'));
  });
  await act(async () => {
    fireEvent.press(view.getByText('確認並執行'));
  });
  await waitFor(() => {
    expect(view.getAllByText('報修備忘已存好').length).toBeGreaterThan(0);
  });
  expect(view.queryByText('伺服器已確認執行成功')).toBeNull();
  expect(view.queryByText('已送出確認，請核對結果')).toBeNull();
  expect(view.queryByText(/避免重複送出/)).toBeNull();
  expect(view.queryByText(/repair-123/)).toBeNull();
});

test('非報修確認成功仍用通用執行成功句', async () => {
  mockConfirm.mockResolvedValue({
    success: true, toolName: 'reserveSeat', reservationId: 'seat-1',
  });
  const view = render(
    <CampusAgentActionReview
      proposal={proposal}
      userId="alice"
      schoolId="pu"
      isCurrent={() => true}
    />,
  );
  await act(async () => {
    fireEvent.press(view.getByText('檢視任務草稿'));
  });
  await act(async () => {
    fireEvent.press(view.getByText('確認並執行'));
  });
  await waitFor(() => {
    expect(view.getByText('伺服器已確認執行成功')).toBeTruthy();
  });
  expect(view.queryByText('報修備忘已存好')).toBeNull();
});

const washingProposal = {
  toolName: 'cancelWashingReservation' as const,
  label: '確認取消洗衣預約',
  input: {
    reservationId: 'washing-2', machineId: 'A2', dormitory: 'A棟', startTime: '18:30',
    reservedUntil: '2030-01-02T10:40:00.000Z', expectedReservationVersion: 'a'.repeat(64),
  },
  agentRunId: proposal.agentRunId,
};
const washingReceipt = {
  success: true, toolName: 'cancelWashingReservation', reservationId: 'washing-2',
  machineId: 'A2', dormitory: 'A棟', startTime: '18:30', reservedUntil: '2030-01-02T10:40:00.000Z',
  status: 'cancelled', userId: 'alice', schoolId: 'pu',
};

test('洗衣取消先顯示精確來源，先不要不寫入，確認兩次只執行一次並顯示回執', async () => {
  let settle!: (value: unknown) => void;
  mockConfirm.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  const openService = jest.fn();
  const view = render(<CampusAgentActionReview proposal={washingProposal} userId="alice" schoolId="pu"
    isCurrent={() => true} onOpenService={openService} />);
  fireEvent.press(view.getByText('檢視任務草稿'));
  for (const value of ['washing-2', 'A2', 'A棟', '18:30', '2030-01-02T10:40:00.000Z']) {
    expect(view.getByText(value)).toBeTruthy();
  }
  expect(view.queryByText('a'.repeat(64))).toBeNull();
  fireEvent.press(view.getByText('先不要'));
  expect(mockConfirm).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('檢視任務草稿'));
  const confirm = view.getByText('確認並執行');
  await act(async () => {
    fireEvent.press(confirm);
    fireEvent.press(confirm);
  });
  expect(mockConfirm).toHaveBeenCalledTimes(1);
  expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
    proposal: washingProposal, userId: 'alice', schoolId: 'pu',
  }));
  await act(async () => { settle({ ...washingReceipt, requestId: 'unrelated-request' }); });
  expect(view.getByText('洗衣預約已取消')).toBeTruthy();
  expect(view.getByText('紀錄編號：washing-2')).toBeTruthy();
  expect(view.queryByText(/unrelated-request/)).toBeNull();
  expect(view.queryByText('確認並執行')).toBeNull();
  fireEvent.press(view.getByText('開啟服務頁核對紀錄'));
  expect(openService).toHaveBeenCalledTimes(1);
});

test.each(['invalid-receipt', 'deadline-exceeded'])('洗衣取消 %s 維持未知且不自動重送', async message => {
  mockConfirm.mockRejectedValue(new Error(message));
  const view = render(<CampusAgentActionReview proposal={washingProposal} userId="alice" schoolId="pu"
    isCurrent={() => true} />);
  fireEvent.press(view.getByText('檢視任務草稿'));
  await act(async () => { fireEvent.press(view.getByText('確認並執行')); });
  expect(view.getByText('執行狀態尚未確認')).toBeTruthy();
  expect(view.getByText(/重新查詢我的洗衣預約/)).toBeTruthy();
  expect(view.queryByText('洗衣預約已取消')).toBeNull();
  expect(view.queryByText('確認並執行')).toBeNull();
  expect(mockConfirm).toHaveBeenCalledTimes(1);
});

test.each([
  { success: true, toolName: 'cancelWashingReservation' },
  { ...washingReceipt, reservationId: 'washing-other' },
  { ...washingReceipt, machineId: 'A1' },
  { ...washingReceipt, schoolId: 'other-school' },
  { ...washingReceipt, userId: 'bob' },
  { ...washingReceipt, reservedUntil: null },
])('洗衣取消不會將不相符或空回執顯示為完成 %#', async receipt => {
  mockConfirm.mockResolvedValueOnce(receipt);
  const view = render(<CampusAgentActionReview proposal={washingProposal} userId="alice" schoolId="pu"
    isCurrent={() => true} />);
  fireEvent.press(view.getByText('檢視任務草稿'));
  await act(async () => { fireEvent.press(view.getByText('確認並執行')); });
  expect(view.getByText('執行狀態尚未確認')).toBeTruthy();
  expect(view.queryByText('洗衣預約已取消')).toBeNull();
  expect(view.queryByText('確認並執行')).toBeNull();
  expect(mockConfirm).toHaveBeenCalledTimes(1);
});

test('洗衣取消換校後不顯示舊回執，過期草稿不執行', async () => {
  let current = true;
  let settle!: (value: unknown) => void;
  mockConfirm.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  const view = render(<CampusAgentActionReview proposal={washingProposal} userId="alice" schoolId="pu"
    isCurrent={() => current} />);
  fireEvent.press(view.getByText('檢視任務草稿'));
  current = false;
  await act(async () => { fireEvent.press(view.getByText('確認並執行')); });
  expect(mockConfirm).not.toHaveBeenCalled();
  current = true;
  await act(async () => { fireEvent.press(view.getByText('確認並執行')); });
  current = false;
  await act(async () => { settle(washingReceipt); });
  expect(view.queryByText('洗衣預約已取消')).toBeNull();
  expect(view.queryByText('紀錄編號：washing-2')).toBeNull();
  expect(mockConfirm).toHaveBeenCalledTimes(1);
});

test('洗衣取消的獨立權限拒絕提供設定入口，不顯示完成或重送', async () => {
  mockConfirm.mockRejectedValue(Object.assign(new Error('你在設定關閉了「取消洗衣預約」，可到設定頁開啟。'), {
    code: 'functions/permission-denied',
  }));
  const openSettings = jest.fn();
  const view = render(<CampusAgentActionReview proposal={washingProposal} userId="alice" schoolId="pu"
    isCurrent={() => true} onOpenSettings={openSettings} />);
  fireEvent.press(view.getByText('檢視任務草稿'));
  await act(async () => { fireEvent.press(view.getByText('確認並執行')); });
  expect(view.getByText(/你在設定關閉了「取消洗衣預約」/)).toBeTruthy();
  fireEvent.press(view.getByText('前往設定'));
  expect(openSettings).toHaveBeenCalledTimes(1);
  expect(mockConfirm).toHaveBeenCalledTimes(1);
  expect(view.queryByText('洗衣預約已取消')).toBeNull();
  expect(view.queryByText('確認並執行')).toBeNull();
});
