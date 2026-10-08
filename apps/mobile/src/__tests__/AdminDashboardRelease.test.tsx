import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { getDocs } from 'firebase/firestore';
import { AdminDashboardScreen } from '../screens/AdminDashboardScreen';
const mockDb = {};
jest.mock('../state/auth', () => ({
  useAuth: () => ({
    user: { uid: 'demo_admin_sys', email: 'admin@example.test' },
    isAdmin: true,
    isEditor: false,
  }),
}));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: { id: 'pu', name: '靜宜大學', code: 'PU' } }),
}));
jest.mock('../firebase', () => ({ getDb: () => mockDb, getFunctionsInstance: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...path: string[]) => path.join('/'),
  query: (path: string) => path,
  orderBy: jest.fn(),
  limit: jest.fn(),
  getDocs: jest.fn().mockResolvedValue({ docs: [] }),
}));
jest.mock('../features/engagement', () => ({ useAmbientCues: () => ({ cue: null }) }));
jest.mock('../services/memberDirectory', () => ({
  fetchSchoolDirectoryProfiles: jest.fn().mockResolvedValue([]),
}));
jest.mock('../components/HeaderAvatarButton', () => ({ HeaderAvatarButton: () => null }));
jest.mock('../components/AIMissionControl', () => ({
  AIMissionControl: () => {
    throw new Error('Demo missions must not render in production');
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
test.each(['production', 'preview'])(
  '%s admin reads real collections even when the UID resembles a demo',
  async (appEnv) => {
    jest.clearAllMocks();
    Object.assign(Constants.expoConfig!, { extra: { appEnv, enableUniversalDevAccounts: true } });
    const view = render(<AdminDashboardScreen />);
    await waitFor(() => expect(getDocs).toHaveBeenCalledWith('schools/pu/announcements'));
    expect(getDocs).toHaveBeenCalledWith('schools/pu/clubEvents');
    expect(view.getByText('管理後台')).toBeTruthy();
    expect(view.queryByText('AI 已替你節省')).toBeNull();
  },
);
