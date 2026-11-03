import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import CafeteriaAiFirstScreen from '../screens/CafeteriaAiFirstScreen';
import MenuDetailAiFirstScreen from '../screens/MenuDetailAiFirstScreen';
import LibraryAiFirstScreen from '../screens/LibraryAiFirstScreen';
import {
  loadDiningCatalog,
  loadPublicDiningCatalog,
  loadDiningIntent,
  prepareDiningIntent,
  submitDiningIntent,
  watchDiningReceipt,
  DiningError,
} from '../features/dining';
import type { DiningReceipt } from '../features/dining';
import { UNVERIFIED_CAFETERIA_BADGE } from '@campus/shared/src/cafeteriaCatalog';

let mockUser: { uid: string } | null = { uid: 'student-a' };
let mockSchool = { id: 'pu' };
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => {}) }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../features/dining', () => ({
  loadDiningCatalog: jest.fn(),
  loadPublicDiningCatalog: jest.fn(),
  loadDiningIntent: jest.fn(),
  prepareDiningIntent: jest.fn(),
  submitDiningIntent: jest.fn(),
  watchDiningReceipt: jest.fn(() => null),
  ORDER_NOT_SENT_TEXT: '訂單沒送出去，請再試一次。',
  ORDER_CHECKING_TEXT: '還在確認訂單有沒有送出，請到『我的訂單』看。',
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
  venues: [
    {
      id: 'venue-a',
      name: '校園餐廳甲',
      location: '一樓',
      orderingEnabled: true,
      reviewStatus: 'verified' as const,
    },
  ],
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
  jest.mocked(loadPublicDiningCatalog).mockResolvedValue(catalog);
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
  await act(async () => push!({ queueNumber: null, status: 'cancelled', cancelledBy: 'merchant' }));
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
test('沒送出去後連點「再試一次」：只再送一次，而且是同一個訂單編號', async () => {
  const retry = deferred<DiningReceipt>();
  jest
    .mocked(submitDiningIntent)
    .mockRejectedValueOnce(new DiningError('訂單沒送出去，請再試一次。', 'unknown'))
    .mockReturnValueOnce(retry.promise);
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  fireEvent.press(view.getByText('選擇今日餐點'));
  await act(async () => fireEvent.press(view.getByText('送出訂單，到店付款')));
  const button = view.getByText('再試一次');
  fireEvent.press(button);
  fireEvent.press(button);
  fireEvent.press(button);
  fireEvent.press(view.getAllByText('送出中')[0]);
  await act(async () => {});
  expect(submitDiningIntent).toHaveBeenCalledTimes(2);
  const ids = jest.mocked(submitDiningIntent).mock.calls.map(([sent]) => sent.orderId);
  expect(new Set(ids)).toEqual(new Set([intent.orderId]));
  await act(async () =>
    retry.resolve({
      id: intent.orderId,
      label: menu.name,
      total: 84,
      status: 'pending',
      queueNumber: 6,
    }),
  );
  expect(view.getByText('取餐號碼 6')).toBeTruthy();
  expect(submitDiningIntent).toHaveBeenCalledTimes(2);
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
test('marks unverified and demo venues and leaves verified unmarked', async () => {
  jest.mocked(loadDiningCatalog).mockResolvedValueOnce({
    venues: [
      {
        id: 'cafe-1',
        name: '校園小棧',
        location: '活動中心',
        orderingEnabled: false,
        reviewStatus: 'demo',
      },
      {
        id: 'stall',
        name: '校內咖啡店',
        location: '學生餐廳',
        orderingEnabled: false,
        reviewStatus: 'unverified',
      },
      {
        id: 'jingyuan',
        name: '靜園餐廳',
        location: '文興樓對面',
        orderingEnabled: false,
        reviewStatus: 'verified',
      },
    ],
    menus: [],
  });
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  expect(view.getByText('示範')).toBeTruthy();
  expect(view.getByText(UNVERIFIED_CAFETERIA_BADGE)).toBeTruthy();
  expect(view.getByText('靜園餐廳')).toBeTruthy();
  expect(view.queryAllByText('示範')).toHaveLength(1);
  expect(view.queryAllByText(UNVERIFIED_CAFETERIA_BADGE)).toHaveLength(1);
});

test('restaurant list payment copy does not mention Nuni', async () => {
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  expect(view.queryByText(/Nuni|nuni/)).toBeNull();
  expect(
    view.queryByText('價格、是否賣完、是否接單以店家訂餐頁為準。Nuni 不處理這筆的付款與退款。'),
  ).toBeNull();
});

test('uses an honest empty state when this school has no restaurants', async () => {
  jest.mocked(loadDiningCatalog).mockResolvedValueOnce({ venues: [], menus: [] });
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  expect(view.getByText('這間學校的餐廳還沒上架')).toBeTruthy();
  expect(view.queryByText('今日餐點')).toBeNull();
  expect(view.queryByText('校園餐廳甲')).toBeNull();
});

test('a failed menu read shows retry without fabricated restaurants', async () => {
  jest.mocked(loadDiningCatalog).mockRejectedValueOnce(new Error('offline'));
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  expect(view.queryByText('今日餐點')).toBeNull();
  expect(view.getByText('服務暫時停止，我們正在處理，請稍後再來。')).toBeTruthy();
  expect(view.queryByText('請確認網路後再試')).toBeNull();
  expect(view.queryByText('重新整理')).toBeNull();
});
test('lets a guest read restaurants without asking them to sign in first', async () => {
  mockUser = null;
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  expect(loadPublicDiningCatalog).toHaveBeenCalledWith('pu');
  expect(loadDiningCatalog).not.toHaveBeenCalled();
  expect(view.getAllByText('校園餐廳甲').length).toBeGreaterThan(0);
  expect(view.queryByText('登入後查看菜單')).toBeNull();
  expect(view.queryByText('請先登入學校帳號，再查看餐廳與訂單。')).toBeNull();
  expect(view.queryByText('我的訂單')).toBeNull();
});
test('keeps the offline copy when the device has no network', async () => {
  jest.mocked(loadDiningCatalog).mockRejectedValueOnce(new TypeError('Network request failed'));
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  expect(view.getByText('請確認網路後再試')).toBeTruthy();
  expect(view.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
  expect(view.getByText('重新整理')).toBeTruthy();
  expect(view.queryByText('今日餐點')).toBeNull();
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
  await act(async () => fireEvent.press(view.getByText('開啟官方館藏結果')));
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

test('library fallback explains manual pasting before any clipboard or browser action', () => {
  mockSchool = { id: 'cgu' };
  const view = render(<LibraryAiFirstScreen />);
  expect(
    view.getByText('這個入口不會自動帶入關鍵字。開啟後請將關鍵字貼到館藏網站的搜尋欄位；是否可借請以館方系統為準。'),
  ).toBeTruthy();
  expect(view.getByRole('button', { name: '複製關鍵字並開啟館藏網站' })).toBeDisabled();
  expect(view.getByRole('button', { name: '開啟館藏網站' })).not.toBeDisabled();
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), ' 護理 ');
  expect(view.getByRole('button', { name: '複製關鍵字並開啟館藏網站' })).not.toBeDisabled();
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  expect(Linking.openURL).not.toHaveBeenCalled();
  expect(view.queryByText('已複製關鍵字，請貼到圖書館網站的搜尋欄位。')).toBeNull();
});

test('library fallback copies the trimmed keyword before opening the official catalog', async () => {
  mockSchool = { id: 'cgu' };
  const pending = deferred<void>();
  jest.mocked(Clipboard.setStringAsync).mockReturnValueOnce(pending.promise);
  const view = render(<LibraryAiFirstScreen />);
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), ' 護理 & 健康 ');
  fireEvent.press(view.getByText('複製關鍵字並開啟館藏網站'));
  expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1);
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('護理 & 健康');
  expect(Linking.openURL).not.toHaveBeenCalled();
  await act(async () => pending.resolve());
  expect(Linking.openURL).toHaveBeenCalledTimes(1);
  expect(Linking.openURL).toHaveBeenCalledWith('https://web20.lib.cgu.edu.tw/');
  expect(view.getByText('已複製關鍵字，請貼到圖書館網站的搜尋欄位。')).toBeTruthy();
});

test.each([
  ['cgu', 'https://web20.lib.cgu.edu.tw/'],
  ['cycu', 'https://cylis.lib.cycu.edu.tw/search*cht'],
  ['tmu', 'https://libelis.tmu.edu.tw/webpacIndex.jsp'],
])('library %s homepage opens without a keyword or clipboard access', async (schoolId, url) => {
  mockSchool = { id: schoolId };
  const view = render(<LibraryAiFirstScreen />);
  expect(view.getByLabelText('館藏關鍵字').props.value).toBe('');
  await act(async () => fireEvent.press(view.getByText('開啟館藏網站')));
  expect(Linking.openURL).toHaveBeenCalledTimes(1);
  expect(Linking.openURL).toHaveBeenCalledWith(url);
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  expect(view.queryByText('已複製關鍵字，請貼到圖書館網站的搜尋欄位。')).toBeNull();
});

test('library homepage action does not copy or attach an entered keyword', async () => {
  mockSchool = { id: 'cgu' };
  const view = render(<LibraryAiFirstScreen />);
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), '護理 & 健康');
  await act(async () => fireEvent.press(view.getByText('開啟館藏網站')));
  expect(Linking.openURL).toHaveBeenCalledTimes(1);
  expect(Linking.openURL).toHaveBeenCalledWith('https://web20.lib.cgu.edu.tw/');
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  expect(view.getByLabelText('館藏關鍵字').props.value).toBe('護理 & 健康');
});

test('library clipboard failure asks for manual entry without claiming it copied', async () => {
  mockSchool = { id: 'cgu' };
  jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error('clipboard unavailable'));
  const view = render(<LibraryAiFirstScreen />);
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), '護理');
  await act(async () => fireEvent.press(view.getByText('複製關鍵字並開啟館藏網站')));
  expect(view.getByText('請在學校圖書館網站自行輸入關鍵字。')).toBeTruthy();
  expect(view.queryByText('已複製關鍵字，請貼到圖書館網站的搜尋欄位。')).toBeNull();
  expect(Linking.openURL).toHaveBeenCalledWith('https://web20.lib.cgu.edu.tw/');
  expect(view.getByLabelText('館藏關鍵字').props.value).toBe('護理');
});

test('library external-open failure preserves the query and lets the user retry', async () => {
  mockSchool = { id: 'cgu' };
  jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('browser unavailable'));
  const view = render(<LibraryAiFirstScreen />);
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), '護理');
  await act(async () => fireEvent.press(view.getByText('複製關鍵字並開啟館藏網站')));
  expect(view.getByRole('alert')).toHaveTextContent('無法開啟圖書館網頁，請確認網路連線後重試。');
  expect(view.getByLabelText('館藏關鍵字').props.value).toBe('護理');
  await act(async () => fireEvent.press(view.getByText('複製關鍵字並開啟館藏網站')));
  expect(Linking.openURL).toHaveBeenCalledTimes(2);
  expect(Linking.openURL).toHaveBeenLastCalledWith('https://web20.lib.cgu.edu.tw/');
  expect(view.queryByRole('alert')).toBeNull();
  expect(view.getByLabelText('館藏關鍵字').props.value).toBe('護理');
});

test.each(['school', 'account'] as const)(
  'library pending clipboard completion cannot open the old catalog after a %s switch',
  async (change) => {
    mockSchool = { id: 'cgu' };
    const pending = deferred<void>();
    jest.mocked(Clipboard.setStringAsync).mockReturnValueOnce(pending.promise);
    const view = render(<LibraryAiFirstScreen />);
    fireEvent.changeText(view.getByLabelText('館藏關鍵字'), 'private query');
    fireEvent.press(view.getByText('複製關鍵字並開啟館藏網站'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('private query');
    if (change === 'school') mockSchool = { id: 'cycu' };
    else mockUser = { uid: 'student-b' };
    view.rerender(<LibraryAiFirstScreen />);
    await act(async () => pending.resolve());
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(view.getByLabelText('館藏關鍵字').props.value).toBe('');
    expect(view.queryByText('已複製關鍵字，請貼到圖書館網站的搜尋欄位。')).toBeNull();
    expect(view.queryByRole('alert')).toBeNull();
  },
);

test('餐廳頁頂端有「我的訂單」，按了開我的訂單', async () => {
  const navigate = jest.fn();
  const view = render(<CafeteriaAiFirstScreen navigation={{ navigate }} />);
  await act(async () => {});
  fireEvent.press(view.getByText('我的訂單'));
  expect(navigate).toHaveBeenCalledWith('StudentOrders');
});
test('斷線後連查都查不出結果：寫「還在確認訂單有沒有送出，請到『我的訂單』看。」，給「我的訂單」不給再試一次', async () => {
  const navigate = jest.fn();
  jest
    .mocked(submitDiningIntent)
    .mockRejectedValueOnce(
      new DiningError('還在確認訂單有沒有送出，請到『我的訂單』看。', 'checking'),
    );
  const view = render(<CafeteriaAiFirstScreen navigation={{ navigate }} />);
  await act(async () => {});
  fireEvent.press(view.getByText('選擇今日餐點'));
  await act(async () => fireEvent.press(view.getByText('送出訂單，到店付款')));
  expect(view.getByText('還在確認訂單')).toBeTruthy();
  expect(view.getByText('還在確認訂單有沒有送出，請到『我的訂單』看。')).toBeTruthy();
  expect(view.queryByText('再試一次')).toBeNull();
  const buttons = view.getAllByText('我的訂單');
  fireEvent.press(buttons[buttons.length - 1]);
  expect(navigate).toHaveBeenCalledWith('StudentOrders');
});

test('restaurant keeps the school catalog and does not invite platform ordering while it is off', async () => {
  const navigate = jest.fn();
  const view = render(<CafeteriaAiFirstScreen navigation={{ navigate }} />);
  await act(async () => {});
  expect(view.getByText('目前還不能線上點餐')).toBeTruthy();
  expect(view.queryByText('前往平台點餐')).toBeNull();
  expect(
    view.queryByText(
      '使用 Google 帳號選餐、查看訂單與出示取餐憑證。學校原有餐廳服務仍保留在下方。',
    ),
  ).toBeNull();
  expect(view.getByText('選擇今日餐點')).toBeTruthy();
  expect(navigate).not.toHaveBeenCalled();
});

test('switching universities opens that university official library instead of Providence OPAC', async () => {
  mockSchool = { id: 'ntu' };
  const navigate = jest.fn();
  const view = render(<LibraryAiFirstScreen navigation={{ navigate }} />);
  expect(view.getByText('國立臺灣大學圖書館')).toBeTruthy();
  expect(view.queryByText('開啟館藏網站')).toBeNull();
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), ' 分散式系統 ');
  await act(async () => fireEvent.press(view.getByText('開啟官方館藏結果')));
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  const opened = jest.mocked(Linking.openURL).mock.calls.at(-1)?.[0];
  expect(opened).toBeTruthy();
  const url = new URL(opened!);
  expect(url.hostname).toBe('ntu.primo.exlibrisgroup.com');
  expect(url.searchParams.get('vid')).toBe('886NTU_INST:886NTU_INST');
  expect(url.searchParams.get('query')).toBe('any,contains,分散式系統');
  expect(navigate).not.toHaveBeenCalledWith('LibraryCatalog', expect.anything());
  expect(view.queryByText('蓋夏圖書館')).toBeNull();
});

test('a campus switch resets library search and never carries the previous OPAC account link', async () => {
  const view = render(<LibraryAiFirstScreen />);
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), 'private search');
  mockSchool = { id: 'ncue' };
  view.rerender(<LibraryAiFirstScreen />);
  expect(view.getByLabelText('館藏關鍵字').props.value).toBe('');
  expect(view.getByText('國立彰化師範大學圖書與資訊處')).toBeTruthy();
  expect(view.queryByText('開啟我的借閱紀錄')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('圖書館官網')));
  expect(Linking.openURL).toHaveBeenCalledWith('https://olis.ncue.edu.tw/');
});

test('changing the university replaces both the catalog destination and previous search', async () => {
  mockSchool = { id: 'nthu' };
  const view = render(<LibraryAiFirstScreen />);
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), 'old query');
  await act(async () => fireEvent.press(view.getByText('開啟官方館藏結果')));
  const first = new URL(jest.mocked(Linking.openURL).mock.calls.at(-1)![0]);
  expect(first.hostname).toBe('nthu.primo.exlibrisgroup.com');
  expect(first.searchParams.get('query')).toBe('any,contains,old query');
  mockSchool = { id: 'ncku' };
  view.rerender(<LibraryAiFirstScreen />);
  expect(view.getByLabelText('館藏關鍵字').props.value).toBe('');
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), 'new query');
  await act(async () => fireEvent.press(view.getByText('開啟官方館藏結果')));
  const second = new URL(jest.mocked(Linking.openURL).mock.calls.at(-1)![0]);
  expect(second.hostname).toBe('ncku.primo.exlibrisgroup.com');
  expect(second.searchParams.get('vid')).toBe('886NCKU_INST:886NCKU_INST');
  expect(second.searchParams.get('query')).toBe('any,contains,new query');
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
});

test('Soochow library search uses its verified Primo view instead of a different campus', async () => {
  mockSchool = { id: 'scu' };
  const view = render(<LibraryAiFirstScreen />);
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), '閱讀教育');
  await act(async () => fireEvent.press(view.getByText('開啟官方館藏結果')));
  const url = new URL(jest.mocked(Linking.openURL).mock.calls.at(-1)![0]);
  expect(url.hostname).toBe('uco-scu.primo.exlibrisgroup.com');
  expect(url.searchParams.get('vid')).toBe('886UCO_SCU:886SCU_INST');
  expect(url.searchParams.get('query')).toBe('any,contains,閱讀教育');
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
});

test('Chang Gung library uses its official iGrid catalog rather than Providence', async () => {
  mockSchool = { id: 'cgu' };
  const view = render(<LibraryAiFirstScreen />);
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), '護理');
  await act(async () => fireEvent.press(view.getByText('複製關鍵字並開啟館藏網站')));
  expect(jest.mocked(Linking.openURL)).toHaveBeenCalledWith('https://web20.lib.cgu.edu.tw/');
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('護理');
  expect(view.queryByText('蓋夏圖書館')).toBeNull();
});

test('Chung Yuan library account and catalog stay on its official domain', async () => {
  mockSchool = { id: 'cycu' };
  const view = render(<LibraryAiFirstScreen />);
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), '企業管理');
  await act(async () => fireEvent.press(view.getByText('複製關鍵字並開啟館藏網站')));
  expect(Linking.openURL).toHaveBeenCalledWith('https://cylis.lib.cycu.edu.tw/search*cht');
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('企業管理');
  await act(async () => fireEvent.press(view.getByText('開啟我的借閱紀錄')));
  expect(Linking.openURL).toHaveBeenCalledWith('https://cylis.lib.cycu.edu.tw/patroninfo*cht');
  expect(view.queryByText('蓋夏圖書館')).toBeNull();
});

test('Taipei Medical library uses its own WebPAC catalog rather than a Providence search', async () => {
  mockSchool = { id: 'tmu' };
  const view = render(<LibraryAiFirstScreen />);
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), '醫學');
  await act(async () => fireEvent.press(view.getByText('複製關鍵字並開啟館藏網站')));
  expect(Linking.openURL).toHaveBeenCalledWith('https://libelis.tmu.edu.tw/webpacIndex.jsp');
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('醫學');
  expect(view.queryByText('蓋夏圖書館')).toBeNull();
});

test('NCUE library search opens WebPACX results without clipboard or Providence navigation', async () => {
  mockSchool = { id: 'ncue' };
  const navigate = jest.fn();
  const view = render(<LibraryAiFirstScreen navigation={{ navigate }} />);
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), ' 資料庫 & SQL ');
  await act(async () => fireEvent.press(view.getByText('開啟官方館藏結果')));
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalledWith('LibraryCatalog', expect.anything());
  expect(view.queryByText('開啟館藏網站')).toBeNull();
  const url = new URL(jest.mocked(Linking.openURL).mock.calls.at(-1)![0]);
  expect(url.hostname).toBe('webpacx.ncue.edu.tw');
  expect(url.pathname).toBe('/search');
  expect(url.searchParams.get('searchInput')).toBe('資料庫 & SQL');
  expect(url.searchParams.get('searchField')).toBe('FullText');
});

test('NTUB and THU library searches stay on each school WebPACX host', async () => {
  mockSchool = { id: 'ntub' };
  let view = render(<LibraryAiFirstScreen />);
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), '會計');
  await act(async () => fireEvent.press(view.getByText('開啟官方館藏結果')));
  expect(new URL(jest.mocked(Linking.openURL).mock.calls.at(-1)![0]).hostname).toBe(
    'webpacx.ntub.edu.tw',
  );
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();

  mockSchool = { id: 'thu' };
  view = render(<LibraryAiFirstScreen />);
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), '哲學');
  await act(async () => fireEvent.press(view.getByText('開啟官方館藏結果')));
  const thu = new URL(jest.mocked(Linking.openURL).mock.calls.at(-1)![0]);
  expect(thu.hostname).toBe('webpac.lib.thu.edu.tw');
  expect(thu.searchParams.get('searchInput')).toBe('哲學');
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
});

test('Fu Jen library search opens Sierra results with the 75-character limit', async () => {
  mockSchool = { id: 'fju' };
  const navigate = jest.fn();
  const view = render(<LibraryAiFirstScreen navigation={{ navigate }} />);
  expect(view.getByLabelText('館藏關鍵字').props.maxLength).toBe(75);
  expect(view.getByText('此校官方館藏關鍵字上限為 75 字。')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), '資料庫');
  await act(async () => fireEvent.press(view.getByText('開啟官方館藏結果')));
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalledWith('LibraryCatalog', expect.anything());
  const url = new URL(jest.mocked(Linking.openURL).mock.calls.at(-1)![0]);
  expect(url.hostname).toBe('library.lib.fju.edu.tw');
  expect(url.port).toBe('444');
  expect(url.pathname).toBe('/search~S0*cht/');
  expect(url.searchParams.get('searcharg')).toBe('資料庫');
  await act(async () => fireEvent.press(view.getByText('開啟我的借閱紀錄')));
  expect(Linking.openURL).toHaveBeenCalledWith(
    'https://library.lib.fju.edu.tw:444/patroninfo*cht',
  );
});

test('restaurant search matches descriptions without leaving unrelated restaurants visible', async () => {
  jest.mocked(loadDiningCatalog).mockResolvedValueOnce({
    venues: [
      catalog.venues[0],
      { ...catalog.venues[0], id: 'other', name: '另一間餐廳', location: '二樓' },
    ],
    menus: [
      { ...menu, name: '早餐組合', description: 'Egg and MILK' },
      { ...menu, id: 'other-meal', cafeteriaId: 'other', name: '午餐組合' },
    ],
  });
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  fireEvent.changeText(view.getByLabelText('餐點或店名'), ' milk ');
  expect(view.getByText('校園餐廳甲')).toBeTruthy();
  expect(view.getByText('早餐組合')).toBeTruthy();
  expect(view.queryByText('另一間餐廳')).toBeNull();
  expect(view.queryByText('午餐組合')).toBeNull();
  fireEvent.changeText(view.getByLabelText('餐點或店名'), '找不到');
  expect(view.getByText('找不到符合的餐廳或餐點')).toBeTruthy();
  fireEvent.press(view.getByText('清除篩選'));
  expect(view.getByText('另一間餐廳')).toBeTruthy();
});

test('a restaurant without dishes is still browsable and does not show a global empty state', async () => {
  jest.mocked(loadDiningCatalog).mockResolvedValueOnce({ venues: catalog.venues, menus: [] });
  const navigate = jest.fn();
  const view = render(<CafeteriaAiFirstScreen navigation={{ navigate }} />);
  await act(async () => {});
  expect(view.getByText('校園餐廳甲')).toBeTruthy();
  expect(view.getByText('尚未提供菜單')).toBeTruthy();
  expect(view.queryByText('找不到符合的餐廳或餐點')).toBeNull();
  fireEvent.press(view.getByLabelText('查看校園餐廳甲的店家資訊'));
  expect(navigate).toHaveBeenCalledWith('校園', {
    screen: 'Storefront',
    params: { cafeteriaId: 'venue-a' },
  });
});

test('budget filtering excludes unknown prices and clears cleanly', async () => {
  jest.mocked(loadDiningCatalog).mockResolvedValueOnce({
    venues: catalog.venues,
    menus: [
      { ...menu, name: '百元餐' },
      { ...menu, id: 'dear', name: '豪華餐', price: 150 },
      { ...menu, id: 'unknown', name: '未標價餐', price: null },
    ],
  });
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  fireEvent.press(view.getByText('100 元內'));
  expect(view.getByText('百元餐')).toBeTruthy();
  expect(view.queryByText('豪華餐')).toBeNull();
  expect(view.queryByText('未標價餐')).toBeNull();
  fireEvent.press(view.getByText('全部餐廳'));
  fireEvent.press(view.getByLabelText('展開校園餐廳甲的菜單'));
  expect(view.getByText('豪華餐')).toBeTruthy();
  expect(view.getByText('未標價餐')).toBeTruthy();
});

test('long restaurant menus expand in place while retaining a compact initial list', async () => {
  jest.mocked(loadDiningCatalog).mockResolvedValueOnce({
    venues: catalog.venues,
    menus: Array.from({ length: 5 }, (_, index) => ({
      ...menu,
      id: `item-${index}`,
      name: `餐點 ${index + 1}`,
    })),
  });
  const view = render(<CafeteriaAiFirstScreen />);
  await act(async () => {});
  expect(view.getByText('餐點 1')).toBeTruthy();
  expect(view.queryByText('餐點 2')).toBeNull();
  fireEvent.press(view.getByLabelText('展開校園餐廳甲的菜單'));
  expect(view.getByText('餐點 5')).toBeTruthy();
  fireEvent.press(view.getByLabelText('收合校園餐廳甲的菜單'));
  expect(view.queryByText('餐點 5')).toBeNull();
});

test('expanded menus keep their storefront destination and reset when the school changes', async () => {
  jest.mocked(loadDiningCatalog).mockResolvedValueOnce({
    venues: catalog.venues,
    menus: [menu, { ...menu, id: 'second', name: '第二道餐點' }],
  });
  const navigate = jest.fn();
  const view = render(<CafeteriaAiFirstScreen navigation={{ navigate }} />);
  await act(async () => {});
  expect(view.queryByText('第二道餐點')).toBeNull();
  fireEvent.press(view.getByLabelText('展開校園餐廳甲的菜單'));
  expect(view.getByText('第二道餐點')).toBeTruthy();
  fireEvent.press(view.getByLabelText('查看校園餐廳甲的店家資訊'));
  expect(navigate).toHaveBeenLastCalledWith('校園', {
    screen: 'Storefront',
    params: { cafeteriaId: 'venue-a' },
  });
  jest.mocked(loadDiningCatalog).mockResolvedValueOnce({
    venues: [{ ...catalog.venues[0], id: 'new-venue', name: '另一校的餐廳' }],
    menus: [
      { ...menu, id: 'new-one', cafeteriaId: 'new-venue', name: '新校餐點' },
      { ...menu, id: 'new-two', cafeteriaId: 'new-venue', name: '另一道新校餐點' },
    ],
  });
  mockSchool = { id: 'other-school' };
  view.rerender(<CafeteriaAiFirstScreen navigation={{ navigate }} />);
  await act(async () => {});
  expect(view.queryByText('第二道餐點')).toBeNull();
  expect(view.queryByText('另一道新校餐點')).toBeNull();
  expect(view.getByLabelText('展開另一校的餐廳的菜單')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('餐點或店名'), '另一道');
  expect(view.getByText('另一道新校餐點')).toBeTruthy();
  fireEvent.press(view.getByLabelText('查看另一校的餐廳的店家資訊'));
  expect(navigate).toHaveBeenLastCalledWith('校園', {
    screen: 'Storefront',
    params: { cafeteriaId: 'new-venue' },
  });
});

test.each(['search', 'budget'] as const)(
  '%s results retain one preview until explicitly expanded',
  async (mode) => {
    jest.mocked(loadDiningCatalog).mockResolvedValueOnce({
      venues: catalog.venues,
      menus: [
        ...Array.from({ length: 5 }, (_, index) => ({
          ...menu,
          id: `item-${index}`,
          name: `飯食 ${index + 1}`,
        })),
        { ...menu, id: 'extra', name: '限定套餐', price: 180 },
      ],
    });
    const view = render(<CafeteriaAiFirstScreen />);
    await act(async () => {});
    if (mode === 'search') fireEvent.changeText(view.getByLabelText('餐點或店名'), '飯食');
    else fireEvent.press(view.getByText('100 元內'));
    expect(view.getByText('飯食 1')).toBeTruthy();
    expect(view.queryByText('飯食 2')).toBeNull();
    expect(view.getByText('5 道符合 · 共 6 道')).toBeTruthy();
    expect(view.getByText('看全部 5 道餐點')).toBeTruthy();
    fireEvent.press(view.getByLabelText('展開校園餐廳甲的菜單'));
    expect(view.getByText('飯食 5')).toBeTruthy();
    expect(view.queryByText('限定套餐')).toBeNull();
    fireEvent.press(view.getByLabelText('收合校園餐廳甲的菜單'));
    expect(view.queryByText('飯食 4')).toBeNull();
  },
);
