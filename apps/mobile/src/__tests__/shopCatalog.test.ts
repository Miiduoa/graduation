import AsyncStorage from '@react-native-async-storage/async-storage';
import { isFirebaseMockMode } from '../firebase';
import {
  loadShopHours,
  saveShopHours,
  saveShopMenuItem,
  loadShopMenu,
  saveShopStorefront,
  loadShopStorefront,
} from '../services/shopCatalog';

jest.mock('../firebase', () => ({
  getDb: jest.fn(),
  isFirebaseMockMode: jest.fn(() => true),
}));

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(isFirebaseMockMode).mockReturnValue(true);
});

test('shop hours and menu stay on this device when Firebase is mock mode', async () => {
  const hours = await saveShopHours({
    schoolId: 'pu',
    cafeteriaId: 'cafe-1',
    openingHours: '週一至週五 11:00–19:00',
  });
  expect(hours.stored).toBe('local');
  expect((await loadShopHours('pu', 'cafe-1')).openingHours).toBe('週一至週五 11:00–19:00');

  const saved = await saveShopMenuItem({
    schoolId: 'pu',
    cafeteriaId: 'cafe-1',
    cafeteriaName: '第一餐廳',
    item: { id: 'menu_1', name: '滷肉飯', price: 70, soldOut: false },
  });
  expect(saved.stored).toBe('local');
  expect(await loadShopMenu('pu', 'cafe-1')).toEqual([
    { id: 'menu_1', name: '滷肉飯', price: 70, soldOut: false },
  ]);
});

test('storefront URLs trim surrounding spaces and reject unsafe values before saving', async () => {
  const saved = await saveShopStorefront({
    schoolId: 'pu',
    cafeteriaId: 'cafe-1',
    storefront: {
      openingHours: '11:00–14:00',
      intro: '',
      location: '學生餐廳',
      websiteUrl: '  https://shop.example  ',
      orderingUrl: '  https://shop.example/order  ',
      merchantMode: 'showcase_link',
    },
  });
  expect(saved.stored).toBe('local');
  await expect(loadShopStorefront('pu', 'cafe-1')).resolves.toMatchObject({
    websiteUrl: 'https://shop.example',
    orderingUrl: 'https://shop.example/order',
  });
  await expect(
    saveShopStorefront({
      schoolId: 'pu',
      cafeteriaId: 'cafe-1',
      storefront: {
        openingHours: '',
        intro: '',
        location: '',
        websiteUrl: 'http://shop.example',
        orderingUrl: '',
        merchantMode: 'info_only',
      },
    }),
  ).rejects.toThrow('請貼 https:// 開頭的網址');
  await expect(
    saveShopStorefront({
      schoolId: 'pu',
      cafeteriaId: 'cafe-1',
      storefront: {
        openingHours: '',
        intro: '',
        location: '',
        websiteUrl: '',
        orderingUrl: 'https://user:pass@shop.example/order',
        merchantMode: 'showcase_link',
      },
    }),
  ).rejects.toThrow('網址裡不能有帳號或密碼');
  await expect(
    saveShopStorefront({
      schoolId: 'pu',
      cafeteriaId: 'cafe-1',
      storefront: {
        openingHours: '',
        intro: '',
        location: '',
        websiteUrl: `https://shop.example/${'a'.repeat(500)}`,
        orderingUrl: '',
        merchantMode: 'info_only',
      },
    }),
  ).rejects.toThrow('網址太長，請改用店家網站首頁或訂餐頁的網址');
});
