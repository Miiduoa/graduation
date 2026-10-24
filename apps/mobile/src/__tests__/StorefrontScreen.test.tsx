import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import StorefrontScreen from '../screens/StorefrontScreen';
import HonestOrderScreen from '../screens/HonestOrderScreen';
import { theme } from '../ui/theme';
import { UNVERIFIED_CAFETERIA_NOTICE } from '@campus/shared/src/cafeteriaCatalog';
import {
  loadStorefront,
  loadStorefrontMenus,
  loadStorefrontPosts,
  isFollowingStorefront,
  loadStorefrontComments,
  followStorefront,
  addStorefrontComment,
} from '../services/storefront';

const navigation = { navigate: jest.fn(), goBack: jest.fn() };
let mockUser: { uid: string } | null = { uid: 'alice' };
let mockSchool = { id: 'pu' };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../services/storefront', () => ({
  loadStorefront: jest.fn(),
  loadStorefrontMenus: jest.fn(async () => []),
  loadStorefrontPosts: jest.fn(async () => []),
  isFollowingStorefront: jest.fn(async () => false),
  followStorefront: jest.fn(),
  loadStorefrontComments: jest.fn(async () => []),
  addStorefrontComment: jest.fn(),
  toggleStorefrontLike: jest.fn(),
}));

const caption = '會開啟店家自己的網站，訂單和付款由店家處理，Campus One 查不到這筆訂單';

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { uid: 'alice' };
  mockSchool = { id: 'pu' };
  jest.mocked(loadStorefrontPosts).mockResolvedValue([]);
  jest.mocked(loadStorefrontMenus).mockResolvedValue([]);
  jest.mocked(isFollowingStorefront).mockResolvedValue(false);
  jest.mocked(loadStorefrontComments).mockResolvedValue([]);
});

const commentsPrompt = '登入後才能看評論';

test('unsigned visitors keep public shop info and menus, skip social reads, and see a comments login prompt', async () => {
  mockUser = null;
  jest.mocked(loadStorefront).mockResolvedValue({
    id: 'stall',
    name: '校內咖啡店',
    intro: '紙感小店',
    merchantMode: 'showcase_link',
    orderingUrl: 'https://shop.example/order',
    location: '學生餐廳',
    openingHours: '週一至週五 11:00–14:00',
  } as never);
  jest
    .mocked(loadStorefrontMenus)
    .mockResolvedValue([{ id: 'meal', name: '蔬菜吐司', price: 60 }] as never);
  jest.mocked(loadStorefrontPosts).mockResolvedValue([
    {
      id: 'post-1',
      title: '今日優惠',
      text: '買一送一',
      kind: 'promo',
      likeCount: 0,
      liked: false,
    },
  ] as never);
  const view = render(
    <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'stall' } }} />,
  );
  expect(await view.findByText('紙感小店')).toBeTruthy();
  expect(view.getByText('店家自己的主頁。')).toBeTruthy();
  expect(view.queryByText('店家自己的主頁。一般帳號即可查看、追蹤與留言。')).toBeNull();
  expect(
    view.queryByText('價格、是否賣完、是否接單以店家訂餐頁為準。Nuni 不處理這筆的付款與退款。'),
  ).toBeNull();
  expect(view.queryByText('返回餐廳列表')).toBeNull();
  expect(view.queryByText('回餐廳列表')).toBeNull();
  expect(await view.findByText('蔬菜吐司')).toBeTruthy();
  expect(view.getByText('NT$60')).toBeTruthy();
  expect(await view.findByText(commentsPrompt)).toBeTruthy();
  expect(view.queryByText('登入後才能看失物招領和評論')).toBeNull();
  expect(loadStorefrontPosts).toHaveBeenCalledWith('pu', 'stall', undefined);
  expect(loadStorefrontComments).not.toHaveBeenCalled();
  expect(isFollowingStorefront).not.toHaveBeenCalled();
  expect(view.queryByText('暫時讀不到這間店。')).toBeNull();
  expect(view.queryByText('目前沒有資料')).toBeNull();
  expect(view.queryByText('請確認網路')).toBeNull();
  fireEvent.press(view.getByText('登入'));
  expect(navigation.navigate).toHaveBeenCalledWith('SSOLogin', { returnTo: '/cafeteria/stall' });
});

test('permission-denied comment reads keep shop data and menus instead of failing the page', async () => {
  jest.mocked(loadStorefront).mockResolvedValue({
    id: 'stall',
    name: '校內咖啡店',
    intro: '紙感小店',
    merchantMode: 'info_only',
    location: '學生餐廳',
    openingHours: '週一到週五',
  } as never);
  jest
    .mocked(loadStorefrontMenus)
    .mockResolvedValue([{ id: 'meal', name: '蔬菜吐司', price: 60 }] as never);
  jest
    .mocked(loadStorefrontPosts)
    .mockRejectedValueOnce(
      Object.assign(new Error('permission-denied'), { code: 'permission-denied' }),
    );
  jest
    .mocked(isFollowingStorefront)
    .mockRejectedValueOnce(
      Object.assign(new Error('permission-denied'), { code: 'permission-denied' }),
    );
  jest
    .mocked(loadStorefrontComments)
    .mockRejectedValue(
      Object.assign(new Error('permission-denied'), { code: 'permission-denied' }),
    );
  const view = render(
    <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'stall' } }} />,
  );
  expect(await view.findByText('紙感小店')).toBeTruthy();
  expect(await view.findByText('蔬菜吐司')).toBeTruthy();
  expect(view.getByText('NT$60')).toBeTruthy();
  expect(await view.findByText(commentsPrompt)).toBeTruthy();
  expect(view.queryByText('暫時讀不到這間店。')).toBeNull();
  expect(view.queryByText('目前沒有資料')).toBeNull();
  expect(view.queryByText('請確認網路')).toBeNull();
});

test('店面有外連時按鈕寫「到店家網站訂餐」，下面放免責小字', async () => {
  jest.mocked(loadStorefront).mockResolvedValue({
    id: 'stall',
    name: '校內咖啡店',
    intro: '紙感小店',
    merchantMode: 'showcase_link',
    orderingUrl: 'https://shop.example/order',
    location: '學生餐廳',
    openingHours: '週一至週五 11:00–14:00',
    reviewStatus: 'verified',
  } as never);
  const view = render(
    <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'stall' } }} />,
  );
  expect(await view.findByText('到店家網站訂餐')).toBeTruthy();
  expect(view.getByText('這間店要到店家自己的頁面訂餐。')).toBeTruthy();
  expect(view.getByText(caption)).toBeTruthy();
  expect(view.queryByText(/點餐|下單/)).toBeNull();
  expect(view.queryByText('沒串接的店也可以只放訂餐連結。')).toBeNull();
  fireEvent.press(view.getByText('到店家網站訂餐'));
  expect(navigation.navigate).toHaveBeenCalledWith('HonestOrder', {
    cafeteriaId: 'stall',
    orderingUrl: 'https://shop.example/order',
  });
});

test('沒有外連的店不放訂餐按鈕，只顯示營業時間和地點', async () => {
  jest.mocked(loadStorefront).mockResolvedValue({
    id: 'stall',
    name: '校內咖啡店',
    merchantMode: 'showcase_link',
    location: '活動中心',
    openingHours: '週一到週五',
    reviewStatus: 'verified',
  } as never);
  const view = render(
    <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'stall' } }} />,
  );
  expect(await view.findByText('活動中心 · 週一到週五')).toBeTruthy();
  expect(view.queryByText('到店家網站訂餐')).toBeNull();
  expect(view.queryByText('這間店要到店家自己的頁面訂餐。')).toBeNull();
  expect(view.queryByText(caption)).toBeNull();
  expect(view.queryByText(/點餐|下單/)).toBeNull();
  expect(view.getByText('還沒有菜單。')).toBeTruthy();
  expect(view.queryByText('沒串接的店也可以只放訂餐連結。')).toBeNull();
});

test('大寫 HTTPS 外連跟小寫一樣放按鈕', async () => {
  jest.mocked(loadStorefront).mockResolvedValue({
    id: 'stall',
    name: '校內咖啡店',
    merchantMode: 'showcase_link',
    orderingUrl: 'HTTPS://shop.example/order',
    websiteUrl: 'HTTPS://shop.example',
    location: '活動中心',
    openingHours: '週一到週五',
  } as never);
  const view = render(
    <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'stall' } }} />,
  );
  expect(await view.findByText('到店家網站訂餐')).toBeTruthy();
  expect(view.getByText('店家網站')).toBeTruthy();
});

test('不合格外連不當成按鈕，也不打開店家網站', async () => {
  const unsafe = [
    'javascript:alert(1)',
    'https://a@evil.com',
    `https://shop.example/${'a'.repeat(2048)}`,
    ' https://shop.example/order',
    'https://shop.example/order ',
    'http://shop.example/order',
    'data:text/html,hi',
    'https://shop.example/order\u0000',
  ];
  for (const url of unsafe) {
    jest.mocked(loadStorefront).mockResolvedValue({
      id: 'stall',
      name: '校內咖啡店',
      merchantMode: 'showcase_link',
      orderingUrl: url,
      websiteUrl: url,
      location: '活動中心',
      openingHours: '週一到週五',
    } as never);
    const view = render(
      <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'stall' } }} />,
    );
    expect(await view.findByText('活動中心 · 週一到週五')).toBeTruthy();
    expect(view.queryByText('到店家網站訂餐')).toBeNull();
    expect(view.queryByText('店家網站')).toBeNull();
    view.unmount();
  }
});

test('外連確認頁不合格網址不放按鈕', async () => {
  const unsafe = [
    'javascript:alert(1)',
    'https://a@evil.com',
    `https://shop.example/${'a'.repeat(2048)}`,
    ' https://shop.example/order',
    'http://shop.example/order',
    'data:text/html,hi',
    'https://shop.example/order\u0000',
  ];
  for (const orderingUrl of unsafe) {
    const view = render(
      <HonestOrderScreen
        navigation={navigation}
        route={{ params: { cafeteriaId: 'stall', orderingUrl } }}
      />,
    );
    expect(view.getByText('這間店還沒有可打開的訂餐連結。')).toBeTruthy();
    expect(view.queryByText('到店家網站訂餐')).toBeTruthy();
    expect(view.queryAllByText('到店家網站訂餐').length).toBe(1);
    view.unmount();
  }
});

test('keeps the not-found copy and offers a way back when the shop is missing', async () => {
  jest.mocked(loadStorefront).mockResolvedValueOnce(null);
  const view = render(
    <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'cafe-1' } }} />,
  );
  expect(await view.findByText('找不到這間店。')).toBeTruthy();
  expect(view.getByText('回餐廳列表')).toBeTruthy();
  expect(view.queryByText('這是示範店家，菜單和價格不是真的，不能點餐。')).toBeNull();
  fireEvent.press(view.getByText('回餐廳列表'));
  expect(navigation.navigate).toHaveBeenCalledWith('Cafeteria');
});

test.each([
  {
    reviewStatus: 'demo' as const,
    notice: '這是示範店家，菜單和價格不是真的，不能點餐。',
    hidden: UNVERIFIED_CAFETERIA_NOTICE,
  },
  {
    reviewStatus: 'unverified' as const,
    notice: UNVERIFIED_CAFETERIA_NOTICE,
    hidden: '這是示範店家，菜單和價格不是真的，不能點餐。',
  },
  {
    reviewStatus: undefined,
    notice: UNVERIFIED_CAFETERIA_NOTICE,
    hidden: '這是示範店家，菜單和價格不是真的，不能點餐。',
  },
])('shows the review notice for $reviewStatus shops', async ({ reviewStatus, notice, hidden }) => {
  jest.mocked(loadStorefront).mockResolvedValueOnce({
    id: 'cafe-1',
    name: '校園小棧',
    intro: '紙感小店',
    merchantMode: 'info_only',
    reviewStatus,
  } as never);
  const view = render(
    <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'cafe-1' } }} />,
  );
  expect(await view.findByText(notice)).toBeTruthy();
  expect(view.queryByText(hidden)).toBeNull();
  expect(view.getByText('紙感小店')).toBeTruthy();
  expect(view.queryByText('找不到這間店。')).toBeNull();
  const box = view.getByTestId('cafeteria-review-notice');
  expect(view.getByText(notice)).toBeTruthy();
  expect(box).toHaveStyle({
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
  });
});

test('hides sold-out marks on unverified storefront menus', async () => {
  jest.mocked(loadStorefront).mockResolvedValueOnce({
    id: 'stall',
    name: '校內咖啡店',
    merchantMode: 'info_only',
    reviewStatus: 'unverified',
  } as never);
  jest
    .mocked(loadStorefrontMenus)
    .mockResolvedValueOnce([{ id: 'meal', name: '蔬菜吐司', price: 60, soldOut: true }] as never);
  const view = render(
    <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'stall' } }} />,
  );
  expect(await view.findByText('蔬菜吐司')).toBeTruthy();
  expect(view.getByText('NT$60')).toBeTruthy();
  expect(view.queryByText(/售完/)).toBeNull();
  expect(view.queryByText('供應中')).toBeNull();
});

test('does not mark a verified shop page', async () => {
  jest.mocked(loadStorefront).mockResolvedValueOnce({
    id: 'stall',
    name: '校內咖啡店',
    intro: '紙感小店',
    merchantMode: 'info_only',
    reviewStatus: 'verified',
  } as never);
  const view = render(
    <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'stall' } }} />,
  );
  expect(await view.findByText('紙感小店')).toBeTruthy();
  expect(view.queryByText('這是示範店家，菜單和價格不是真的，不能點餐。')).toBeNull();
  expect(view.queryByText(UNVERIFIED_CAFETERIA_NOTICE)).toBeNull();
  expect(view.queryByTestId('cafeteria-review-notice')).toBeNull();
  expect(view.queryByText('返回餐廳列表')).toBeNull();
});

test('外連確認頁按鈕與小字同一套文案', async () => {
  const view = render(
    <HonestOrderScreen
      navigation={navigation}
      route={{ params: { cafeteriaId: 'stall', orderingUrl: 'https://shop.example/order' } }}
    />,
  );
  await act(async () => {});
  expect(view.getAllByText('到店家網站訂餐').length).toBeGreaterThan(0);
  expect(view.getByText(caption)).toBeTruthy();
  expect(view.queryByText(/點餐|下單/)).toBeNull();
});

test('storefront always provides a visible back action', async () => {
  jest.mocked(loadStorefront).mockResolvedValueOnce({
    id: 'stall',
    name: '校內咖啡店',
    merchantMode: 'info_only',
    reviewStatus: 'verified',
  } as never);
  const view = render(
    <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'stall' } }} />,
  );
  await act(async () => {});
  fireEvent.press(view.getByLabelText('返回'));
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
});

test('menu search and budget filter combine without treating unknown prices as zero', async () => {
  jest.mocked(loadStorefront).mockResolvedValueOnce({
    id: 'stall',
    name: '校內咖啡店',
    merchantMode: 'info_only',
    reviewStatus: 'verified',
  } as never);
  jest.mocked(loadStorefrontMenus).mockResolvedValueOnce([
    { id: 'tea', name: 'Milk Tea', price: 60 },
    { id: 'latte', name: 'Latte', price: 120 },
    { id: 'cake', name: 'Cake' },
  ]);
  const view = render(
    <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'stall' } }} />,
  );
  await act(async () => {});
  fireEvent.press(view.getByText('100 元內'));
  expect(view.getByText('Milk Tea')).toBeTruthy();
  expect(view.queryByText('Latte')).toBeNull();
  expect(view.queryByText('Cake')).toBeNull();
  fireEvent.changeText(view.getByLabelText('搜尋這間店的餐點'), ' latte ');
  expect(view.getByText('找不到符合的餐點。')).toBeTruthy();
  fireEvent.press(view.getByText('清除篩選'));
  expect(view.getByText('Latte')).toBeTruthy();
  expect(view.getByText('Cake')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('搜尋這間店的餐點'), ' MILK ');
  expect(view.getByText('Milk Tea')).toBeTruthy();
  expect(view.queryByText('Latte')).toBeNull();
});

test('a failed menu read is distinct from an empty menu and can be retried', async () => {
  jest.mocked(loadStorefront).mockResolvedValue({
    id: 'stall',
    name: '校內咖啡店',
    merchantMode: 'info_only',
    reviewStatus: 'verified',
  } as never);
  jest
    .mocked(loadStorefrontMenus)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce([{ id: 'meal', name: '蔬菜吐司', price: 60 }]);
  const view = render(
    <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'stall' } }} />,
  );
  await act(async () => {});
  expect(view.getByText('菜單暫時無法讀取，店家資訊仍可查看。')).toBeTruthy();
  expect(view.queryByText('還沒有菜單。')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('重新讀取菜單')));
  expect(view.getByText('蔬菜吐司')).toBeTruthy();
  expect(view.queryByText('菜單暫時無法讀取，店家資訊仍可查看。')).toBeNull();
});

test('follow failure leaves the previous state and repeated taps do not duplicate the request', async () => {
  jest.mocked(loadStorefront).mockResolvedValueOnce({
    id: 'stall',
    name: '校內咖啡店',
    merchantMode: 'info_only',
    reviewStatus: 'verified',
  } as never);
  let reject!: (reason: Error) => void;
  jest.mocked(followStorefront).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const view = render(
    <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'stall' } }} />,
  );
  await act(async () => {});
  const button = view.getByText('追蹤店家');
  fireEvent.press(button);
  fireEvent.press(button);
  expect(followStorefront).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('offline')));
  expect(view.getByText('追蹤狀態沒有更新，請稍後再試。')).toBeTruthy();
  expect(view.getByText('追蹤店家')).toBeTruthy();
  expect(view.queryByText('取消追蹤')).toBeNull();
});

test('failed comments keep the draft and retry cannot duplicate a pending submission', async () => {
  jest.mocked(loadStorefront).mockResolvedValueOnce({
    id: 'stall',
    name: '校內咖啡店',
    merchantMode: 'info_only',
    reviewStatus: 'verified',
  } as never);
  jest
    .mocked(loadStorefrontPosts)
    .mockResolvedValueOnce([
      { id: 'post', title: '今日消息', text: '今日供應', kind: 'post', liked: false, likeCount: 0 },
    ]);
  let reject!: (reason: Error) => void;
  jest.mocked(addStorefrontComment).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const view = render(
    <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'stall' } }} />,
  );
  await act(async () => {});
  await act(async () => fireEvent.press(view.getByText('店家貼文')));
  fireEvent.changeText(view.getByLabelText('留言內容'), ' 明天有供應嗎？ ');
  const button = view.getByText('送出留言');
  fireEvent.press(button);
  fireEvent.press(button);
  expect(addStorefrontComment).toHaveBeenCalledTimes(1);
  expect(addStorefrontComment).toHaveBeenCalledWith(
    'pu',
    'stall',
    'post',
    'alice',
    '明天有供應嗎？',
  );
  await act(async () => reject(new Error('offline')));
  expect(view.getByLabelText('留言內容').props.value).toBe(' 明天有供應嗎？ ');
  expect(view.getByText('留言沒有送出，內容已保留，請再試一次。')).toBeTruthy();
});

test('changing schools immediately discards the previous shop, posts and search', async () => {
  jest
    .mocked(loadStorefront)
    .mockResolvedValueOnce({
      id: 'stall',
      name: '原學校餐廳',
      merchantMode: 'info_only',
      reviewStatus: 'verified',
    } as never)
    .mockImplementationOnce(() => new Promise(() => {}));
  jest
    .mocked(loadStorefrontMenus)
    .mockResolvedValueOnce([{ id: 'meal', name: '原學校餐點', price: 60 }])
    .mockImplementationOnce(() => new Promise(() => {}));
  jest
    .mocked(loadStorefrontPosts)
    .mockResolvedValueOnce([
      {
        id: 'post',
        title: '原學校消息',
        text: '原學校公告',
        kind: 'post',
        liked: false,
        likeCount: 0,
      },
    ])
    .mockImplementationOnce(() => new Promise(() => {}));
  const view = render(
    <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'stall' } }} />,
  );
  await act(async () => {});
  await act(async () => fireEvent.press(view.getByText('店家貼文')));
  expect(view.getByText('原學校消息')).toBeTruthy();
  mockSchool = { id: 'other' };
  await act(async () =>
    view.rerender(
      <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'stall' } }} />,
    ),
  );
  expect(view.queryByText('原學校消息')).toBeNull();
  expect(view.queryByText('原學校餐點')).toBeNull();
  expect(view.queryByText('原學校餐廳')).toBeNull();
  expect(loadStorefront).toHaveBeenLastCalledWith('other', 'stall');
});

test('switching between menu and posts preserves a comment draft', async () => {
  jest.mocked(loadStorefront).mockResolvedValueOnce({
    id: 'stall',
    name: '校內咖啡店',
    merchantMode: 'info_only',
    reviewStatus: 'verified',
  } as never);
  jest
    .mocked(loadStorefrontPosts)
    .mockResolvedValueOnce([
      { id: 'post', title: '今日消息', text: '今日供應', kind: 'post', liked: false, likeCount: 0 },
    ]);
  const view = render(
    <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'stall' } }} />,
  );
  await act(async () => {});
  fireEvent.press(view.getByText('店家貼文'));
  fireEvent.changeText(view.getByLabelText('留言內容'), '明天有供應嗎？');
  fireEvent.press(view.getByText('菜單'));
  expect(view.queryByLabelText('留言內容')).toBeNull();
  fireEvent.press(view.getByText('店家貼文'));
  expect(view.getByLabelText('留言內容').props.value).toBe('明天有供應嗎？');
});

test('a directly opened storefront returns to restaurants when no previous screen exists', async () => {
  jest.mocked(loadStorefront).mockResolvedValueOnce({
    id: 'stall',
    name: '校內咖啡店',
    merchantMode: 'info_only',
    reviewStatus: 'verified',
  } as never);
  const view = render(
    <StorefrontScreen
      navigation={{ ...navigation, canGoBack: () => false }}
      route={{ params: { cafeteriaId: 'stall' } }}
    />,
  );
  await act(async () => {});
  fireEvent.press(view.getByLabelText('返回'));
  expect(navigation.goBack).not.toHaveBeenCalled();
  expect(navigation.navigate).toHaveBeenCalledWith('Cafeteria');
});
