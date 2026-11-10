import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { DormitoryScreen } from '../screens/DormitoryScreen';
import { useDormLaundryReminder } from '../hooks/useDormLaundryReminder';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { dormStorageKey } from '@campus/shared/src/dormitory';
import { laundryNotificationAllowed, refreshDormLaundryReminder, selectDormLaundryScope } from '../services/dormLaundryReminder';

jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'pu', name: '靜宜大學' }, selectionReady: true }) }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: 'private-id' } }) }));
jest.mock('../state/nuniSession', () => ({ useOptionalNuniSession: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, input: string) => require('crypto').createHash('sha256').update(input).digest('hex'),
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(), cancelScheduledNotificationAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(), setNotificationChannelAsync: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' }, AndroidImportance: { DEFAULT: 3, NONE: 0 },
}));

const scope = dormStorageKey('firebase:private-id', 'pu');
const later = Date.now() + 90 * 60_000;
const alarms = new Map<string, Notifications.NotificationContentInput>();
const permission = (granted: boolean, canAskAgain = false) =>
  ({ granted, canAskAgain }) as Notifications.NotificationPermissionsStatus;
const write = (key: string, endAt: number | null, notify: boolean) =>
  AsyncStorage.setItem(key, JSON.stringify({ laundryEndAt: endAt, laundryReminder: notify, building: '私密學苑', room: '301' }));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  alarms.clear();
  alarms.set('unrelated', { title: '作業提醒' });
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(true));
  jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockImplementation(async () =>
    [...alarms].map(([identifier, content]) => ({ identifier, content })) as Notifications.NotificationRequest[]);
  jest.mocked(Notifications.cancelScheduledNotificationAsync).mockImplementation(async (id) => { alarms.delete(id); });
  jest.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async (request) => {
    alarms.set(request.identifier!, request.content);
    return request.identifier!;
  });
  await selectDormLaundryScope(null);
});

test('only a user action can prompt, and a denied permission or legacy timer schedules nothing', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(false, true));
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue(permission(false));
  await write(scope, later, false);
  await selectDormLaundryScope(scope);
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(await laundryNotificationAllowed(true)).toBe(false);
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  await write(scope, later, true);
  expect(await refreshDormLaundryReminder(scope)).toBe('denied');
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect((JSON.parse((await AsyncStorage.getItem(scope))!) as {laundryEndAt:number}).laundryEndAt).toBe(later);
});

test('a cold start, repeated refresh, extension, clearing and a new timer own at most one dated request', async () => {
  await write(scope, later, true);
  expect(await selectDormLaundryScope(scope)).toBe('scheduled');
  const first = jest.mocked(Notifications.scheduleNotificationAsync).mock.calls[0][0];
  expect(first.trigger).toMatchObject({ type: 'date', date: new Date(later) });
  expect(first.content).toEqual({ title: '洗衣計時已到', body: '你設定的取衣時間到了，可以去看看衣物。', sound: true });
  expect(first.identifier).toMatch(/^campus\.dorm\.laundry\.v1\.[a-f0-9]{64}$/);
  await refreshDormLaundryReminder(scope);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  await write(scope, later + 600000, true);
  await refreshDormLaundryReminder(scope);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenLastCalledWith(expect.objectContaining({
    identifier: expect.not.stringMatching(first.identifier!), trigger: expect.objectContaining({ date: new Date(later + 600000) }),
  }));
  await write(scope, null, false);
  await refreshDormLaundryReminder(scope);
  await selectDormLaundryScope(scope);
  expect([...alarms.keys()]).toEqual(['unrelated']);
  await write(scope, later, true);
  await refreshDormLaundryReminder(scope);
  expect([...alarms.keys()]).toEqual(['unrelated', first.identifier]);
});

test.each([dormStorageKey('firebase:private-id', 'nthu'), dormStorageKey('platform:another-account', 'pu')])(
  'changing the selected school or account preserves timers but suppresses inactive notifications', async (other) => {
    await write(scope, later, true);
    await write(other, later + 700000, false);
    await selectDormLaundryScope(scope);
    await selectDormLaundryScope(other);
    await refreshDormLaundryReminder(scope);
    expect([...alarms.keys()]).toEqual(['unrelated']);
    await selectDormLaundryScope(scope);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenLastCalledWith(expect.objectContaining({ trigger: expect.objectContaining({ date: new Date(later) }) }));
    await selectDormLaundryScope(null);
    expect([...alarms.keys()]).toEqual(['unrelated']);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  },
);

test('logout cancels pending notifications without waiting for a blocked previous account read', async () => {
  await write(scope, later, true);
  await selectDormLaundryScope(scope);
  expect(alarms.size).toBe(2);
  let finish!: (raw: string | null) => void;
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const oldRefresh = refreshDormLaundryReminder(scope);
  await selectDormLaundryScope(null);
  expect([...alarms.keys()]).toEqual(['unrelated']);
  finish(JSON.stringify({ laundryEndAt: later, laundryReminder: true }));
  await oldRefresh;
  expect([...alarms.keys()]).toEqual(['unrelated']);
});

test('a scope switch during native scheduling revokes the late alarm', async () => {
  let finish!: () => void;
  let started!: () => void;
  const scheduled = new Promise<void>((resolve) => { started = resolve; });
  jest.mocked(Notifications.scheduleNotificationAsync).mockImplementationOnce(async (request) => {
    started();
    await new Promise<void>((resolve) => { finish = resolve; });
    alarms.set(request.identifier!, request.content);
    return request.identifier!;
  });
  await write(scope, later, true);
  const oldRun = selectDormLaundryScope(scope);
  await scheduled;
  const next = selectDormLaundryScope(null);
  finish();
  await Promise.all([oldRun, next]);
  expect([...alarms.keys()]).toEqual(['unrelated']);
});

test('expired timers stay silent and the Android channel is created before requesting permission', async () => {
  const original = Platform.OS;
  try {
    Platform.OS = 'android';
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(false, true));
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue(permission(true));
    expect(await laundryNotificationAllowed(true)).toBe(true);
    const channel = jest.mocked(Notifications.setNotificationChannelAsync);
    expect(channel.mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(Notifications.requestPermissionsAsync).mock.invocationCallOrder[0]);
    await write(scope, Date.now() - 1000, true);
    await selectDormLaundryScope(scope);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  } finally {
    Platform.OS = original;
  }
});

test('changing the deadline still removes the old alarm when the replacement fails', async () => {
  await write(scope, later, true);
  await selectDormLaundryScope(scope);
  await write(scope, later + 600000, true);
  jest.mocked(Notifications.scheduleNotificationAsync).mockRejectedValueOnce(new Error('OS unavailable'));
  await expect(refreshDormLaundryReminder(scope)).rejects.toThrow();
  expect([...alarms.keys()]).toEqual(['unrelated']);
  await refreshDormLaundryReminder(scope);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenLastCalledWith(expect.objectContaining({ trigger: expect.objectContaining({ date: new Date(later + 600000) }) }));
});

test('clearing a timer does not confirm cancellation if a native request still remains', async () => {
  await write(scope, later, true);
  await selectDormLaundryScope(scope);
  await write(scope, null, false);
  jest.mocked(Notifications.cancelScheduledNotificationAsync).mockResolvedValueOnce(undefined);
  await expect(refreshDormLaundryReminder(scope)).rejects.toThrow('cancellation is unconfirmed');
  expect(alarms.size).toBe(2);
  await refreshDormLaundryReminder(scope);
  expect([...alarms.keys()]).toEqual(['unrelated']);
});

test('a native API success without a pending alarm cannot be confirmed', async () => {
  await write(scope, later, true);
  jest.mocked(Notifications.scheduleNotificationAsync).mockImplementationOnce(async (request) => request.identifier!);
  await expect(selectDormLaundryScope(scope)).rejects.toThrow('was not scheduled');
  expect([...alarms.keys()]).toEqual(['unrelated']);
});

function DormApp() {
  useDormLaundryReminder();
  return <DormitoryScreen />;
}

test('a resident can start a timer after denying notifications, turn reminders on later, extend and clear it', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(false, true));
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue(permission(false));
  const screen = render(<DormApp />);
  await screen.findByText('我的住宿備忘');
  fireEvent.press(screen.getByText('洗衣計時'));
  await act(async () => fireEvent.press(screen.getByText('開始計時並提醒')));
  expect(await screen.findByText(/手機通知未啟用/)).toBeTruthy();
  const read = async () => JSON.parse((await AsyncStorage.getItem(scope))!);
  const started = await read();
  expect(started.laundryEndAt).toBeGreaterThan(Date.now());
  expect(started.laundryReminder).toBe(false);
  expect(alarms.size).toBe(1);
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(true));
  await act(async () => fireEvent.press(screen.getByText('開啟到時提醒')));
  expect((await read()).laundryReminder).toBe(true);
  expect(alarms.size).toBe(2);
  await act(async () => fireEvent.press(screen.getByText('延長 10 分鐘')));
  expect((await read()).laundryEndAt).toBe(started.laundryEndAt + 600000);
  expect(alarms.size).toBe(2);
  await act(async () => fireEvent.press(screen.getByText('清除計時')));
  expect(await screen.findByText('尚未開始')).toBeTruthy();
  expect([...alarms.keys()]).toEqual(['unrelated']);
});
