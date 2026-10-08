import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import * as Location from 'expo-location';
import { GoogleMapsLikeScreen } from '../screens/GoogleMapsLikeScreen';
import { loadCampusMapPlaces, type CampusMapPlace } from '../features/campusMap';

let mockSchool = { id: 'school-a' };
let mockUser = { uid: 'user-a' };
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
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
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
