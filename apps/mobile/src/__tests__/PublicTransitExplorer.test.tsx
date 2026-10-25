import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { AppState, Linking, View } from 'react-native';
import { PublicTransitExplorer } from '../components/PublicTransitExplorer';
import {
  queryPublicTransit,
  TAICHUNG_BUS_CATALOG_SOURCE,
  TAICHUNG_BUS_OFFICIAL,
  type PublicTransitResult,
} from '../features/publicTransit';

jest.mock('../features/publicTransit', () => ({
  ...jest.requireActual('../features/publicTransit'),
  queryPublicTransit: jest.fn(),
}));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));
jest.mock('../state/theme', () => ({
  useTheme: () => require('../ui/theme').getCurrentTheme(),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true,
  default: { currentState: 'background', addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

const stop = { id: 'HSZ001', name: '清華大學', city: 'Hsinchu' as const,
  lat: 24.8, lon: 120.99, distance: null };
const fetchedAt = () => new Date().toISOString();
const result = (): PublicTransitResult => ({
  status: 'ready', kind: 'stops', stops: [stop], limited: false, fetchedAt: fetchedAt(),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(queryPublicTransit).mockResolvedValue(result());
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({
    status: 'granted',
  } as Location.LocationPermissionResponse);
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue({
    coords: { latitude: 24.8, longitude: 120.99, accuracy: 20 },
  } as Location.LocationObject);
});

test('search uses this university city without requesting GPS or querying Taichung', async () => {
  const view = render(<PublicTransitExplorer schoolId="nthu" schoolName="國立清華大學" />);
  expect(view.getByText('查詢縣市：新竹市')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('搜尋公車站名'), '清華大學');
  await act(async () => fireEvent.press(view.getByText('搜尋官方站牌')));
  expect(queryPublicTransit).toHaveBeenCalledWith(
    { action: 'search', city: 'Hsinchu', text: '清華大學' },
    expect.any(AbortSignal),
  );
  expect(view.getByText('清華大學（HSZ001）')).toBeTruthy();
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});

test('unrecognized campuses must select a city before searching, never defaulting to Taichung', async () => {
  const view = render(<PublicTransitExplorer schoolId="unlisted-campus" schoolName="新校園" />);
  fireEvent.changeText(view.getByLabelText('搜尋公車站名'), '學校門口');
  fireEvent.press(view.getByText('搜尋官方站牌'));
  expect(view.getByText('請先選擇要查詢的縣市。')).toBeTruthy();
  expect(queryPublicTransit).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('選擇查詢縣市'));
  fireEvent.press(view.getByLabelText('選擇臺南市'));
  await act(async () => fireEvent.press(view.getByText('搜尋官方站牌')));
  expect(queryPublicTransit).toHaveBeenCalledWith(
    { action: 'search', city: 'Tainan', text: '學校門口' },
    expect.any(AbortSignal),
  );
});

test('geolocation is requested only after permission-aware user action', async () => {
  const view = render(<PublicTransitExplorer schoolId="nthu" schoolName="清華大學" />);
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('用我的位置找附近站牌')));
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(queryPublicTransit).toHaveBeenCalledWith(
    { action: 'nearby', city: 'Hsinchu', lat: 24.8, lon: 120.99, radius: 600 },
    expect.any(AbortSignal),
  );
});

test('denied location never guesses a school coordinate and still permits station searches', async () => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValueOnce({
    status: 'denied',
  } as Location.LocationPermissionResponse);
  const view = render(<PublicTransitExplorer schoolId="nthu" />);
  await act(async () => fireEvent.press(view.getByText('用我的位置找附近站牌')));
  expect(view.getByText(/尚未授權定位/)).toBeTruthy();
  expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  expect(queryPublicTransit).not.toHaveBeenCalled();
});

test('station search cancels a pending permission request before GPS is started', async () => {
  const permission = deferred<Location.LocationPermissionResponse>();
  jest.mocked(Location.requestForegroundPermissionsAsync).mockReturnValueOnce(permission.promise);
  const view = render(<PublicTransitExplorer schoolId="nthu" />);
  await act(async () => fireEvent.press(view.getByText('用我的位置找附近站牌')));
  expect(view.getByText('正在確認位置…')).toBeTruthy();

  fireEvent.changeText(view.getByLabelText('搜尋公車站名'), '清華大學');
  await act(async () => fireEvent.press(view.getByText('搜尋官方站牌')));
  expect(view.queryByText('正在確認位置…')).toBeNull();
  await act(async () => permission.resolve({ status: 'granted' } as Location.LocationPermissionResponse));

  expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  expect(queryPublicTransit).toHaveBeenCalledTimes(1);
  expect(view.getByText('清華大學（HSZ001）')).toBeTruthy();
});

test.each(['resolved', 'rejected'] as const)('late %s GPS cannot replace a newer station search', async (outcome) => {
  const position = deferred<Location.LocationObject>();
  jest.mocked(Location.getCurrentPositionAsync).mockReturnValueOnce(position.promise);
  const view = render(<PublicTransitExplorer schoolId="nthu" />);
  await act(async () => fireEvent.press(view.getByText('用我的位置找附近站牌')));
  expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);

  fireEvent.changeText(view.getByLabelText('搜尋公車站名'), '清華大學');
  await act(async () => fireEvent.press(view.getByText('搜尋官方站牌')));
  await act(async () => {
    if (outcome === 'resolved') {
      position.resolve({ coords: { latitude: 24.8, longitude: 120.99, accuracy: 900 } } as Location.LocationObject);
    } else {
      position.reject(new Error('GPS unavailable'));
    }
  });

  expect(queryPublicTransit).toHaveBeenCalledTimes(1);
  expect(view.getByText('清華大學（HSZ001）')).toBeTruthy();
  expect(view.queryByText('正在確認位置…')).toBeNull();
  expect(view.queryByText(/無法取得位置/)).toBeNull();
  expect(view.queryByText(/定位誤差偏大/)).toBeNull();
});

test('cancel location stops the busy state and ignores the later coordinates', async () => {
  const position = deferred<Location.LocationObject>();
  jest.mocked(Location.getCurrentPositionAsync).mockReturnValueOnce(position.promise);
  const view = render(<PublicTransitExplorer schoolId="nthu" />);
  await act(async () => fireEvent.press(view.getByText('用我的位置找附近站牌')));
  fireEvent.press(view.getByText('取消定位'));
  expect(view.queryByText('正在確認位置…')).toBeNull();
  expect(view.getByText('已取消定位，仍可搜尋站名。')).toBeTruthy();
  await act(async () => position.resolve({
    coords: { latitude: 24.8, longitude: 120.99, accuracy: 20 },
  } as Location.LocationObject));
  expect(queryPublicTransit).not.toHaveBeenCalled();
});

test('a stalled GPS attempt times out and a new attempt can complete without old results', async () => {
  jest.useFakeTimers();
  const position = deferred<Location.LocationObject>();
  jest.mocked(Location.getCurrentPositionAsync).mockReturnValueOnce(position.promise);
  const view = render(<PublicTransitExplorer schoolId="nthu" />);
  try {
    await act(async () => fireEvent.press(view.getByText('用我的位置找附近站牌')));
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(view.getByText('定位逾時，請重新定位或輸入站牌名稱查詢。')).toBeTruthy();
    expect(view.queryByText('正在確認位置…')).toBeNull();
    await act(async () => fireEvent.press(view.getByText('用我的位置找附近站牌')));
    expect(queryPublicTransit).toHaveBeenCalledTimes(1);
    expect(view.getByText('清華大學（HSZ001）')).toBeTruthy();
    await act(async () => position.resolve({
      coords: { latitude: 22.6, longitude: 120.3, accuracy: 20 },
    } as Location.LocationObject));
    expect(queryPublicTransit).toHaveBeenCalledTimes(1);
    expect(view.queryByText(/定位逾時/)).toBeNull();
  } finally {
    view.unmount();
    jest.useRealTimers();
  }
});

test('submitting a new station search from the keyboard discards an earlier response', async () => {
  const first = deferred<PublicTransitResult>();
  jest.mocked(queryPublicTransit).mockReturnValueOnce(first.promise);
  const view = render(<PublicTransitExplorer schoolId="nthu" />);
  fireEvent.changeText(view.getByLabelText('搜尋公車站名'), '舊站牌');
  fireEvent.press(view.getByText('搜尋官方站牌'));
  const oldSignal = jest.mocked(queryPublicTransit).mock.calls[0][1]!;
  fireEvent.changeText(view.getByLabelText('搜尋公車站名'), '清華大學');
  await act(async () => fireEvent(view.getByLabelText('搜尋公車站名'), 'submitEditing'));
  expect(oldSignal.aborted).toBe(true);
  await act(async () => first.resolve({ ...result(), stops: [{ ...stop, id: 'HSZ_OLD', name: '舊站牌' }] }));
  expect(view.getByText('清華大學（HSZ001）')).toBeTruthy();
  expect(view.queryByText('舊站牌（HSZ_OLD）')).toBeNull();
});

test('only a selected verified stop requests live TDX arrivals', async () => {
  jest.mocked(queryPublicTransit).mockImplementation(async (input) =>
    input.action === 'arrivals'
      ? { status: 'ready', kind: 'arrivals', arrivals: [
          { id: 'a', route: '83', direction: 0, destination: '火車站',
            status: 0, seconds: 240, updatedAt: fetchedAt() },
        ], fetchedAt: fetchedAt() }
      : result(),
  );
  const view = render(<PublicTransitExplorer schoolId="nthu" />);
  fireEvent.changeText(view.getByLabelText('搜尋公車站名'), '清華大學');
  await act(async () => fireEvent.press(view.getByText('搜尋官方站牌')));
  expect(queryPublicTransit).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.press(view.getByText('清華大學（HSZ001）')));
  expect(queryPublicTransit).toHaveBeenCalledWith(
    { action: 'arrivals', city: 'Hsinchu', stopId: 'HSZ001' },
    expect.any(AbortSignal),
  );
  expect(view.getByText(/83 往 火車站/)).toBeTruthy();
});

test('static catalog stops show provenance, routes and actions without ever polling arrivals', async () => {
  jest.useFakeTimers();
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const originalState = AppState.currentState;
  AppState.currentState = 'active';
  try {
    jest.mocked(queryPublicTransit).mockResolvedValue({
      status: 'ready', kind: 'stops', limited: false, fetchedAt: fetchedAt(), stops: [{
        id: 'TCOD_static001', name: '靜宜大學', city: 'Taichung', lat: 24.23, lon: 120.57, distance: 120,
        source: 'taichung-open-data', catalogDate: '2026-01-01T00:00:00.000Z',
        routes: [{ name: '300', direction: '去', destination: '臺中車站' }],
      }, {
        id: 'TCOD_static002', name: '靜宜大學', city: 'Taichung', lat: 24.231, lon: 120.571, distance: 160,
        source: 'taichung-open-data', catalogDate: '2026-01-01T00:00:00.000Z',
        routes: [{ name: '300', direction: '返', destination: '靜宜大學' }],
      }],
    });
    const view = render(<View><PublicTransitExplorer key="pu" schoolId="pu" /></View>);
    fireEvent.changeText(view.getByLabelText('搜尋公車站名'), '靜宜大學');
    await act(async () => fireEvent.press(view.getByText('搜尋官方站牌')));
    expect(view.getByText('靜宜大學 · 300 路線 · 去程 · 約 120 公尺 · 無即時到站')).toBeTruthy();
    expect(view.getByText('靜宜大學 · 300 路線 · 返程 · 約 160 公尺 · 無即時到站')).toBeTruthy();
    expect(view.queryByText(/TCOD_/)).toBeNull();
    await act(async () => fireEvent.press(view.getByText('靜宜大學 · 300 路線 · 去程 · 約 120 公尺 · 無即時到站')));
    expect(view.getByText('班次時間請至官方網站確認')).toBeTruthy();
    expect(view.getByText(/臺中市政府交通局 · 站牌資料快照：2026/)).toBeTruthy();
    expect(view.getByText('300 · 去程 · 往 臺中車站')).toBeTruthy();
    expect(view.queryByText('更新此站到站時間')).toBeNull();
    expect(view.queryByText(/TDX 公開資料/)).toBeNull();
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(queryPublicTransit).toHaveBeenCalledTimes(1);
    expect(AppState.addEventListener).not.toHaveBeenCalled();
    fireEvent.press(view.getByText('到臺中公車網站查即時動態'));
    expect(openURL).toHaveBeenLastCalledWith(TAICHUNG_BUS_OFFICIAL);
    fireEvent.press(view.getByText('查看站牌資料來源'));
    expect(openURL).toHaveBeenLastCalledWith(TAICHUNG_BUS_CATALOG_SOURCE);
    fireEvent.press(view.getByText('步行前往此站牌'));
    expect(openURL).toHaveBeenLastCalledWith('https://www.google.com/maps/dir/?api=1&destination=24.23%2C120.57&travelmode=walking');
    await act(async () => view.rerender(<View><PublicTransitExplorer key="nthu" schoolId="nthu" /></View>));
    expect(view.getByText('查詢縣市：新竹市')).toBeTruthy();
    expect(view.queryByText('班次時間請至官方網站確認')).toBeNull();
    expect(view.queryByText(/靜宜大學/)).toBeNull();
    view.unmount();
  } finally {
    AppState.currentState = originalState;
    openURL.mockRestore();
    jest.useRealTimers();
  }
});

test('switching school cancels previous searches and clears the old station list', async () => {
  let finish!: (value: PublicTransitResult) => void;
  jest.mocked(queryPublicTransit).mockImplementationOnce(
    () => new Promise((resolve) => { finish = resolve; }),
  );
  const view = render(<View><PublicTransitExplorer key="nthu" schoolId="nthu" /></View>);
  fireEvent.changeText(view.getByLabelText('搜尋公車站名'), '清華大學');
  fireEvent.press(view.getByText('搜尋官方站牌'));
  await act(async () => view.rerender(<View><PublicTransitExplorer key="ncku" schoolId="ncku" /></View>));
  expect(view.getByText('查詢縣市：臺南市')).toBeTruthy();
  expect(view.getByLabelText('搜尋公車站名').props.value).toBe('');
  await act(async () => finish(result()));
  expect(view.queryByText('清華大學（HSZ001）')).toBeNull();
  fireEvent.changeText(view.getByLabelText('搜尋公車站名'), '成大醫院');
  await act(async () => fireEvent.press(view.getByText('搜尋官方站牌')));
  expect(queryPublicTransit).toHaveBeenLastCalledWith(
    { action: 'search', city: 'Tainan', text: '成大醫院' },
    expect.any(AbortSignal),
  );
});
