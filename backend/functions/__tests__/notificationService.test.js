const { defaultNotificationPreferences, isInQuietHours } = require('../lib/notificationService');

describe('notificationService', () => {
  test('returns default notification preferences', () => {
    expect(defaultNotificationPreferences()).toEqual({
      enabled: true,
      announcements: true,
      events: true,
      groups: true,
      assignments: true,
      grades: true,
      messages: true,
      quietHoursEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
    });
  });

  test('detects quiet hours within a same-day window', () => {
    const prefs = {
      ...defaultNotificationPreferences(),
      quietHoursEnabled: true,
      quietHoursStart: '09:00',
      quietHoursEnd: '18:00',
    };

    expect(isInQuietHours(prefs, new Date('2026-03-20T10:30:00'))).toBe(true);
    expect(isInQuietHours(prefs, new Date('2026-03-20T08:30:00'))).toBe(false);
  });

  test('detects overnight quiet hours', () => {
    const prefs = {
      ...defaultNotificationPreferences(),
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
    };

    expect(isInQuietHours(prefs, new Date('2026-03-20T23:30:00'))).toBe(true);
    expect(isInQuietHours(prefs, new Date('2026-03-20T07:45:00'))).toBe(true);
    expect(isInQuietHours(prefs, new Date('2026-03-20T15:00:00'))).toBe(false);
  });
});

const { createNotificationService } = require('../lib/notificationService');
const { Timestamp } = require('firebase-admin/firestore');

function setup() {
  const rows = new Map([
    ['users/alice', {}],
    ['users/bob', {}],
  ]);
  const versions = new Map();
  const reads = [];
  let readError;
  let clock = new Date('2026-10-08T04:00:00Z');
  const ref = (path) => ({
    path,
    collection: (name) => ref(`${path}/${name}`),
    doc: (id) => ref(`${path}/${id}`),
    where: () => ref(path),
    orderBy: () => ref(path),
    limit: () => ref(path),
    get: async () => {
      reads.push(path);
      if (readError) throw readError;
      if (path.split('/').length % 2 === 0) return snapshot(path);
      const docs = [...rows.keys()]
        .filter(
          (p) => p.startsWith(`${path}/`) && p.split('/').length === path.split('/').length + 1,
        )
        .map(snapshot);
      return { docs, empty: !docs.length };
    },
    set: async (data, options) =>
      rows.set(path, options?.merge ? { ...rows.get(path), ...data } : data),
    update: async (data) => rows.set(path, { ...rows.get(path), ...data }),
  });
  const snapshot = (path) => ({
    id: path.split('/').at(-1),
    ref: ref(path),
    exists: rows.has(path),
    data: (
      (value) => () =>
        value
    )(rows.get(path)),
    updateTime: versions.get(path) || Timestamp.fromMillis(1),
  });
  const db = {
    collection: ref,
    doc: ref,
    runTransaction: async (fn) =>
      fn({
        get: (r) => r.get(),
        delete: (r) => rows.delete(r.path),
        set: (r, v) => rows.set(r.path, v),
        update: (r, v) => rows.set(r.path, { ...rows.get(r.path), ...v }),
      }),
    batch: () => {
      const mutations = [];
      return {
        set: (r, v) => mutations.push(() => rows.set(r.path, v)),
        delete: (r) => mutations.push(() => rows.delete(r.path)),
        commit: async () => mutations.forEach((fn) => fn()),
      };
    },
  };
  const fetch = jest.fn();
  const messaging = { sendEachForMulticast: jest.fn() };
  const service = createNotificationService({
    db,
    messaging,
    fetch,
    now: () => clock,
    expoAccessToken: 'server-token',
    logger: { warn: jest.fn() },
  });
  return {
    rows,
    versions,
    reads,
    db,
    fetch,
    messaging,
    service,
    setClock: (value) => {
      clock = value;
    },
    failReads: () => {
      readError = new Error('offline');
    },
  };
}
const note = { title: '餐點可領取', body: '請到店領取餐點。' };
const expo = 'ExpoPushToken[example-token]';
function ok(data) {
  return { ok: true, json: async () => ({ data }) };
}
function token(s, id, tokenValue, type) {
  s.rows.set(`users/alice/pushTokens/${id}`, { token: tokenValue, type });
}

describe('provider-backed notification service', () => {
  test('uses the real preference path and never treats a failed read as opt-in', async () => {
    const s = setup();
    s.failReads();
    await expect(s.service.sendPushToUser('alice', note)).rejects.toThrow('offline');
    expect(s.reads).toEqual(['users/alice']);
    expect(s.fetch).not.toHaveBeenCalled();
    expect(s.messaging.sendEachForMulticast).not.toHaveBeenCalled();
  });
  test.each([
    [{ enabled: false }, 'disabled'],
    [{ assignments: false }, 'category_disabled'],
    [{ quietHoursEnabled: true, quietHoursStart: '11:00', quietHoursEnd: '13:00' }, 'quiet_hours'],
  ])('respects acknowledged preferences %j', async (preferences, reason) => {
    const s = setup();
    s.rows.set('users/alice/settings/notifications', preferences);
    token(s, 'expo', expo, 'expo');
    expect(await s.service.sendPushToUser('alice', note, {}, 'assignments')).toEqual({
      status: 'skipped',
      accepted: 0,
      failed: 0,
      reason,
    });
    expect(s.fetch).not.toHaveBeenCalled();
    expect(s.reads).not.toContain('users/alice/pushTokens');
  });
  test('quiet hours use Taiwan time independently from server timezone', () => {
    const prefs = { quietHoursEnabled: true, quietHoursStart: '22:00', quietHoursEnd: '08:00' };
    expect(isInQuietHours(prefs, new Date('2026-10-08T14:30:00Z'), 'Asia/Taipei')).toBe(true);
    expect(isInQuietHours(prefs, new Date('2026-10-08T08:30:00Z'), 'Asia/Taipei')).toBe(false);
  });
  test('sends Expo and FCM tokens only to their respective provider and retains receipt evidence', async () => {
    const s = setup();
    token(s, 'expo', expo, 'expo');
    token(s, 'duplicate', expo, 'expo');
    token(s, 'native', 'native-fcm-token', 'fcm');
    s.fetch.mockResolvedValue(ok([{ status: 'ok', id: 'receipt-1' }]));
    s.messaging.sendEachForMulticast.mockResolvedValue({ responses: [{ success: true }] });
    expect(
      await s.service.sendPushToUser('alice', note, {
        orderId: 'order-1',
        channel: 'orders',
        count: 1,
      }),
    ).toEqual({ status: 'accepted', accepted: 2, failed: 0 });
    const [url, request] = s.fetch.mock.calls[0];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(request.redirect).toBe('error');
    expect(request.headers.Authorization).toBe('Bearer server-token');
    expect(JSON.parse(request.body)).toEqual([
      {
        to: expo,
        ...note,
        data: { orderId: 'order-1', channel: 'orders', count: '1' },
        channelId: 'orders',
        sound: 'default',
      },
    ]);
    expect(s.messaging.sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ['native-fcm-token'] }),
    );
    expect(s.rows.get('pendingPushReceipts/receipt-1')).toMatchObject({
      uid: 'alice',
      token: expo,
      tokenPath: 'users/alice/pushTokens/expo',
    });
  });
  test('no token, malformed Expo token and disabled preference do not report delivery', async () => {
    const s = setup();
    token(s, 'bad', 'ExpoPushToken[bad value]', 'expo');
    expect(await s.service.sendPushToUser('alice', note)).toMatchObject({
      status: 'skipped',
      reason: 'no_tokens',
      accepted: 0,
    });
    expect(s.fetch).not.toHaveBeenCalled();
    expect(s.messaging.sendEachForMulticast).not.toHaveBeenCalled();
  });
  test.each([new Error('timeout'), { ok: false, status: 503 }, ok([])])(
    'provider failure is never accepted: %j',
    async (response) => {
      const s = setup();
      token(s, 'expo', expo, 'expo');
      if (response instanceof Error) s.fetch.mockRejectedValue(response);
      else s.fetch.mockResolvedValue(response);
      expect(await s.service.sendPushToUser('alice', note)).toMatchObject({
        status: 'failed',
        accepted: 0,
        failed: 1,
      });
      expect([...s.rows.keys()].some((p) => p.startsWith('pendingPushReceipts/'))).toBe(false);
    },
  );
  test('cleans invalid provider tokens without deleting a refreshed registration', async () => {
    const s = setup();
    token(s, 'expo', expo, 'expo');
    s.fetch.mockImplementation(async () => {
      s.versions.set('users/alice/pushTokens/expo', Timestamp.fromMillis(2));
      return ok([{ status: 'error', details: { error: 'DeviceNotRegistered' } }]);
    });
    expect(await s.service.sendPushToUser('alice', note)).toMatchObject({ status: 'failed' });
    expect(s.rows.has('users/alice/pushTokens/expo')).toBe(true);
  });
  test('deletes a confirmed invalid FCM registration', async () => {
    const s = setup();
    token(s, 'native', 'invalid-token', 'fcm');
    s.messaging.sendEachForMulticast.mockResolvedValue({
      responses: [
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ],
    });
    expect(await s.service.sendPushToUser('alice', note)).toMatchObject({
      status: 'failed',
      failed: 1,
    });
    expect(s.rows.has('users/alice/pushTokens/native')).toBe(false);
  });
  test('reports partial provider acceptance and batches Expo messages within 100 recipients', async () => {
    const s = setup();
    for (let i = 0; i < 101; i += 1) token(s, `expo${i}`, `ExpoPushToken[t${i}]`, 'expo');
    s.fetch.mockImplementation(async (_url, request) =>
      ok(
        JSON.parse(request.body).map((_, i) =>
          i === 0 ? { status: 'error' } : { status: 'ok', id: `receipt-${i}` },
        ),
      ),
    );
    expect(await s.service.sendPushToUser('alice', note)).toMatchObject({
      status: 'partial',
      accepted: 99,
      failed: 2,
    });
    expect(s.fetch.mock.calls.map(([, request]) => JSON.parse(request.body).length)).toEqual([
      100, 1,
    ]);
  });
  test('persists preferences at the canonical location and propagates unavailable database', async () => {
    const s = setup();
    await s.service.setPreferences('alice', { enabled: false });
    expect(s.rows.get('users/alice/settings/notifications').enabled).toBe(false);
    await expect(
      createNotificationService().setPreferences('alice', { enabled: false }),
    ).rejects.toThrow('unavailable');
  });
  test('keeps each recipient preference and outcome separate', async () => {
    const s = setup();
    token(s, 'expo', expo, 'expo');
    s.rows.set('users/bob/settings/notifications', { enabled: false });
    s.fetch.mockResolvedValue(ok([{ status: 'ok', id: 'receipt-1' }]));
    expect(await s.service.sendPushToMultipleUsers(['alice', 'alice', 'bob'], note)).toEqual([
      { uid: 'alice', status: 'accepted', accepted: 1, failed: 0 },
      { uid: 'bob', status: 'skipped', accepted: 0, failed: 0, reason: 'disabled' },
    ]);
  });
  test('checks provider receipts, removes invalid registration and does not claim device delivery', async () => {
    const s = setup();
    token(s, 'expo', expo, 'expo');
    const createdAt = Timestamp.fromDate(new Date('2026-10-08T03:30:00Z'));
    s.rows.set('pendingPushReceipts/one', {
      uid: 'alice',
      token: expo,
      tokenPath: 'users/alice/pushTokens/expo',
      createdAt,
    });
    s.rows.set('pendingPushReceipts/two', { uid: 'alice', createdAt });
    s.fetch.mockResolvedValue(
      ok({
        one: { status: 'error', details: { error: 'DeviceNotRegistered' } },
        two: { status: 'ok' },
      }),
    );
    expect(await s.service.processPendingReceipts()).toEqual({
      checked: 2,
      confirmed: 1,
      failed: 1,
      pending: 0,
    });
    expect(s.rows.has('users/alice/pushTokens/expo')).toBe(false);
    expect(s.rows.has('pendingPushReceipts/one')).toBe(false);
    expect(s.rows.get('pushReceiptResults/two')).toMatchObject({ status: 'provider_confirmed' });
    expect(JSON.parse(s.fetch.mock.calls[0][1].body)).toEqual({ ids: ['one', 'two'] });
  });
  test('postpones missing receipts so they cannot starve the next batch and expires after 24 hours', async () => {
    const s = setup();
    s.rows.set('pendingPushReceipts/one', {
      uid: 'alice',
      createdAt: Timestamp.fromDate(new Date('2026-10-08T03:30:00Z')),
    });
    s.fetch.mockResolvedValue(ok({}));
    expect(await s.service.processPendingReceipts()).toEqual({
      checked: 1,
      confirmed: 0,
      failed: 0,
      pending: 1,
    });
    expect(s.rows.get('pendingPushReceipts/one').nextCheckAt).toEqual(
      new Date('2026-10-08T04:15:00Z'),
    );
    s.setClock(new Date('2026-10-09T04:00:00Z'));
    expect(await s.service.processPendingReceipts()).toEqual({
      checked: 1,
      confirmed: 0,
      failed: 1,
      pending: 0,
    });
    expect(s.rows.get('pushReceiptResults/one')).toMatchObject({ status: 'receipt_expired' });
  });
});

test('account deletion during provider request cannot recreate private receipt data', async () => {
  const s = setup();
  token(s, 'expo', expo, 'expo');
  s.fetch.mockImplementation(async () => {
    s.rows.set('users/alice', { notificationDeliveryDisabled: true });
    return ok([{ status: 'ok', id: 'receipt-late' }]);
  });
  expect(await s.service.sendPushToUser('alice', note)).toMatchObject({ status: 'accepted' });
  expect(s.rows.has('pendingPushReceipts/receipt-late')).toBe(false);
  expect(await s.service.sendPushToUser('alice', note)).toMatchObject({
    status: 'skipped',
    reason: 'account_unavailable',
  });
  expect(s.fetch).toHaveBeenCalledTimes(1);
});

test('receipt completion after account removal does not recreate receipt history', async () => {
  const s = setup();
  s.rows.set('pendingPushReceipts/one', {
    uid: 'alice',
    createdAt: Timestamp.fromDate(new Date('2026-10-08T03:30:00Z')),
  });
  s.fetch.mockImplementation(async () => {
    s.rows.delete('users/alice');
    return ok({ one: { status: 'ok' } });
  });
  await s.service.processPendingReceipts();
  expect(s.rows.has('pendingPushReceipts/one')).toBe(false);
  expect(s.rows.has('pushReceiptResults/one')).toBe(false);
});

test.each([true, false])(
  'a late receipt sweep cannot replace confirmed status or revive a deleted pending receipt (expired=%s)',
  async (expired) => {
    const s = setup();
    s.rows.set('pendingPushReceipts/one', {
      uid: 'alice',
      createdAt: Timestamp.fromDate(
        new Date(expired ? '2026-10-07T03:30:00Z' : '2026-10-08T03:30:00Z'),
      ),
    });
    let releaseLate;
    s.fetch
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseLate = resolve;
          }),
      )
      .mockResolvedValueOnce(ok({ one: { status: 'ok' } }));
    const late = s.service.processPendingReceipts();
    while (!releaseLate) await Promise.resolve();
    await s.service.processPendingReceipts();
    expect(s.rows.get('pushReceiptResults/one').status).toBe('provider_confirmed');
    releaseLate(ok({}));
    await late;
    expect(s.rows.get('pushReceiptResults/one').status).toBe('provider_confirmed');
    expect(s.rows.has('pendingPushReceipts/one')).toBe(false);
  },
);
