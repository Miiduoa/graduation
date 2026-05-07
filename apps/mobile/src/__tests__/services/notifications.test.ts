import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc, setDoc } from 'firebase/firestore';

jest.mock('../../firebase', () => ({
  getDb: jest.fn(() => ({})),
}));

import {
  defaultNotificationPreferences,
  loadNotificationPreferences,
  saveNotificationPreferences,
} from '../../services/notifications';

jest.mock('../../services/analytics', () => ({
  trackEvent: jest.fn(),
}));

const mockGetDoc = getDoc as jest.MockedFunction<typeof getDoc>;
const mockSetDoc = setDoc as jest.MockedFunction<typeof setDoc>;
const mockDoc = doc as jest.MockedFunction<typeof doc>;

describe('notification preferences', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await AsyncStorage.clear();
    mockDoc.mockReturnValue({ path: 'users/u1/settings/notifications' } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('falls back to defaults when Firestore is offline and no cache exists', async () => {
    mockGetDoc.mockRejectedValueOnce(
      new Error('Failed to get document because the client is offline.'),
    );

    await expect(loadNotificationPreferences('u1')).resolves.toEqual(
      defaultNotificationPreferences,
    );
  });

  it('uses cached preferences when Firestore is offline', async () => {
    await AsyncStorage.setItem(
      '@notifications.preferences:u1',
      JSON.stringify({ ...defaultNotificationPreferences, messages: false }),
    );
    mockGetDoc.mockRejectedValueOnce(
      new Error('Failed to get document because the client is offline.'),
    );

    await expect(loadNotificationPreferences('u1')).resolves.toMatchObject({ messages: false });
  });

  it('saves preferences locally when Firestore write is offline', async () => {
    mockSetDoc.mockRejectedValueOnce(
      new Error('Failed to get document because the client is offline.'),
    );

    await expect(
      saveNotificationPreferences('u1', { ...defaultNotificationPreferences, events: false }),
    ).resolves.toBeUndefined();

    await expect(AsyncStorage.getItem('@notifications.preferences:u1')).resolves.toContain(
      '"events":false',
    );
  });
});
