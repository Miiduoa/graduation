import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import StorefrontScreen from '../screens/StorefrontScreen';
import HonestOrderScreen from '../screens/HonestOrderScreen';
import { loadStorefront, loadStorefrontPosts, isFollowingStorefront } from '../services/storefront';

const navigation = { navigate: jest.fn(), goBack: jest.fn() };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: 'alice' } }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'pu' } }) }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../services/storefront', () => ({
  loadStorefront: jest.fn(),
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
  jest.mocked(loadStorefrontPosts).mockResolvedValue([]);
  jest.mocked(isFollowingStorefront).mockResolvedValue(false);
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

test('不合格外連不當成按鈕，也不打開店家網站', async () => {
  const unsafe = [
    'javascript:alert(1)',
    'https://a@evil.com',
    `https://shop.example/${'a'.repeat(2048)}`,
    ' https://shop.example/order',
    'https://shop.example/order ',
    'http://shop.example/order',
    'data:text/html,hi',
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
