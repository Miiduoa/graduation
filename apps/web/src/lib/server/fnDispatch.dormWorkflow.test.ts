// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { dispatchFnRequest, type FnRuntime } from './fnDispatch';
import { createMemoryGroupStore } from './memoryGroupStore';

function fixture(uid = 'student') {
  const store = createMemoryGroupStore([
    ['schools/pu', { dormWorkflowEnabled: true }],
    ['schools/pu/members/student', { status: 'active', role: 'student' }],
    ['users/student', { status: 'active' }],
    [
      'schools/pu/dormResidents/123',
      { userId: 'student', active: true, building: 'A', room: '101', name: '同學' },
    ],
  ]);
  const verifyIdToken = vi.fn(async (token: string) => {
    if (token !== 'fixture-token') throw new Error('invalid token');
    return { uid };
  });
  const runtime: FnRuntime = { db: store.db as FnRuntime['db'], verifyIdToken };
  const call = (data: Record<string, unknown>, token: string | null = 'fixture-token') =>
    dispatchFnRequest(
      'dormWorkflow',
      new Request('https://nuni.tw/api/fn/dormWorkflow', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ data: { schoolId: 'pu', ...data } }),
      }),
      runtime,
    );
  return { call, store, verifyIdToken };
}

it('requires verified auth and active membership', async () => {
  const { call, verifyIdToken } = fixture();
  expect((await call({ action: 'config' }, null)).status).toBe(401);
  expect((await call({ action: 'config' }, 'invalid')).status).toBe(401);
  expect((await call({ action: 'config' })).status).toBe(200);
  expect(verifyIdToken).toHaveBeenCalledWith('fixture-token', true);
  expect((await fixture('outsider').call({ action: 'config' })).status).toBe(403);
});

it('rejects unknown actions and keeps setStaff unreachable', async () => {
  const { call } = fixture();
  for (const action of ['unknown', 'setStaff']) {
    const response = await call({ action });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { message: '未知操作', status: 'INVALID_ARGUMENT' },
    });
  }
  expect((await call({ action: 'workspace' })).status).toBe(403);
});

it('uses the original config, repair, leave and own-history handler', async () => {
  const { call, store } = fixture();
  expect(await (await call({ action: 'config' })).json()).toMatchObject({
    result: { enabled: true, repairs: false },
  });
  const repair = {
    action: 'submitRepair',
    key: 'repair',
    title: '燈壞了',
    description: '無法開啟',
    category: 'electric',
    building: 'A',
    room: '101',
  };
  expect((await call(repair)).status).toBe(200);
  expect((await call(repair)).status).toBe(200);
  expect(
    (await call({ action: 'requestLeave', key: 'leave', date: '2099-01-01', reason: '返家' }))
      .status,
  ).toBe(200);
  expect(await (await call({ action: 'mine' })).json()).toMatchObject({
    result: { repairs: [{ title: '燈壞了' }], leaves: [{ reason: '返家', building: 'A' }] },
  });
  expect([...store.docs.keys()].filter((p) => p.includes('/dormRepairs/'))).toHaveLength(1);
  expect(
    (await call({ action: 'uploadPhoto', base64: 'YQ==', contentType: 'image/png' })).status,
  ).toBe(503);
  expect([...store.docs.keys()].some((p) => p.includes('/dormPhotoUploads/'))).toBe(false);
});

it('has a dedicated bounded budget that allows polling beyond the default ten requests', async () => {
  const { call } = fixture('polling-student');
  for (let i = 0; i < 240; i++) {
    // Outsider membership remains rejected, while every authenticated request counts.
    expect((await call({ action: 'config' })).status).toBe(403);
  }
  expect((await call({ action: 'config' })).status).toBe(429);
});
