import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { TransportHubScreen } from '../screens/TransportHubScreen';
import {
  planRoutes,
  reverseGeocode,
  searchPlaces,
  PU_LOCATION,
  type RouteOption,
} from '../services/routingService';
import { linkingOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';
import {
  getBusEstimates,
  getBusStopsOfRoute,
  getTrainSchedule,
  getHSRSchedule,
} from '../services/tdxApi';

const mockPosition = jest.fn();
jest.mock('../hooks/useGeolocation', () => ({
  useGeolocation: () => ({ getCurrentPosition: mockPosition, loading: false }),
}));
jest.mock('../state/theme', () => ({ useThemeMode: () => 'light' }));
jest.mock('../ui/navigationTheme', () => ({ TAB_BAR_CONTENT_BOTTOM_PADDING: 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/PuWebView', () => ({ PuWebView: () => null }));
jest.mock('../ui/components', () => {
  const React = require('react');
  const { View, Text, Pressable } = require('react-native');
  return {
    Screen: View,
    Card: ({ title, children }: { title: string; children: React.ReactNode }) =>
      React.createElement(View, null, React.createElement(Text, null, title), children),
    Pill: ({ text }: { text: string }) => React.createElement(Text, null, text),
    Button: ({ text, onPress }: { text: string; onPress?: () => void }) =>
      React.createElement(Pressable, { onPress }, React.createElement(Text, null, text)),
  };
});
jest.mock('../services/routingService', () => ({
  ...jest.requireActual('../services/routingService'),
  planRoutes: jest.fn(),
  searchPlaces: jest.fn(),
  reverseGeocode: jest.fn(),
}));
jest.mock('../services/tronClassWebUiGate', () => ({ linkingOpenWithPuTronClassGate: jest.fn() }));
jest.mock('../services/tdxApi', () => ({
  searchBusRoutes: jest.fn().mockResolvedValue([]),
  getBusEstimates: jest.fn(),
  getBusStopsOfRoute: jest.fn(),
  getTrainSchedule: jest.fn(),
  getHSRSchedule: jest.fn(),
  PU_COMMON_BUS_ROUTES: [{ id: '300', name: '300', desc: '測試路線' }],
  PU_NEARBY_TRAIN_STATIONS: [{ id: '1', name: '沙鹿', desc: '海線' }],
  HSR_TAICHUNG_STATION_ID: '2',
}));

const walkingRoute: RouteOption = {
  id: 'walk',
  mode: 'walking',
  modeLabel: '步行',
  totalDistance: 500,
  totalDuration: 480,
  summary: '供應商回傳的步行路線',
  routeGeometry: [
    [120.563, 24.226],
    [120.686, 24.137],
  ],
  steps: [],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockPosition.mockResolvedValue(null);
  jest.mocked(reverseGeocode).mockResolvedValue('已確認位置');
  jest.mocked(planRoutes).mockResolvedValue([walkingRoute]);
  jest.mocked(linkingOpenWithPuTronClassGate).mockResolvedValue(true);
  jest.mocked(getBusStopsOfRoute).mockResolvedValue([]);
  jest.mocked(getBusEstimates).mockResolvedValue([]);
  jest.mocked(getTrainSchedule).mockResolvedValue([]);
  jest.mocked(getHSRSchedule).mockResolvedValue([]);
});

test.each(['denied', 'failed'])(
  'unknown location (%s) never becomes a campus origin',
  async (state) => {
    if (state === 'failed') mockPosition.mockRejectedValueOnce(new Error('unavailable'));
    const view = render(<TransportHubScreen />);
    await view.findByText('尚未確認起點');
    fireEvent.press(view.getByText('台中車站'));
    expect(planRoutes).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(view.getByText('在地圖選擇起點')));
    const url = new URL(jest.mocked(linkingOpenWithPuTronClassGate).mock.calls[0][0]);
    expect(url.searchParams.get('destination')).toBe('24.137,120.686');
    expect(url.searchParams.has('origin')).toBe(false);
    expect(view.queryByText(/開始導航|路況順暢|已抵達/)).toBeNull();
  },
);

test('only an explicit campus selection passes campus coordinates into routing and Maps', async () => {
  const view = render(<TransportHubScreen />);
  await view.findByText('尚未確認起點');
  fireEvent.press(view.getByText('以靜宜大學為起點'));
  fireEvent.press(view.getByText('台中車站'));
  await view.findByText(walkingRoute.summary);
  expect(planRoutes).toHaveBeenCalledWith(PU_LOCATION, { lat: 24.137, lng: 120.686 });
  await act(async () => fireEvent.press(view.getByText('在地圖確認路線')));
  const url = new URL(jest.mocked(linkingOpenWithPuTronClassGate).mock.calls[0][0]);
  expect(url.searchParams.get('origin')).toBe('24.226,120.563');
  expect(url.searchParams.get('travelmode')).toBe('walking');
});

test('a late GPS result cannot replace an explicitly selected starting point', async () => {
  const pending = deferred<{ latitude: number; longitude: number }>();
  mockPosition.mockReturnValueOnce(pending.promise);
  const view = render(<TransportHubScreen />);
  fireEvent.press(view.getByText('以靜宜大學為起點'));
  await act(async () => pending.resolve({ latitude: 25.1, longitude: 121.2 }));
  expect(view.getByText('靜宜大學（已選起點）')).toBeTruthy();
  fireEvent.press(view.getByText('台中車站'));
  await view.findByText(walkingRoute.summary);
  expect(planRoutes).toHaveBeenCalledWith(PU_LOCATION, expect.anything());
});

test('a later location failure clears the previous origin before another route is planned', async () => {
  mockPosition
    .mockResolvedValueOnce({ latitude: 25.1, longitude: 121.2 })
    .mockResolvedValueOnce(null);
  const view = render(<TransportHubScreen />);
  await view.findByText('已確認位置');
  await act(async () => fireEvent.press(view.getByLabelText('重新定位起點')));
  await view.findByText('尚未確認起點');
  fireEvent.press(view.getByText('台中車站'));
  expect(planRoutes).not.toHaveBeenCalled();
});

test('external map open failures remain visible and never claim navigation started', async () => {
  const view = render(<TransportHubScreen />);
  await view.findByText('尚未確認起點');
  fireEvent.press(view.getByText('台中車站'));
  jest.mocked(linkingOpenWithPuTronClassGate).mockResolvedValueOnce(false);
  await act(async () => fireEvent.press(view.getByText('在地圖選擇起點')));
  expect(view.getByText('無法開啟地圖服務，請稍後重試。')).toBeTruthy();
});

test('unconfirmed bus responses retain the official link instead of claiming no departures', async () => {
  const view = render(<TransportHubScreen />);
  await view.findByText('尚未確認起點');
  fireEvent.press(view.getByText('公車'));
  fireEvent.press(view.getByText('300'));
  await view.findByText('無法確認到站資訊，請到官方查詢。');
  await act(async () => fireEvent.press(view.getByText('到台中公車查詢')));
  expect(linkingOpenWithPuTronClassGate).toHaveBeenCalledWith('https://citybus.taichung.gov.tw/');
  expect(view.queryByText(/沒有班次|今日無更多班次/)).toBeNull();
});

test.each([
  ['台鐵', '到台鐵查詢', 'https://www.railway.gov.tw/tra-tip-web/tip'],
  ['高鐵', '到台灣高鐵查詢', 'https://www.thsrc.com.tw/'],
])('unavailable %s schedules do not claim that service has ended', async (tab, label, url) => {
  jest.mocked(getTrainSchedule).mockRejectedValueOnce(new Error('unauthorized'));
  jest.mocked(getHSRSchedule).mockRejectedValueOnce(new Error('offline'));
  const view = render(<TransportHubScreen />);
  await view.findByText('尚未確認起點');
  fireEvent.press(view.getByText(tab));
  await view.findByText('無法確認後續班次，請到官方查詢。');
  await act(async () => fireEvent.press(view.getByText(label)));
  expect(linkingOpenWithPuTronClassGate).toHaveBeenCalledWith(url);
  expect(view.queryByText('今日無更多班次')).toBeNull();
});

test('unknown bike availability links to the provider without inventing zero vehicles', async () => {
  const view = render(<TransportHubScreen />);
  await view.findByText('尚未確認起點');
  fireEvent.press(view.getByText('YouBike'));
  expect(view.queryByText('0')).toBeNull();
  expect(view.getByText('目前無法在這裡確認車輛與空位數量，請到官方站點查詢。')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('到 YouBike 查詢')));
  expect(linkingOpenWithPuTronClassGate).toHaveBeenCalledWith(
    'https://www.youbike.com.tw/region/main/stations/',
  );
});

test('a slower previous destination search cannot overwrite the latest results', async () => {
  const first = deferred<Awaited<ReturnType<typeof searchPlaces>>>();
  const second = deferred<Awaited<ReturnType<typeof searchPlaces>>>();
  jest.mocked(searchPlaces).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = render(<TransportHubScreen />);
  await view.findByText('尚未確認起點');
  const input = view.getByPlaceholderText('搜尋目的地...');
  fireEvent.changeText(input, '第一筆');
  fireEvent(input, 'submitEditing');
  fireEvent.changeText(input, '第二筆');
  fireEvent(input, 'submitEditing');
  const result = {
    placeId: '2',
    displayName: '新搜尋地點',
    shortName: '新搜尋地點',
    lat: 24.2,
    lng: 120.5,
    type: 'place',
    importance: 1,
  };
  await act(async () => second.resolve([result]));
  await act(async () => first.resolve([{ ...result, placeId: '1', shortName: '舊搜尋地點' }]));
  expect(view.getAllByText('新搜尋地點').length).toBeGreaterThan(0);
  expect(view.queryByText('舊搜尋地點')).toBeNull();
});

test('clearing the search invalidates the pending response', async () => {
  const pending = deferred<Awaited<ReturnType<typeof searchPlaces>>>();
  jest.mocked(searchPlaces).mockReturnValueOnce(pending.promise);
  const view = render(<TransportHubScreen />);
  await view.findByText('尚未確認起點');
  const input = view.getByPlaceholderText('搜尋目的地...');
  fireEvent.changeText(input, '舊查詢');
  fireEvent(input, 'submitEditing');
  fireEvent.changeText(input, '');
  await act(async () =>
    pending.resolve([
      {
        placeId: '1',
        displayName: '舊搜尋地點',
        shortName: '舊搜尋地點',
        lat: 24.2,
        lng: 120.5,
        type: 'place',
        importance: 1,
      },
    ]),
  );
  expect(view.queryByText('舊搜尋地點')).toBeNull();
});
