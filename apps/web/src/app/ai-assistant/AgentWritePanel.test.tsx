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
