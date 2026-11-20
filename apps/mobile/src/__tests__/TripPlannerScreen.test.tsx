import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { TripPlannerScreen } from '../screens/TripPlannerScreen';
import { loadCampusMapPlaces, type CampusMapPlace } from '../features/campusMap';

let mockSchool = { id: 'pu' };
let mockUser: { uid: string } | null = { uid: 'student-a' };
let mockParams: Record<string, unknown> | undefined;
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ key: 'planner', params: mockParams }),
}));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').getCurrentTheme() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../features/campusMap', () => ({ loadCampusMapPlaces: jest.fn() }));

const places: CampusMapPlace[] = [
  {
    id: 'library',
    name: '正式圖書館',
    category: '圖書館',
    description: '自習與借閱',
    lat: 24.22,
    lng: 120.56,
    facilities: [],
  },
  {
    id: 'gate',
    name: '正式校門',
    category: '交通',
    description: '入口',
    lat: 24.23,
    lng: 120.57,
    facilities: [],
  },
];
const loadPlaces = jest.mocked(loadCampusMapPlaces);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  loadPlaces.mockReset();
  loadPlaces.mockResolvedValue(places);
  mockSchool = { id: 'pu' };
  mockUser = { uid: 'student-a' };
  mockParams = undefined;
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

test('uses the school catalog and leaves the unknown origin to Google Maps', async () => {
  const view = render(<TripPlannerScreen />);
  expect(Linking.openURL).not.toHaveBeenCalled();
  await waitFor(() => expect(view.getByText('正式圖書館')).toBeTruthy());
  expect(loadPlaces).toHaveBeenCalledWith('pu');
  fireEvent.press(view.getByText('正式圖書館'));
  expect(view.getByText('在 Google Maps 確認出發地點')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('在 Google Maps 查看路線')));
  const url = new URL(jest.mocked(Linking.openURL).mock.calls[0][0]);
  expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
  expect(url.searchParams.get('api')).toBe('1');
  expect(url.searchParams.get('destination')).toBe('24.22,120.56');
  expect(url.searchParams.get('travelmode')).toBe('walking');
  expect(url.searchParams.has('origin')).toBe(false);
  expect(url.searchParams.has('dir_action')).toBe(false);
  expect(view.queryByText(/我的位置|\d+ 分鐘|\d+:\d+ 班/)).toBeNull();
  expect(view.getByText(/步行路線未經無障礙通行驗證/)).toBeTruthy();
});

test.each([
  ['大眾運輸', 'transit'],
  ['自行車', 'bicycling'],
  ['開車', 'driving'],
])('passes the selected %s mode to the external route service', async (label, mode) => {
  mockParams = { toPoiId: 'library' };
  const view = render(<TripPlannerScreen />);
  await waitFor(() => expect(view.getByText('正式圖書館')).toBeTruthy());
  fireEvent.press(view.getByText(label));
  await act(async () => fireEvent.press(view.getByText('在 Google Maps 查看路線')));
  const url = new URL(jest.mocked(Linking.openURL).mock.calls[0][0]);
  expect(url.searchParams.get('travelmode')).toBe(mode);
  expect(url.searchParams.has('origin')).toBe(false);
  expect(view.queryByText(/下一班|總時間|推薦路線|\d+ 分鐘/)).toBeNull();
});

test('resolves POI parameters from the current school and ignores conflicting route coordinates', async () => {
  mockParams = {
    toPoiId: 'library',
    fromPoiId: 'gate',
    toLat: 1,
    toLng: 2,
    toName: '舊地點',
    mode: 'bus',
    autoStart: true,
  };
  const view = render(<TripPlannerScreen />);
  await waitFor(() => expect(view.getByText('正式圖書館')).toBeTruthy());
  expect(view.getByText('正式校門')).toBeTruthy();
  expect(view.queryByText('舊地點')).toBeNull();
  expect(Linking.openURL).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('在 Google Maps 查看路線')));
  const url = new URL(jest.mocked(Linking.openURL).mock.calls[0][0]);
  expect(url.searchParams.get('destination')).toBe('24.22,120.56');
  expect(url.searchParams.get('origin')).toBe('24.23,120.57');
  expect(url.searchParams.get('travelmode')).toBe('transit');
});

test('allows selecting a catalog origin and then clearing it for confirmation in Maps', async () => {
  mockParams = { toPoiId: 'library' };
  const view = render(<TripPlannerScreen />);
  await waitFor(() => expect(view.getByText('正式圖書館')).toBeTruthy());
  fireEvent.press(view.getByText('選擇校園起點'));
  fireEvent.changeText(view.getByLabelText('搜尋起點'), '入口');
  fireEvent.press(view.getByText('正式校門'));
  await act(async () => fireEvent.press(view.getByText('在 Google Maps 查看路線')));
  expect(new URL(jest.mocked(Linking.openURL).mock.calls[0][0]).searchParams.get('origin')).toBe(
    '24.23,120.57',
  );
  fireEvent.press(view.getByText('改在 Google Maps 設定起點'));
  await act(async () => fireEvent.press(view.getByText('在 Google Maps 查看路線')));
  expect(new URL(jest.mocked(Linking.openURL).mock.calls[1][0]).searchParams.has('origin')).toBe(
    false,
  );
});

test('accepts explicit valid coordinates including zero without presenting them as school-verified', async () => {
  mockParams = { toLat: 0, toLng: 0, toName: '帶入地點' };
  loadPlaces.mockResolvedValue([]);
  const view = render(<TripPlannerScreen />);
  await waitFor(() => expect(view.getByText('這所學校尚未提供地點')).toBeTruthy());
  expect(view.getByText('帶入地點')).toBeTruthy();
  expect(view.getByText(/由開啟此頁的地點帶入/)).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('在 Google Maps 查看路線')));
  expect(
    new URL(jest.mocked(Linking.openURL).mock.calls[0][0]).searchParams.get('destination'),
  ).toBe('0,0');
});

test.each([
  { toLat: NaN, toLng: 120, toName: '無效位置' },
  { toLat: 24, toLng: Infinity, toName: '無效位置' },
  { toLat: 91, toLng: 120, toName: '無效位置' },
  { toLat: 24, toLng: -181, toName: '無效位置' },
  { toLat: '24', toLng: '120', toName: '無效位置' },
  { toLat: 24, toLng: 120, toName: '' },
])('rejects invalid coordinate parameters %#', async (params) => {
  mockParams = params;
  const view = render(<TripPlannerScreen />);
  await waitFor(() => expect(view.getByText('正式圖書館')).toBeTruthy());
  fireEvent.press(view.getByText('在 Google Maps 查看路線'));
  expect(Linking.openURL).not.toHaveBeenCalled();
  expect(view.queryByText('無效位置')).toBeNull();
});

test('an unknown POI does not silently use an arbitrary coordinate fallback', async () => {
  mockParams = { toPoiId: 'old-poi', toLat: 24, toLng: 120, toName: '旧清单地点' };
  const view = render(<TripPlannerScreen />);
  await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent(/不在目前學校的清單/));
  fireEvent.press(view.getByText('在 Google Maps 查看路線'));
  expect(Linking.openURL).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('選擇目的地'));
  fireEvent.press(view.getByText('正式校門'));
  await act(async () => fireEvent.press(view.getByText('在 Google Maps 查看路線')));
  expect(
    new URL(jest.mocked(Linking.openURL).mock.calls[0][0]).searchParams.get('destination'),
  ).toBe('24.23,120.57');
});

test('does not silently omit an unavailable explicit origin', async () => {
  mockParams = { toPoiId: 'library', fromPoiId: 'missing-origin' };
  const view = render(<TripPlannerScreen />);
  await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent(/不在目前學校的清單/));
  fireEvent.press(view.getByText('在 Google Maps 查看路線'));
  expect(Linking.openURL).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('改在 Google Maps 設定起點'));
  await act(async () => fireEvent.press(view.getByText('在 Google Maps 查看路線')));
  expect(new URL(jest.mocked(Linking.openURL).mock.calls[0][0]).searchParams.has('origin')).toBe(
    false,
  );
});

test('shows source failure and retries without substituting a static catalog', async () => {
  loadPlaces.mockRejectedValueOnce(new Error('source down'));
  const view = render(<TripPlannerScreen />);
  await waitFor(() => expect(view.getByText('校園地點暫時無法讀取')).toBeTruthy());
  expect(view.queryByText('正式圖書館')).toBeNull();
  fireEvent.press(view.getByText('重新讀取地點'));
  await waitFor(() => expect(view.getByText('正式圖書館')).toBeTruthy());
  expect(loadPlaces).toHaveBeenCalledTimes(2);
});

test('does not fabricate a destination when the server confirms an empty catalog', async () => {
  loadPlaces.mockResolvedValue([]);
  const view = render(<TripPlannerScreen />);
  await waitFor(() => expect(view.getByText('這所學校尚未提供地點')).toBeTruthy());
  expect(view.getByText('尚未選擇')).toBeTruthy();
  fireEvent.press(view.getByText('在 Google Maps 查看路線'));
  expect(Linking.openURL).not.toHaveBeenCalled();
});

test('deduplicates pending opens and lets a failed external handoff be retried', async () => {
  mockParams = { toPoiId: 'library' };
  const pending = deferred<unknown>();
  jest.mocked(Linking.openURL).mockReturnValueOnce(pending.promise);
  const view = render(<TripPlannerScreen />);
  await waitFor(() => expect(view.getByText('正式圖書館')).toBeTruthy());
  fireEvent.press(view.getByText('在 Google Maps 查看路線'));
  fireEvent.press(view.getByText('正在開啟…'));
  expect(Linking.openURL).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error('unavailable')));
  expect(view.getByRole('alert')).toHaveTextContent(/無法開啟 Google Maps/);
  await act(async () => fireEvent.press(view.getByText('在 Google Maps 查看路線')));
  expect(Linking.openURL).toHaveBeenCalledTimes(2);
  expect(view.queryByRole('alert')).toBeNull();
});

test('school changes discard a pending previous-school catalog and carried destination', async () => {
  mockParams = { toPoiId: 'library' };
  const first = deferred<CampusMapPlace[]>();
  loadPlaces
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce([{ ...places[1], name: '新校門' }]);
  const view = render(<TripPlannerScreen />);
  mockSchool = { id: 'new-school' };
  view.rerender(<TripPlannerScreen />);
  await waitFor(() => expect(view.getByText('新校門')).toBeTruthy());
  await act(async () => first.resolve(places));
  expect(view.queryByText('正式圖書館')).toBeNull();
  expect(view.getByText('尚未選擇')).toBeTruthy();
  expect(loadPlaces).toHaveBeenLastCalledWith('new-school');
});

test('account changes clear carried coordinates and ignore late handoff errors', async () => {
  mockParams = { toLat: 24.1, toLng: 120.1, toName: '先前帳號的地點' };
  const pending = deferred<unknown>();
  jest.mocked(Linking.openURL).mockReturnValueOnce(pending.promise);
  const view = render(<TripPlannerScreen />);
  await waitFor(() => expect(view.queryByText('正在讀取校園地點…')).toBeNull());
  fireEvent.press(view.getByText('在 Google Maps 查看路線'));
  mockUser = { uid: 'student-b' };
  view.rerender(<TripPlannerScreen />);
  await act(async () => pending.reject(new Error('unavailable')));
  expect(view.queryByText('先前帳號的地點')).toBeNull();
  expect(view.queryByRole('alert')).toBeNull();
  expect(view.getByText('尚未選擇')).toBeTruthy();
  fireEvent.press(view.getByText('在 Google Maps 查看路線'));
  expect(Linking.openURL).toHaveBeenCalledTimes(1);
  mockUser = { uid: 'student-a' };
  view.rerender(<TripPlannerScreen />);
  expect(view.queryByText('先前帳號的地點')).toBeNull();
  expect(view.getByText('尚未選擇')).toBeTruthy();
});

test('a new navigation intent replaces the previous selection without opening automatically', async () => {
  mockParams = { toPoiId: 'library' };
  const view = render(<TripPlannerScreen />);
  await waitFor(() => expect(view.getByText('正式圖書館')).toBeTruthy());
  mockParams = { toPoiId: 'gate', mode: 'drive' };
  view.rerender(<TripPlannerScreen />);
  await waitFor(() => expect(view.getByText('正式校門')).toBeTruthy());
  expect(view.queryByText('正式圖書館')).toBeNull();
  expect(Linking.openURL).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(view.getByText('在 Google Maps 查看路線')));
  const url = new URL(jest.mocked(Linking.openURL).mock.calls[0][0]);
  expect(url.searchParams.get('destination')).toBe('24.23,120.57');
  expect(url.searchParams.get('travelmode')).toBe('driving');
});
