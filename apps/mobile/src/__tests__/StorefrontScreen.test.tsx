import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import StorefrontScreen from '../screens/StorefrontScreen';
import HonestOrderScreen from '../screens/HonestOrderScreen';
import {
  loadStorefront,
  loadStorefrontMenus,
  loadStorefrontPosts,
  isFollowingStorefront,
  loadStorefrontComments,
} from '../services/storefront';

const navigation = { navigate: jest.fn(), goBack: jest.fn() };
let mockUser: { uid: string } | null = { uid: 'alice' };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'pu' } }) }));
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
  jest.mocked(loadStorefrontMenus).mockResolvedValue([
    { id: 'meal', name: '蔬菜吐司', price: 60 },
  ] as never);
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
  expect(await view.findByText('蔬菜吐司 · NT$60')).toBeTruthy();
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
  jest.mocked(loadStorefrontMenus).mockResolvedValue([
    { id: 'meal', name: '蔬菜吐司', price: 60 },
  ] as never);
  jest.mocked(loadStorefrontPosts).mockRejectedValueOnce(
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
  expect(await view.findByText('蔬菜吐司 · NT$60')).toBeTruthy();
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
  } as never);
  const view = render(
    <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'stall' } }} />,
  );
  expect(await view.findByText('到店家網站訂餐')).toBeTruthy();
  expect(view.getByText(caption)).toBeTruthy();
  expect(view.queryByText(/點餐|下單/)).toBeNull();
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
  } as never);
  const view = render(
    <StorefrontScreen navigation={navigation} route={{ params: { cafeteriaId: 'stall' } }} />,
  );
  expect(await view.findByText('活動中心 · 週一到週五')).toBeTruthy();
  expect(view.queryByText('到店家網站訂餐')).toBeNull();
  expect(view.queryByText(caption)).toBeNull();
  expect(view.queryByText(/點餐|下單/)).toBeNull();
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
    hidden: '這間店的菜單和價格還沒跟店家核對過，可能跟現場不一樣，目前不能點餐。',
  },
  {
    reviewStatus: 'unverified' as const,
    notice: '這間店的菜單和價格還沒跟店家核對過，可能跟現場不一樣，目前不能點餐。',
    hidden: '這是示範店家，菜單和價格不是真的，不能點餐。',
  },
  {
    reviewStatus: undefined,
    notice: '這間店的菜單和價格還沒跟店家核對過，可能跟現場不一樣，目前不能點餐。',
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
  expect(
    view.queryByText('這間店的菜單和價格還沒跟店家核對過，可能跟現場不一樣，目前不能點餐。'),
  ).toBeNull();
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
