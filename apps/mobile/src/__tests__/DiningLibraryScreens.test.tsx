import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import CafeteriaAiFirstScreen from '../screens/CafeteriaAiFirstScreen';
import MenuDetailAiFirstScreen from '../screens/MenuDetailAiFirstScreen';
import LibraryAiFirstScreen from '../screens/LibraryAiFirstScreen';
import {
  loadDiningCatalog,
  loadDiningIntent,
  prepareDiningIntent,
  submitDiningIntent,
  watchDiningReceipt,
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
  watchDiningReceipt: jest.fn(() => null),
  ORDER_NOT_SENT_TEXT: '訂單沒送出去，請再試一次。',
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
  expect(view.getByText('等店家接單')).toBeTruthy();
  expect(view.queryByText('已付款')).toBeNull();
});
test('沒拿到號碼：寫「號碼還沒拿到，請到櫃台確認。」和下單時間、品項，店家給號碼後換成真的號碼', async () => {
  let push: ((patch: { queueNumber: number | null; status?: string }) => void) | undefined;
  const stop = jest.fn();
  jest.mocked(watchDiningReceipt).mockImplementation((_scope, onChange) => {
    push = onChange;
    return stop;
  });
  jest.mocked(submitDiningIntent).mockResolvedValueOnce({
    id: intent.orderId,
    label: menu.name,
    total: 84,
    status: 'pending',
    queueNumber: null,
    createdAt: '2026-10-13T04:05:00.000Z',
    items: [{ name: '雞腿飯', quantity: 1 }],
  });
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  fireEvent.press(view.getByText('選擇今日餐點'));
  await act(async () => fireEvent.press(view.getByText('送出訂單，到店付款')));
  expect(view.getByText('號碼還沒拿到，請到櫃台確認。')).toBeTruthy();
  expect(view.getByText('10 月 13 日（二）12:05・雞腿飯 ×1')).toBeTruthy();
  expect(view.getByText('狀態：待給號碼')).toBeTruthy();
  expect(view.queryByText(/取餐號碼 \d/)).toBeNull();
  expect(watchDiningReceipt).toHaveBeenCalledWith(
    expect.objectContaining({ userId: 'student-a', schoolId: 'pu', orderId: intent.orderId }),
    expect.any(Function),
  );
  await act(async () => push!({ queueNumber: 12, status: 'confirmed' }));
  expect(view.getByText('取餐號碼 12')).toBeTruthy();
  expect(view.queryByText('號碼還沒拿到，請到櫃台確認。')).toBeNull();
  expect(view.getByText('店家已接單')).toBeTruthy();
  // 拿到號碼後還繼續盯著，直到取餐完或取消
  expect(view.getByText(/訂單末 6 碼/)).toBeTruthy();
});
test('給了號碼之後店家取消：寫「這張單店家取消了」，號碼拿掉，不再監聽', async () => {
  let push: ((patch: Record<string, unknown>) => void) | undefined;
  const stop = jest.fn();
  jest.mocked(watchDiningReceipt).mockImplementation((_scope, onChange) => {
    push = onChange as never;
    return stop;
  });
  jest.mocked(submitDiningIntent).mockResolvedValueOnce({
    id: intent.orderId,
    label: menu.name,
    total: 84,
    status: 'pending',
    queueNumber: null,
    createdAt: '2026-10-13T04:05:00.000Z',
    items: [{ name: '雞腿飯', quantity: 1 }],
  });
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  fireEvent.press(view.getByText('選擇今日餐點'));
  await act(async () => fireEvent.press(view.getByText('送出訂單，到店付款')));
  await act(async () => push!({ queueNumber: 7, status: 'confirmed' }));
  expect(view.getByText('取餐號碼 7')).toBeTruthy();
  expect(stop).not.toHaveBeenCalled();
  await act(async () =>
    push!({ queueNumber: null, status: 'cancelled', cancelledBy: 'merchant' }),
  );
  expect(view.getByText('這張單店家取消了')).toBeTruthy();
  expect(view.getByText('訂單已取消')).toBeTruthy();
  expect(view.queryByText(/取餐號碼/)).toBeNull();
  expect(view.queryByText(/號碼還沒拿到/)).toBeNull();
  expect(stop).toHaveBeenCalled();
});
test('伺服器建單時已發號：直接顯示取餐號碼，照樣盯著訂單（店家取消時要拿掉號碼）', async () => {
  jest.mocked(submitDiningIntent).mockResolvedValueOnce({
    id: intent.orderId,
    label: menu.name,
    total: 84,
    status: 'pending',
    queueNumber: 3,
    createdAt: '2026-10-13T04:05:00.000Z',
    items: [{ name: '雞腿飯', quantity: 1 }],
  });
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  fireEvent.press(view.getByText('選擇今日餐點'));
  await act(async () => fireEvent.press(view.getByText('送出訂單，到店付款')));
  expect(view.getByText('取餐號碼 3')).toBeTruthy();
  expect(view.queryByText('號碼還沒拿到，請到櫃台確認。')).toBeNull();
  expect(watchDiningReceipt).toHaveBeenCalledTimes(1);
});
test('legacy menu links load the current catalog without static recommendations or reviews', async () => {
  const view = render(<MenuDetailAiFirstScreen />);
  await act(async () => {});
  expect(loadDiningCatalog).toHaveBeenCalledWith(
    { userId: 'student-a', schoolId: 'pu' },
    expect.any(Function),
  );
  expect(view.getByText('今日餐點')).toBeTruthy();
  expect(view.queryByText(/350 評論|AI 為你推薦|你週三常點|650 kcal|紅燒牛肉麵/)).toBeNull();
});
test('double tapping confirmation sends only one request', async () => {
  const pending = deferred<DiningReceipt>();
  jest.mocked(submitDiningIntent).mockReturnValueOnce(pending.promise);
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  fireEvent.press(view.getByText('選擇今日餐點'));
  fireEvent.press(view.getByText('送出訂單，到店付款'));
  await act(async () => {});
  fireEvent.press(view.getAllByText('送出中')[0]);
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
  await act(async () => fireEvent.press(view.getByText('再試一次')));
  expect(prepareDiningIntent).not.toHaveBeenCalled();
  expect(submitDiningIntent).toHaveBeenCalledWith(intent, expect.any(Function));
});
test('伺服器沒建成：寫「訂單沒送出去，請再試一次。」，不在手機上自己成立訂單，再試一次沿用同一個訂單編號', async () => {
  jest
    .mocked(submitDiningIntent)
    .mockRejectedValueOnce(new DiningError('訂單沒送出去，請再試一次。', 'unknown'))
    .mockResolvedValueOnce({
      id: intent.orderId,
      label: menu.name,
      total: 84,
      status: 'pending',
      queueNumber: 5,
    });
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  fireEvent.press(view.getByText('選擇今日餐點'));
  await act(async () => fireEvent.press(view.getByText('送出訂單，到店付款')));
  expect(view.getByText('訂單沒送出去')).toBeTruthy();
  expect(view.getAllByText('訂單沒送出去，請再試一次。')).toHaveLength(1);
  expect(view.queryByText(/請到櫃台確認/)).toBeNull();
  expect(view.queryByText(/取餐號碼/)).toBeNull();
  expect(view.queryByText('送出訂單，到店付款')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('再試一次')));
  expect(prepareDiningIntent).toHaveBeenCalledTimes(1);
  expect(submitDiningIntent).toHaveBeenCalledTimes(2);
  expect(jest.mocked(submitDiningIntent).mock.calls[1][0]).toBe(
    jest.mocked(submitDiningIntent).mock.calls[0][0],
  );
  expect(jest.mocked(submitDiningIntent).mock.calls[1][0].orderId).toBe(intent.orderId);
  expect(view.getByText('取餐號碼 5')).toBeTruthy();
  expect(view.queryByText('訂單沒送出去')).toBeNull();
});
test('a server availability rejection clears the stale quote and requires a menu refresh', async () => {
  jest.mocked(submitDiningIntent).mockRejectedValueOnce(new DiningError('餐點已變更', 'not-sent'));
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  fireEvent.press(view.getByText('選擇今日餐點'));
  await act(async () => fireEvent.press(view.getByText('送出訂單，到店付款')));
  expect(view.getByText('餐點已變更')).toBeTruthy();
  expect(view.queryByText('選擇今日餐點')).toBeNull();
  expect(view.queryByText('等店家接單')).toBeNull();
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
    expect(view.queryByText('等店家接單')).toBeNull();
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
