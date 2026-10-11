import AsyncStorage from '@react-native-async-storage/async-storage';
import { isFirebaseMockMode } from '../firebase';
import { loadShopHours, saveShopHours, saveShopMenuItem, loadShopMenu } from '../services/shopCatalog';

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
