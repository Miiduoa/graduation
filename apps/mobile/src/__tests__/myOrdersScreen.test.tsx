import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CampusHubScreen } from '../screens/CampusHubScreen';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.unmock('@react-navigation/native');
jest.mock('../components/HeaderAvatarButton', () => ({ HeaderAvatarButton: () => null }));
jest.mock('../components/SchoolBrowsingControl', () => ({ SchoolBrowsingControl: () => null }));
jest.mock('../components/OpenOrderCard', () => ({ OpenOrderCard: () => null }));
jest.mock('../ui/AppActionIcon', () => ({ AppActionIcon: () => null }));
jest.mock('../services/release', () => ({ isFeatureEnabled: () => false }));

let mockUser: { uid: string } | null = { uid: 'alice' };
let mockProfileUserId = 'alice';
let mockProfileLoading = false;
let mockSchool = 'pu';
jest.mock('../state/auth', () => ({
  useAuth: () => ({
    user: mockUser,
    profile: { uid: mockProfileUserId, schoolId: 'pu' },
    profileLoading: mockProfileLoading,
  }),
}));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchool }, selectionReady: true }) }));
jest.mock('../services/schoolLoginAvailability', () => ({ isStudentIdLoginAvailable: (id: string) => id === 'pu' }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

// 伺服器上的學生訂單副本（模擬 Firestore）；App 重開後重新訂閱，一樣從這裡讀
let mockServerRows: Array<{ id: string; data: Record<string, unknown> }> = [];
const mockListeners: Array<() => void> = [];
const mockQueryPaths: string[] = [];
let mockFailNext = false;
let mockDeferDocument = false;
let mockDocument: Record<string, unknown> | null = null;
let mockDocumentFromCache = false;
let mockDocumentFailed = false;
const mockDocumentListeners: Array<() => void> = [];
let mockFromCache = false;
const mockUnsubscribe = jest.fn();
jest.mock('../firebase', () => ({
  getDb: () => ({}),
  getFunctionsInstance: () => ({}),
  getAuthInstance: () => ({ currentUser: { uid: 'alice' } }),
  isFirebaseMockMode: () => false,
}));
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/'), orderId: path.at(-1) }),
  getDocFromServer: jest.fn(),
  getDocsFromServer: jest.fn(),
  query: (ref: { path: string }) => ref,
  orderBy: jest.fn(),
  limit: jest.fn(),
  onSnapshot: (
    ref: { path: string; orderId?: string },
    options: { includeMetadataChanges: boolean },
    next: (snapshot: unknown) => void,
    error: (reason: Error) => void,
  ) => {
    expect(options).toEqual({ includeMetadataChanges: true });
    mockQueryPaths.push(ref.path);
    if (ref.orderId) {
      const emit = () => {
        if (mockDocumentFailed) error(new Error('permission-denied'));
        else next({
          id: ref.orderId,
          exists: () => mockDocument !== null,
          data: () => mockDocument,
          metadata: { fromCache: mockDocumentFromCache },
        });
      };
      mockDocumentListeners.push(emit);
      if (!mockDeferDocument) emit();
      return mockUnsubscribe;
    }
    const emit = () =>
      next({
        docs: mockServerRows.map((row) => ({ id: row.id, data: () => row.data })),
        metadata: { fromCache: mockFromCache },
      });
    mockListeners.push(emit);
    if (mockFailNext) {
      mockFailNext = false;
      error(new Error('offline'));
    } else {
      emit();
    }
    return mockUnsubscribe;
  },
}));

import MyOrdersScreen from '../screens/MyOrdersScreen';

const placed = { toDate: () => new Date('2026-10-13T04:05:00.000Z') };
beforeEach(async () => {
  mockUser = { uid: 'alice' };
  mockProfileUserId = 'alice';
  mockFromCache = false;
  mockProfileLoading = false;
  mockSchool = 'pu';
  mockFailNext = false;
  mockDocument = null;
  mockDeferDocument = false;
  mockDocumentFromCache = false;
  mockDocumentFailed = false;
  mockDocumentListeners.length = 0;
  mockUnsubscribe.mockClear();
  mockListeners.length = 0;
  mockQueryPaths.length = 0;
  await AsyncStorage.clear();
  mockServerRows = [
    {
      id: 'co_numbered_aaa111',
      data: { status: 'confirmed', queueNumber: 7, cafeteria: '校園餐廳', total: 100, createdAt: placed, items: [{ name: '雞腿飯', quantity: 1 }] },
    },
    {
      id: 'co_waiting_bbb222',
      data: { status: 'pending', queueNumber: null, cafeteria: '校園餐廳', total: 60, createdAt: placed, items: [{ name: '紅茶', quantity: 2 }] },
    },
    {
      id: 'co_cancel_ccc333',
      data: { status: 'cancelled', queueNumber: null, cancelledQueueNumber: 5, cancelledBy: 'merchant', cafeteria: '校園餐廳', total: 80, createdAt: placed, items: [] },
    },
  ];
});

test('我的訂單：讀伺服器上學生自己的訂單，有號碼寫號碼，沒號碼寫待給號碼兩行，店家取消寫「這張單店家取消了」', async () => {
  const view = render(<MyOrdersScreen />);
  await act(async () => {});
  expect(mockQueryPaths).toEqual(['users/alice/schools/pu/orders']);
  expect(view.getByText('取餐號碼 7')).toBeTruthy();
  expect(view.getByText('號碼還沒拿到，請到櫃台確認。')).toBeTruthy();
  expect(view.getByText('10 月 13 日（二）12:05・紅茶 ×2')).toBeTruthy();
  expect(view.getByText('狀態：待給號碼')).toBeTruthy();
  expect(view.getByText('這張單店家取消了')).toBeTruthy();
  expect(view.queryByText('取餐號碼 5')).toBeNull();
  expect(view.getByText('訂單末 6 碼 AAA111')).toBeTruthy();
  expect(view.queryByText(/待確認/)).toBeNull();
});

test('App 關掉重開：號碼一樣從伺服器讀回來，不靠手機本機存的訂單', async () => {
  const first = render(<MyOrdersScreen />);
  await act(async () => {});
  expect(first.getByText('取餐號碼 7')).toBeTruthy();
  first.unmount();
  await AsyncStorage.clear(); // 本機什麼都沒有
  const reopened = render(<MyOrdersScreen />);
  await act(async () => {});
  expect(reopened.getByText('取餐號碼 7')).toBeTruthy();
  expect(mockQueryPaths).toEqual(['users/alice/schools/pu/orders', 'users/alice/schools/pu/orders']);
});

test('店家之後給號碼或取消，畫面跟著更新', async () => {
  const view = render(<MyOrdersScreen />);
  await act(async () => {});
  mockServerRows = mockServerRows.map((row) =>
    row.id === 'co_waiting_bbb222'
      ? { ...row, data: { ...row.data, status: 'confirmed', queueNumber: 8 } }
      : row.id === 'co_numbered_aaa111'
        ? { ...row, data: { ...row.data, status: 'cancelled', queueNumber: null, cancelledBy: 'merchant' } }
        : row,
  );
  await act(async () => mockListeners.forEach((emit) => emit()));
  expect(view.getByText('取餐號碼 8')).toBeTruthy();
  expect(view.queryByText('取餐號碼 7')).toBeNull();
  expect(view.getAllByText('這張單店家取消了')).toHaveLength(2);
});

test('沒有訂單：寫還沒有訂單', async () => {
  mockServerRows = [];
  const view = render(<MyOrdersScreen />);
  await act(async () => {});
  expect(view.getByText('還沒有訂單')).toBeTruthy();
});

test('帶 orderId 時標示該筆訂單', async () => {
  const view = render(<MyOrdersScreen route={{ params: { orderId: 'co_waiting_bbb222' } }} />);
  await act(async () => {});
  expect(view.getByText('通知訂單')).toBeTruthy();
  expect(view.getByText('號碼還沒拿到，請到櫃台確認。')).toBeTruthy();
  const firstCode = () => view.getAllByText(/^訂單末 6 碼/)[0].props.children;
  expect(firstCode()).toBe('訂單末 6 碼 BBB222');
  act(() => mockListeners[0]());
  expect(firstCode()).toBe('訂單末 6 碼 BBB222');
});

test('orderId 無效時給友善提示且不壞頁', async () => {
  const view = render(<MyOrdersScreen route={{ params: { orderId: 'co_missing_zzz' } }} />);
  await act(async () => {});
  expect(view.getByText(/找不到這筆訂單/)).toBeTruthy();
  expect(view.getByText('取餐號碼 7')).toBeTruthy();
});

test('訂閱失敗可以原地重試，舊連線的晚到回呼不會覆蓋結果', () => {
  mockFailNext = true;
  const view = render(<MyOrdersScreen />);
  fireEvent.press(view.getByRole('button', { name: '重新讀取訂單' }));
  expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  expect(mockQueryPaths).toEqual(Array(2).fill('users/alice/schools/pu/orders'));
  expect(view.getByText('取餐號碼 7')).toBeTruthy();
  mockServerRows = [];
  act(() => mockListeners[0]());
  expect(view.getByText('取餐號碼 7')).toBeTruthy();
});

test('換帳號取得新身分前停止查詢，忽略前一個帳號的結果', () => {
  const view = render(<MyOrdersScreen />);
  expect(view.getByText('取餐號碼 7')).toBeTruthy();
  mockUser = { uid: 'bob' };
  mockProfileLoading = true;
  view.rerender(<MyOrdersScreen />);
  expect(view.queryByText('取餐號碼 7')).toBeNull();
  expect(mockQueryPaths).toHaveLength(1);
  mockProfileLoading = false;
  view.rerender(<MyOrdersScreen />);
  expect(mockQueryPaths).toHaveLength(1);
  mockProfileUserId = 'bob';
  const aliceRows = mockServerRows;
  mockServerRows = [];
  view.rerender(<MyOrdersScreen />);
  expect(mockQueryPaths.at(-1)).toBe('users/bob/schools/pu/orders');
  mockServerRows = aliceRows;
  act(() => mockListeners[0]());
  expect(view.getByText('還沒有訂單')).toBeTruthy();
  expect(view.queryByText('取餐號碼 7')).toBeNull();
});

test('其他學校的訂單通知不查詢目前校園的同名訂單', () => {
  const view = render(<MyOrdersScreen route={{ params: { orderId: 'co_numbered_aaa111', schoolId: 'nthu' } }} />);
  expect(mockQueryPaths).toEqual([]);
  expect(view.getByText(/這筆訂單屬於其他學校/)).toBeTruthy();
  expect(view.queryByText('取餐號碼 7')).toBeNull();
});

test('快取沒有訂單時不顯示空白紀錄，等伺服器回覆再確認', () => {
  mockServerRows = [];
  mockFromCache = true;
  mockDocumentFromCache = true;
  const view = render(<MyOrdersScreen route={{ params: { orderId: 'co_missing' } }} />);
  expect(view.getByText('等待訂單同步')).toBeTruthy();
  expect(view.queryByText('還沒有訂單')).toBeNull();
  expect(view.queryByText(/找不到這筆訂單/)).toBeNull();
  mockFromCache = false;
  act(() => mockListeners[0]());
  expect(view.queryByText(/找不到這筆訂單/)).toBeNull();
  mockDocumentFromCache = false;
  act(() => mockDocumentListeners[0]());
  expect(view.getByText(/找不到這筆訂單/)).toBeTruthy();
});

test('區分上次同步的訂單與店家最新狀態', () => {
  mockFromCache = true;
  const view = render(<MyOrdersScreen />);
  expect(view.getByText('上次同步的訂單')).toBeTruthy();
  expect(view.getByText('取餐號碼 7')).toBeTruthy();
  mockFromCache = false;
  act(() => mockListeners[0]());
  expect(view.queryByText('上次同步的訂單')).toBeNull();
  expect(view.getByText('取餐號碼 7')).toBeTruthy();
});

test('從生活搜尋取餐號碼，查看訂單後返回原搜尋結果', async () => {
  const Stack = createNativeStackNavigator<{ CampusHome: undefined; StudentOrders: undefined }>();
  const view = render(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ animation: 'none', headerShown: false }}>
        <Stack.Screen name="CampusHome" component={CampusHubScreen} />
        <Stack.Screen name="StudentOrders" component={MyOrdersScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  fireEvent.changeText(view.getByLabelText('搜尋校園服務'), '取餐號碼');
  fireEvent.press(view.getByText('我的訂單'));
  expect(await view.findByText('取餐號碼 7')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '返回' }));
  expect(await view.findByDisplayValue('取餐號碼')).toBeTruthy();
  expect(view.getByText('我的訂單')).toBeTruthy();
});

test('未登入或瀏覽其他學校時不訂閱私人訂單', () => {
  mockUser = null;
  const view = render(<MyOrdersScreen />);
  expect(view.getByText('登入後查看訂單')).toBeTruthy();
  expect(mockQueryPaths).toEqual([]);
  mockUser = { uid: 'alice' };
  mockSchool = 'nthu';
  view.rerender(<MyOrdersScreen />);
  expect(mockQueryPaths).toEqual([]);
});

test('通知不在近期清單時，個別訂閱本人訂單並保留可用的清單', () => {
  mockDeferDocument = true;
  const view = render(<MyOrdersScreen route={{ params: { orderId: 'co_older_xyz789' } }} />);
  expect(mockQueryPaths).toEqual([
    'users/alice/schools/pu/orders', 'users/alice/schools/pu/orders/co_older_xyz789',
  ]);
  expect(view.queryByText(/找不到這筆訂單/)).toBeNull();
  expect(view.getByText('取餐號碼 7')).toBeTruthy();
  mockDocumentFailed = true;
  act(() => mockDocumentListeners[0]());
  expect(view.getByText('取餐號碼 7')).toBeTruthy();
  mockDocumentFailed = false;
  mockDocument = { ...mockServerRows[0].data, queueNumber: 24 };
  mockDeferDocument = false;
  mockDocumentFromCache = true;
  fireEvent.press(view.getByRole('button', { name: '重試這筆訂單' }));
  expect(mockQueryPaths.filter((path) => path.endsWith('/orders'))).toHaveLength(1);
  expect(view.getByText('通知訂單・上次同步')).toBeTruthy();
  expect(view.getByText('取餐號碼 24')).toBeTruthy();
  mockDocumentFromCache = false;
  mockDocument = { ...mockDocument, queueNumber: 25 };
  act(() => mockDocumentListeners[1]());
  expect(view.getByText('取餐號碼 25')).toBeTruthy();

  mockServerRows.push({ id: 'co_older_xyz789', data: mockDocument });
  act(() => mockListeners[0]());
  expect(view.getAllByText('取餐號碼 25')).toHaveLength(1);
  mockDocument = null;
  act(() => mockDocumentListeners[1]());
  expect(view.getByText('取餐號碼 25')).toBeTruthy();
  expect(view.queryByText(/找不到這筆訂單/)).toBeNull();
});

test('換通知後慢回來的前一筆訂單不覆蓋新通知', () => {
  mockDeferDocument = true;
  const view = render(<MyOrdersScreen route={{ params: { orderId: 'co_archived_one' } }} />);
  view.rerender(<MyOrdersScreen route={{ params: { orderId: 'co_archived_two' } }} />);
  mockDocument = { ...mockServerRows[0].data, queueNumber: 32 };
  act(() => mockDocumentListeners[1]());
  mockDocument = { ...mockServerRows[0].data, queueNumber: 29 };
  act(() => mockDocumentListeners[0]());
  expect(view.getByText('取餐號碼 32')).toBeTruthy();
  expect(view.queryByText('取餐號碼 29')).toBeNull();
});
