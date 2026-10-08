import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import BusScreen from '../screens/BusAiFirstScreen';
import { loadBusRoutes, loadBusArrivals, type BusArrivals } from '../features/campusBus';
let mockSchool = { id: 'pu' };
let mockUser = { uid: 'first' };
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').getCurrentTheme() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true,
  default: { currentState: 'background', addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock('../features/campusBus', () => ({
  BUS_FRESHNESS_MS: 90000,
  TAICHUNG_BUS_URL: 'https://citybus-free.taichung.gov.tw/',
  loadBusRoutes: jest.fn(),
  loadBusArrivals: jest.fn(),
}));
const routes = [
  {
    id: 'route',
    name: '300',
    description: '來源路線',
    city: 'Taichung',
    stops: [
      { id: 'stop-a', name: '校門', order: 0 },
      { id: 'stop-b', name: '第二站', order: 1 },
    ],
  },
];
const ready = (): BusArrivals => ({
  status: 'ready',
  fetchedAt: new Date().toISOString(),
  arrivals: [{ routeName: '300', direction: '去程', label: '約 8 分鐘' }],
});
beforeEach(() => {
  jest.clearAllMocks();
  mockSchool = { id: 'pu' };
  mockUser = { uid: 'first' };
  jest.mocked(loadBusRoutes).mockResolvedValue(routes);
  jest.mocked(loadBusArrivals).mockResolvedValue(ready());
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
test('shows source routes and arrivals without a fake timetable or reminder', async () => {
  const view = render(<BusScreen />);
  await view.findByText('校門 · 查到站');
  expect(view.queryByText(/14:20|32 分鐘|設定提醒|乘車紀錄/)).toBeNull();
  await act(async () => fireEvent.press(view.getByText('校門 · 查到站')));
  expect(loadBusArrivals).toHaveBeenCalledWith({
    schoolId: 'pu',
    stopId: 'stop-a',
    city: 'Taichung',
  });
  expect(view.getByText('300 去程 · 約 8 分鐘')).toBeTruthy();
});
test('distinguishes route failure, retry and confirmed emptiness', async () => {
  jest.mocked(loadBusRoutes).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
  const view = render(<BusScreen />);
  await view.findByText('無法讀取公車路線');
  expect(view.queryByText('尚未提供公車路線')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('重新讀取路線')));
  expect(view.getByText('尚未提供公車路線')).toBeTruthy();
});
test('drops late arrivals after another stop or account becomes current', async () => {
  let resolve!: (value: BusArrivals) => void;
  jest.mocked(loadBusArrivals).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = render(<BusScreen />);
  await view.findByText('校門 · 查到站');
  fireEvent.press(view.getByText('校門 · 查到站'));
  await act(async () => fireEvent.press(view.getByText('第二站 · 查到站')));
  await act(async () =>
    resolve({
      status: 'ready',
      fetchedAt: new Date().toISOString(),
      arrivals: [{ routeName: '過期站牌', direction: '', label: '舊資料' }],
    }),
  );
  expect(view.queryByText(/過期站牌/)).toBeNull();
  mockUser = { uid: 'second' };
  view.rerender(<BusScreen />);
  expect(view.queryByText('第二站 到站資訊')).toBeNull();
  await act(async () => {});
});
test('discards route responses across schools and recovers official-link failure', async () => {
  let resolve!: (value: typeof routes) => void;
  jest
    .mocked(loadBusRoutes)
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    )
    .mockResolvedValueOnce([]);
  const view = render(<BusScreen />);
  jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('offline'));
  await act(async () => fireEvent.press(view.getByText('開啟官方公車查詢')));
  expect(view.getByText(/無法開啟公車網站/)).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('開啟官方公車查詢')));
  expect(view.queryByText(/無法開啟公車網站/)).toBeNull();
  mockSchool = { id: 'other' };
  view.rerender(<BusScreen />);
  await act(async () => resolve(routes));
  expect(view.queryByText('校門 · 查到站')).toBeNull();
  expect(view.queryByText('開啟官方公車查詢')).toBeNull();
});
test('expires stale estimates while background polling is paused', async () => {
  jest.useFakeTimers();
  const view = render(<BusScreen />);
  await act(async () => {});
  await act(async () => fireEvent.press(view.getByText('校門 · 查到站')));
  expect(view.getByText('300 去程 · 約 8 分鐘')).toBeTruthy();
  await act(async () => jest.advanceTimersByTime(90000));
  expect(view.queryByText('300 去程 · 約 8 分鐘')).toBeNull();
  expect(view.getByText(/目前沒有可確認的即時到站資訊/)).toBeTruthy();
  view.unmount();
  jest.useRealTimers();
});
