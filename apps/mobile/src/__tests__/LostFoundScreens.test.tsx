import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { LostFoundScreen } from '../screens/LostFoundScreen';
import { LostFoundDetailScreen } from '../screens/LostFoundDetailScreen';
import { LostFoundPostScreen } from '../screens/LostFoundPostScreen';
import type { LostFoundItem } from '../data/types';

let mockUser: { uid: string } | null = { uid: 'owner' };
let mockSchool = { id: 'pu' };
let mockReal = true;
const mockSource = {
  listLostFoundItems: jest.fn(),
  getLostFoundItem: jest.fn(),
  createLostFoundItem: jest.fn(),
  updateLostFoundItem: jest.fn(),
  resolveLostFoundItem: jest.fn(),
};
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/theme', () => ({ useThemeMode: () => 'light' }));
jest.mock('../data/source', () => ({
  hasDataSource: () => true,
  getDataSource: () => mockSource,
  getDataSourceEvidence: () => ({
    mode: mockReal ? 'firebase' : 'mock',
    sourceLabel: mockReal ? 'real' : 'mock',
  }),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('../ui/navigationTheme', () => ({
  TAB_BAR_CONTENT_BOTTOM_PADDING: 80,
  useTabBarContentBottomPadding: () => 80,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
const navigation = { navigate: jest.fn(), goBack: jest.fn() };
const route = { params: { id: 'item-1' } };
function item(patch: Partial<LostFoundItem> = {}): LostFoundItem {
  return {
    id: 'item-1',
    schoolId: 'pu',
    reporterId: 'owner',
    type: 'lost',
    title: '圖書館的筆記本',
    description: '深綠色封面，內頁有課程筆記。',
    category: 'books',
    location: '圖書館',
    date: '2026-10-08T00:00:00Z',
    createdAt: '2026-10-08T01:00:00Z',
    status: 'open',
    contactInfo: 'contact@example.test',
    ...patch,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function alertAction(label: string) {
  const call = jest.mocked(Alert.alert).mock.calls.at(-1);
  const action = call?.[2]?.find((button) => button.text === label);
  expect(action?.onPress).toBeDefined();
  return action!.onPress!;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { uid: 'owner' };
  mockSchool = { id: 'pu' };
  mockReal = true;
  mockSource.listLostFoundItems.mockResolvedValue([item()]);
  mockSource.getLostFoundItem.mockResolvedValue(item());
  mockSource.createLostFoundItem.mockImplementation(async (data) => item(data));
  mockSource.updateLostFoundItem.mockImplementation(async (id, data) => item({ ...data, id }));
  mockSource.resolveLostFoundItem.mockResolvedValue(undefined);
  jest.mocked(Clipboard.setStringAsync).mockResolvedValue(true);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('lists real school records, filters text and type, and navigates using the actual ID', async () => {
  mockSource.listLostFoundItems.mockResolvedValue([
    item(),
    item({ id: 'found-2', type: 'found', title: '水壺', location: '體育館' }),
  ]);
  const view = render(<LostFoundScreen navigation={navigation} />);
  await view.findByText('圖書館的筆記本');
  expect(mockSource.listLostFoundItems).toHaveBeenCalledWith('pu', { limit: 100 });
  expect(view.queryByText(/AI|歸還率|信譽|智慧/)).toBeNull();
  fireEvent.changeText(view.getByLabelText('搜尋物品'), '體育館');
  expect(view.queryByText('圖書館的筆記本')).toBeNull();
  fireEvent.press(view.getByLabelText('查看水壺'));
  expect(navigation.navigate).toHaveBeenCalledWith('LostFoundDetail', { id: 'found-2' });
  fireEvent.press(view.getByText('我遺失了'));
  expect(navigation.navigate).toHaveBeenCalledWith('LostFoundPost', { type: 'lost' });
});

test('list errors expose retry, while an empty successful list stays empty', async () => {
  mockSource.listLostFoundItems
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce([]);
  const view = render(<LostFoundScreen />);
  await view.findByText('暫時無法讀取');
  expect(view.queryByText('目前沒有本校刊登資訊')).toBeNull();
  fireEvent.press(view.getByText('重新讀取'));
  await view.findByText('目前沒有本校刊登資訊');
});

test('list school and account changes hide old records and ignore late responses', async () => {
  const old = deferred<LostFoundItem[]>();
  const next = deferred<LostFoundItem[]>();
  mockSource.listLostFoundItems.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const view = render(<LostFoundScreen />);
  mockSchool = { id: 'other' };
  mockUser = { uid: 'other-owner' };
  view.rerender(<LostFoundScreen />);
  await act(async () => old.resolve([item()]));
  expect(view.queryByText('圖書館的筆記本')).toBeNull();
  await act(async () => next.resolve([item({ schoolId: 'other', title: '新學校物品' })]));
  expect(view.getByText('新學校物品')).toBeTruthy();
});

test('mock mode is unavailable instead of showing sample listings or accepting posts', async () => {
  mockReal = false;
  const view = render(<LostFoundScreen />);
  await view.findByText('暫時無法讀取');
  expect(mockSource.listLostFoundItems).not.toHaveBeenCalled();
});

test.each([null, 'failure'])(
  'detail does not fabricate a record when source is %s',
  async (value) => {
    if (value === 'failure')
      mockSource.getLostFoundItem.mockRejectedValueOnce(new Error('offline'));
    else mockSource.getLostFoundItem.mockResolvedValueOnce(null);
    const view = render(<LostFoundDetailScreen route={route} />);
    await view.findByText(value === 'failure' ? '暫時無法讀取物品' : '找不到物品');
    expect(view.queryByText(/王小明|AirPods|xiaoming/)).toBeNull();
  },
);

test('detail rejects a different school and cannot contact or edit it', async () => {
  mockSource.getLostFoundItem.mockResolvedValueOnce(item({ schoolId: 'other' }));
  const view = render(<LostFoundDetailScreen route={route} />);
  await view.findByText('暫時無法讀取物品');
  expect(view.queryByText('聯絡發布者')).toBeNull();
});

test('copy success follows the real clipboard result; failed copies never claim success', async () => {
  const copy = deferred<boolean>();
  jest.mocked(Clipboard.setStringAsync).mockReturnValueOnce(copy.promise);
  const view = render(<LostFoundDetailScreen route={route} />);
  await view.findByText('圖書館的筆記本');
  fireEvent.press(view.getByText('聯絡發布者'));
  const action = alertAction('複製');
  act(() => action());
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('contact@example.test');
  expect(Alert.alert).not.toHaveBeenCalledWith('已複製', expect.any(String));
  await act(async () => copy.resolve(false));
  expect(Alert.alert).toHaveBeenLastCalledWith('無法複製', expect.any(String));
  fireEvent.press(view.getByText('聯絡發布者'));
  await act(async () => alertAction('複製')());
  expect(Alert.alert).toHaveBeenLastCalledWith('已複製', expect.any(String));
});

test('an old contact dialog cannot copy after switching accounts', async () => {
  const view = render(<LostFoundDetailScreen route={route} />);
  await view.findByText('圖書館的筆記本');
  fireEvent.press(view.getByText('聯絡發布者'));
  const oldAction = alertAction('複製');
  mockUser = { uid: 'new-account' };
  view.rerender(<LostFoundDetailScreen route={route} />);
  await act(async () => oldAction());
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
});

test('a failed owner resolve never shows a completed state or success', async () => {
  mockSource.resolveLostFoundItem.mockRejectedValueOnce(new Error('permission-denied'));
  const view = render(<LostFoundDetailScreen route={route} />);
  await view.findByText('圖書館的筆記本');
  fireEvent.press(view.getByText('標記為已結案'));
  await act(async () => alertAction('確認結案')());
  expect(view.getByText('尋找中')).toBeTruthy();
  expect(view.queryByText('已結案')).toBeNull();
  expect(Alert.alert).toHaveBeenLastCalledWith('無法確認結案', expect.any(String));
});

test('owner resolve requires a confirmed persisted result and blocks duplicate taps', async () => {
  const write = deferred<void>();
  mockSource.resolveLostFoundItem.mockReturnValueOnce(write.promise);
  const view = render(<LostFoundDetailScreen route={route} />);
  await view.findByText('圖書館的筆記本');
  fireEvent.press(view.getByText('標記為已結案'));
  const confirm = alertAction('確認結案');
  act(() => {
    void confirm();
    void confirm();
  });
  expect(mockSource.resolveLostFoundItem).toHaveBeenCalledTimes(1);
  mockSource.getLostFoundItem.mockResolvedValue(item({ status: 'resolved' }));
  await act(async () => write.resolve());
  expect(view.getByText('已結案')).toBeTruthy();
  expect(Alert.alert).toHaveBeenLastCalledWith('已結案', expect.any(String));
});

test('nonowners contact the publisher instead of fabricating a claim or delete', async () => {
  mockUser = { uid: 'reader' };
  const view = render(<LostFoundDetailScreen route={route} />);
  await view.findByText('圖書館的筆記本');
  expect(view.queryByText(/認領成功|標記為已結案|編輯資訊|刪除/)).toBeNull();
  expect(view.getByText('聯絡發布者')).toBeTruthy();
});

async function fillPost(view: ReturnType<typeof render>) {
  await view.findByText('發布失物招領');
  fireEvent.changeText(view.getByLabelText('物品名稱'), '真的新刊登');
  fireEvent.changeText(view.getByLabelText('物品描述'), '這是有十個字以上的真實物品描述。');
  fireEvent.changeText(view.getByLabelText('遺失或拾獲地點'), '圖書館');
}
test('publishing waits for source persistence and returns the real record to the list/detail flow', async () => {
  const write = deferred<LostFoundItem>();
  mockSource.createLostFoundItem.mockReturnValueOnce(write.promise);
  const view = render(<LostFoundPostScreen navigation={navigation} />);
  await fillPost(view);
  fireEvent.press(view.getByRole('button', { name: '發布刊登' }));
  fireEvent.press(view.getByRole('button', { name: '發布刊登' }));
  expect(mockSource.createLostFoundItem).toHaveBeenCalledTimes(1);
  expect(Alert.alert).not.toHaveBeenCalled();
  const posted = item({ id: 'server-id-123', title: '真的新刊登' });
  await act(async () => write.resolve(posted));
  expect(Alert.alert).toHaveBeenLastCalledWith('已發布刊登', expect.any(String), expect.any(Array));
  act(() => alertAction('返回列表')());
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  view.unmount();
  mockSource.listLostFoundItems.mockResolvedValueOnce([posted]);
  const list = render(<LostFoundScreen navigation={navigation} />);
  await list.findByText('真的新刊登');
  fireEvent.press(list.getByLabelText('查看真的新刊登'));
  expect(navigation.navigate).toHaveBeenLastCalledWith('LostFoundDetail', { id: 'server-id-123' });
  list.unmount();
  mockSource.getLostFoundItem.mockResolvedValueOnce(posted);
  const detail = render(<LostFoundDetailScreen route={{ params: { id: 'server-id-123' } }} />);
  await detail.findByText('真的新刊登');
});

test('posting failure retains the draft and never reports success', async () => {
  mockSource.createLostFoundItem.mockRejectedValueOnce(new Error('permission-denied'));
  const view = render(<LostFoundPostScreen />);
  await fillPost(view);
  await act(async () => fireEvent.press(view.getByText('發布刊登')));
  expect(Alert.alert).toHaveBeenLastCalledWith('無法確認刊登結果', expect.any(String));
  expect(view.getByLabelText('物品名稱').props.value).toBe('真的新刊登');
  expect(navigation.goBack).not.toHaveBeenCalled();
});

test('unavailable source cannot pretend to publish and invalid dates never reach the source', async () => {
  const view = render(<LostFoundPostScreen />);
  await fillPost(view);
  fireEvent.changeText(view.getByLabelText('日期（YYYY-MM-DD）'), '2026-02-30');
  await act(async () => fireEvent.press(view.getByText('發布刊登')));
  expect(mockSource.createLostFoundItem).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByLabelText('日期（YYYY-MM-DD）'), '2026-02-28');
  mockReal = false;
  await act(async () => fireEvent.press(view.getByText('發布刊登')));
  expect(mockSource.createLostFoundItem).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('無法確認刊登結果', expect.any(String));
});

test('the owner editor loads saved values and updates the same ID in the same school', async () => {
  const view = render(<LostFoundPostScreen route={route} />);
  await view.findByText('編輯失物招領');
  expect(view.getByLabelText('物品名稱').props.value).toBe('圖書館的筆記本');
  fireEvent.changeText(view.getByLabelText('物品名稱'), '補上特徵的筆記本');
  await act(async () => fireEvent.press(view.getByText('儲存變更')));
  expect(mockSource.updateLostFoundItem).toHaveBeenCalledWith(
    'item-1',
    expect.objectContaining({ reporterId: 'owner', schoolId: 'pu', title: '補上特徵的筆記本' }),
    'pu',
  );
});

test('editing another publisher is blocked before showing an editable draft', async () => {
  mockSource.getLostFoundItem.mockResolvedValueOnce(item({ reporterId: 'someone-else' }));
  const view = render(<LostFoundPostScreen route={route} />);
  await view.findByText('無法讀取刊登資料');
  expect(view.queryByLabelText('物品名稱')).toBeNull();
});

test('switching schools clears the draft and suppresses the old publication response', async () => {
  const write = deferred<LostFoundItem>();
  mockSource.createLostFoundItem.mockReturnValueOnce(write.promise);
  const view = render(<LostFoundPostScreen navigation={navigation} />);
  await fillPost(view);
  fireEvent.press(view.getByText('發布刊登'));
  mockSchool = { id: 'new-school' };
  view.rerender(<LostFoundPostScreen navigation={navigation} />);
  await view.findByText('發布失物招領');
  expect(view.getByLabelText('物品名稱').props.value).toBe('');
  await act(async () => write.resolve(item({ title: '真的新刊登' })));
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(navigation.goBack).not.toHaveBeenCalled();
});

test('a persisted write with an unavailable readback cannot be blindly submitted again', async () => {
  mockSource.createLostFoundItem.mockRejectedValueOnce({ code: 'lost-found-write-unconfirmed' });
  const view = render(<LostFoundPostScreen navigation={navigation} />);
  await fillPost(view);
  await act(async () => fireEvent.press(view.getByText('發布刊登')));
  expect(view.getByRole('button', { name: '請先回列表確認' })).toBeDisabled();
  fireEvent.press(view.getByText('請先回列表確認'));
  expect(mockSource.createLostFoundItem).toHaveBeenCalledTimes(1);
  expect(view.getByText('返回列表')).toBeTruthy();
  expect(Alert.alert).not.toHaveBeenCalledWith('已發布刊登', expect.anything(), expect.anything());
});
