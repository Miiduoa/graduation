import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  rows: {
    repairs: [] as unknown[],
    leaves: [] as unknown[],
    packages: [],
    residents: [] as {
      id: string;
      studentId: string;
      name: string;
      building: string;
      room: string;
    }[],
  },
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

it('keeps history read-only after school disables the workflow', async () => {
  api.config.enabled = false;
  api.rows.repairs = [
    {
      id: 'r',
      title: '歷史報修',
      dormitory: 'A',
      room: '101',
      dormStatus: 'fixed',
      history: [{ status: 'fixed', at: 1 }],
    },
  ];
  const onRepairs = vi.fn();
  render(<DormWorkflow schoolId="pu" uid="alice" onOwnRepairsChange={onRepairs} />);
  await waitFor(() =>
    expect(onRepairs).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'r', official: true, status: 'fixed' }),
    ]),
  );
  expect(await screen.findByText('歷史報修 · A 101')).toBeTruthy();
  expect(screen.queryByText('還沒修好')).toBeNull();
  expect(screen.queryByText('送給輔導員核可')).toBeNull();
  expect(screen.queryByText('開啟輔導員工作台')).toBeNull();
});
it('requires a fresh resident selection after changing parcel search', async () => {
  api.config.packages = true;
  api.rows.residents = [
    { id: 'dw_roster', studentId: '***123', name: '小明', building: 'A', room: '101' },
  ];
  render(<DormWorkflow schoolId="pu" uid="staff" initialStaff />);
  const search = await screen.findByLabelText('學號末三碼或姓名（本棟住宿生）');
  fireEvent.change(search, { target: { value: '123' } });
  fireEvent.click(await screen.findByText('***123 小明 A 101'));
  expect((screen.getByText('登錄並通知學生') as HTMLButtonElement).disabled).toBe(false);
  fireEvent.change(search, { target: { value: '456' } });
  expect((screen.getByText('登錄並通知學生') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('登錄並通知學生'));
  expect(api.call.mock.calls.some(([d]) => d.action === 'registerPackage')).toBe(false);
});

it('re-evaluates capabilities on account and school changes and ignores old responses', async () => {
  let resolveOld!: (value: unknown) => void;
  const view = render(<DormWorkflow schoolId="pu" uid="alice" />);
  await screen.findByText('宿舍輔導員服務');
  api.call.mockImplementation(async (data) => {
    if (data.action !== 'config') return api.rows;
    if (data.schoolId === 'pu')
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    return api.config;
  });
  view.rerender(<DormWorkflow schoolId="pu" uid="bob" />);
  expect(screen.getByText('宿舍輔導員服務')).toBeTruthy();
  view.rerender(<DormWorkflow schoolId="ntnu" uid="bob" />);
  await waitFor(() => expect(api.call).toHaveBeenCalledWith({ action: 'mine', schoolId: 'ntnu' }));
  resolveOld({ enabled: false });
  await waitFor(() => expect(screen.getByText('宿舍輔導員服務')).toBeTruthy());
  view.rerender(<DormWorkflow schoolId="ntnu" uid="carol" />);
  await waitFor(() =>
    expect(api.call.mock.calls.filter(([d]) => d.action === 'config')).toHaveLength(4),
  );
  expect(screen.getByText('宿舍輔導員服務')).toBeTruthy();
});

it.each([false, true])(
  'tonight summary uses own leaves across staff switches (own approved=%s)',
  async (approved) => {
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const own = {
      repairs: [],
      leaves: approved
        ? [{ id: 'own', date: today, status: 'approved', history: [], reason: '本人返家' }]
        : [],
    };
    api.call.mockImplementation(async (data) =>
      data.action === 'config'
        ? { enabled: true, repairs: true }
        : data.action === 'mine'
          ? own
          : {
              repairs: [],
              leaves: [
                {
                  id: 'other',
                  date: today,
                  status: 'approved',
                  history: [],
                  reason: '其他住宿生返家',
                },
              ],
            },
    );
    const onTonight = vi.fn();
    render(<DormWorkflow schoolId="pu" uid="staff" onTonightLeaveChange={onTonight} />);
    await waitFor(() => expect(onTonight).toHaveBeenLastCalledWith(approved));
    fireEvent.click(await screen.findByText('開啟輔導員工作台'));
    await waitFor(() =>
      expect(api.call).toHaveBeenCalledWith({ action: 'workspace', schoolId: 'pu' }),
    );
    expect(await screen.findByText('其他住宿生返家')).toBeTruthy();
    expect(onTonight).toHaveBeenLastCalledWith(approved);
    fireEvent.click(screen.getByText('回學生服務'));
    await waitFor(() => expect(screen.getByText('開啟輔導員工作台')).toBeTruthy());
    expect(onTonight).toHaveBeenLastCalledWith(approved);
  },
);

it('authorized leave reviewers see applicant name and only masked student ID', async () => {
  api.config.repairs = true;
  api.rows.leaves = [
    {
      id: 'leave',
      date: '2099-01-01',
      building: 'A',
      room: '101',
      reason: '返家',
      status: 'pending',
      history: [],
      applicantName: '王同學',
      maskedStudentId: '***456',
    },
  ];
  render(<DormWorkflow schoolId="pu" uid="staff" initialStaff />);
  expect(await screen.findByText('申請人：王同學 · 學號 ***456')).toBeTruthy();
  expect(screen.queryByText('123456')).toBeNull();
});
it('loads the next workspace page with server cursors', async () => {
  api.config.repairs = true;
  const cursors = { leaves: 'last-row' };
  api.call.mockImplementation(async (data) =>
    data.action === 'config'
      ? api.config
      : {
          ...api.rows,
          nextCursors: data.cursors ? { leaves: null } : cursors,
        },
  );
  render(<DormWorkflow schoolId="pu" uid="staff" initialStaff />);
  fireEvent.click(await screen.findByText('載入更多紀錄'));
  await waitFor(() =>
    expect(api.call).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'workspace', cursors }),
    ),
  );
  await waitFor(() => expect(screen.queryByText('載入更多紀錄')).toBeNull());
  fireEvent.click(screen.getByText('包含已結案及已處理紀錄'));
  await waitFor(() =>
    expect(api.call).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'workspace', includeHistory: true }),
    ),
  );
});

it('blocks partial statistics until all 51 records have loaded', async () => {
  const polling = vi.spyOn(globalThis, 'setInterval');
  const parcel = (i: number) => ({
    id: String(i),
    building: 'A',
    status: 'waiting',
    description: '包裹',
    location: '管理室',
  });
  api.call.mockImplementation(async (data) =>
    data.action === 'config'
      ? { enabled: true, repairs: true, packages: true, admin: true }
      : data.action === 'mine'
        ? { repairs: [], leaves: [] }
        : {
            repairs: [],
            leaves: [],
            residents: [],
            packages: data.cursors ? [parcel(50)] : Array.from({ length: 50 }, (_, i) => parcel(i)),
            nextCursors: { parcels: data.cursors ? null : '49' },
          },
  );
  render(<DormWorkflow schoolId="pu" uid="admin" initialStaff />);
  const button = await screen.findByRole('button', { name: '匯出宿舍統計' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('請先載入全部紀錄，再查看或匯出完整統計。')).toBeTruthy();
  fireEvent.click(await screen.findByText('載入更多紀錄'));
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByText(/"A","51","0","0"/)).toBeTruthy();
  const count = api.call.mock.calls.length;
  const tick = polling.mock.calls.find(([, ms]) => ms === 60000)?.[0] as () => void;
  await act(async () => {
    tick();
  });
  expect(api.call.mock.calls.length).toBe(count);
  expect(screen.getByText(/"A","51","0","0"/)).toBeTruthy();
  polling.mockRestore();
});

it('selects a masked resident using the opaque handle for package registration', async () => {
  api.config.packages = true;
  api.rows.residents = [
    {
      id: 'dw_synthetic_resident',
      studentId: '***456',
      name: '合成同學',
      building: 'A',
      room: '101',
    },
  ];
  render(<DormWorkflow schoolId="pu" uid="staff" initialStaff />);
  fireEvent.change(await screen.findByLabelText('學號末三碼或姓名（本棟住宿生）'), {
    target: { value: '456' },
  });
  fireEvent.click(await screen.findByText('***456 合成同學 A 101'));
  fireEvent.click(screen.getByText('登錄並通知學生'));
  await waitFor(() =>
    expect(api.call).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'registerPackage', studentId: 'dw_synthetic_resident' }),
    ),
  );
});

it('resolves ticket photos through the authorized backend only on request', async () => {
  api.rows.repairs = [
    {
      id: 'dw_photo',
      title: '合成報修',
      dormitory: 'A',
      room: '101',
      dormStatus: 'sent',
      history: [],
      images: ['0'],
    },
  ];
  const original = api.call.getMockImplementation()!;
  api.call.mockImplementation(async (data) =>
    data.action === 'repairPhoto' ? { url: 'https://signed.invalid/random' } : original(data),
  );
  render(<DormWorkflow schoolId="pu" uid="student" />);
  const button = await screen.findByText('查看報修照片 1');
  expect(screen.queryByRole('img')).toBeNull();
  fireEvent.click(button);
  await waitFor(() =>
    expect(api.call).toHaveBeenCalledWith({
      schoolId: 'pu',
      action: 'repairPhoto',
      id: 'dw_photo',
      index: 0,
    }),
  );
  expect((await screen.findByRole('img')).getAttribute('src')).toBe(
    'https://signed.invalid/random',
  );
});
