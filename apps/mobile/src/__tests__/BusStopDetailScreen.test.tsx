import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import { BusStopDetailScreen } from '../screens/BusStopDetailScreen';
import { loadBusRoutes, loadBusArrivals, type BusArrivals } from '../features/campusBus';
import { simulateActiveVehicles } from '../data/campusBusRoutes';
import { scheduleLocalNotification } from '../services/notifications';
import { upsertSavedPlace } from '../services/savedPlaces';

let mockStopId = 'cs-gate-main';
let mockSchool = { id: 'pu' };
let mockUser = { uid: 'student-a' };
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: { stopId: mockStopId } }),
}));
jest.mock('expo-constants', () => ({
  expoConfig: { extra: { appEnv: 'production', isReleaseLike: true } },
}));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/theme', () => ({
  useTheme: () => require('../ui/theme').getCurrentTheme(),
  useThemeMode: () => 'light',
}));
jest.mock('../ui/navigationTheme', () => ({ TAB_BAR_CONTENT_BOTTOM_PADDING: 80 }));
jest.mock('../ui/components', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true,
  default: { currentState: 'background', addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock('../services/analytics', () => ({
  analytics: { logScreenView: jest.fn(), logEvent: jest.fn() },
}));
jest.mock('../services/notifications', () => ({ scheduleLocalNotification: jest.fn() }));
jest.mock('../services/savedPlaces', () => ({ upsertSavedPlace: jest.fn() }));
jest.mock('../data/campusBusRoutes', () => ({
  ...jest.requireActual('../data/campusBusRoutes'),
  simulateActiveVehicles: jest.fn(() => {
    throw new Error('Production must not synthesize vehicles');
  }),
}));
jest.mock('../features/campusBus', () => ({
  BUS_FRESHNESS_MS: 90000,
  TAICHUNG_BUS_URL: 'https://citybus-free.taichung.gov.tw/',
  loadBusRoutes: jest.fn(),
  loadBusArrivals: jest.fn(),
}));

const sourceRoute = (stopId = 'cs-gate-main', city = 'Taichung') => ({
  id: 'published-route',
  name: '300',
  description: '學校發布的路線',
  city,
  stops: [{ id: stopId, name: '官方站牌名稱', order: 0 }],
});
const ready = (): BusArrivals => ({
  status: 'ready',
  fetchedAt: new Date().toISOString(),
  arrivals: [{ routeName: '300', direction: '去程', label: '約 8 分鐘' }],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockStopId = 'cs-gate-main';
  mockSchool = { id: 'pu' };
  mockUser = { uid: 'student-a' };
  jest.mocked(loadBusRoutes).mockResolvedValue([]);
  jest.mocked(loadBusArrivals).mockResolvedValue(ready());
  jest.mocked(upsertSavedPlace).mockResolvedValue(undefined);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('production keeps static stop information but never generates vehicles, ETA or arrival notifications', async () => {
  jest.useFakeTimers();
  const view = render(<BusStopDetailScreen />);
  await act(async () => {});
  expect(view.getByText('正門')).toBeTruthy();
  expect(view.getByText(/站點與路線來源：App 內建參考資料，非即時班表/)).toBeTruthy();
  expect(view.getByText(/本站尚未對應到可查詢的官方站牌/)).toBeTruthy();
  expect(view.getByText(/參考營運時間 07:30-21:00/)).toBeTruthy();
  expect(view.queryByText(/下一班|即將到站|此時段暫無班次/)).toBeNull();
  expect(view.queryByRole('button', { name: /提醒/ })).toBeNull();
  await act(async () => jest.advanceTimersByTime(120000));
  expect(simulateActiveVehicles).not.toHaveBeenCalled();
  expect(loadBusArrivals).not.toHaveBeenCalled();
  expect(scheduleLocalNotification).not.toHaveBeenCalled();
  view.unmount();
  jest.useRealTimers();
});

test('does not guess a station ID from a matching stop name or accept ambiguous cities', async () => {
  jest
    .mocked(loadBusRoutes)
    .mockResolvedValueOnce([
      {
        ...sourceRoute('TDX-real-id'),
        stops: [{ id: 'TDX-real-id', name: '正門', order: 0 }],
      },
    ])
    .mockResolvedValueOnce([sourceRoute(), sourceRoute('cs-gate-main', 'Taipei')]);
  const view = render(<BusStopDetailScreen />);
  await view.findByText(/本站尚未對應到可查詢的官方站牌/);
  expect(loadBusArrivals).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '重新確認站牌' }));
  await view.findByText(/本站尚未對應到可查詢的官方站牌/);
  expect(loadBusArrivals).not.toHaveBeenCalled();
});

test('distinguishes a failed station read from no mapping and retries through the verified arrival service', async () => {
  jest
    .mocked(loadBusRoutes)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce([sourceRoute()]);
  const view = render(<BusStopDetailScreen />);
  await view.findByText(/無法讀取學校發布的站牌資料/);
  expect(view.queryByText(/本站尚未對應到可查詢的官方站牌/)).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '重新確認站牌' }));
  await view.findByText('300 去程 · 約 8 分鐘');
  expect(loadBusArrivals).toHaveBeenCalledWith({
    schoolId: 'pu',
    stopId: 'cs-gate-main',
    city: 'Taichung',
  });
  expect(view.getByText(/交通部 TDX 資料/)).toBeTruthy();
  expect(scheduleLocalNotification).not.toHaveBeenCalled();
});

test('an arrival failure has a working retry and an unverified response never becomes a made-up estimate', async () => {
  jest.mocked(loadBusRoutes).mockResolvedValue([sourceRoute()]);
  jest
    .mocked(loadBusArrivals)
    .mockResolvedValueOnce({ status: 'error', arrivals: [], fetchedAt: null })
    .mockResolvedValueOnce({ status: 'unavailable', arrivals: [], fetchedAt: null })
    .mockResolvedValueOnce(ready());
  const view = render(<BusStopDetailScreen />);
  await view.findByText(/無法連線取得到站資訊/);
  expect(view.queryByText('300 去程 · 約 8 分鐘')).toBeNull();
  fireEvent.press(view.getByText('更新到站資訊'));
  await view.findByText(/目前沒有可確認的即時到站資訊/);
  fireEvent.press(view.getByText('更新到站資訊'));
  await view.findByText('300 去程 · 約 8 分鐘');
  expect(simulateActiveVehicles).not.toHaveBeenCalled();
  expect(scheduleLocalNotification).not.toHaveBeenCalled();
});

test.each(['account', 'school', 'stop'])(
  'drops a late station mapping after the %s changes',
  async (change) => {
    const old = deferred<ReturnType<typeof sourceRoute>[]>();
    jest.mocked(loadBusRoutes).mockReturnValueOnce(old.promise).mockResolvedValueOnce([]);
    const view = render(<BusStopDetailScreen />);
    if (change === 'account') mockUser = { uid: 'student-b' };
    if (change === 'school') mockSchool = { id: 'other' };
    if (change === 'stop') mockStopId = 'cs-jingyuan';
    view.rerender(<BusStopDetailScreen />);
    await act(async () => old.resolve([sourceRoute()]));
    expect(loadBusArrivals).not.toHaveBeenCalled();
    expect(view.queryByText(/交通部 TDX 資料/)).toBeNull();
  },
);

test('drops old arrival data on a station change and expires the newly fetched estimate', async () => {
  jest.useFakeTimers();
  const old = deferred<BusArrivals>();
  jest
    .mocked(loadBusRoutes)
    .mockResolvedValueOnce([sourceRoute()])
    .mockResolvedValueOnce([sourceRoute('cs-jingyuan')]);
  jest.mocked(loadBusArrivals).mockReturnValueOnce(old.promise).mockResolvedValueOnce(ready());
  const view = render(<BusStopDetailScreen />);
  await act(async () => {});
  mockStopId = 'cs-jingyuan';
  view.rerender(<BusStopDetailScreen />);
  await act(async () => {});
  await act(async () =>
    old.resolve({
      ...ready(),
      arrivals: [{ routeName: '舊站牌', direction: '', label: '過期回應' }],
    }),
  );
  expect(view.queryByText(/舊站牌/)).toBeNull();
  expect(view.getByText('300 去程 · 約 8 分鐘')).toBeTruthy();
  await act(async () => jest.advanceTimersByTime(90000));
  expect(view.queryByText('300 去程 · 約 8 分鐘')).toBeNull();
  expect(view.getByText(/目前沒有可確認的即時到站資訊/)).toBeTruthy();
  expect(scheduleLocalNotification).not.toHaveBeenCalled();
  view.unmount();
  jest.useRealTimers();
});

test('keeps map and saved-place actions and can retry a failed official-site launch', async () => {
  jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('unavailable'));
  const view = render(<BusStopDetailScreen />);
  await view.findByText(/本站尚未對應到可查詢的官方站牌/);
  fireEvent.press(view.getByRole('button', { name: '在地圖上查看' }));
  expect(mockNavigate).toHaveBeenCalledWith('MapV2', { focusLat: 24.22495, focusLng: 120.56535 });
  fireEvent.press(view.getByRole('button', { name: '儲存' }));
  await act(async () => {});
  expect(upsertSavedPlace).toHaveBeenCalledWith(
    'student-a',
    expect.objectContaining({ id: 'busstop-cs-gate-main', name: '正門' }),
  );
  fireEvent.press(view.getByRole('button', { name: '開啟官方公車查詢' }));
  await view.findByText(/無法開啟公車網站/);
  fireEvent.press(view.getByRole('button', { name: '開啟官方公車查詢' }));
  await act(async () => {});
  expect(view.queryByText(/無法開啟公車網站/)).toBeNull();
  expect(Linking.openURL).toHaveBeenCalledTimes(2);
  expect(scheduleLocalNotification).not.toHaveBeenCalled();
});
