jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: jest.fn(),
}));

const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const database = { collection: jest.fn(), runTransaction: jest.fn() };
getFirestore.mockReturnValue(database);
const { upsertSchoolEvent } = require('./index');

describe('school event publication', () => {
  let records;
  let retryWith;
  const existingPath = 'schools/pu/clubEvents/event-one';
  const start = Timestamp.fromDate(new Date('2026-11-01T02:00:00Z'));
  const end = Timestamp.fromDate(new Date('2026-11-01T04:00:00Z'));
  const request = (data = {}) =>
    upsertSchoolEvent.run({
      auth: { uid: 'editor', token: { email: 'editor@example.test' } },
      data: { schoolId: 'pu', title: '校園講座', ...data },
    });

  beforeEach(() => {
    jest.clearAllMocks();
    records = new Map([
      ['schools/pu/members/editor', { role: 'editor', status: 'active' }],
      [existingPath, { title: '原活動', startsAt: start, endsAt: end, capacity: 25 }],
    ]);
    retryWith = null;
    const snapshot = (reference) => ({
      exists: records.has(reference.path),
      data: () => records.get(reference.path),
    });
    const reference = (path) => ({
      path,
      id: path.split('/').pop(),
      collection: (name) => collection(`${path}/${name}`),
      get: async () => snapshot({ path }),
    });
    const collection = (path) => ({
      doc: (id = 'generated-event') => reference(`${path}/${id}`),
      add: async (data) => records.set(`${path}/log`, data),
    });
    database.collection.mockImplementation(collection);
    database.runTransaction.mockImplementation(async (callback) => {
      let writes;
      const attempt = async () => {
        writes = [];
        return callback({
          get: async (ref) => snapshot(ref),
          update: (ref, data) => writes.push({ ref, data, update: true }),
          create: (ref, data) => writes.push({ ref, data, update: false }),
        });
      };
      await attempt();
      if (retryWith) {
        records.set(existingPath, { ...records.get(existingPath), ...retryWith });
        await attempt();
      }
      for (const { ref, data, update } of writes) {
        const merged = { ...(update ? records.get(ref.path) : {}), ...data };
        for (const [key, value] of Object.entries(merged)) {
          if (value instanceof FieldValue && value.isEqual(FieldValue.delete())) delete merged[key];
        }
        records.set(ref.path, merged);
      }
    });
  });

  test('publishes to the reader collection without inventing an unscheduled date', async () => {
    expect(await request()).toEqual({ success: true, eventId: 'generated-event' });
    const created = records.get('schools/pu/clubEvents/generated-event');
    expect(created).toMatchObject({ schoolId: 'pu', title: '校園講座', registeredCount: 0 });
    expect(created).not.toHaveProperty('startsAt');
    expect(created).not.toHaveProperty('endsAt');
    expect(records.has('schools/pu/events/generated-event')).toBe(false);
  });

  test('keeps the supplied schedule as Firestore timestamps', async () => {
    await request({ startsAt: start.toDate().toISOString(), endsAt: end.toDate().toISOString() });
    expect(records.get('schools/pu/clubEvents/generated-event')).toMatchObject({
      startsAt: start,
      endsAt: end,
    });
  });

  test('editing text preserves omitted dates and capacity', async () => {
    await request({ eventId: 'event-one', description: '更新說明' });
    expect(records.get(existingPath)).toMatchObject({
      description: '更新說明',
      startsAt: start,
      endsAt: end,
      capacity: 25,
    });
  });

  test('explicitly empty dates clear the schedule without manufacturing replacement dates', async () => {
    await request({ eventId: 'event-one', startsAt: null, endsAt: '', capacity: null });
    const updated = records.get(existingPath);
    expect(updated).not.toHaveProperty('startsAt');
    expect(updated).not.toHaveProperty('endsAt');
    expect(updated).not.toHaveProperty('capacity');
  });

  test.each([{ startsAt: '2026-11-01T05:00:00Z' }, { endsAt: '2026-11-01T01:00:00Z' }])(
    'rejects a partial edit that conflicts with the persisted interval: %j',
    async (patch) => {
      await expect(request({ eventId: 'event-one', ...patch })).rejects.toMatchObject({
        code: 'invalid-argument',
      });
      expect(records.get(existingPath)).toEqual({
        title: '原活動',
        startsAt: start,
        endsAt: end,
        capacity: 25,
      });
      expect(records.has('schools/pu/adminLogs/log')).toBe(false);
    },
  );

  test('rechecks the persisted interval after a transaction conflict', async () => {
    retryWith = { endsAt: Timestamp.fromDate(new Date('2026-11-01T02:30:00Z')) };
    await expect(
      request({ eventId: 'event-one', startsAt: '2026-11-01T03:00:00Z' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(records.get(existingPath).startsAt).toEqual(start);
    expect(records.get(existingPath).title).toBe('原活動');
  });

  test('rejects unknown event IDs without creating replacements', async () => {
    await expect(request({ eventId: 'missing' })).rejects.toMatchObject({ code: 'not-found' });
    expect(records.has('schools/pu/clubEvents/missing')).toBe(false);
  });

  test('requires school editor authorization before any mutation', async () => {
    records.set('schools/pu/members/editor', { role: 'member', status: 'active' });
    await expect(request()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(database.runTransaction).not.toHaveBeenCalled();
    expect(records.size).toBe(2);
  });
});
