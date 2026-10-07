import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import CafeteriaAiFirstScreen from '../screens/CafeteriaAiFirstScreen';
import LibraryAiFirstScreen from '../screens/LibraryAiFirstScreen';
import {
  loadDiningCatalog,
  loadDiningIntent,
  prepareDiningIntent,
  submitDiningIntent,
  DiningError,
} from '../features/dining';
import type { DiningReceipt } from '../features/dining';

let mockUser: { uid: string } | null = { uid: 'student-a' };
let mockSchool = { id: 'pu' };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../features/dining', () => ({
  loadDiningCatalog: jest.fn(),
  loadDiningIntent: jest.fn(),
  prepareDiningIntent: jest.fn(),
  submitDiningIntent: jest.fn(),
  diningTotal: (price: number) => ({
    subtotal: price,
    tax: Math.round(price * 0.05),
    total: price + Math.round(price * 0.05),
  }),
  DiningError: class extends Error {
    constructor(
      message: string,
      public kind = 'unknown',
    ) {
      super(message);
    }
  },
}));
const intent = {
  userId: 'student-a',
  schoolId: 'pu',
  requestId: 'uuid-a',
  orderId: 'co_hash',
  cafeteriaId: 'venue-a',
  items: [{ menuItemId: 'meal-a', quantity: 1 }],
  expectedTotal: 84,
  label: '今日餐點',
};
const menu = {
  id: 'meal-a',
  cafeteriaId: 'venue-a',
  name: '今日餐點',
  description: '',
  price: 80,
  orderable: true,
};
const catalog = {
  venues: [{ id: 'venue-a', name: '校園餐廳甲', location: '一樓', orderingEnabled: true }],
  menus: [menu],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { uid: 'student-a' };
  mockSchool = { id: 'pu' };
  jest.mocked(loadDiningCatalog).mockResolvedValue(catalog);
  jest.mocked(loadDiningIntent).mockResolvedValue(null);
  jest.mocked(prepareDiningIntent).mockResolvedValue(intent);
  jest
    .mocked(submitDiningIntent)
    .mockResolvedValue({ id: intent.orderId, label: menu.name, total: 84, status: 'pending' });
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());
test('shows real menu prices, an explicit taxed quote, and only onsite ordering', async () => {
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  expect(view.queryByText(/平均花費|現營業 8 家|保證可訂|口試/)).toBeNull();
  fireEvent.press(view.getByText('選擇今日餐點'));
  expect(view.getByText('到店付款合計 NT$84')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('送出訂單，到店付款')));
  expect(view.getByText('等待店家確認')).toBeTruthy();
  expect(view.queryByText('已付款')).toBeNull();
});
test('double tapping confirmation sends only one request', async () => {
  const pending = deferred<DiningReceipt>();
  jest.mocked(submitDiningIntent).mockReturnValueOnce(pending.promise);
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  fireEvent.press(view.getByText('選擇今日餐點'));
  fireEvent.press(view.getByText('送出訂單，到店付款'));
  await act(async () => {});
  fireEvent.press(view.getByText('確認訂單中'));
  expect(prepareDiningIntent).toHaveBeenCalledTimes(1);
  expect(submitDiningIntent).toHaveBeenCalledTimes(1);
  await act(async () =>
    pending.resolve({ id: 'order-a', label: menu.name, total: 84, status: 'pending' }),
  );
});
test('an unresolved stored intent blocks new orders and retries the original request', async () => {
  jest.mocked(loadDiningIntent).mockResolvedValueOnce(intent);
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  fireEvent.press(view.getByText('選擇今日餐點'));
  expect(view.queryByText('送出訂單，到店付款')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('確認或重試這筆訂單')));
  expect(prepareDiningIntent).not.toHaveBeenCalled();
  expect(submitDiningIntent).toHaveBeenCalledWith(intent, expect.any(Function));
});
test('a server availability rejection clears the stale quote and requires a menu refresh', async () => {
  jest.mocked(submitDiningIntent).mockRejectedValueOnce(new DiningError('餐點已變更', 'not-sent'));
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  fireEvent.press(view.getByText('選擇今日餐點'));
  await act(async () => fireEvent.press(view.getByText('送出訂單，到店付款')));
  expect(view.getByText('餐點已變更')).toBeTruthy();
  expect(view.queryByText('選擇今日餐點')).toBeNull();
  expect(view.queryByText('等待店家確認')).toBeNull();
});
test.each(['account', 'school'] as const)(
  'changing %s isolates a pending order response',
  async (change) => {
    const pending = deferred<DiningReceipt>();
    jest.mocked(submitDiningIntent).mockReturnValueOnce(pending.promise);
    const view = render(<CafeteriaAiFirstScreen />);
    await act(async () => {});
    fireEvent.press(view.getByText('選擇今日餐點'));
    await act(async () => fireEvent.press(view.getByText('送出訂單，到店付款')));
    const guard = jest.mocked(submitDiningIntent).mock.calls[0][1];
    if (change === 'account') mockUser = { uid: 'student-b' };
    else mockSchool = { id: 'other' };
    await act(async () => view.rerender(<CafeteriaAiFirstScreen />));
    expect(guard()).toBe(false);
    await act(async () =>
      pending.resolve({ id: 'old-order', label: menu.name, total: 84, status: 'pending' }),
    );
    expect(view.queryByText('等待店家確認')).toBeNull();
  },
);
test('a failed menu read shows retry without fabricated restaurants', async () => {
  jest.mocked(loadDiningCatalog).mockRejectedValueOnce(new Error('offline'));
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  expect(view.queryByText('今日餐點')).toBeNull();
  expect(view.getByText('目前無法取得餐廳資料，請確認連線後重試。')).toBeTruthy();
});
test('library search opens the existing real catalog with the typed query', () => {
  const navigate = jest.fn();
  const view = render(<LibraryAiFirstScreen navigation={{ navigate }} />);
  expect(view.queryByText(/剩 23|63%|已續借|演算法導論|在架/)).toBeNull();
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), ' 分散式系統 ');
  fireEvent.press(view.getByText('查詢館藏'));
  expect(navigate).toHaveBeenCalledWith('LibraryCatalog', { initialQuery: '分散式系統' });
});
test('borrowing and renewal open the official personal account instead of local writes', async () => {
  const view = render(<LibraryAiFirstScreen />);
  await act(async () => fireEvent.press(view.getByText('開啟我的借閱紀錄')));
  expect(Linking.openURL).toHaveBeenCalledWith('https://webpacx.lib.pu.edu.tw/personal/');
  expect(view.queryByText('續借成功')).toBeNull();
});
test('library web search encodes the query, and another school cannot open PU service links', async () => {
  const view = render(<LibraryAiFirstScreen />);
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), 'A&B');
  await act(async () => fireEvent.press(view.getByText('在圖書館網站搜尋')));
  expect(Linking.openURL).toHaveBeenCalledWith(
    'https://webpacx.lib.pu.edu.tw/search?searchField=FullText&searchInput=A%26B',
  );
  mockSchool = { id: 'other' };
  view.rerender(<LibraryAiFirstScreen />);
  expect(view.queryByText('開啟我的借閱紀錄')).toBeNull();
});
test('library account switches clear the previous keyword', () => {
  const view = render(<LibraryAiFirstScreen />);
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), 'private query');
  mockUser = { uid: 'student-b' };
  view.rerender(<LibraryAiFirstScreen />);
  expect(view.getByLabelText('館藏關鍵字').props.value).toBe('');
});
