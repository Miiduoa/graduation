import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadMockAuthSession, saveMockAuthSession } from '../services/mockAuth';
import { getReleaseConfig } from '../services/release';
jest.mock('../services/release', () => ({
  getReleaseConfig: jest.fn(() => ({ appEnv: 'production' })),
}));
const session = {
  uid: 'demo-student',
  email: 'test@example.test',
  schoolId: 'school',
  displayName: 'Student',
  role: 'student' as const,
};
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(getReleaseConfig).mockReturnValue({ appEnv: 'production' } as never);
});
test('production ignores a cached test identity from an earlier build', async () => {
  await AsyncStorage.setItem('campus.mockAuthSession.v1', JSON.stringify(session));
  expect(await loadMockAuthSession()).toBeNull();
});
test('production cannot save a test identity', async () => {
  await expect(saveMockAuthSession(session)).rejects.toThrow('正式環境');
  expect(await AsyncStorage.getItem('campus.mockAuthSession.v1')).toBeNull();
});
