import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { getDocFromServer, setDoc } from 'firebase/firestore';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import {
  defaultNotificationPreferences,
  loadNotificationPreferencesState,
  saveNotificationPreferences,
  enablePushNotificationsForUser,
  syncPushTokenForUser,
} from '../../services/notifications';
let mockUid: string | null = 'u1';
let mockMode = false;
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3 },
}));
jest.mock('../../firebase', () => ({
  getDb: () => ({}),
  getAuthInstance: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
  isFirebaseMockMode: () => mockMode,
}));
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDocFromServer: jest.fn(),
  getDoc: jest.fn(),
  setDoc: jest.fn(),
  deleteDoc: jest.fn(),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
}));
jest.mock('../../services/analytics', () => ({ trackEvent: jest.fn() }));
const read = getDocFromServer as jest.Mock;
const write = setDoc as jest.Mock;
const cacheKey = '@notifications.preferences:u1';
const draftKey = `${cacheKey}:pending:s1`;
const prefs = { ...defaultNotificationPreferences, events: false };
const scope = { schoolId: 's1' };
const offline = Object.assign(new Error('client is offline'), { code: 'unavailable' });
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  jest.clearAllMocks();
  read.mockReset();
  write.mockReset();
  mockUid = 'u1';
  mockMode = false;
  await AsyncStorage.clear();
  (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true, isInternetReachable: true });
  read.mockResolvedValue({ exists: () => true, data: () => defaultNotificationPreferences });
  write.mockResolvedValue(undefined);
  Object.defineProperty(Device, 'isDevice', { value: true, configurable: true });
  Object.assign(Constants, { easConfig: { projectId: 'project-123' } });
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
    status: 'granted',
    canAskAgain: true,
  });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
    status: 'granted',
    canAskAgain: true,
  });
  (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
    data: 'ExpoPushToken[123]',
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
test('server read and absent document use confirmed account preferences, not stale local cache', async () => {
  await AsyncStorage.setItem(cacheKey, JSON.stringify(prefs));
  read.mockResolvedValue({ exists: () => false });
  await expect(loadNotificationPreferencesState('u1', scope)).resolves.toEqual({
    preferences: defaultNotificationPreferences,
    source: 'server',
  });
  expect(read.mock.calls[0][0].path).toBe('users/u1/settings/notifications');
});
test('offline distinguishes no known settings from previously read cache', async () => {
  read.mockRejectedValue(offline);
  await expect(loadNotificationPreferencesState('u1', scope)).resolves.toMatchObject({
    source: 'unavailable',
  });
  await AsyncStorage.setItem(cacheKey, JSON.stringify(prefs));
  await expect(loadNotificationPreferencesState('u1', scope)).resolves.toEqual({
    source: 'cache',
    preferences: prefs,
  });
});
test('local draft is school-scoped and never auto-sent or silently replaced during a server read', async () => {
  await AsyncStorage.setItem(draftKey, JSON.stringify(prefs));
  await expect(loadNotificationPreferencesState('u1', scope)).resolves.toEqual({
    source: 'local',
    preferences: prefs,
  });
  await expect(loadNotificationPreferencesState('u1', { schoolId: 's2' })).resolves.toMatchObject({
    source: 'server',
    preferences: { events: true },
  });
  expect(write).not.toHaveBeenCalled();
});
test('permission denied is a read failure even when old cached preferences exist', async () => {
  await AsyncStorage.setItem(cacheKey, JSON.stringify(prefs));
  read.mockRejectedValue(
    Object.assign(new Error('permission-denied'), { code: 'permission-denied' }),
  );
  await expect(loadNotificationPreferencesState('u1', scope)).rejects.toThrow('permission-denied');
});
test('offline save returns local only after the draft is persisted and never dispatches a cloud write', async () => {
  (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });
  await expect(saveNotificationPreferences('u1', prefs, scope)).resolves.toEqual({
    status: 'local',
  });
  expect(JSON.parse((await AsyncStorage.getItem(draftKey))!)).toEqual(prefs);
  expect(write).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(cacheKey)).toBeNull();
});
test('server acknowledgment replaces cache and removes the pending draft', async () => {
  await AsyncStorage.setItem(draftKey, JSON.stringify(defaultNotificationPreferences));
  await expect(saveNotificationPreferences('u1', prefs, scope)).resolves.toEqual({
    status: 'server',
  });
  expect(write).toHaveBeenCalledWith(
    { path: 'users/u1/settings/notifications' },
    { ...prefs, updatedAt: 'SERVER_TIMESTAMP' },
    { merge: true },
  );
  expect(await AsyncStorage.getItem(draftKey)).toBeNull();
  expect(JSON.parse((await AsyncStorage.getItem(cacheKey))!)).toEqual(prefs);
});
test('failed server save rejects without replacing the last confirmed cache', async () => {
  await AsyncStorage.setItem(cacheKey, JSON.stringify(defaultNotificationPreferences));
  write.mockRejectedValue(new Error('permission-denied'));
  await expect(saveNotificationPreferences('u1', prefs, scope)).rejects.toThrow(
    'permission-denied',
  );
  expect(JSON.parse((await AsyncStorage.getItem(cacheKey))!).events).toBe(true);
});
test('failed local persistence is not reported as saved', async () => {
  (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('storage full'));
  await expect(saveNotificationPreferences('u1', prefs, scope)).rejects.toThrow('storage full');
});
test('write timeout is uncertain local state, and late acknowledgment does not promote it or start another write', async () => {
  jest.useFakeTimers();
  const pending = deferred();
  write.mockReturnValueOnce(pending.promise);
  const promise = saveNotificationPreferences('u1', prefs, scope);
  await jest.advanceTimersByTimeAsync(12001);
  await expect(promise).resolves.toEqual({ status: 'local' });
  pending.resolve(undefined);
  await Promise.resolve();
  expect(write).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(cacheKey)).toBeNull();
  expect(await AsyncStorage.getItem(draftKey)).not.toBeNull();
});
test('account or school change while checking connectivity prevents dispatching old preferences', async () => {
  const pending = deferred();
  (NetInfo.fetch as jest.Mock).mockReturnValue(pending.promise);
  let active = true;
  const promise = saveNotificationPreferences('u1', prefs, {
    schoolId: 's1',
    isCurrent: () => active,
  });
  active = false;
  mockUid = 'u2';
  pending.resolve({ isConnected: true });
  await expect(promise).rejects.toThrow('account changed');
  expect(write).not.toHaveBeenCalled();
});
test('a late read cannot cache account data after the context has changed', async () => {
  const pending = deferred();
  read.mockReturnValueOnce(pending.promise);
  let active = true;
  const promise = loadNotificationPreferencesState('u1', {
    schoolId: 's1',
    isCurrent: () => active,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(read).toHaveBeenCalledTimes(1);
  active = false;
  pending.resolve({ exists: () => true, data: () => prefs });
  await expect(promise).rejects.toThrow('account changed');
  expect(await AsyncStorage.getItem(cacheKey)).toBeNull();
});
test('preference payload normalizes unsafe cached types and validates submitted times', async () => {
  read.mockResolvedValue({
    exists: () => true,
    data: () => ({
      enabled: 'false',
      announcements: false,
      quietHoursStart: '99:00',
      quietHoursEnd: '09:30',
    }),
  });
  await expect(loadNotificationPreferencesState('u1', scope)).resolves.toMatchObject({
    preferences: {
      enabled: true,
      announcements: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '09:30',
    },
  });
  await expect(
    saveNotificationPreferences('u1', { ...prefs, quietHoursStart: '99:00' }, scope),
  ).rejects.toThrow('Invalid quiet hours');
  expect(write).not.toHaveBeenCalled();
});
test('push has distinct unsupported, unconfigured, denied and unavailable results', async () => {
  Object.defineProperty(Device, 'isDevice', { value: false, configurable: true });
  await expect(enablePushNotificationsForUser('u1')).resolves.toEqual({ status: 'unsupported' });
  Object.defineProperty(Device, 'isDevice', { value: true, configurable: true });
  Object.assign(Constants, { easConfig: null });
  await expect(enablePushNotificationsForUser('u1')).resolves.toEqual({ status: 'unconfigured' });
  Object.assign(Constants, { easConfig: { projectId: 'project-123' } });
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
    status: 'denied',
    canAskAgain: false,
  });
  await expect(enablePushNotificationsForUser('u1')).resolves.toEqual({ status: 'denied' });
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Notifications.getExpoPushTokenAsync as jest.Mock).mockRejectedValue(new Error('network'));
  await expect(enablePushNotificationsForUser('u1')).resolves.toEqual({ status: 'unavailable' });
  expect(write).not.toHaveBeenCalled();
});
test('push registration awaits server save and keeps the existing sync token contract', async () => {
  await expect(syncPushTokenForUser('u1')).resolves.toBe('ExpoPushToken[123]');
  expect(write.mock.calls[0][0].path).toBe('users/u1/pushTokens/ExpoPushToken_123_');
  expect(write.mock.calls[0][1].type).toBe('expo');
});
test('late permission response cannot register the prior account after switching account', async () => {
  const pending = deferred();
  (Notifications.getPermissionsAsync as jest.Mock).mockReturnValue(pending.promise);
  const promise = enablePushNotificationsForUser('u1');
  mockUid = 'u2';
  pending.resolve({ status: 'granted', canAskAgain: true });
  await expect(promise).rejects.toThrow('account changed');
  expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

test('an older online completion cannot erase a newer offline draft for the same account and school', async () => {
  const old = deferred();
  write.mockReturnValueOnce(old.promise);
  const earlier = saveNotificationPreferences('u1', defaultNotificationPreferences, scope);
  const rejected = expect(earlier).rejects.toThrow('superseded');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(write).toHaveBeenCalledTimes(1);
  (NetInfo.fetch as jest.Mock).mockResolvedValueOnce({ isConnected: false });
  await expect(saveNotificationPreferences('u1', prefs, scope)).resolves.toEqual({
    status: 'local',
  });
  old.resolve(undefined);
  await rejected;
  expect(JSON.parse((await AsyncStorage.getItem(draftKey))!)).toEqual(prefs);
  expect(await AsyncStorage.getItem(cacheKey)).toBeNull();
});
test('an older server response from another school cannot overwrite a newer account cache', async () => {
  const old = deferred();
  write.mockReturnValueOnce(old.promise);
  const earlier = saveNotificationPreferences('u1', defaultNotificationPreferences, scope);
  const rejected = expect(earlier).rejects.toThrow('superseded');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(write).toHaveBeenCalledTimes(1);
  await expect(saveNotificationPreferences('u1', prefs, { schoolId: 's2' })).resolves.toEqual({
    status: 'server',
  });
  old.resolve(undefined);
  await rejected;
  expect(JSON.parse((await AsyncStorage.getItem(cacheKey))!)).toEqual(prefs);
});
test('an earlier settings read cannot replace cache from a later acknowledged save', async () => {
  const old = deferred();
  read.mockReturnValueOnce(old.promise);
  const earlier = loadNotificationPreferencesState('u1', scope);
  const rejected = expect(earlier).rejects.toThrow('superseded');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(read).toHaveBeenCalledTimes(1);
  await saveNotificationPreferences('u1', prefs, scope);
  old.resolve({ exists: () => true, data: () => defaultNotificationPreferences });
  await rejected;
  expect(JSON.parse((await AsyncStorage.getItem(cacheKey))!)).toEqual(prefs);
});

test('Android creates notification channels before requesting permission and obtaining a token', async () => {
  const previous = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  const order: string[] = [];
  (Notifications.setNotificationChannelAsync as jest.Mock).mockImplementation(async () => {
    order.push('channel');
  });
  (Notifications.getPermissionsAsync as jest.Mock).mockImplementationOnce(async () => {
    order.push('permission');
    return { status: 'undetermined', canAskAgain: true };
  });
  (Notifications.requestPermissionsAsync as jest.Mock).mockImplementationOnce(async () => {
    order.push('prompt');
    return { status: 'granted' };
  });
  (Notifications.getExpoPushTokenAsync as jest.Mock).mockImplementationOnce(async () => {
    order.push('token');
    return { data: 'ExpoPushToken[123]' };
  });
  try {
    await expect(enablePushNotificationsForUser('u1')).resolves.toMatchObject({
      status: 'enabled',
    });
    expect(order.indexOf('channel')).toBeLessThan(order.indexOf('permission'));
    expect(order.indexOf('prompt')).toBeLessThan(order.indexOf('token'));
  } finally {
    Object.defineProperty(Platform, 'OS', { value: previous, configurable: true });
  }
});

test('push token timeout stays unavailable even if the token arrives later', async () => {
  jest.useFakeTimers();
  const pending = deferred();
  (Notifications.getExpoPushTokenAsync as jest.Mock).mockReturnValueOnce(pending.promise);
  const registration = enablePushNotificationsForUser('u1');
  await jest.advanceTimersByTimeAsync(12001);
  await expect(registration).resolves.toEqual({ status: 'unavailable' });
  pending.resolve({ data: 'ExpoPushToken[late]' });
  await Promise.resolve();
  expect(write).not.toHaveBeenCalled();
});
