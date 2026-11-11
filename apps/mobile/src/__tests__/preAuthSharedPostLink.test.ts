import * as Linking from 'expo-linking';
import { preAuthLinking } from '../app/preAuthLinking';
import {
  clearPendingSharedPostLink,
  resolvePrivateInitialSharedPostURL,
  stagePendingSharedPostLink,
} from '../app/pendingSharedPostLink';

jest.mock('expo-linking', () => ({
  createURL: () => 'campus://',
  getInitialURL: jest.fn(),
  addEventListener: jest.fn(),
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { release: { deepLinkHost: 'nuni.tw' } } } },
}));

const shared = 'https://nuni.tw/community/post/old-article?schoolId=pu';

beforeEach(() => {
  clearPendingSharedPostLink();
  jest.mocked(Linking.getInitialURL).mockReset();
});
afterEach(() => clearPendingSharedPostLink());

test('a newer cold public library link replaces an older pending signed-out article', async () => {
  const now = Date.now();
  expect(stagePendingSharedPostLink(shared, 'nuni.tw', now)).toBe(true);
  jest.mocked(Linking.getInitialURL).mockResolvedValue('campus://library');

  expect(await preAuthLinking.getInitialURL?.()).toBe('campus://library');
  // The next private navigation must not silently reopen the old article.
  expect(resolvePrivateInitialSharedPostURL(null, 'nuni.tw', now + 1)).toBeNull();
});

test('a foreign cold URL cannot cancel a pending verified app share', async () => {
  const now = Date.now();
  expect(stagePendingSharedPostLink(shared, 'nuni.tw', now)).toBe(true);
  jest.mocked(Linking.getInitialURL).mockResolvedValue('https://foreign.example/library');

  expect(await preAuthLinking.getInitialURL?.()).toBe('https://foreign.example/library');
  expect(resolvePrivateInitialSharedPostURL(null, 'nuni.tw', now + 1)).toBe(shared);
});
