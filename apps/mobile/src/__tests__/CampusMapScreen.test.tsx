import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import * as Location from 'expo-location';
import { GoogleMapsLikeScreen } from '../screens/GoogleMapsLikeScreen';
import { loadCampusMapPlaces, type CampusMapPlace } from '../features/campusMap';
import { safeNavigate } from '../utils/safeNavigate';

let mockSchool: { id: string; name?: string } = { id: 'school-a' };
let mockUser: { uid: string } | null = { uid: 'user-a' };
let mockParams: Record<string, unknown> = {};
const mockInject = jest.fn();
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('../ui/PuWebView', () => {
  const React = require('react');
  return {
    PuWebView: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject }));
      return React.createElement(require('react-native').View, props);
    }),
  };
});
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../features/campusMap', () => ({
  ...jest.requireActual('../features/campusMap'),
  loadCampusMapPlaces: jest.fn(),
}));
jest.mock('../firebase', () => ({ getDb: jest.fn(), isFirebaseMockMode: () => false }));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));
const place: CampusMapPlace = {
  id: 'library',
  name: '學校發布的圖書館',
  category: '圖書館',
  description: '學校提供的館舍說明',
  lat: 25.1,
  lng: 121.2,
  facilities: ['閱覽室'],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { resolve, reject, promise };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockSchool = { id: 'school-a' };
  mockUser = { uid: 'user-a' };
  mockParams = {};
  jest.mocked(loadCampusMapPlaces).mockResolvedValue([place]);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  jest
    .mocked(Location.requestForegroundPermissionsAsync)
    .mockResolvedValue({ status: 'granted' } as Location.LocationPermissionResponse);
  jest
    .mocked(Location.getCurrentPositionAsync)
    .mockResolvedValue({ coords: { latitude: 25.2, longitude: 121.3 } } as Location.LocationObject);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function openMap() {
  const view = render(<GoogleMapsLikeScreen />);
  await view.findByTestId('campus-map-webview');
  fireEvent(view.getByTestId('campus-map-webview'), 'message', {
    nativeEvent: { data: '{"type":"ready"}' },
  });
  return view;
}

test('loads the current school without fabricated status or an automatic location prompt', async () => {
  const view = await openMap();
  expect(loadCampusMapPlaces).toHaveBeenCalledWith('school-a');
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(view.queryByText(/人潮|人少|評論|已抵達|營業中|Google Maps 級/)).toBeNull();
  expect(mockInject).toHaveBeenCalledWith(expect.stringContaining('學校發布的圖書館'));
});

test('opens real walking directions only after a deliberate press without inventing an origin', async () => {
  mockParams = { toPoiId: 'library', autoStart: true };
  const view = await openMap();
  expect(Linking.openURL).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('查看步行路線')));
  expect(Linking.openURL).toHaveBeenCalledWith(
    'https://www.google.com/maps/dir/?api=1&destination=25.1%2C121.2&travelmode=walking',
  );
  expect(view.queryByText(/已抵達|正在導航/)).toBeNull();
});

test('keeps unknown deep-link places from becoming a fabricated destination', async () => {
  mockParams = { poiId: 'unpublished-id', name: '捏造的地點' };
  const view = await openMap();
  expect(view.queryByText('捏造的地點')).toBeNull();
  expect(view.queryByText('查看步行路線')).toBeNull();
});

test('preserves a verified named starting point and reports directions-open failures', async () => {
  jest
    .mocked(loadCampusMapPlaces)
    .mockResolvedValue([place, { ...place, id: 'gate', name: '學校正門', lat: 25, lng: 121 }]);
  mockParams = { toPoiId: 'library', fromPoiId: 'gate' };
  const view = await openMap();
  jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('offline'));
  await act(async () => fireEvent.press(view.getByText('查看步行路線')));
  expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('&origin=25%2C121'));
  expect(view.getByText('無法開啟地圖服務，請確認網路連線後重試。')).toBeTruthy();
});

test('an unavailable map retains searchable data and the retry really remounts the map', async () => {
  const view = await openMap();
  fireEvent(view.getByTestId('campus-map-webview'), 'message', {
    nativeEvent: { data: '{"type":"error"}' },
  });
  expect(view.queryByTestId('campus-map-webview')).toBeNull();
  fireEvent.press(view.getByText(place.name));
  expect(view.getByText('查看步行路線')).toBeTruthy();
  fireEvent.press(view.getByText('重新載入地圖'));
  expect(view.getByTestId('campus-map-webview')).toBeTruthy();
});

test('script-loading timeout exposes retry instead of leaving the map spinner forever', async () => {
  jest.useFakeTimers();
  const view = render(<GoogleMapsLikeScreen />);
  await act(async () => {});
  act(() => jest.advanceTimersByTime(15000));
  expect(view.getByText('重新載入地圖')).toBeTruthy();
  jest.useRealTimers();
});

test('permission denial never substitutes the campus center for the user position', async () => {
  jest
    .mocked(Location.requestForegroundPermissionsAsync)
    .mockResolvedValueOnce({ status: 'denied' } as Location.LocationPermissionResponse);
  const view = await openMap();
  mockInject.mockClear();
  await act(async () => fireEvent.press(view.getByText('查看目前位置')));
  expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  expect(mockInject).not.toHaveBeenCalled();
  expect(view.getByText(/尚未允許使用位置/)).toBeTruthy();
});

test('failed reads remain errors, while a confirmed empty source has an empty state', async () => {
  jest
    .mocked(loadCampusMapPlaces)
    .mockRejectedValueOnce(new Error('permission-denied'))
    .mockResolvedValueOnce([]);
  const view = render(<GoogleMapsLikeScreen />);
  await view.findByText('目前無法讀取校園地點');
  expect(view.queryByText('尚未提供校園地點')).toBeNull();
  fireEvent.press(view.getByText('重新讀取地點'));
  await view.findByText('尚未提供校園地點');
});

test.each(['school', 'account'])(
  'changing %s masks pending catalog and position responses',
  async (change) => {
    const nextCatalog = deferred<CampusMapPlace[]>();
    const pendingPosition = deferred<Location.LocationObject>();
    const view = await openMap();
    jest.mocked(Location.getCurrentPositionAsync).mockReturnValueOnce(pendingPosition.promise);
    await act(async () => fireEvent.press(view.getByText('查看目前位置')));
    jest.mocked(loadCampusMapPlaces).mockReturnValueOnce(nextCatalog.promise);
    if (change === 'school') mockSchool = { id: 'school-b' };
    else mockUser = { uid: 'user-b' };
    view.rerender(<GoogleMapsLikeScreen />);
    expect(view.queryByText(place.name)).toBeNull();
    mockInject.mockClear();
    await act(async () =>
      pendingPosition.resolve({
        coords: { latitude: 24, longitude: 120 },
      } as Location.LocationObject),
    );
    expect(mockInject).not.toHaveBeenCalled();
    await act(async () =>
      nextCatalog.resolve([{ ...place, id: 'next', name: '目前學校的新地點' }]),
    );
    expect(view.getByText('目前學校的新地點')).toBeTruthy();
    expect(view.queryByText(place.name)).toBeNull();
  },
);

test.each(['denied', 'failed'])(
  'a second position attempt clears the old location marker when %s',
  async (outcome) => {
    const view = await openMap();
    await act(async () => fireEvent.press(view.getByText('查看目前位置')));
    expect(mockInject).toHaveBeenCalledWith(expect.stringContaining('location'));
    mockInject.mockClear();
    if (outcome === 'denied')
      jest
        .mocked(Location.requestForegroundPermissionsAsync)
        .mockResolvedValueOnce({ status: 'denied' } as Location.LocationPermissionResponse);
    else
      jest.mocked(Location.getCurrentPositionAsync).mockRejectedValueOnce(new Error('unavailable'));
    await act(async () => fireEvent.press(view.getByText('查看目前位置')));
    expect(mockInject).toHaveBeenCalledWith(expect.stringContaining('clearLocation'));
    expect(mockInject).not.toHaveBeenCalledWith(expect.stringContaining('25.2'));
  },
);

test('a visitor can load the public map without a school identity', async () => {
  mockUser = null;
  const view = await openMap();
  expect(loadCampusMapPlaces).toHaveBeenCalledWith('school-a');
  expect(view.getByText('學校發布的圖書館')).toBeTruthy();
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});


test('an empty university map can search that university externally without inventing local POIs', async () => {
  mockSchool = { id: 'nthu', name: '國立清華大學' };
  jest.mocked(loadCampusMapPlaces).mockResolvedValue([]);
  const view = render(<GoogleMapsLikeScreen />);
  await view.findByText('尚未提供校園地點');
  expect(view.queryByText('學校發布的圖書館')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('在 Google 地圖搜尋國立清華大學')));
  const url = new URL(jest.mocked(Linking.openURL).mock.calls[0][0]);
  expect(url.origin).toBe('https://www.google.com');
  expect(url.pathname).toBe('/maps/search/');
  expect(url.searchParams.get('query')).toBe('國立清華大學 校園');
  expect(view.getByText(/第三方地圖搜尋結果尚未由校方核對/)).toBeTruthy();
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});

test('unresolved campus titles do not create misleading Google Maps searches', async () => {
  mockSchool = { id: 'unknown', name: '所選校園（unknown）' };
  jest.mocked(loadCampusMapPlaces).mockResolvedValue([]);
  const view = render(<GoogleMapsLikeScreen />);
  await view.findByText('尚未提供校園地點');
  expect(view.queryByText(/在 Google 地圖搜尋/)).toBeNull();
});


test('uses the confirmed user position for directions only after an explicit location request', async () => {
  mockParams = { toPoiId: 'library' };
  const view = await openMap();
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('查看目前位置')));
  await act(async () => fireEvent.press(view.getByText('查看步行路線')));
  expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('&origin=25.2%2C121.3'));
  expect(view.getByText(/與目前位置直線相距約/)).toBeTruthy();
});

test('lets a visitor choose the start and destination from real school points', async () => {
  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([
    place,
    { ...place, id: 'gate', name: '學校正門', lat: 25.11, lng: 121.21 },
  ]);
  const view = await openMap();
  fireEvent.press(view.getByText(place.name));
  fireEvent.press(view.getByText('設為步行起點'));
  await act(async () => fireEvent.press(view.getByText('查看步行路線')));
  expect(Linking.openURL).not.toHaveBeenCalled();
  expect(view.getByText(/起點與終點不能相同/)).toBeTruthy();
  fireEvent.press(view.getByText('學校正門'));
  await act(async () => fireEvent.press(view.getByText('查看步行路線')));
  expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('&origin=25.1%2C121.2'));
  expect(view.getByText(/兩地直線距離約/)).toBeTruthy();
});

test('sorts nearby places only after location permission and supports clearing the radius filter', async () => {
  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([
    place,
    { ...place, id: 'near', name: '附近教室', lat: 25.2, lng: 121.3 },
  ]);
  const view = await openMap();
  expect(view.queryByText('附近 1 公里')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('查看目前位置')));
  fireEvent.press(view.getByText('附近 1 公里'));
  expect(view.queryByText(place.name)).toBeNull();
  expect(view.getByText('附近教室')).toBeTruthy();
  fireEvent.press(view.getByText('附近 1 公里'));
  expect(view.getByText(place.name)).toBeTruthy();
});

test('does not invent cross-school points when a deep link targets an unpublished place', async () => {
  mockParams = { focusPoiId: 'from-previous-campus' };
  const view = await openMap();
  expect(view.getByText('找不到連結指定的地點')).toBeTruthy();
  expect(Linking.openURL).not.toHaveBeenCalled();
  expect(view.queryByText('查看步行路線')).toBeNull();
});

test('does not interpret an old campus POI id as another campus destination after a school switch', async () => {
  mockParams = { toPoiId: 'library' };
  const view = await openMap();
  expect(view.getByText('查看步行路線')).toBeTruthy();
  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([{
    ...place,
    id: 'library',
    name: '乙校圖書館',
    lat: 23.8,
    lng: 120.5,
  }]);
  mockSchool = { id: 'school-b' };
  view.rerender(<GoogleMapsLikeScreen />);
  await view.findByText('乙校圖書館');
  expect(view.queryByText('查看步行路線')).toBeNull();
  fireEvent.press(view.getByText('乙校圖書館'));
  await act(async () => fireEvent.press(view.getByText('查看步行路線')));
  expect(Linking.openURL).toHaveBeenCalledWith(
    expect.stringContaining('destination=23.8%2C120.5'),
  );
});


test('opens the verified library floor directory from Providence campus map only', async () => {
  mockSchool = { id: 'pu', name: '靜宜大學' };
  mockParams = { poiId: 'pu-library' };
  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([
    { ...place, id: 'pu-library', name: '蓋夏圖書館', category: '圖書館' },
  ]);
  const view = await openMap();
  expect(view.getByText('查看校方樓層導覽')).toBeTruthy();
  fireEvent.press(view.getByText('查看校方樓層導覽'));
  expect(safeNavigate).toHaveBeenCalledWith(expect.any(Object), 'IndoorFloorMap', {
    poiId: 'pu-library',
  });
  expect(Linking.openURL).not.toHaveBeenCalled();
});

test('never offers a Providence floor directory for a different university', async () => {
  mockSchool = { id: 'nthu', name: '國立清華大學' };
  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([
    { ...place, id: 'pu-library', name: '蓋夏圖書館', category: '圖書館' },
  ]);
  const view = await openMap();
  expect(view.queryByText('查看校方樓層導覽')).toBeNull();
  expect(safeNavigate).not.toHaveBeenCalled();
});


test('shows the verified campus plan alongside public map POIs without automatically leaving the app', async () => {
  mockSchool = { id: 'pu', name: '靜宜大學' };
  const view = await openMap();
  expect(view.getByText('查看校方校區平面圖')).toBeTruthy();
  expect(Linking.openURL).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('查看校方校區平面圖')));
  expect(Linking.openURL).toHaveBeenCalledWith('https://gnl.pu.edu.tw/p/426-1007-8.php?Lang=zh-tw');
});

test('keeps bundled Providence places with a sync warning when the published source fails', async () => {
  mockSchool = { id: 'pu', name: '靜宜大學' };
  jest.mocked(loadCampusMapPlaces).mockRejectedValueOnce(new Error('offline'));
  const view = render(<GoogleMapsLikeScreen />);
  await view.findByText(/校方地點資料暫時讀不到/);
  expect(view.getByText('主顧樓')).toBeTruthy();
  expect(view.queryByText('目前無法讀取校園地點')).toBeNull();
  expect(view.getByText('查看校方校區平面圖')).toBeTruthy();
  jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('not available'));
  await act(async () => fireEvent.press(view.getByText('查看校方校區平面圖')));
  expect(view.getByText(/無法開啟校方校區平面圖/)).toBeTruthy();
});

test('shows bundled Providence places for a confirmed empty source and keeps the official plan', async () => {
  mockSchool = { id: 'pu', name: '靜宜大學' };
  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([]);
  const view = render(<GoogleMapsLikeScreen />);
  await view.findByText('主顧樓');
  expect(view.queryByText('尚未提供校園地點')).toBeNull();
  expect(view.getAllByText(/OpenStreetMap|靜宜地圖資料來源/).length).toBeGreaterThan(0);
  await act(async () => fireEvent.press(view.getByText('查看校方校區平面圖')));
  expect(Linking.openURL).toHaveBeenCalledWith('https://gnl.pu.edu.tw/p/426-1007-8.php?Lang=zh-tw');
});

test('shows bundled Providence places immediately while the published source is still pending', async () => {
  mockSchool = { id: 'pu', name: '靜宜大學' };
  const pending = deferred<CampusMapPlace[]>();
  jest.mocked(loadCampusMapPlaces).mockReturnValueOnce(pending.promise);
  const view = render(<GoogleMapsLikeScreen />);
  expect(view.getByText(/正在同步校方地點資料/)).toBeTruthy();
  expect(view.getByText('文興樓')).toBeTruthy();
  expect(view.getByText('查看校方校區平面圖')).toBeTruthy();
  expect(view.queryByText('目前無法讀取校園地點')).toBeNull();
  await act(async () => pending.resolve([]));
  expect(view.queryByText(/正在同步校方地點資料/)).toBeNull();
});

test('retry after timeout keeps retained Providence places and remounts the sync request', async () => {
  mockSchool = { id: 'pu', name: '靜宜大學' };
  jest.mocked(loadCampusMapPlaces).mockRejectedValueOnce(new Error('Map source timed out'));
  const view = render(<GoogleMapsLikeScreen />);
  await view.findByText(/校方地點資料暫時讀不到/);
  expect(view.getByText('文興樓')).toBeTruthy();
  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([]);
  fireEvent.press(view.getByText('重新讀取地點資料'));
  await act(async () => {});
  expect(view.queryByText(/校方地點資料暫時讀不到/)).toBeNull();
  expect(view.getByText('文興樓')).toBeTruthy();
  expect(loadCampusMapPlaces).toHaveBeenCalledTimes(2);
});

test('switching away from Providence while a request is pending drops PU places', async () => {
  mockSchool = { id: 'pu', name: '靜宜大學' };
  const pending = deferred<CampusMapPlace[]>();
  jest.mocked(loadCampusMapPlaces).mockReturnValueOnce(pending.promise);
  const view = render(<GoogleMapsLikeScreen />);
  expect(view.getByText('主顧樓')).toBeTruthy();
  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([]);
  mockSchool = { id: 'nthu', name: '國立清華大學' };
  view.rerender(<GoogleMapsLikeScreen />);
  await view.findByText('尚未提供校園地點');
  expect(view.queryByText('主顧樓')).toBeNull();
  await act(async () => pending.resolve([{ ...place, name: '晚到的靜宜地點' }]));
  expect(view.queryByText('晚到的靜宜地點')).toBeNull();
  expect(view.queryByText('主顧樓')).toBeNull();
});

test('deep-links to the bundled Providence library before the published source answers', async () => {
  mockSchool = { id: 'pu', name: '靜宜大學' };
  mockParams = { poiId: 'pu-library' };
  const pending = deferred<CampusMapPlace[]>();
  jest.mocked(loadCampusMapPlaces).mockReturnValueOnce(pending.promise);
  const view = render(<GoogleMapsLikeScreen />);
  expect(view.getAllByText('蓋夏圖書館').length).toBeGreaterThan(0);
  expect(view.getByText('查看校方樓層導覽')).toBeTruthy();
  expect(view.getByText('查看地點來源')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('查看地點來源')));
  expect(Linking.openURL).toHaveBeenCalledWith('https://www.openstreetmap.org/way/255784049');
  await act(async () => pending.resolve([]));
});

test('finds verified print facilities from the bundled Providence catalog', async () => {
  mockSchool = { id: 'pu', name: '靜宜大學' };
  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([]);
  const view = render(<GoogleMapsLikeScreen />);
  await view.findByText('蓋夏圖書館');
  fireEvent.changeText(view.getByLabelText('搜尋校園地點'), '影印');
  expect(view.getByText('蓋夏圖書館')).toBeTruthy();
  expect(view.getByText('至善樓')).toBeTruthy();
  expect(view.queryByText('主顧樓')).toBeNull();
});

test('does not route toilet search to resident-only dorm bathrooms', async () => {
  mockSchool = { id: 'pu', name: '靜宜大學' };
  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([]);
  const view = render(<GoogleMapsLikeScreen />);
  await view.findByText('蓋夏圖書館');
  fireEvent.changeText(view.getByLabelText('搜尋校園地點'), '廁所');
  expect(view.queryByText('希嘉學苑')).toBeNull();
  expect(view.queryByText('思高學苑')).toBeNull();
  expect(view.getByText('找不到符合的地點')).toBeTruthy();
  expect(view.getByText('查看校方校區平面圖')).toBeTruthy();
});

test('ignores a late source-link rejection after the selected place changes', async () => {
  mockSchool = { id: 'pu', name: '靜宜大學' };
  mockParams = { poiId: 'pu-library' };
  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([]);
  const pending = deferred<unknown>();
  jest.mocked(Linking.openURL).mockReturnValueOnce(pending.promise);
  const view = render(<GoogleMapsLikeScreen />);
  await view.findByText('查看地點來源');
  await act(async () => fireEvent.press(view.getByText('查看地點來源')));
  fireEvent.press(view.getByText('主顧樓'));
  expect(view.queryByText(/無法開啟地點來源/)).toBeNull();
  await act(async () => pending.reject(new Error('offline')));
  expect(view.queryByText(/無法開啟地點來源/)).toBeNull();
  expect(view.getAllByText('主顧樓').length).toBeGreaterThan(0);
});

test('never substitutes Providence official campus maps for an unverified university id', async () => {
  mockSchool = { id: 'tw-demo-uni', name: '示範大學' };
  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([]);
  const view = render(<GoogleMapsLikeScreen />);
  await view.findByText('尚未提供校園地點');
  expect(view.queryByText('查看校方校區平面圖')).toBeNull();
  expect(view.getByText('在 Google 地圖搜尋示範大學')).toBeTruthy();
});

test('opens the selected university official map instead of Providence for a non-Providence school', async () => {
  mockSchool = { id: 'nthu', name: '國立清華大學' };
  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([]);
  const view = render(<GoogleMapsLikeScreen />);
  await view.findByText('尚未提供校園地點');
  await act(async () => fireEvent.press(view.getByText('查看校方校區平面圖')));
  expect(Linking.openURL).toHaveBeenCalledWith('https://www.nthu.edu.tw/campusmap');
});

test('never revives an old deep-link destination after switching A → B → A in the same screen', async () => {
  mockParams = { toPoiId: 'library' };
  const view = await openMap();
  expect(view.getByText('查看步行路線')).toBeTruthy();

  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([{
    ...place,
    name: '乙校圖書館',
  }]);
  mockSchool = { id: 'school-b' };
  view.rerender(<GoogleMapsLikeScreen />);
  await view.findByText('乙校圖書館');
  expect(view.queryByText('查看步行路線')).toBeNull();

  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([{
    ...place,
    name: '甲校圖書館',
  }]);
  mockSchool = { id: 'school-a' };
  view.rerender(<GoogleMapsLikeScreen />);
  await view.findByText('甲校圖書館');
  expect(view.queryByText('查看步行路線')).toBeNull();
  fireEvent.press(view.getByText('甲校圖書館'));
  expect(view.getByText('查看步行路線')).toBeTruthy();
});

test('lets a visitor clear a linked school origin before opening directions', async () => {
  mockParams = { fromPoiId: 'gate', toPoiId: 'library' };
  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([
    place,
    { ...place, id: 'gate', name: '校園正門', lat: 25, lng: 121 },
  ]);
  const view = await openMap();
  expect(view.getByText('清除步行起點')).toBeTruthy();
  expect(mockInject.mock.calls.some(([script]) => script.includes('route') && script.includes('start'))).toBe(true);
  fireEvent.press(view.getByText('清除步行起點'));
  await act(async () => fireEvent.press(view.getByText('查看步行路線')));
  expect(Linking.openURL).toHaveBeenCalledWith(
    'https://www.google.com/maps/dir/?api=1&destination=25.1%2C121.2&travelmode=walking',
  );
  expect(mockInject.mock.calls.some(([script]) => script.includes('clearRoute'))).toBe(true);
});

test('keeps the selected map marker after a search hides it from the directory', async () => {
  mockParams = { toPoiId: 'library' };
  const view = await openMap();
  mockInject.mockClear();
  fireEvent.changeText(view.getByLabelText('搜尋校園地點'), '不存在的設施');
  expect(mockInject.mock.calls.some(([script]) =>
    script.includes('places') && script.includes('學校發布的圖書館')
  )).toBe(true);
});


test('accepts a new explicit destination for the current campus after a school change', async () => {
  mockParams = { toPoiId: 'library' };
  const view = await openMap();
  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([
    { ...place, name: '乙校圖書館' },
    { ...place, id: 'entrance', name: '乙校正門', lat: 24.1, lng: 121.1 },
  ]);
  mockSchool = { id: 'school-b' };
  view.rerender(<GoogleMapsLikeScreen />);
  await view.findByText('乙校正門');
  expect(view.queryByText('查看步行路線')).toBeNull();

  mockParams = { toPoiId: 'entrance' };
  view.rerender(<GoogleMapsLikeScreen />);
  expect(view.getByText('查看步行路線')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('查看步行路線')));
  expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('destination=24.1%2C121.1'));
});


test('clears a source-opening error when a new deep link selects another place', async () => {
  mockSchool = { id: 'pu', name: '靜宜大學' };
  mockParams = { toPoiId: 'pu-library' };
  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([]);
  const view = await openMap();
  jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('offline'));
  await act(async () => fireEvent.press(view.getByText('查看地點來源')));
  expect(view.getByText(/無法開啟地點來源/)).toBeTruthy();

  mockParams = { toPoiId: 'pu-zhugu' };
  view.rerender(<GoogleMapsLikeScreen />);
  expect(view.queryByText(/無法開啟地點來源/)).toBeNull();
  await act(async () => fireEvent.press(view.getByText('查看步行路線')));
  expect(Linking.openURL).toHaveBeenLastCalledWith(
    expect.stringContaining('destination=24.226939%2C120.583587'),
  );
});

test('does not replace the WebView document when only the map search changes', async () => {
  const view = await openMap();
  const source = view.getByTestId('campus-map-webview').props.source;
  fireEvent.changeText(view.getByLabelText('搜尋校園地點'), '沒有這個校舍');
  expect(view.getByTestId('campus-map-webview').props.source).toBe(source);
  fireEvent.changeText(view.getByLabelText('搜尋校園地點'), '圖書館');
  expect(view.getByTestId('campus-map-webview').props.source).toBe(source);
});


test('keeps a route starting-point marker visible when the start is filtered out', async () => {
  mockParams = { fromPoiId: 'gate', toPoiId: 'library' };
  jest.mocked(loadCampusMapPlaces).mockResolvedValueOnce([
    place,
    { ...place, id: 'gate', name: '校園正門', lat: 25, lng: 121 },
  ]);
  const view = await openMap();
  mockInject.mockClear();
  fireEvent.changeText(view.getByLabelText('搜尋校園地點'), '圖書館');
  expect(mockInject.mock.calls.some(([script]) =>
    script.includes('places') && script.includes('校園正門') && script.includes('學校發布的圖書館')
  )).toBe(true);
});

test('room deep links search only within the current school and clear after switching school', async () => {
  mockParams = { query: '圖書館', schoolId: 'school-a' };
  const view = await openMap();
  expect(view.getByLabelText('搜尋校園地點').props.value).toBe('圖書館');
  mockSchool = { id: 'school-b' };
  view.rerender(<GoogleMapsLikeScreen />);
  expect((await view.findByLabelText('搜尋校園地點')).props.value).toBe('');
});
test('a room link for another school cannot set the current map search', async () => {
  mockParams = { query: '別校教室', schoolId: 'school-b' };
  const view = await openMap();
  expect(view.getByLabelText('搜尋校園地點').props.value).toBe('');
});
