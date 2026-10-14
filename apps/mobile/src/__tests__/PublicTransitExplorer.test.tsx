import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { PublicTransitExplorer } from '../components/PublicTransitExplorer';
import {
  queryPublicTransit,
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

test('switching school cancels previous searches and clears the old station list', async () => {
  let finish!: (value: PublicTransitResult) => void;
  jest.mocked(queryPublicTransit).mockImplementationOnce(
    () => new Promise((resolve) => { finish = resolve; }),
  );
  const view = render(<PublicTransitExplorer key="nthu" schoolId="nthu" />);
  fireEvent.changeText(view.getByLabelText('搜尋公車站名'), '清華大學');
  fireEvent.press(view.getByText('搜尋官方站牌'));
  view.rerender(<PublicTransitExplorer key="ncku" schoolId="ncku" />);
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
