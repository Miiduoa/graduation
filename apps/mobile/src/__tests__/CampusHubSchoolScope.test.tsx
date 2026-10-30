import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CampusHubScreen } from '../screens/CampusHubScreen';
import { safeNavigate } from '../utils/safeNavigate';

let mockSchool = { id: 'pu', name: '靜宜大學' };
const mockSetSelection = jest.fn();
let mockPaymentsEnabled = false;
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: mockSchool, setSelection: mockSetSelection }),
}));
jest.mock('../services/release', () => ({ isFeatureEnabled: () => mockPaymentsEnabled }));
jest.mock('../services/schoolDirectory', () => ({
  fetchSchoolDirectory: jest.fn(async () => [
    { id: 'pu', code: 'PU', name: '靜宜大學' },
    { id: 'nthu', code: 'NTHU', name: '國立清華大學' },
  ]),
}));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
jest.mock('../components/HeaderAvatarButton', () => ({ HeaderAvatarButton: () => null }));
jest.mock('../components/OpenOrderCard', () => ({ OpenOrderCard: () => null }));
jest.mock('../app/rootNavigation', () => ({ rootNavigateNested: jest.fn() }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../ui/AppActionIcon', () => ({ AppActionIcon: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  mockSchool = { id: 'pu', name: '靜宜大學' };
  mockPaymentsEnabled = false;
});

test.each(['住宿', '宿舍', '職涯', '實習', '入住', '就業'])(
  'campus home reaches current school information when looking for %s',
  (keyword) => {
    const navigation = { navigate: jest.fn() };
    const view = render(<CampusHubScreen navigation={navigation} />);
    fireEvent.changeText(view.getByPlaceholderText('搜尋地點或服務'), keyword);
    fireEvent.press(view.getByText('學校資訊'));
    expect(safeNavigate).toHaveBeenCalledWith(navigation, 'SchoolInfo', undefined, {
      fallbackMessage: '「學校資訊」目前無法開啟。',
    });
  },
);

test('Taichung-specific transport entry is only available in its original PU context', () => {
  const view = render(<CampusHubScreen />);
  expect(view.getByText('台中交通')).toBeTruthy();
  mockSchool = { id: 'nthu', name: '國立清華大學' };
  view.rerender(<CampusHubScreen />);
  expect(view.queryByText('台中交通')).toBeNull();
  expect(view.getByText('國立清華大學')).toBeTruthy();
  expect(view.getByText('圖書館')).toBeTruthy();
});

test('closed modules stay out of the directory while official information has clear entries', () => {
  const view = render(<CampusHubScreen />);
  expect(view.getByText('宿舍')).toBeTruthy();
  expect(view.queryByText('職涯')).toBeNull();
  expect(view.queryByText('社團')).toBeNull();
  expect(view.queryByText('校園錢包')).toBeNull();
  expect(view.queryByText('報修')).toBeNull();
  expect(view.queryByText('住宿資訊')).toBeNull();
  expect(view.queryByText('職涯資訊')).toBeNull();
  expect(view.getByText('學校資訊')).toBeTruthy();
});

test('frequent services open their actual routes without duplicate map entries', () => {
  const navigation = { navigate: jest.fn() };
  const view = render(<CampusHubScreen navigation={navigation} />);
  expect(view.getAllByText('校園地圖')).toHaveLength(1);
  fireEvent.press(view.getByTestId('e2e-campus-open-map'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'MapV2', undefined, expect.any(Object));
  fireEvent.press(view.getByText('學校資訊'));
  expect(safeNavigate).toHaveBeenLastCalledWith(
    navigation,
    'SchoolInfo',
    undefined,
    expect.any(Object),
  );
});

test('the compact school control opens the picker directly from campus services', async () => {
  const view = render(<CampusHubScreen />);
  fireEvent.press(view.getByRole('button', { name: '目前瀏覽靜宜大學，選擇其他學校' }));
  fireEvent.press(await view.findByRole('button', { name: '選擇國立清華大學' }));
  expect(mockSetSelection).toHaveBeenCalledWith(
    expect.objectContaining({ schoolId: 'nthu', code: 'NTHU' }),
  );
});

test('clearing an empty search restores the complete service directory', () => {
  const view = render(<CampusHubScreen />);
  fireEvent.changeText(view.getByPlaceholderText('搜尋地點或服務'), '不存在的服務');
  expect(view.getByText('找不到「不存在的服務」相關的服務')).toBeTruthy();
  expect(view.queryByText('校園地圖')).toBeNull();
  fireEvent.press(view.getByText('查看所有服務'));
  expect(view.getByText('校園地圖')).toBeTruthy();
});

test('changing school resets the search and regional service matches', () => {
  const view = render(<CampusHubScreen />);
  fireEvent.changeText(view.getByPlaceholderText('搜尋地點或服務'), '高鐵');
  expect(view.getByText('台中交通')).toBeTruthy();
  mockSchool = { id: 'nthu', name: '國立清華大學' };
  view.rerender(<CampusHubScreen />);
  expect(view.getByPlaceholderText('搜尋地點或服務').props.value).toBe('');
  expect(view.queryByText('台中交通')).toBeNull();
  expect(view.getByText('校園地圖')).toBeTruthy();
});

test('the wallet is offered only when payments are available', () => {
  mockPaymentsEnabled = true;
  const view = render(<CampusHubScreen />);
  expect(view.getByText('校園錢包')).toBeTruthy();
});

test('another school does not expose Providence-specific library search keywords', () => {
  mockSchool = { id: 'nthu', name: '國立清華大學' };
  const view = render(<CampusHubScreen />);
  fireEvent.changeText(view.getByPlaceholderText('搜尋地點或服務'), '蓋夏');
  expect(view.queryByText('圖書館')).toBeNull();
  fireEvent.changeText(view.getByPlaceholderText('搜尋地點或服務'), '圖書館');
  expect(view.getByText('圖書館')).toBeTruthy();
});

test('dormitory opens its own workspace and repair search finds it directly', () => {
  const navigation = { navigate: jest.fn() };
  const view = render(<CampusHubScreen navigation={navigation} />);
  fireEvent.changeText(view.getByPlaceholderText('搜尋地點或服務'), '報修');
  expect(view.getByText('宿舍')).toBeTruthy();
  fireEvent.press(view.getByText('宿舍'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'Dormitory', undefined, {
    fallbackMessage: '「宿舍」目前無法開啟。',
  });
});

test('natural-language directions offer the actual map rather than a dead-end empty search', () => {
  const navigation = { navigate: jest.fn() };
  const view = render(<CampusHubScreen navigation={navigation} />);
  fireEvent.changeText(view.getByPlaceholderText('搜尋地點或服務'), '圖書館怎麼走');
  fireEvent.press(view.getByLabelText('依需求前往校園地圖'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'MapV2', undefined, {
    fallbackMessage: '目前無法開啟對應服務，請稍後重試。',
  });
});

test('when the ordinary service list matches, it does not duplicate the same destination', () => {
  const view = render(<CampusHubScreen />);
  fireEvent.changeText(view.getByPlaceholderText('搜尋地點或服務'), '宿舍');
  expect(view.getAllByText('宿舍')).toHaveLength(1);
  expect(view.queryByLabelText('依需求前往宿舍')).toBeNull();
});


test('course shortcuts select the courses tab in the native workspace', () => {
  const navigation = { navigate: jest.fn() };
  const view = render(<CampusHubScreen navigation={navigation} />);
  fireEvent.changeText(view.getByPlaceholderText('搜尋地點或服務'), '我要交作業');
  fireEvent.press(view.getByLabelText('依需求前往課程與作業'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'NuniWorkspace', { tab: 'courses' }, {
    fallbackMessage: '目前無法開啟對應服務，請稍後重試。',
  });
});
