// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { dispatchFnRequest, type FnRuntime } from './fnDispatch';
import { createMemoryGroupStore } from './memoryGroupStore';

const storage = vi.hoisted(() => ({
  getStorage: vi.fn(() => {
    throw new Error('no admin app');
  }),
}));
vi.mock('firebase-admin/storage', () => storage);
afterEach(() => vi.restoreAllMocks());

function fixture(uid = 'student', messaging?: FnRuntime['messaging']) {
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
  const runtime: FnRuntime = { db: store.db as FnRuntime['db'], verifyIdToken, messaging };
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

it('publishes to the resident workspace and reports provider acceptance for eligible devices', async () => {
  const sendEachForMulticast = vi.fn().mockResolvedValue({
    responses: [{ success: true }, { success: false, error: { code: 'messaging/internal-error' } }],
  });
  const { call, store } = fixture('staff', { sendEachForMulticast });
  store.docs.set('schools/pu/members/staff', { role: 'staff', status: 'active' });
  store.docs.set('schools/pu/dormStaffRoles/staff', { status: 'active', packages: true, buildings: ['A'] });
  store.docs.set('users/student/pushTokens/one', { token: 'device-one', type: 'fcm' });
  store.docs.set('users/student/pushTokens/two', { token: 'device-two', type: 'fcm' });
  const notice = { action: 'announce', building: 'A', title: '停水', body: '週三下午供水暫停', key: 'water' };
  const published = await (await call(notice)).json();
  expect(published).toMatchObject({ result: { acceptedRecipients: 1, recipients: 1 } });
  expect(await (await call(notice)).json()).toEqual(published);
  const inboxPrefix = 'users/student/notifications/';
  const inboxRows = [...store.docs].filter(([path]) => path.startsWith(inboxPrefix));
  expect(inboxRows).toHaveLength(1);
  const [[path, inbox]] = inboxRows;
  const inboxNotificationId = path.slice(inboxPrefix.length);
  expect(inboxNotificationId).toMatch(/^dorm_[0-9a-f]{64}$/);
  expect(inbox.data).toEqual({
    type: 'announcement',
    channel: 'dormitory',
    schoolId: 'pu',
    dormAnnouncementId: published.result.id,
    inboxNotificationId,
    deliveryKey: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  });
  expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
  expect(sendEachForMulticast).toHaveBeenCalledWith(expect.objectContaining({
    tokens: ['device-one', 'device-two'],
    data: inbox.data,
  }));
  store.docs.set('users/student/settings/notifications', { announcements: false });
  expect(await (await call({ ...notice, key: 'next' })).json()).toMatchObject({
    result: { acceptedRecipients: 0, recipients: 1 },
  });
  expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
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

it('uses Admin Storage for authenticated uploads and owner-only signed photo reads', async () => {
  const save = vi.fn(async () => undefined);
  const getSignedUrl = vi.fn(async () => ['https://storage.example/signed']);
  const file = vi.fn(() => ({ save, getSignedUrl }));
  const bucket = vi.fn(() => ({ file }));
  storage.getStorage.mockReturnValueOnce({ bucket } as never);
  const { call, store } = fixture();
  const upload = await call({ action: 'uploadPhoto', base64: 'YQ==', contentType: 'image/png' });
  expect(upload.status).toBe(200);
  const {
    result: { path },
  } = await upload.json();
  expect(path).toMatch(/^dorm-private\/[0-9a-f-]{36}$/);
  expect(save).toHaveBeenCalledWith(
    Buffer.from('a'),
    expect.objectContaining({ resumable: false }),
  );
  store.docs.set('schools/pu/dormRepairs/photo-ticket', {
    userId: 'student',
    workflow: 'dorm_staff',
    images: [path],
  });
  storage.getStorage.mockReturnValueOnce({ bucket } as never);
  expect(
    await (await call({ action: 'repairPhoto', id: 'photo-ticket', index: 0 })).json(),
  ).toMatchObject({ result: { url: 'https://storage.example/signed' } });
  expect(getSignedUrl).toHaveBeenCalledWith(expect.objectContaining({ action: 'read' }));
  store.docs.set('schools/pu/dormRepairs/photo-ticket', {
    userId: 'other',
    workflow: 'dorm_staff',
    images: [path],
  });
  expect((await call({ action: 'repairPhoto', id: 'photo-ticket', index: 0 })).status).toBe(403);
  expect(getSignedUrl).toHaveBeenCalledTimes(1);
});

it('accepts a 6 MiB photo plus its JSON envelope through the hosted entry', async () => {
  const bytes = Buffer.alloc(6 * 1024 * 1024, 97);
  const save = vi.fn(async (bytes: Buffer, options: unknown) => ({ bytes, options }));
  const file = vi.fn(() => ({ save }));
  const bucket = vi.fn(() => ({ file }));
  storage.getStorage.mockReturnValueOnce({ bucket } as never);
  const { call, verifyIdToken } = fixture();
  const response = await call({
    action: 'uploadPhoto', base64: bytes.toString('base64'), contentType: 'image/jpeg',
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ result: { path: expect.stringMatching(/^dorm-private\//) } });
  expect(verifyIdToken).toHaveBeenCalledWith('fixture-token', true);
  expect(save).toHaveBeenCalledOnce();
  const [savedBytes, options] = save.mock.calls[0];
  expect(savedBytes.equals(bytes)).toBe(true);
  expect(options).toMatchObject({ resumable: false });
});

it('still requires auth for photo bodies larger than 64 KiB', async () => {
  const { call, verifyIdToken } = fixture();
  const response = await call({
    action: 'uploadPhoto', base64: 'YWFh'.repeat(32 * 1024), contentType: 'image/jpeg',
  }, 'invalid');
  expect(response.status).toBe(401);
  expect(verifyIdToken).toHaveBeenCalledWith('invalid', true);
});

it('cancels dorm bodies above 8 MiB plus 64 KiB before authenticating', async () => {
  const { store, verifyIdToken } = fixture();
  let chunksRead = 0;
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunksRead += 1;
      controller.enqueue(new Uint8Array(64 * 1024));
    },
    cancel,
  }, { highWaterMark: 0 });
  const response = await dispatchFnRequest('dormWorkflow', new Request('https://nuni.tw/api/fn/dormWorkflow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-token' },
    body: stream,
    duplex: 'half',
  } as RequestInit), { db: store.db as FnRuntime['db'], verifyIdToken });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { message: 'Request body too large' } });
  expect(chunksRead).toBe(130);
  expect(cancel).toHaveBeenCalledOnce();
  expect(verifyIdToken).not.toHaveBeenCalled();
});
