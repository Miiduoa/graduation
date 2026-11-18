import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('@/lib/campusAssistantClient', () => ({
  executeCampusAgentWrite: mocks.execute,
}));

vi.mock('@/lib/onlineOrdering', () => ({
  isWebOnlineOrderingEnabled: () => true,
}));

import { AgentWritePanel } from './AgentWritePanel';

const proposal = {
  toolName: 'reserveSeat' as const,
  label: '預約座位',
  input: { seatId: 'A1', date: '2030-01-02', startTime: '09:00', endTime: '10:00' },
  agentRunId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
};

beforeEach(() => {
  mocks.execute.mockReset();
});

it('permission-denied 顯示後端訊息與前往設定，不顯示結果不確定', async () => {
  mocks.execute.mockRejectedValue(
    Object.assign(new Error('你在設定關閉了「預約座位」，可到設定頁開啟。'), {
      code: 'functions/permission-denied',
    }),
  );
  render(
    <AgentWritePanel
      proposal={proposal}
      userId="alice"
      schoolId="pu"
      onCompleted={() => undefined}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '檢視草稿' }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '確認並執行' }));
  });
  await waitFor(() => {
    expect(screen.getByText('設定已關閉此寫入動作')).toBeTruthy();
  });
  expect(screen.getByText(/你在設定關閉了「預約座位」/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往設定' }).getAttribute('href')).toBe(
    '/settings?section=assistant',
  );
  expect(screen.queryByText('尚未收到確定的執行結果')).toBeNull();
});

it('報修確認用備忘句，不用送出後離開或伺服器已確認執行成功', async () => {
  mocks.execute.mockResolvedValue({
    success: true, toolName: 'createDormRepairRequest', repairId: 'repair-123',
  });
  render(
    <AgentWritePanel
      proposal={{
        toolName: 'createDormRepairRequest',
        label: '確認存成報修備忘',
        input: { dormitory: 'A棟', room: '301', category: '冷氣', description: '不冷' },
        agentRunId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }}
      userId="alice"
      schoolId="pu"
      onCompleted={() => undefined}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '檢視草稿' }));
  expect(screen.getByText(/確認後只會存成報修備忘/)).toBeTruthy();
  expect(screen.queryByText(/送出後即使離開此頁/)).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '確認並執行' }));
  });
  await waitFor(() => {
    expect(screen.getByText('報修備忘已存好')).toBeTruthy();
  });
  expect(screen.queryByText('伺服器已確認執行成功')).toBeNull();
  expect(screen.queryByText(/repair-123/)).toBeNull();
});

it('非報修確認仍保留通用送出與執行成功句', async () => {
  mocks.execute.mockResolvedValue({
    success: true, toolName: 'reserveSeat', reservationId: 'seat-1',
  });
  render(
    <AgentWritePanel
      proposal={proposal}
      userId="alice"
      schoolId="pu"
      onCompleted={() => undefined}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '檢視草稿' }));
  expect(screen.getByText(/送出後即使離開此頁，操作也可能繼續完成/)).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '確認並執行' }));
  });
  await waitFor(() => {
    expect(screen.getByText('伺服器已確認執行成功')).toBeTruthy();
  });
  expect(screen.queryByText('報修備忘已存好')).toBeNull();
});

const cancelProposal = { toolName: 'cancelWashingReservation', label: '取消洗衣預約', agentRunId: proposal.agentRunId,
  input: { reservationId: 'wash-1', expectedReservationVersion: 'a'.repeat(64), machineId: 'A2', dormitory: '女生宿舍',
    startTime: '2030-01-02T09:00:00+08:00', reservedUntil: '2030-01-02T02:00:00.000Z' } };
const cancelReceipt = { success: true, toolName: 'cancelWashingReservation', reservationId: 'wash-1', machineId: 'A2',
  dormitory: '女生宿舍', startTime: cancelProposal.input.startTime, reservedUntil: cancelProposal.input.reservedUntil,
  status: 'cancelled', schoolId: 'pu', userId: 'alice' };
function openCancellation(onCompleted = vi.fn()) {
  const view = render(<AgentWritePanel proposal={cancelProposal} userId="alice" schoolId="pu" onCompleted={onCompleted} />);
  fireEvent.click(screen.getByRole('button', { name: '檢視草稿' }));
  return { ...view, onCompleted };
}
it.each([cancelProposal.input.reservedUntil, null])('shows the exact cancellation target and end %s before confirmation', reservedUntil => {
  render(<AgentWritePanel proposal={{ ...cancelProposal, input: { ...cancelProposal.input, reservedUntil } }} userId="alice" schoolId="pu" onCompleted={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '檢視草稿' }));
  for (const value of ['wash-1', 'A2', '女生宿舍', cancelProposal.input.startTime, reservedUntil ?? '未提供到期時間'])
    expect(screen.getByText(value)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '先不要' }));
  expect(mocks.execute).not.toHaveBeenCalled();
});
it('confirms cancellation once and shows only the verified cancellation receipt', async () => {
  let finish!: (value: unknown) => void;
  mocks.execute.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { onCompleted } = openCancellation();
  const button = screen.getByRole('button', { name: '確認並執行' });
  act(() => { button.click(); button.click(); });
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  await act(async () => finish(cancelReceipt));
  expect(screen.getByText('洗衣預約已取消')).toBeTruthy();
  expect(screen.getByText('紀錄編號：wash-1')).toBeTruthy();
  expect(onCompleted).toHaveBeenCalledTimes(1);
});
it.each(['bare-success', 'mismatch', 'timeout'])('does not retry or claim cancellation after %s', async mode => {
  if (mode === 'timeout') mocks.execute.mockRejectedValue(new Error('timeout'));
  else mocks.execute.mockResolvedValue(mode === 'bare-success' ? { success: true, toolName: cancelProposal.toolName }
    : { ...cancelReceipt, machineId: 'A1' });
  const { onCompleted } = openCancellation();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '確認並執行' })));
  expect(screen.queryByText('洗衣預約已取消')).toBeNull();
  expect(screen.getByText(/重新查詢洗衣預約/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '查看服務紀錄' }).getAttribute('href')).toBe('/dormitory');
  expect(screen.queryByRole('button', { name: '確認並執行' })).toBeNull();
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  expect(onCompleted).not.toHaveBeenCalled();
});
it.each(['school', 'account', 'unmount'])('ignores cancellation completion after %s changes', async change => {
  let finish!: (value: unknown) => void;
  mocks.execute.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = openCancellation();
  fireEvent.click(screen.getByRole('button', { name: '確認並執行' }));
  const signal = mocks.execute.mock.calls[0][1] as AbortSignal | undefined;
  if (change === 'unmount') view.unmount();
  else view.rerender(<AgentWritePanel proposal={cancelProposal} userId={change === 'account' ? 'bob' : 'alice'} schoolId={change === 'school' ? 'nthu' : 'pu'} onCompleted={view.onCompleted} />);
  await act(async () => finish(cancelReceipt));
  expect(signal?.aborted).toBe(true);
  expect(view.onCompleted).not.toHaveBeenCalled();
  expect(screen.queryByText('洗衣預約已取消')).toBeNull();
});

it('uses the verified reservation ID even if the response also includes an unrelated reference', async () => {
  mocks.execute.mockResolvedValue({ ...cancelReceipt, requestId: 'other-transaction' });
  openCancellation();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '確認並執行' })));
  expect(screen.getByText('紀錄編號：wash-1')).toBeTruthy();
  expect(screen.queryByText(/other-transaction/)).toBeNull();
});
