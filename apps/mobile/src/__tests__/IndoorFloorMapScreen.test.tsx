import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { IndoorFloorMapScreen } from '../screens/IndoorFloorMapScreen';

let mockSchool = { id: 'pu', name: '靜宜大學' };
let mockParams: Record<string, unknown> = {};

jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSchool = { id: 'pu', name: '靜宜大學' };
  mockParams = {};
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

test('never reuses a Providence indoor plan when another campus has no verified floor plan', () => {
  mockSchool = { id: 'nthu', name: '國立清華大學' };
  mockParams = { buildingId: 'lib' };
  const view = render(<IndoorFloorMapScreen />);
  expect(view.getByText('尚未提供可核對的室內平面圖')).toBeTruthy();
  expect(view.getByText(/國立清華大學目前沒有這個建築/)).toBeTruthy();
  expect(view.queryByText(/蓋夏圖書館 · 官方樓層資訊/)).toBeNull();
  expect(Linking.openURL).not.toHaveBeenCalled();
});

test('does not invent a default library when the building identity is unknown', () => {
  mockParams = { buildingId: 'unverified-building' };
  const view = render(<IndoorFloorMapScreen />);
  expect(view.getByText('尚未提供可核對的室內平面圖')).toBeTruthy();
  expect(view.queryByText('B1 · 期刊、咖啡與資訊檢索')).toBeNull();
});

test('shows only floor allocations published by the Providence University library', () => {
  mockParams = { poiId: 'pu-library' };
  const view = render(<IndoorFloorMapScreen />);
  expect(view.getByText('蓋夏圖書館 · 官方樓層資訊')).toBeTruthy();
  expect(view.getByText('B2 · 期刊與自習')).toBeTruthy();
  expect(view.getByText('10F · 蓋夏廳與行政辦公')).toBeTruthy();
  expect(view.queryByText(/即時人潮|尚有座位|已抵達|模擬導航/)).toBeNull();
  fireEvent.changeText(view.getByLabelText('搜尋樓層與設施'), '影印');
  expect(view.getByText('B1 · 期刊、咖啡與資訊檢索')).toBeTruthy();
  expect(view.getByText('1F · 流通與參考服務')).toBeTruthy();
  expect(view.queryByText('10F · 蓋夏廳與行政辦公')).toBeNull();
  fireEvent.press(view.getByText('清除樓層搜尋'));
  expect(view.getByText('10F · 蓋夏廳與行政辦公')).toBeTruthy();
});

test('opens the genuine official guide only after user action and reports failures', async () => {
  mockParams = { buildingId: 'lib', floorId: 'lib-b1' };
  const view = render(<IndoorFloorMapScreen />);
  expect(view.getByText('B1 · 期刊、咖啡與資訊檢索')).toBeTruthy();
  expect(view.queryByText('B2 · 期刊與自習')).toBeNull();
  expect(Linking.openURL).not.toHaveBeenCalled();
  jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('offline'));
  fireEvent.press(view.getByText('開啟圖書館官方樓層導覽'));
  await waitFor(() => expect(view.getByText(/無法開啟校方樓層導覽/)).toBeTruthy());
  fireEvent.press(view.getByText('開啟圖書館官方樓層導覽'));
  await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(
    'https://b028.pu.edu.tw/p/426-1054-34.php?Lang=zh-tw',
  ));
});
