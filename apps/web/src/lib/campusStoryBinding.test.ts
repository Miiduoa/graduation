import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCloudFunctionUrl } from './cloudFunctions';
import { ensureCampusStoryBinding } from './campusStoryBinding';

const { fetchMock, getIdToken, auth } = vi.hoisted(() => {
  const getIdToken = vi.fn(async () => 'story-id-token');
  return {
    fetchMock: vi.fn(),
    getIdToken,
    auth: {
      currentUser: { uid: 'alice', getIdToken } as {
        uid: string;
        getIdToken: () => Promise<string>;
      } | null,
    },
  };
});

vi.mock('@/features/auth/client', () => ({
  getAuth: () => auth,
}));

beforeEach(() => {
  vi.clearAllMocks();
  auth.currentUser = { uid: 'alice', getIdToken };
  getIdToken.mockResolvedValue('story-id-token');
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ result: { success: true, stamped: ['pu'] } })));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('posts to the same-origin hosted route with the Firebase ID token', async () => {
  await ensureCampusStoryBinding();
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/fn/ensureCampusStoryBinding',
    expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer story-id-token' },
      body: JSON.stringify({ data: {} }),
      cache: 'no-store',
    }),
  );
});

it('keeps the hosted route even when a Cloud Functions base URL is set', () => {
  expect(
    getCloudFunctionUrl('ensureCampusStoryBinding', {
      env: {
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'campus-one-tw',
        NEXT_PUBLIC_FUNCTIONS_BASE_URL: 'https://nuni-functions.fly.dev',
      },
    }),
  ).toBe('/api/fn/ensureCampusStoryBinding');
  expect(getCloudFunctionUrl('ensureCampusStoryBinding', { env: {} })).toBe(
    '/api/fn/ensureCampusStoryBinding',
  );
});

it('does not call the network when Firebase Auth is missing', async () => {
  auth.currentUser = null;
  await ensureCampusStoryBinding();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(getIdToken).not.toHaveBeenCalled();
});

it('does not import httpsCallable', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/campusStoryBinding.ts'), 'utf8');
  expect(source).not.toMatch(/httpsCallable/);
  expect(source).toMatch(/getCloudFunctionUrl\('ensureCampusStoryBinding'\)/);
});
