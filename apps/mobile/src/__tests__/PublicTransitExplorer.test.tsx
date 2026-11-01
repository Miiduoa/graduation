import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { AppState, Keyboard, Linking, View } from 'react-native';
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
    await act(async () => fireEvent.press(view.getByText('到臺中公車網站查即時動態')));
    expect(openURL).toHaveBeenLastCalledWith(TAICHUNG_BUS_OFFICIAL);
    await act(async () => fireEvent.press(view.getByText('查看站牌資料來源')));
    expect(openURL).toHaveBeenLastCalledWith(TAICHUNG_BUS_CATALOG_SOURCE);
    await act(async () => fireEvent.press(view.getByText('步行前往此站牌')));
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

test('a stop near the start of a long list opens a full-screen detail and returns without repeating the search', async () => {
  const keyboard = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  jest.mocked(queryPublicTransit).mockImplementation(async (input) => input.action === 'arrivals'
    ? { status: 'ready', kind: 'arrivals', arrivals: [], fetchedAt: fetchedAt() }
    : { ...result(), stops: [stop, ...Array.from({ length: 45 }, (_, index) => ({ ...stop, id: 'HSZ' + index, name: '其他站牌' + index }))] });
  const view = render(<PublicTransitExplorer schoolId="nthu" />);
  try {
    fireEvent.changeText(view.getByLabelText('搜尋公車站名'), '清華大學');
    await act(async () => fireEvent.press(view.getByText('搜尋官方站牌')));
    const firstStop = view.getByLabelText('清華大學（HSZ001）');
    await act(async () => {
      fireEvent.press(firstStop);
      fireEvent.press(firstStop);
    });
    const detail = view.getByTestId('public-transit-stop-details');
    expect(detail.props.presentationStyle).toBe('fullScreen');
    expect(detail.props.animationType).toBe('none');
    expect(view.getByText('返回站牌清單')).toBeTruthy();
    expect(view.getByText('這個站牌目前沒有可確認的班次預估。')).toBeTruthy();
    expect(keyboard).toHaveBeenCalled();
    expect(jest.mocked(queryPublicTransit).mock.calls.filter(([query]) => query.action === 'arrivals')).toHaveLength(1);
    fireEvent.press(view.getByText('返回站牌清單'));
    expect(view.queryByTestId('public-transit-stop-details')).toBeNull();
    expect(view.getByLabelText('搜尋公車站名').props.value).toBe('清華大學');
    expect(view.getByText('其他站牌44（HSZ44）')).toBeTruthy();
    expect(view.getByText('查詢縣市：新竹市')).toBeTruthy();
    expect(queryPublicTransit).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
    keyboard.mockRestore();
  }
});

test.each(['button', 'android', 'screen-reader'] as const)('closing detail with %s cancels pending arrivals and prevents late content from resurfacing', async (method) => {
  const arrivals = deferred<PublicTransitResult>();
  jest.mocked(queryPublicTransit).mockImplementation((input) => input.action === 'arrivals'
    ? arrivals.promise : Promise.resolve(result()));
  const view = render(<PublicTransitExplorer schoolId="nthu" />);
  fireEvent.changeText(view.getByLabelText('搜尋公車站名'), '清華大學');
  await act(async () => fireEvent.press(view.getByText('搜尋官方站牌')));
  fireEvent.press(view.getByLabelText('清華大學（HSZ001）'));
  expect(view.getByText('正在取得班次…')).toBeTruthy();
  const signal = jest.mocked(queryPublicTransit).mock.calls[1][1]!;
  if (method === 'button') fireEvent.press(view.getByText('返回站牌清單'));
  else if (method === 'android') fireEvent(view.getByTestId('public-transit-stop-details'), 'requestClose');
  else fireEvent(view.getByText('返回站牌清單'), 'accessibilityEscape');
  expect(signal.aborted).toBe(true);
  await act(async () => arrivals.resolve({ status: 'ready', kind: 'arrivals', fetchedAt: fetchedAt(), arrivals: [
    { id: 'late', route: '晚到回應', direction: 0, destination: '', status: 0, seconds: 60, updatedAt: fetchedAt() },
  ] }));
  expect(view.queryByTestId('public-transit-stop-details')).toBeNull();
  expect(view.queryByText(/晚到回應/)).toBeNull();
  expect(view.getByText('清華大學（HSZ001）')).toBeTruthy();
  view.unmount();
});

test('switching school stops polling and discards pending detail data', async () => {
  jest.useFakeTimers();
  const originalState = AppState.currentState;
  AppState.currentState = 'active';
  const remove = jest.fn();
  jest.mocked(AppState.addEventListener).mockReturnValueOnce({ remove });
  const arrivals = deferred<PublicTransitResult>();
  jest.mocked(queryPublicTransit).mockImplementation((input) => input.action === 'arrivals'
    ? arrivals.promise : Promise.resolve(result()));
  const view = render(<View><PublicTransitExplorer key="nthu" schoolId="nthu" /></View>);
  try {
    fireEvent.changeText(view.getByLabelText('搜尋公車站名'), '清華大學');
    await act(async () => fireEvent.press(view.getByText('搜尋官方站牌')));
    fireEvent.press(view.getByLabelText('清華大學（HSZ001）'));
    const signal = jest.mocked(queryPublicTransit).mock.calls[1][1]!;
    view.rerender(<View><PublicTransitExplorer key="ncku" schoolId="ncku" /></View>);
    expect(signal.aborted).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
    await act(async () => {
      arrivals.resolve({ status: 'unavailable', reason: 'network' });
      jest.advanceTimersByTime(60_000);
    });
    expect(queryPublicTransit).toHaveBeenCalledTimes(2);
    expect(view.queryByTestId('public-transit-stop-details')).toBeNull();
    expect(view.getByText('查詢縣市：臺南市')).toBeTruthy();
    expect(view.queryByText(/目前無法取得可確認/)).toBeNull();
  } finally {
    view.unmount();
    AppState.currentState = originalState;
    jest.useRealTimers();
  }
});

test('detail can recover from unavailable arrivals and retains the existing stale-data warning', async () => {
  jest.mocked(queryPublicTransit)
    .mockResolvedValueOnce(result())
    .mockResolvedValueOnce({ status: 'unavailable', reason: 'network' })
    .mockResolvedValueOnce({ status: 'ready', kind: 'arrivals', fetchedAt: fetchedAt(), arrivals: [
      { id: 'old', route: '83', direction: 0, destination: '火車站', status: 0, seconds: 240,
        updatedAt: new Date(Date.now() - 120_000).toISOString() },
    ] });
  const view = render(<PublicTransitExplorer schoolId="nthu" />);
  fireEvent.changeText(view.getByLabelText('搜尋公車站名'), '清華大學');
  await act(async () => fireEvent.press(view.getByText('搜尋官方站牌')));
  await act(async () => fireEvent.press(view.getByLabelText('清華大學（HSZ001）')));
  expect(view.getByText('目前無法取得可確認的到站資料，請稍後重新查詢。')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('更新此站到站時間')));
  expect(view.queryByText(/目前無法取得可確認/)).toBeNull();
  expect(view.getByText('83 往 火車站 · 資料待更新')).toBeTruthy();
  expect(view.getByTestId('public-transit-stop-details')).toBeTruthy();
  view.unmount();
});

test('external navigation failures remain visible in detail and retry the same link without duplicate openings', async () => {
  const opening = deferred<void>();
  const openURL = jest.spyOn(Linking, 'openURL').mockReturnValueOnce(opening.promise).mockResolvedValue(undefined);
  jest.mocked(queryPublicTransit).mockImplementation(async (input) => input.action === 'arrivals'
    ? { status: 'ready', kind: 'arrivals', arrivals: [], fetchedAt: fetchedAt() } : result());
  const view = render(<PublicTransitExplorer schoolId="nthu" />);
  try {
    fireEvent.changeText(view.getByLabelText('搜尋公車站名'), '清華大學');
    await act(async () => fireEvent.press(view.getByText('搜尋官方站牌')));
    await act(async () => fireEvent.press(view.getByLabelText('清華大學（HSZ001）')));
    const walk = view.getByText('步行前往此站牌');
    act(() => { fireEvent.press(walk); fireEvent.press(walk); });
    expect(view.getByText('正在開啟連結…')).toBeTruthy();
    expect(openURL).toHaveBeenCalledTimes(1);
    await act(async () => opening.reject(new Error('no map handler')));
    expect(view.getByText('無法開啟連結，請確認裝置可開啟瀏覽器或地圖後再試。')).toBeTruthy();
    expect(view.getByTestId('public-transit-stop-details')).toBeTruthy();
    await act(async () => fireEvent.press(view.getByText('再試開啟連結')));
    expect(openURL).toHaveBeenCalledTimes(2);
    expect(openURL).toHaveBeenLastCalledWith('https://www.google.com/maps/dir/?api=1&destination=24.8%2C120.99&travelmode=walking');
    expect(view.queryByText(/無法開啟連結/)).toBeNull();
    expect(view.getByTestId('public-transit-stop-details')).toBeTruthy();
  } finally {
    view.unmount();
    openURL.mockRestore();
  }
});

test('a late external-link failure from a closed detail cannot replace another stop detail', async () => {
  const opening = deferred<void>();
  const openURL = jest.spyOn(Linking, 'openURL').mockReturnValueOnce(opening.promise);
  jest.mocked(queryPublicTransit).mockImplementation(async (input) => input.action === 'arrivals'
    ? { status: 'ready', kind: 'arrivals', arrivals: [], fetchedAt: fetchedAt() }
    : { ...result(), stops: [stop, { ...stop, id: 'HSZ002', name: '交通大學' }] });
  const view = render(<PublicTransitExplorer schoolId="nthu" />);
  try {
    fireEvent.changeText(view.getByLabelText('搜尋公車站名'), '大學');
    await act(async () => fireEvent.press(view.getByText('搜尋官方站牌')));
    await act(async () => fireEvent.press(view.getByLabelText('清華大學（HSZ001）')));
    fireEvent.press(view.getByText('步行前往此站牌'));
    fireEvent.press(view.getByText('返回站牌清單'));
    await act(async () => fireEvent.press(view.getByLabelText('交通大學（HSZ002）')));
    await act(async () => opening.reject(new Error('late failure')));
    expect(view.getByText('交通大學 · 官方到站預估')).toBeTruthy();
    expect(view.queryByText(/無法開啟連結/)).toBeNull();
    expect(view.queryByText('正在開啟連結…')).toBeNull();
  } finally {
    view.unmount();
    openURL.mockRestore();
  }
});


test('returning to the list removes the detail subscription and stops background polling', async () => {
  jest.useFakeTimers();
  const originalState = AppState.currentState;
  AppState.currentState = 'active';
  const remove = jest.fn();
  jest.mocked(AppState.addEventListener).mockReturnValueOnce({ remove });
  jest.mocked(queryPublicTransit).mockImplementation(async (input) => input.action === 'arrivals'
    ? { status: 'ready', kind: 'arrivals', arrivals: [], fetchedAt: fetchedAt() } : result());
  const view = render(<PublicTransitExplorer schoolId="nthu" />);
  try {
    fireEvent.changeText(view.getByLabelText('搜尋公車站名'), '清華大學');
    await act(async () => fireEvent.press(view.getByText('搜尋官方站牌')));
    await act(async () => fireEvent.press(view.getByLabelText('清華大學（HSZ001）')));
    fireEvent.press(view.getByText('返回站牌清單'));
    expect(remove).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(queryPublicTransit).toHaveBeenCalledTimes(2);
    expect(view.queryByTestId('public-transit-stop-details')).toBeNull();
  } finally {
    view.unmount();
    AppState.currentState = originalState;
    jest.useRealTimers();
  }
});


test('React Native Web detail focuses its title and restores the original stop without native handles', async () => {
  const { createRoot } = jest.requireActual('react-dom/client') as typeof import('react-dom/client');
  let WebExplorer!: typeof PublicTransitExplorer;
  let webQuery!: jest.MockedFunction<typeof queryPublicTransit>;
  // Render the real component and shared UI through React Native Web. Only
  // native safe-area insets and the public network boundary are fixtures.
  jest.resetModules();
  jest.isolateModules(() => {
    jest.doMock('react', () => React);
    jest.doMock('react-native', () => jest.requireActual('react-native-web'));
    jest.doMock('react-native-safe-area-context', () => {
      const { View: WebView } = jest.requireActual('react-native-web');
      return {
        SafeAreaView: WebView,
        useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
      };
    });
    WebExplorer = require('../components/PublicTransitExplorer').PublicTransitExplorer;
    webQuery = require('../features/publicTransit').queryPublicTransit;
  });
  webQuery.mockImplementation(async (input) => input.action === 'arrivals'
    ? { status: 'ready', kind: 'arrivals', arrivals: [], fetchedAt: fetchedAt() } : result());
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const button = (label: string) => {
    const match = Array.from(document.querySelectorAll<HTMLElement>('[role="button"]')).find((node) => node.textContent === label);
    if (!match) throw new Error('Missing browser button: ' + label);
    return match;
  };
  try {
    await act(async () => root.render(<WebExplorer schoolId="nthu" />));
    const input = document.querySelector<HTMLInputElement>('[aria-label="搜尋公車站名"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '清華大學');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('搜尋官方站牌').click());
    const source = button('清華大學（HSZ001）');
    await act(async () => source.click());
    // Modal onShow is triggered by the real RN Web Modal animation lifecycle.
    await waitFor(() => {
      const title = document.querySelector<HTMLElement>('[role="heading"][tabindex="-1"]');
      expect(title?.textContent).toBe('清華大學');
      expect(document.activeElement).toBe(title);
    });
    await act(async () => button('返回站牌清單').click());
    await act(async () => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(source);
    expect(input.value).toBe('清華大學');
    expect(webQuery).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    jest.dontMock('react');
    jest.dontMock('react-native');
    jest.dontMock('react-native-safe-area-context');
  }
});
