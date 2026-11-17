import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
const mockCall = jest.fn();
jest.mock('../firebase', () => ({
  getAuthInstance: () => ({ currentUser: { uid: 'fixture' } }),
}));
jest.mock('../services/nuniWebFn', () => ({
  postNuniWebFn: (_name: string, data: unknown) => mockCall(data),
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
          residents: [
            { id: 'dw_roster', studentId: '***123', name: '小明', building: 'A', room: '101' },
          ],
        },
  );
  const view = render(<DormWorkflow schoolId="pu" uid="staff" initialStaff />);
  const search = await view.findByLabelText('學號末三碼或姓名（本棟住宿生）');
  await waitFor(() =>
    expect(mockCall).toHaveBeenCalledWith(expect.objectContaining({ action: 'workspace' })),
  );
  fireEvent.changeText(search, '123');
  fireEvent.press(await view.findByText('***123 小明 A 101'));
  const staleSubmit = view.UNSAFE_root.findAll(
    (node) =>
      typeof node.type === 'function' &&
      node.type.name === 'Btn' &&
      node.props.label === '登錄包裹',
  )[0].props.onPress;
  fireEvent.changeText(search, '456');
  // A queued press from the previous render must also reject the old student.
  act(() => staleSubmit());
  expect(
    view.getByRole('button', { name: '登錄包裹' }).props.accessibilityState.disabled,
  ).toBe(true);
  fireEvent.press(view.getByText('登錄包裹'));
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
test('unknown capabilities hide the mobile workflow forms', async () => {
  mockCall.mockRejectedValue(new Error('offline'));
  const view = render(<DormWorkflow schoolId="pu" uid="student" />);
  expect(await view.findByText('宿舍服務暫時無法使用，請稍後再試。')).toBeTruthy();
  expect(view.queryByText('送給宿舍輔導員')).toBeNull();
  expect(view.queryByText('送給輔導員核可')).toBeNull();
  expect(view.queryByLabelText('外宿原因')).toBeNull();
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
  const polling = jest.spyOn(globalThis, 'setInterval');
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
  expect(view.queryByText('輔導員帳號 UID')).toBeNull();
  expect(view.queryByText('值班棟別（授權時必填，多棟以逗號分隔）')).toBeNull();
  expect(view.queryByText('授予包裹及報修權限')).toBeNull();
  expect(view.queryByText('移除宿舍服務權限')).toBeNull();
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
  const count = mockCall.mock.calls.length;
  const tick = polling.mock.calls.find(([, ms]) => ms === 60000)?.[0] as () => void;
  await act(async () => {
    tick();
  });
  expect(mockCall.mock.calls.length).toBe(count);
  expect(view.getByRole('button', { name: '匯出宿舍統計' }).props.accessibilityState.disabled).toBe(
    false,
  );
  polling.mockRestore();
});

test('mobile resolves repair photos through the authorized backend', async () => {
  mockCall.mockImplementation(async (data) =>
    data.action === 'config'
      ? { enabled: true }
      : data.action === 'repairPhoto'
        ? { url: 'https://signed.invalid/random' }
        : {
            repairs: [
              {
                id: 'dw_photo',
                title: '合成報修',
                dormitory: 'A',
                room: '101',
                dormStatus: 'sent',
                history: [],
                images: ['0'],
              },
            ],
            leaves: [],
          },
  );
  const view = render(<DormWorkflow schoolId="pu" uid="student" />);
  fireEvent.press(await view.findByText('查看報修照片 1'));
  await waitFor(() =>
    expect(mockCall).toHaveBeenCalledWith({
      schoolId: 'pu',
      action: 'repairPhoto',
      id: 'dw_photo',
      index: 0,
    }),
  );
  expect((await view.findAllByLabelText('報修照片 1')).length).toBeGreaterThan(0);
});

test('mobile sends the selected opaque resident handle with masked display', async () => {
  mockCall.mockImplementation(async (data) =>
    data.action === 'config'
      ? { enabled: true, packages: true }
      : {
          repairs: [],
          leaves: [],
          packages: [],
          residents: [
            {
              id: 'dw_resident',
              studentId: '***456',
              name: '合成同學',
              building: 'A',
              room: '101',
            },
          ],
        },
  );
  const view = render(<DormWorkflow schoolId="pu" uid="staff" initialStaff />);
  fireEvent.changeText(await view.findByLabelText('學號末三碼或姓名（本棟住宿生）'), '456');
  fireEvent.press(await view.findByText('***456 合成同學 A 101'));
  fireEvent.press(view.getByText('登錄包裹'));
  await waitFor(() =>
    expect(mockCall).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'registerPackage', studentId: 'dw_resident' }),
    ),
  );
  expect(await view.findByText('已登錄，學生開啟 nuni 宿舍頁即可看到。')).toBeTruthy();
});

it('完整學號查詢與零筆核銷提示', async () => {
  mockCall.mockImplementation(async (data) =>
    data.action === 'config'
      ? { enabled: true, packages: true }
      : data.action === 'findResident'
        ? {
            residents: [
              { id: 'dw_found', studentId: '***456', name: '查詢同學', building: 'A', room: '101' },
            ],
          }
        : data.action === 'collectPackages'
          ? { success: false, updated: 0, skipped: 1 }
          : { repairs: [], leaves: [], packages: [], residents: [] },
  );
  const view = render(<DormWorkflow schoolId="pu" uid="staff" initialStaff />);
  fireEvent.changeText(
    await view.findByLabelText('學號末三碼或姓名（本棟住宿生）'),
    'SYNTHETIC123456',
  );
  fireEvent.press(view.getByText('以完整學號查詢'));
  fireEvent.press(await view.findByText('***456 查詢同學 A 101'));
  fireEvent.press(view.getByText('登錄包裹'));
  await waitFor(() =>
    expect(mockCall).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'registerPackage', studentId: 'dw_found' }),
    ),
  );
  await view.findByText('已登錄，學生開啟 nuni 宿舍頁即可看到。');
  fireEvent.changeText(view.getByLabelText('核對學生領取碼上的學號'), 'wrong');
  fireEvent.press(view.getByText('已核對姓名與學號・全部核銷'));
  expect(await view.findByText('未核銷任何包裹，跳過 1 件。')).toBeTruthy();
});

test('failed config also hides the mobile memo submission form', async () => {
  mockCall.mockRejectedValue(new Error('unauthenticated'));
  const view = render(<DormWorkflow schoolId="pu" uid="student" submitOnly />);
  expect(await view.findByText('宿舍服務暫時無法使用，請稍後再試。')).toBeTruthy();
  expect(view.queryByText('送給宿舍輔導員')).toBeNull();
});

test.each([0, 1])(
  'reports announcement push delivery honestly (%i delivered)',
  async (delivered) => {
    mockCall.mockImplementation(async (data) =>
      data.action === 'config'
        ? { enabled: true, packages: true }
        : ['mine', 'workspace'].includes(data.action)
          ? { repairs: [], leaves: [], packages: [], residents: [] }
          : { success: true, delivered, recipients: 1 },
    );
    const view = render(<DormWorkflow schoolId="pu" uid="staff" />);
    fireEvent.press(await view.findByText('開啟輔導員工作台'));
    fireEvent.press(await view.findByText('住宿生'));
  fireEvent.press(await view.findByText('預覽公告'));
    fireEvent.press(view.getByText('確認發布本棟公告'));
    expect(
      await view.findByText(delivered ? '公告已發布，推播 1/1 人。' : '公告已發布，推播尚未送出。'),
    ).toBeTruthy();
  },
);

test.each([false, true])('設定查詢失敗可重試並重新開啟服務（submitOnly=%s）', async (submitOnly) => {
  mockCall.mockRejectedValueOnce(new Error('offline'));
  const view = render(<DormWorkflow schoolId="pu" uid="student" submitOnly={submitOnly} draft={{ title: '燈壞了', description: '不亮', category: 'electric', location: '浴室' }} />);
  await view.findByText('宿舍服務暫時無法使用，請稍後再試。');
  fireEvent.press(view.getByText('重試'));
  expect(await view.findByText('送給宿舍輔導員')).toBeTruthy();
  expect(mockCall.mock.calls.filter(([data]) => data.action === 'config')).toHaveLength(2);
});

test('工單區分載入、失敗、重試與空白結果', async () => {
  let rejectRows!: (reason: Error) => void;
  mockCall.mockImplementation(async (data) => data.action === 'config'
    ? { enabled: true, repairs: false, packages: false }
    : new Promise((_, reject) => { rejectRows = reject; }));
  const view = render(<DormWorkflow schoolId="pu" uid="student" />);
  expect(await view.findByText('正在讀取工單…')).toBeTruthy();
  expect(view.queryByText('目前沒有送給輔導員的工單。')).toBeNull();
  await act(async () => rejectRows(new Error('offline')));
  expect(await view.findByText('工單讀取失敗，請重試。')).toBeTruthy();
  expect(view.queryByText('目前沒有送給輔導員的工單。')).toBeNull();
  mockCall.mockResolvedValue({ repairs: [], leaves: [] });
  fireEvent.press(view.getByText('重試'));
  expect(await view.findByText('目前沒有送給輔導員的工單。')).toBeTruthy();
  expect(view.queryByText('工單讀取失敗，請重試。')).toBeNull();
  expect(view.queryByText('讀取失敗，請重試。')).toBeNull();
});

test('外宿卡說明使用校方名冊且不送出本機棟別與房間', async () => {
  const view = render(<DormWorkflow schoolId="pu" uid="student" building="本機棟別" room="999" />);
  expect(await view.findByText('棟別與寢室依校方住宿名冊帶入')).toBeTruthy();
  expect(view.queryByText('外宿棟別')).toBeNull();
  expect(view.queryByText('外宿房間')).toBeNull();
  fireEvent.changeText(view.getByLabelText('外宿日期 YYYY-MM-DD'), '2099-01-01');
  fireEvent.changeText(view.getByLabelText('外宿原因'), '返家');
  fireEvent.press(view.getByText('送給輔導員核可'));
  await waitFor(() => expect(mockCall).toHaveBeenCalledWith(expect.objectContaining({ action: 'requestLeave', date: '2099-01-01', reason: '返家' })));
  const payload = mockCall.mock.calls.find(([data]) => data.action === 'requestLeave')![0];
  expect(payload).not.toHaveProperty('building');
  expect(payload).not.toHaveProperty('room');
});

test.each([
  ['manual', true, true],
  ['manual', false, true],
  ['manual', true, false],
  ['timer', true, true],
  ['timer', false, true],
  ['timer', true, false],
] as const)(
  'only the latest row read updates the UI (%s, olderFails=%s, latestFirst=%s)',
  async (source, olderFails, latestFirst) => {
    const polling = jest.spyOn(globalThis, 'setInterval');
    const pending: { resolve: (value: unknown) => void; reject: (reason: Error) => void }[] = [];
    const repair = (title: string) => ({
      repairs: [{ id: title, title, dormitory: 'A', room: '101', dormStatus: 'sent', history: [] }],
      leaves: [],
    });
    try {
      const view = render(<DormWorkflow schoolId="pu" uid="student" />);
      await view.findByText('目前沒有送給輔導員的工單。');
      mockCall.mockImplementation(() => new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
      }));
      fireEvent.press(view.getByText('重新整理'));
      await waitFor(() => expect(pending).toHaveLength(1));
      if (source === 'timer') {
        await act(async () => {
          for (const [tick, ms] of polling.mock.calls) {
            if (ms === 60000 && typeof tick === 'function') tick();
          }
        });
      } else {
        fireEvent.press(view.getByText('重新整理'));
      }
      await waitFor(() => expect(pending).toHaveLength(2));
      const settleOlder = () => olderFails
        ? pending[0].reject(new Error('older request failed'))
        : pending[0].resolve(repair('舊工單'));
      const settleLatest = () => olderFails
        ? pending[1].resolve(repair('新工單'))
        : pending[1].reject(new Error('latest request failed'));
      await act(async () => { (latestFirst ? settleLatest : settleOlder)(); });
      if (!latestFirst) {
        expect(view.getByText('正在讀取工單…')).toBeTruthy();
        expect(view.queryByText('工單讀取失敗，請重試。')).toBeNull();
        expect(view.queryByText('讀取失敗，請重試。')).toBeNull();
      }
      await act(async () => { (latestFirst ? settleOlder : settleLatest)(); });
      expect(view.queryByText('舊工單 · A 101')).toBeNull();
      expect(view.queryByText('正在讀取工單…')).toBeNull();
      if (olderFails) {
        expect(view.getByText('新工單 · A 101')).toBeTruthy();
        expect(view.queryByText('工單讀取失敗，請重試。')).toBeNull();
        expect(view.queryByText('讀取失敗，請重試。')).toBeNull();
      } else {
        expect(view.getByText('工單讀取失敗，請重試。')).toBeTruthy();
        expect(view.queryByText('目前沒有送給輔導員的工單。')).toBeNull();
      }
    } finally {
      polling.mockRestore();
    }
  },
);
