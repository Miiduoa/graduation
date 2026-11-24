import React from 'react';
import { Animated } from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native/pure';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NetworkStatusBanner, OfflineIndicator } from '../../ui/OfflineBanner';
import {
  getNetworkStatus,
  isSyncing,
  getOfflineQueueLength,
  subscribeToNetworkStatus,
  subscribeToSyncEvents,
  type NetworkStatus,
} from '../../services/offline';

let mockReducedMotion = true;
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReducedMotion }));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../services/offline', () => ({
  getNetworkStatus: jest.fn(),
  isSyncing: jest.fn(() => false),
  getOfflineQueueLength: jest.fn(),
  subscribeToNetworkStatus: jest.fn(),
  subscribeToSyncEvents: jest.fn(),
}));

const initial = { isConnected: false, isInternetReachable: null, type: 'unknown' };
const offline = { isConnected: true, isInternetReachable: false, type: 'wifi' };
const checking = { isConnected: true, isInternetReachable: null, type: 'wifi' };
const online = { isConnected: true, isInternetReachable: true, type: 'wifi' };
let snapshot: NetworkStatus;
const listeners = new Set<(state: NetworkStatus) => void>();
let sync: Parameters<typeof subscribeToSyncEvents>[0] | undefined;

async function publish(state: NetworkStatus) {
  await act(async () => {
    snapshot = state;
    listeners.forEach((listener) => listener(state));
  });
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  jest.clearAllMocks();
  mockReducedMotion = true;
  jest.mocked(isSyncing).mockReturnValue(false);
  snapshot = initial;
  listeners.clear();
  sync = undefined;
  jest.mocked(getNetworkStatus).mockImplementation(() => snapshot);
  jest.mocked(subscribeToNetworkStatus).mockImplementation((listener) => {
    listener(snapshot);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  });
  jest.mocked(subscribeToSyncEvents).mockImplementation((listener) => {
    sync = listener;
    return () => {
      sync = undefined;
    };
  });
  jest.mocked(getOfflineQueueLength).mockResolvedValue(0);
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('initial reachability checks and a normal startup never announce a reconnection', async () => {
  const view = render(<NetworkStatusBanner />);
  await act(async () => {});
  expect(view.toJSON()).toBeNull();
  await publish(checking);
  await publish(online);
  expect(view.toJSON()).toBeNull();
  expect(getOfflineQueueLength).not.toHaveBeenCalled();
});

test('Wi-Fi without internet shows help, then only confirmed recovery shows a dismissible status', async () => {
  const view = render(<NetworkStatusBanner />);
  await publish(offline);
  const help = view.getByRole('button', { expanded: false });
  fireEvent.press(help);
  expect(view.getByRole('button', { expanded: true })).toBeVisible();
  await publish(checking);
  expect(view.queryByText(/已重新連線/)).toBeNull();
  await publish(online);
  expect(view.getByText(/已重新連線/)).toBeVisible();
  act(() => {
    jest.advanceTimersByTime(4500);
  });
  await publish(offline);
  expect(view.getByRole('button', { expanded: false })).toBeVisible();
  await publish(online);
  act(() => {
    jest.advanceTimersByTime(600);
  });
  expect(view.getByText(/已重新連線/)).toBeVisible();
  fireEvent.press(view.getByRole('button', { name: '關閉網路狀態提示' }));
  await publish(online);
  expect(view.toJSON()).toBeNull();
});

test('an earlier queue read cannot overwrite a newer queued event, and recovery does not claim those changes have synced', async () => {
  let finishRead!: (count: number) => void;
  jest.mocked(getOfflineQueueLength).mockImplementationOnce(
    () =>
      new Promise<number>((resolve) => {
        finishRead = resolve;
      }),
  );
  const view = render(<NetworkStatusBanner />);
  await publish(offline);
  expect(sync).toBeDefined();
  await act(async () => {
    sync!({ type: 'queued', queueLength: 2 });
  });
  await act(async () => {
    finishRead(7);
  });
  expect(view.getByText(/2 項待同步/)).toBeVisible();
  jest.mocked(getOfflineQueueLength).mockResolvedValue(2);
  await publish(online);
  expect(view.getByText(/2 項待同步/)).toBeVisible();
  expect(view.queryByText(/正在同步/)).toBeNull();
  act(() => {
    jest.advanceTimersByTime(5000);
  });
  expect(view.toJSON()).toBeNull();
  expect(sync).toBeUndefined();
});

test('a saved preference leaves the offline notice visible without an inert disclosure', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce('true');
  const view = render(<NetworkStatusBanner />);
  await publish(offline);
  expect(view.getByText(/離線/)).toBeVisible();
  expect(view.queryByRole('button')).toBeNull();
});

test('compact offline indicators also follow reachability on Wi-Fi', async () => {
  const view = render(<OfflineIndicator />);
  expect(view.toJSON()).toBeNull();
  await publish(offline);
  expect(view.getByText('離線')).toBeVisible();
  await publish(online);
  expect(view.toJSON()).toBeNull();
  view.unmount();
  expect(listeners.size).toBe(0);
});

test('disclosure remains immediately operable when a reduced motion change stops the indicator', async () => {
  mockReducedMotion = false;
  const stop = jest.fn();
  const timing = jest
    .spyOn(Animated, 'timing')
    .mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() });
  const view = render(<NetworkStatusBanner />);
  await publish(offline);
  expect(timing).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { expanded: false }));
  expect(timing).toHaveBeenCalledTimes(1);
  expect(view.getByRole('button', { expanded: true })).toBeVisible();
  mockReducedMotion = true;
  view.rerender(<NetworkStatusBanner />);
  expect(stop).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByRole('button', { expanded: true }));
  expect(view.getByRole('button', { expanded: false })).toBeVisible();
  expect(timing).toHaveBeenCalledTimes(1);
});

test('sync start and completion change the recovery message without assuming success', async () => {
  const view = render(<NetworkStatusBanner />);
  await publish(offline);
  await publish(online);
  jest.mocked(isSyncing).mockReturnValue(true);
  await act(async () => {
    sync!({ type: 'sync_start', total: 3 });
  });
  expect(view.getByText(/已重新連線.*正在同步/)).toBeVisible();
  jest.mocked(isSyncing).mockReturnValue(false);
  jest.mocked(getOfflineQueueLength).mockResolvedValue(1);
  await act(async () => {
    sync!({ type: 'sync_complete', processed: 3, total: 3 });
  });
  expect(view.getByText(/已重新連線.*1 項待同步/)).toBeVisible();
});
