import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DormWorkflow } from './DormWorkflow';
import {
  dormTicketOverdue,
  parseDormResidentsCsv,
  dormWorkflowSummary,
} from '@campus/shared/src/dormWorkflow';
const api = vi.hoisted(() => ({
  call: vi.fn(),
  config: { enabled: true, repairs: false, packages: false, admin: false },
  rows: { repairs: [] as unknown[], leaves: [] as unknown[], packages: [], residents: [] },
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Record<string, unknown>) => ({ data: await api.call(data) }),
}));
vi.mock('@/lib/firebase', () => ({ getFunctionsInstance: () => ({}), getDb: () => ({ app: {} }) }));
beforeEach(() => {
  api.config = { enabled: true, repairs: false, packages: false, admin: false };
  api.rows = { repairs: [], leaves: [], packages: [], residents: [] };
  api.call.mockImplementation(async (data) =>
    data.action === 'config'
      ? api.config
      : ['mine', 'workspace'].includes(data.action)
        ? api.rows
        : { success: true },
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('disabled school and guests have no submission or staff controls', async () => {
  api.config.enabled = false;
  const view = render(<DormWorkflow schoolId="pu" uid="alice" />);
  await waitFor(() => expect(api.call).toHaveBeenCalled());
  expect(screen.queryByText('外宿卡')).toBeNull();
  view.rerender(<DormWorkflow schoolId="pu" />);
  expect(screen.queryByText('開啟輔導員工作台')).toBeNull();
});
it('sends the actual draft to the canonical school and submits leave with date/reason', async () => {
  render(
    <DormWorkflow
      schoolId="tw-pu"
      uid="alice"
      building="A"
      room="101"
      draft={{ title: '燈不亮', category: 'electric', description: '無法開啟', location: '浴室' }}
    />,
  );
  fireEvent.click(await screen.findByText('送給宿舍輔導員'));
  await waitFor(() =>
    expect(api.call).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'submitRepair',
        schoolId: 'pu',
        title: '燈不亮',
        description: '浴室\n無法開啟',
        building: 'A',
        room: '101',
      }),
    ),
  );
  await waitFor(() =>
    expect((screen.getByText('送給輔導員核可') as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.change(screen.getByLabelText('外宿日期 YYYY-MM-DD'), {
    target: { value: '2099-01-01' },
  });
  fireEvent.change(screen.getByLabelText('外宿原因'), { target: { value: '返家' } });
  fireEvent.click(screen.getByText('送給輔導員核可'));
  await waitFor(() =>
    expect(api.call).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'requestLeave', date: '2099-01-01', reason: '返家' }),
    ),
  );
});
it('shows formal timeline, school reference and reopens the same ticket', async () => {
  api.rows.repairs = [
    {
      id: 'r1',
      title: '燈不亮',
      dormitory: 'A',
      room: '101',
      dormStatus: 'fixed',
      schoolReference: 'A123',
      history: [
        { status: 'sent', at: 1 },
        { status: 'fixed', at: 2 },
      ],
    },
  ];
  render(<DormWorkflow schoolId="pu" uid="alice" />);
  expect(await screen.findByText('學校單號 A123（輔導員填）')).toBeTruthy();
  fireEvent.click(screen.getByText('還沒修好'));
  await waitFor(() =>
    expect(api.call).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'repairStatus', id: 'r1', status: 'sent' }),
    ),
  );
});
it('staff sees grouped tickets and stores receipt plus repair metadata', async () => {
  api.config.repairs = true;
  api.rows.repairs = [
    {
      id: 'r1',
      title: '燈不亮',
      dormitory: 'A',
      room: '101',
      dormStatus: 'sent',
      history: [{ status: 'sent', at: 1 }],
    },
  ];
  render(<DormWorkflow schoolId="pu" uid="staff" />);
  fireEvent.click(await screen.findByText('開啟輔導員工作台'));
  await screen.findByText('學校單號（選填）');
  fireEvent.change(screen.getByLabelText('學校單號（選填）'), { target: { value: 'A123' } });
  fireEvent.click(screen.getByText('輔導員已收到', { selector: 'button' }));
  await waitFor(() =>
    expect(api.call).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'repairStatus',
        id: 'r1',
        status: 'received',
        schoolReference: 'A123',
      }),
    ),
  );
});
it('parses CSV strictly, counts workdays after reopen and exports counts without personal data', () => {
  expect(parseDormResidentsCsv('學號,棟,房,床\n123,A,101,1')).toEqual([
    { studentId: '123', building: 'A', room: '101', bed: '1' },
  ]);
  expect(() => parseDormResidentsCsv('123,A,101,1\n123,A,101,2')).toThrow();
  expect(
    dormTicketOverdue(
      {
        id: '1',
        title: '燈',
        description: '',
        dormitory: 'A',
        room: '101',
        dormStatus: 'sent',
        history: [
          { status: 'sent', at: Date.parse('2026-11-02T00:00:00+08:00') },
          { status: 'sent', at: Date.parse('2026-11-13T00:00:00+08:00') },
        ],
      },
      Date.parse('2026-11-16T00:00:00+08:00'),
    ),
  ).toBe(false);
  expect(
    dormWorkflowSummary({ repairs: [], leaves: [], residents: [], packages: [] }),
  ).not.toContain('學號');
});
