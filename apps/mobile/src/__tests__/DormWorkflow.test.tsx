import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
const mockCall = jest.fn();
jest.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: unknown) => ({ data: await mockCall(data) }),
}));
jest.mock('../firebase', () => ({
  getFunctionsInstance: () => ({}),
  getStorageInstance: () => ({}),
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('../ui/aiFirst', () => ({ aiTokens: { border: '#ddd', text: '#111', ai: '#355e52' } }));
import { DormWorkflow } from '../components/dorm/DormWorkflow';
beforeEach(() => {
  mockCall.mockImplementation(async (data) =>
    data.action === 'config'
      ? { enabled: true, repairs: false, packages: false, admin: false }
      : data.action === 'mine'
        ? { repairs: [], leaves: [] }
        : { success: true },
  );
});
afterEach(() => jest.clearAllMocks());
test('mobile converts an edited memo to a real ticket without losing location', async () => {
  const view = render(
    <DormWorkflow
      schoolId="tw-pu"
      uid="student"
      building="A"
      room="101"
      draft={{ title: '電燈故障', category: 'electric', location: '浴室', description: '無法開啟' }}
      submitOnly
    />,
  );
  fireEvent.press(await view.findByText('送給宿舍輔導員'));
  await waitFor(() =>
    expect(mockCall).toHaveBeenCalledWith(
      expect.objectContaining({
        schoolId: 'pu',
        action: 'submitRepair',
        title: '電燈故障',
        description: '浴室\n無法開啟',
      }),
    ),
  );
  expect(view.queryByText('外宿卡')).toBeNull();
});
test('disabled schools hide official submission', async () => {
  mockCall.mockResolvedValue({ enabled: false });
  const view = render(<DormWorkflow schoolId="pu" uid="student" />);
  await waitFor(() => expect(mockCall).toHaveBeenCalled());
  expect(view.queryByText('送給宿舍輔導員')).toBeNull();
});
test('student can reopen the same repaired ticket', async () => {
  mockCall.mockImplementation(async (data) =>
    data.action === 'config'
      ? { enabled: true }
      : data.action === 'mine'
        ? {
            repairs: [
              {
                id: 'r',
                title: '電燈故障',
                dormStatus: 'fixed',
                dormitory: 'A',
                room: '101',
                history: [{ status: 'fixed', at: 1 }],
              },
            ],
            leaves: [],
          }
        : { success: true },
  );
  const view = render(<DormWorkflow schoolId="pu" uid="student" />);
  fireEvent.press(await view.findByText('還沒修好'));
  await waitFor(() =>
    expect(mockCall).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'repairStatus', id: 'r', status: 'sent' }),
    ),
  );
});

test('disabled school keeps history read-only', async () => {
  mockCall.mockImplementation(async (data) =>
    data.action === 'config'
      ? { enabled: false, repairs: true }
      : {
          repairs: [
            {
              id: 'r',
              title: '歷史報修',
              dormitory: 'A',
              room: '101',
              dormStatus: 'fixed',
              history: [{ status: 'fixed', at: 1 }],
            },
          ],
          leaves: [],
        },
  );
  const view = render(<DormWorkflow schoolId="pu" uid="student" />);
  expect(await view.findByText('歷史報修 · A 101')).toBeTruthy();
  expect(view.queryByText('還沒修好')).toBeNull();
  expect(view.queryByText('開啟輔導員工作台')).toBeNull();
});
test('changing parcel search clears the previously selected resident', async () => {
  mockCall.mockImplementation(async (data) =>
    data.action === 'config'
      ? { enabled: true, packages: true }
      : {
          repairs: [],
          leaves: [],
          packages: [],
          residents: [{ id: '123', studentId: '123', name: '小明', building: 'A', room: '101' }],
        },
  );
  const view = render(<DormWorkflow schoolId="pu" uid="staff" initialStaff />);
  const search = await view.findByLabelText('學號或姓名（本棟住宿生）');
  await waitFor(() =>
    expect(mockCall).toHaveBeenCalledWith(expect.objectContaining({ action: 'workspace' })),
  );
  fireEvent.changeText(search, '123');
  fireEvent.press(await view.findByText('123 小明 A 101'));
  const staleSubmit = view.UNSAFE_root.findAll(
    (node) =>
      typeof node.type === 'function' &&
      node.type.name === 'Btn' &&
      node.props.label === '登錄並通知學生',
  )[0].props.onPress;
  fireEvent.changeText(search, '456');
  // A queued press from the previous render must also reject the old student.
  act(() => staleSubmit());
  expect(
    view.getByRole('button', { name: '登錄並通知學生' }).props.accessibilityState.disabled,
  ).toBe(true);
  fireEvent.press(view.getByText('登錄並通知學生'));
  expect(mockCall.mock.calls.some(([d]) => d.action === 'registerPackage')).toBe(false);
});

test('mobile re-evaluates capabilities after account and school changes', async () => {
  const view = render(<DormWorkflow schoolId="pu" uid="alice" />);
  await waitFor(() =>
    expect(mockCall).toHaveBeenCalledWith(expect.objectContaining({ action: 'mine' })),
  );
  view.rerender(<DormWorkflow schoolId="pu" uid="bob" />);
  await waitFor(() =>
    expect(mockCall.mock.calls.filter(([d]) => d.action === 'config')).toHaveLength(2),
  );
  expect(view.getByText('宿舍輔導員服務')).toBeTruthy();
  view.rerender(<DormWorkflow schoolId="ntnu" uid="bob" />);
  await waitFor(() => expect(mockCall).toHaveBeenCalledWith({ action: 'mine', schoolId: 'ntnu' }));
  expect(view.getByText('宿舍輔導員服務')).toBeTruthy();
});
test('unknown capabilities keep the mobile workflow visible', async () => {
  mockCall.mockRejectedValue(new Error('offline'));
  const view = render(<DormWorkflow schoolId="pu" uid="student" />);
  expect(await view.findByText('宿舍服務暫時無法連線。')).toBeTruthy();
  expect(view.getByText('宿舍輔導員服務')).toBeTruthy();
});

test.each([false, true])(
  'mobile tonight summary uses own leaves in staff mode (own approved=%s)',
  async (approved) => {
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    mockCall.mockImplementation(async (data) =>
      data.action === 'config'
        ? { enabled: true, repairs: true }
        : data.action === 'mine'
          ? {
              repairs: [],
              leaves: approved
                ? [{ id: 'own', date: today, status: 'approved', history: [], reason: '本人返家' }]
                : [],
            }
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
    const onTonight = jest.fn();
    const view = render(
      <DormWorkflow schoolId="pu" uid="staff" onTonightLeaveChange={onTonight} />,
    );
    await waitFor(() => expect(onTonight).toHaveBeenLastCalledWith(approved));
    fireEvent.press(await view.findByText('開啟輔導員工作台'));
    await waitFor(() =>
      expect(mockCall).toHaveBeenCalledWith({ action: 'workspace', schoolId: 'pu' }),
    );
    expect(await view.findByText('其他住宿生返家')).toBeTruthy();
    expect(onTonight).toHaveBeenLastCalledWith(approved);
    fireEvent.press(view.getByText('回學生服務'));
    expect(await view.findByText('開啟輔導員工作台')).toBeTruthy();
    expect(onTonight).toHaveBeenLastCalledWith(approved);
  },
);

test('mobile leave reviewers see applicant name and masked student ID', async () => {
  mockCall.mockImplementation(async (data) =>
    data.action === 'config'
      ? { enabled: true, repairs: true }
      : {
          repairs: [],
          packages: [],
          residents: [],
          leaves: [
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
          ],
        },
  );
  const view = render(<DormWorkflow schoolId="pu" uid="staff" initialStaff />);
  expect(await view.findByText('申請人：王同學 · 學號 ***456')).toBeTruthy();
  expect(view.queryByText('123456')).toBeNull();
});
test('mobile loads another workspace page using server cursors', async () => {
  const cursors = { leaves: 'last-row' };
  mockCall.mockImplementation(async (data) =>
    data.action === 'config'
      ? { enabled: true, repairs: true }
      : {
          repairs: [],
          leaves: [],
          packages: [],
          residents: [],
          nextCursors: data.cursors ? { leaves: null } : cursors,
        },
  );
  const view = render(<DormWorkflow schoolId="pu" uid="staff" initialStaff />);
  fireEvent.press(await view.findByText('載入更多紀錄'));
  await waitFor(() =>
    expect(mockCall).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'workspace', cursors }),
    ),
  );
  await waitFor(() => expect(view.queryByText('載入更多紀錄')).toBeNull());
  fireEvent.press(view.getByText('包含已結案及已處理紀錄'));
  await waitFor(() =>
    expect(mockCall).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'workspace', includeHistory: true }),
    ),
  );
});

test('mobile blocks partial statistics until all 51 records have loaded', async () => {
  const parcel = (i: number) => ({
    id: String(i),
    building: 'A',
    status: 'waiting',
    description: '包裹',
    location: '管理室',
  });
  mockCall.mockImplementation(async (data) =>
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
  const view = render(<DormWorkflow schoolId="pu" uid="admin" initialStaff />);
  await view.findByText('匯出宿舍統計');
  expect(view.getByRole('button', { name: '匯出宿舍統計' }).props.accessibilityState.disabled).toBe(
    true,
  );
  expect(view.getByText('請先載入全部紀錄，再查看或匯出完整統計。')).toBeTruthy();
  fireEvent.press(await view.findByText('載入更多紀錄'));
  await waitFor(() =>
    expect(
      view.getByRole('button', { name: '匯出宿舍統計' }).props.accessibilityState.disabled,
    ).toBe(false),
  );
  expect(view.getByText(/"A","51","0","0"/)).toBeTruthy();
});
