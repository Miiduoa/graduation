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
