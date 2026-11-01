import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ClubSummary } from '../screens/ClubSummary';
const mockCall = jest.fn();
let mockAccountChanged: (user: { uid: string } | null) => void;
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (_: unknown, changed: (user: { uid: string } | null) => void) => {
    mockAccountChanged = changed;
    changed(mockUser);
    return jest.fn();
  },
}));
let mockUser: { uid: string } = { uid: 'one' };
const mockDoc = jest.fn();
const mockDocs = jest.fn();
jest.mock('firebase/firestore', () => ({
  doc: (...parts: unknown[]) => parts.slice(1).join('/'),
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  getDocFromServer: (...args: unknown[]) => mockDoc(...args),
  getDocsFromServer: (...args: unknown[]) => mockDocs(...args),
}));
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockCall }));
jest.mock('../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockUser }),
  getFunctionsInstance: () => ({}),
  getDb: () => ({}),
}));
jest.mock('../ui/components', () => {
  const { View, Text, Pressable } = require('react-native');
  return {
    Card: ({ children, title }: { children: React.ReactNode; title: string }) => (
      <View>
        <Text>{title}</Text>
        {children}
      </View>
    ),
    Button: ({
      text,
      onPress,
      disabled,
    }: {
      text: string;
      onPress: () => void;
      disabled?: boolean;
    }) => (
      <Pressable onPress={onPress} disabled={disabled}>
        <Text>{text}</Text>
      </Pressable>
    ),
  };
});
beforeEach(() => {
  jest.resetAllMocks();
  mockUser = { uid: 'one' };
  mockDoc.mockImplementation(async (path: string) => ({
    data: () =>
      path === 'groups/club'
        ? { type: 'club', schoolId: 'school' }
        : path.includes('/directory/')
          ? { displayName: '備援社員' }
          : { status: 'active' },
  }));
  mockDocs.mockResolvedValue({
    docs: [{ id: 'one', data: () => ({ role: 'owner', phone: '0900000000' }) }],
  });
  process.env.EXPO_PUBLIC_CLUB_ADMIN_ENABLED = 'true';
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_CLUB_ADMIN_ENABLED;
});
test('預設關閉不讀取資料', () => {
  delete process.env.EXPO_PUBLIC_CLUB_ADMIN_ENABLED;
  render(<ClubSummary uid="one" schoolId="school" groupId="club" />);
  expect(mockCall).not.toHaveBeenCalled();
  expect(screen.queryByText('社團活動')).toBeNull();
});
test('呈現伺服器名單與統計', async () => {
  mockCall.mockResolvedValue({
    data: { members: [{ id: 'one', name: '測試社員', role: '社員' }], events: [] },
  });
  render(<ClubSummary uid="one" schoolId="school" groupId="club" />);
  expect(await screen.findByText('社員 1 位 · 活動 0 場')).toBeTruthy();
  expect(mockCall).toHaveBeenCalledWith({ schoolId: 'school', groupId: 'club', action: 'read' });
  expect(screen.queryByText('學號')).toBeNull();
});
test('拒絕讀取顯示錯誤', async () => {
  mockCall.mockRejectedValue(new Error('denied'));
  mockDoc.mockResolvedValue({ data: () => ({ status: 'inactive' }) });
  render(<ClubSummary uid="one" schoolId="school" groupId="club" />);
  expect(await screen.findByText('無法確認社團資料，請重試')).toBeTruthy();
});

test.each(['functions/not-found', 'functions/unavailable', 'network-request-failed'])(
  '%s 時保留備援名單並說明活動管理與 CSV 匯出不可用',
  async (code) => {
    mockCall.mockRejectedValue(Object.assign(new Error(code), { code }));
    render(<ClubSummary uid="one" schoolId="school" groupId="club" />);
    expect(await screen.findByText('備援社員 · 會長')).toBeTruthy();
    expect(screen.getByText('活動管理與 CSV 匯出暫時無法使用，社員名單仍可查閱。')).toBeTruthy();
    expect(screen.queryByText(/活動 0 場|尚無活動|0900000000/)).toBeNull();
    expect(screen.queryByText('建立活動')).toBeNull();
    expect(screen.queryByText('匯出社員與活動 CSV')).toBeNull();
  },
);
test('備援讀取途中切帳號不回傳舊名單', async () => {
  mockCall.mockRejectedValue(new Error('network'));
  mockDocs.mockImplementation(async () => {
    mockUser = { uid: 'two' };
    return { docs: [{ id: 'one', data: () => ({ displayName: '舊社員', role: 'member' }) }] };
  });
  render(<ClubSummary uid="one" schoolId="school" groupId="club" />);
  expect(await screen.findByText('無法確認社團資料，請重試')).toBeTruthy();
  expect(screen.queryByText(/舊社員|備援社員/)).toBeNull();
});
test('切帳號後忽略尚未完成的舊請求', async () => {
  let finish!: (value: unknown) => void;
  mockCall.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<ClubSummary uid="one" schoolId="school" groupId="club" />);
  mockUser = { uid: 'two' };
  mockCall.mockResolvedValue({
    data: { members: [{ id: 'two', name: '新社員', role: 'admin' }], events: [] },
  });
  act(() => mockAccountChanged(mockUser));
  view.rerender(<ClubSummary uid="two" schoolId="school" groupId="club" />);
  expect(await screen.findByText('新社員 · 幹部')).toBeTruthy();
  await act(async () => {
    finish({ data: { members: [{ id: 'one', name: '舊社員', role: 'owner' }], events: [] } });
  });
  expect(screen.queryByText(/舊社員/)).toBeNull();
  expect(screen.getByText('新社員 · 幹部')).toBeTruthy();
});

test('備援查詢失去讀權時拒絕回傳名單', async () => {
  mockCall.mockRejectedValue(new Error('missing'));
  mockDoc.mockRejectedValue(new Error('permission-denied'));
  render(<ClubSummary uid="one" schoolId="school" groupId="club" />);
  expect(await screen.findByText('無法確認社團資料，請重試')).toBeTruthy();
  expect(mockDocs).not.toHaveBeenCalled();
});
test('登入帳號與參數不符時不讀取資料', async () => {
  render(<ClubSummary uid="other" schoolId="school" groupId="club" />);
  expect(screen.queryByText('社團活動')).toBeNull();
  expect(mockCall).not.toHaveBeenCalled();
  expect(mockDoc).not.toHaveBeenCalled();
});

const event = {
  id: 'outing',
  title: '迎新',
  location: '活動中心',
  startsAt: Date.now() + 3600000,
  endsAt: Date.now() + 7200000,
  registered: 2,
  checkedIn: 0,
  mine: false,
  myCheckIn: false,
};
const response = (changes = {}) => ({
  data: { success: true, members: [], events: [{ ...event, ...changes }] },
});
async function openEvent(changes = {}) {
  mockCall.mockResolvedValue(response(changes));
  const view = render(<ClubSummary uid="one" schoolId="school" groupId="club" />);
  await screen.findByText('迎新');
  return view;
}
test('報名前確認，連點僅送一次，重讀完成才顯示已報名與返回', async () => {
  await openEvent();
  fireEvent.press(screen.getByText('報名活動'));
  expect(mockCall).toHaveBeenCalledTimes(1);
  let finish!: (value: unknown) => void;
  mockCall.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mockCall.mockResolvedValue(response({ mine: true, registered: 3 }));
  const confirm = screen.getByText('確認報名');
  fireEvent.press(confirm);
  fireEvent.press(confirm);
  expect(mockCall).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('已報名')).toBeNull();
  expect(screen.getByText('正在確認報名狀態…')).toBeTruthy();
  await act(async () => finish({ data: { success: true } }));
  expect(await screen.findByText('已報名')).toBeTruthy();
  fireEvent.press(screen.getByText('回到活動'));
  expect(screen.getByText('取消報名')).toBeTruthy();
});
test('取消確認可返回，送出後以伺服器狀態顯示未報名', async () => {
  await openEvent({ mine: true });
  fireEvent.press(screen.getByText('取消報名'));
  fireEvent.press(screen.getByText('先保留原狀'));
  expect(screen.getByText('已報名')).toBeTruthy();
  fireEvent.press(screen.getByText('取消報名'));
  mockCall.mockResolvedValue(response());
  fireEvent.press(screen.getByText('確認取消報名'));
  expect(await screen.findByText('回到活動')).toBeTruthy();
  expect(mockCall).toHaveBeenCalledWith({
    schoolId: 'school',
    groupId: 'club',
    eventId: 'outing',
    action: 'cancel',
  });
  expect(screen.getByText('尚未報名')).toBeTruthy();
});
test('斷線後保留活動，重讀已落地的報名，不盲目重送', async () => {
  await openEvent();
  fireEvent.press(screen.getByText('報名活動'));
  mockCall.mockRejectedValueOnce(new Error('network'));
  fireEvent.press(screen.getByText('確認報名'));
  await screen.findByText('重新讀取報名狀態');
  expect(screen.getByText('迎新')).toBeTruthy();
  expect(screen.queryByText('已報名')).toBeNull();
  mockCall.mockResolvedValue(response({ mine: true }));
  fireEvent.press(screen.getByText('重新讀取報名狀態'));
  await screen.findByText(/伺服器當下查詢：已報名/);
  expect(screen.queryByText('回到活動')).toBeNull();
  expect(mockCall.mock.calls.filter(([input]) => input.action === 'register')).toHaveLength(1);
});
test.each([{ startsAt: 1 }, { myCheckIn: true }])('開始或已簽到不可操作 %j', async (changes) => {
  await openEvent(changes);
  expect(screen.queryByText('報名活動')).toBeNull();
  expect(screen.getByText('活動已開始或已簽到，無法變更報名。')).toBeTruthy();
});
test('資格撤銷清除舊資料並提示返回', async () => {
  await openEvent({ mine: true });
  fireEvent.press(screen.getByText('取消報名'));
  mockCall.mockRejectedValue(
    Object.assign(new Error('denied'), { code: 'functions/permission-denied' }),
  );
  fireEvent.press(screen.getByText('確認取消報名'));
  await screen.findByText('社團資格已失效或登入已過期，請返回上一頁確認資格後再開啟。');
  expect(screen.queryByText('迎新')).toBeNull();
});
test.each(['not-found', 'failed-precondition'])('明確拒絕 %s 不提示網路重試', async (code) => {
  await openEvent();
  fireEvent.press(screen.getByText('報名活動'));
  mockCall.mockRejectedValueOnce(Object.assign(new Error(code), { code: `functions/${code}` }));
  fireEvent.press(screen.getByText('確認報名'));
  await screen.findByText('本次操作已被伺服器拒絕。');
  expect(screen.queryByText('重新讀取報名狀態')).toBeNull();
});
test.each([false, true])('逾時後先讀舊快照再晚提交，原 mine=%s 仍保持未確定', async (mine) => {
  await openEvent({ mine });
  fireEvent.press(screen.getByText(mine ? '取消報名' : '報名活動'));
  let serverMine = mine;
  let commit!: () => void;
  const lateCommit = new Promise<void>((resolve) => {
    commit = resolve;
  }).then(() => {
    serverMine = !mine;
  });
  mockCall.mockRejectedValueOnce(
    Object.assign(new Error('timeout'), { code: 'functions/deadline-exceeded' }),
  );
  fireEvent.press(screen.getByText(mine ? '確認取消報名' : '確認報名'));
  await screen.findByText('重新讀取報名狀態');
  mockCall.mockImplementation(async () => response({ mine: serverMine }));
  fireEvent.press(screen.getByText('重新讀取報名狀態'));
  await screen.findByText(/伺服器當下查詢/);
  expect(screen.queryByText('回到活動')).toBeNull();
  fireEvent.press(screen.getByText('重新整理社團資料'));
  expect(mockCall).toHaveBeenCalledTimes(3);
  await act(async () => {
    commit();
    await lateCommit;
  });
  fireEvent.press(screen.getByText('重新讀取報名狀態'));
  await screen.findByText(
    `伺服器當下查詢：${serverMine ? '已報名' : '未報名'}。原操作可能仍在處理，結果尚未確定；請稍後再讀取確認，暫不開放再次操作。`,
  );
  expect(screen.getByText('報名狀態待確認')).toBeTruthy();
  expect(screen.queryByText('回到活動')).toBeNull();
  expect(mockCall.mock.calls.filter(([input]) => input.action !== 'read')).toHaveLength(1);
});
test('送出中切帳號清除活動，舊結果不會回到畫面', async () => {
  await openEvent();
  fireEvent.press(screen.getByText('報名活動'));
  let finish!: (value: unknown) => void;
  mockCall.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.press(screen.getByText('確認報名'));
  act(() => {
    mockUser = { uid: 'two' };
    mockAccountChanged(mockUser);
  });
  await act(async () => finish(response({ mine: true })));
  expect(screen.queryByText('迎新')).toBeNull();
  expect(screen.queryByText('已報名')).toBeNull();
});
test('寫入回應格式不正確時不宣告成功', async () => {
  await openEvent();
  fireEvent.press(screen.getByText('報名活動'));
  mockCall.mockResolvedValueOnce({ data: {} });
  fireEvent.press(screen.getByText('確認報名'));
  await screen.findByText('重新讀取報名狀態');
  expect(screen.queryByText('已報名')).toBeNull();
});

test('寫入確認但後續讀取失敗，仍需重讀才能顯示結果', async () => {
  await openEvent();
  fireEvent.press(screen.getByText('報名活動'));
  mockCall
    .mockResolvedValueOnce({ data: { success: true } })
    .mockRejectedValueOnce(new Error('network'));
  fireEvent.press(screen.getByText('確認報名'));
  await screen.findByText('重新讀取報名狀態');
  expect(screen.queryByText('已報名')).toBeNull();
  mockCall.mockResolvedValue(response());
  fireEvent.press(screen.getByText('重新讀取報名狀態'));
  await screen.findByText('回到活動');
  fireEvent.press(screen.getByText('回到活動'));
  expect(screen.getByText('報名活動')).toBeTruthy();
});
test('確認期間活動開始，不送出過期操作', async () => {
  await openEvent();
  fireEvent.press(screen.getByText('報名活動'));
  const clock = jest.spyOn(Date, 'now').mockReturnValue(event.endsAt + 1);
  try {
    fireEvent.press(screen.getByText('確認報名'));
    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(screen.getByText('活動已開始或已簽到，無法變更報名。')).toBeTruthy();
  } finally {
    clock.mockRestore();
  }
});
