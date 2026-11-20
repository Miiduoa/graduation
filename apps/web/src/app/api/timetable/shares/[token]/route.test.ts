// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { GET } from './route';

const snapshot = vi.hoisted(() => vi.fn());
vi.mock('@/lib/server/firebaseAdmin', () => ({
  getFirebaseAdmin: async () => ({
    db: { collection: () => ({ doc: () => ({ get: snapshot }) }) },
  }),
}));

function get(token: string) {
  return GET(new Request('https://campus.example/'), { params: Promise.resolve({ token }) });
}

it('only returns public fields from an active legacy timetable', async () => {
  snapshot.mockResolvedValueOnce({
    exists: true,
    data: () => ({
      revoked: false, ownerUid: 'private-owner', meta: { title: '秋季', email: 'private@example.test' },
      courses: [{ id: 'db', name: '資料庫', teacher: 'private-teacher' }],
      expiresAt: { toMillis: () => Date.now() + 60_000 },
    }),
  });
  const response = await get('old-token');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const data = await response.json();
  expect(data.meta).toEqual({ title: '秋季' });
  expect(data.courses[0]).toMatchObject({ id: 'db', teacher: '' });
  expect(JSON.stringify(data)).not.toContain('private');
});

it.each([
  { revoked: true, code: 'revoked' },
  { revoked: 'false', code: 'revoked' },
  { revoked: undefined, code: 'revoked' },
  { revoked: false, code: 'expired' },
])('withholds the contents of a $code legacy share', async ({ revoked, code }) => {
  snapshot.mockResolvedValueOnce({
    exists: true,
    data: () => ({ revoked, meta: { title: 'private' }, expiresAt: { toMillis: () => 1 } }),
  });
  const response = await get('old-token');
  expect(response.status).toBe(410);
  expect(await response.json()).toMatchObject({ code });
});
