import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { saveShopStorefront } from '../services/shopCatalog';

jest.mock('../state/auth', () => ({
  useAuth: () => ({
    user: { uid: 'shop-a' },
    profile: {
      role: 'vendor',
      merchantAssignments: [
        { status: 'active', schoolId: 'pu', cafeteriaId: 'cafe', cafeteriaName: '校園餐廳' },
      ],
    },
  }),
}));
jest.mock('../hooks/useMerchantOrders', () => ({
  useMerchantOrders: () => ({ loading: false, error: null, orders: [] }),
}));
jest.mock('../screens/MerchantHubScreen', () => ({
  MerchantHubScreen: () => null,
}));
jest.mock('../services/demoSession', () => ({
  shouldBlockForNoLogin: () => false,
  isDemoUid: () => false,
}));
jest.mock('../services/shopCatalog', () => ({
  createShopPost: jest.fn(),
  deleteShopMenuItem: jest.fn(),
  loadShopHours: jest.fn(async () => ({})),
  loadShopMenu: jest.fn(async () => []),
  loadShopStorefront: jest.fn(async () => ({
    openingHours: '11:00–14:00',
    intro: '',
    location: '學生餐廳',
    websiteUrl: '',
    orderingUrl: '',
    merchantMode: 'info_only',
  })),
  saveShopHours: jest.fn(),
  saveShopMenuItem: jest.fn(),
  saveShopStorefront: jest.fn(async () => ({ stored: 'cloud' })),
}));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import ShopDockScreen from '../screens/ShopDockScreen';

beforeEach(() => {
  jest.mocked(saveShopStorefront).mockClear();
  jest.mocked(saveShopStorefront).mockResolvedValue({ stored: 'cloud' });
});

async function openHours() {
  const view = render(<ShopDockScreen />);
  await act(async () => {});
  fireEvent.press(view.getByText('營業'));
  await act(async () => {});
  return view;
}

test('外連與網站網址先去掉前後空白再存，不報錯', async () => {
  const view = await openHours();
  fireEvent.changeText(view.getByPlaceholderText('外連訂餐網址（https，選填）'), '  https://shop.example/order  ');
  fireEvent.press(view.getByText('儲存店面'));
  await act(async () => {});
  expect(saveShopStorefront).toHaveBeenCalledWith(
    expect.objectContaining({
      storefront: expect.objectContaining({ orderingUrl: '  https://shop.example/order  ' }),
    }),
  );
  expect(view.getByText('店面資料已更新。')).toBeTruthy();
});

test('不是 https 的網址不能存，錯誤出現在店家網站欄位下', async () => {
  const view = await openHours();
  fireEvent.changeText(view.getByPlaceholderText('店家網站（https）'), 'http://shop.example');
  fireEvent.press(view.getByText('儲存店面'));
  expect(saveShopStorefront).not.toHaveBeenCalled();
  expect(within(view.getByTestId('website-field')).getByText('請貼 https:// 開頭的網址')).toBeTruthy();
  expect(within(view.getByTestId('ordering-field')).queryByText('請貼 https:// 開頭的網址')).toBeNull();
});

test('帶帳密的網址不能存，錯誤出現在外連欄位下', async () => {
  const view = await openHours();
  fireEvent.changeText(
    view.getByPlaceholderText('外連訂餐網址（https，選填）'),
    'https://user:pass@shop.example/order',
  );
  fireEvent.press(view.getByText('儲存店面'));
  expect(saveShopStorefront).not.toHaveBeenCalled();
  expect(within(view.getByTestId('ordering-field')).getByText('網址裡不能有帳號或密碼')).toBeTruthy();
  expect(within(view.getByTestId('website-field')).queryByText('網址裡不能有帳號或密碼')).toBeNull();
});

test('javascript、帳號網址和 data 都不能存，錯誤在店家網站欄位下', async () => {
  const view = await openHours();
  fireEvent.changeText(view.getByPlaceholderText('店家網站（https）'), 'javascript:alert(1)');
  fireEvent.press(view.getByText('儲存店面'));
  expect(saveShopStorefront).not.toHaveBeenCalled();
  expect(within(view.getByTestId('website-field')).getByText('請貼 https:// 開頭的網址')).toBeTruthy();
  fireEvent.changeText(view.getByPlaceholderText('店家網站（https）'), 'https://a@evil.com');
  fireEvent.press(view.getByText('儲存店面'));
  expect(saveShopStorefront).not.toHaveBeenCalled();
  expect(within(view.getByTestId('website-field')).getByText('網址裡不能有帳號或密碼')).toBeTruthy();
  fireEvent.changeText(view.getByPlaceholderText('店家網站（https）'), 'data:text/html,hi');
  fireEvent.press(view.getByText('儲存店面'));
  expect(saveShopStorefront).not.toHaveBeenCalled();
  expect(within(view.getByTestId('website-field')).getByText('請貼 https:// 開頭的網址')).toBeTruthy();
});

test('太長的網址不能存，錯誤出現在店家網站欄位下', async () => {
  const view = await openHours();
  fireEvent.changeText(
    view.getByPlaceholderText('店家網站（https）'),
    `https://shop.example/${'a'.repeat(2048)}`,
  );
  fireEvent.press(view.getByText('儲存店面'));
  expect(saveShopStorefront).not.toHaveBeenCalled();
  expect(
    within(view.getByTestId('website-field')).getByText('網址太長，請改用店家網站首頁或訂餐頁的網址'),
  ).toBeTruthy();
});

test('大寫 HTTPS 可以存，NUL 的錯誤在該欄位下', async () => {
  const view = await openHours();
  fireEvent.changeText(view.getByPlaceholderText('店家網站（https）'), 'HTTPS://shop.example');
  fireEvent.press(view.getByText('儲存店面'));
  expect(saveShopStorefront).toHaveBeenCalled();
  expect(within(view.getByTestId('website-field')).queryByText('請貼 https:// 開頭的網址')).toBeNull();
  jest.mocked(saveShopStorefront).mockClear();
  fireEvent.changeText(view.getByPlaceholderText('店家網站（https）'), 'https://shop.example/\u0000');
  fireEvent.press(view.getByText('儲存店面'));
  expect(saveShopStorefront).not.toHaveBeenCalled();
  expect(
    within(view.getByTestId('website-field')).getByText('請貼 https:// 開頭的網址'),
  ).toBeTruthy();
});
