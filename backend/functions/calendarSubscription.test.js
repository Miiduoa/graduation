jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: jest.fn(),
}));

const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const database = { collection: jest.fn() };
getFirestore.mockReturnValue(database);
const { calendarSubscribe } = require('./index');

describe('public calendar subscription', () => {
  let records;
  let schoolExists;
  let readError;
  let queriedPaths;
  const timestamp = (value) => Timestamp.fromDate(new Date(value));
  const scheduled = {
    title: '校園講座',
    startsAt: timestamp('2026-11-01T02:00:00Z'),
    endsAt: timestamp('2026-11-01T04:00:00Z'),
    schoolId: 'pu',
    description: '公開的活動說明',
  };
  const call = async (query = { schoolId: 'pu' }, overrides = {}) => {
    const response = {
      statusCode: 200,
      headers: {},
      on: jest.fn(),
      setHeader(key, value) {
        this.headers[key] = value;
      },
      getHeader(key) {
        return this.headers[key];
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      send(body) {
        this.body = body;
        return this;
      },
    };
    await calendarSubscribe({ method: 'GET', headers: {}, query, ...overrides }, response);
    return response;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    records = [['public-event', scheduled]];
    schoolExists = true;
    readError = null;
    queriedPaths = [];
    database.collection.mockImplementation((collectionName) => {
      expect(collectionName).toBe('schools');
      return {
        doc(schoolId) {
          expect(schoolId).toBe('pu');
          return {
            async get() {
              queriedPaths.push('schools/pu');
              if (readError) throw readError;
              return { exists: schoolExists, data: () => ({ name: '靜宜大學' }) };
            },
            collection(name) {
              expect(name).toBe('clubEvents');
              const query = {
                orderBy: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                async get() {
                  queriedPaths.push('schools/pu/clubEvents');
                  expect(query.orderBy).toHaveBeenCalledWith('startsAt', 'desc');
                  expect(query.limit).toHaveBeenCalledWith(100);
                  return { docs: records.map(([id, data]) => ({ id, data: () => data })) };
                },
              };
              return query;
            },
          };
        },
      };
    });
  });

  test.each([{ schoolId: 'pu' }, { schoolId: 'pu', type: 'events' }])(
    'anonymous callers receive only scheduled public activities: %j',
    async (query) => {
      records[0][1] = { ...scheduled, privateNotes: 'never include', registeredUsers: ['victim'] };
      const response = await call(query);
      expect(response.statusCode).toBe(200);
      expect(response.headers['Content-Type']).toBe('text/calendar; charset=utf-8');
      expect(response.body).toContain('X-WR-CALNAME:靜宜大學 公開活動');
      expect(response.body).toContain('SUMMARY:校園講座');
      expect(response.body).toContain('UID:event-public-event@campus-app.tw');
      expect(response.body).toContain('DTSTART:20261101T020000Z');
      expect(response.body).toContain('DTEND:20261101T040000Z');
      expect(response.body).not.toContain('DTSTART;TZID=');
      expect(response.body).not.toMatch(/victim|never include|已報名/);
      expect(queriedPaths).toEqual(['schools/pu', 'schools/pu/clubEvents']);
    },
  );

  test.each([
    { userId: 'victim' },
    { userId: 'victim', type: 'events' },
    { userId: 'victim', type: 'all' },
    { userId: '' },
    { userId: ['victim', 'other'] },
    { type: 'all' },
    { type: 'assignments' },
    { type: 'registered' },
  ])('rejects a personal subscription before any database read: %j', async (privateQuery) => {
    const response = await call({ schoolId: 'pu', ...privateQuery });
    expect(response.statusCode).toBe(410);
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(database.collection).not.toHaveBeenCalled();
    expect(response.body).not.toContain('victim');
  });

  test('a signed-in caller cannot subscribe to a different UID either', async () => {
    const response = await call(
      { schoolId: 'pu', userId: 'other-user', type: 'assignments' },
      { auth: { uid: 'current-user' }, headers: { authorization: 'Bearer synthetic-test-token' } },
    );
    expect(response.statusCode).toBe(410);
    expect(database.collection).not.toHaveBeenCalled();
  });

  test.each([
    {},
    { schoolId: ['pu'] },
    { schoolId: '../private' },
    { schoolId: 'pu\r\n' },
    { schoolId: 'pu', type: ['events', 'assignments'] },
    { schoolId: 'pu', type: '' },
    { schoolId: 'pu', type: 'unknown' },
    { schoolId: 'pu', access_token: 'synthetic-test-token' },
  ])('rejects malformed or unsupported query fields: %j', async (query) => {
    const response = await call(query);
    expect(response.statusCode).toBe(400);
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(database.collection).not.toHaveBeenCalled();
  });

  test('does not manufacture a start time for unscheduled or invalid events', async () => {
    records = [
      ['missing', { title: '尚未排定' }],
      ['null', { ...scheduled, startsAt: null }],
      ['invalid', { ...scheduled, startsAt: 'not-a-date' }],
      ['number', { ...scheduled, startsAt: 0 }],
      ['invalid-date', { ...scheduled, startsAt: new Date(NaN) }],
      [
        'broken-timestamp',
        {
          ...scheduled,
          startsAt: {
            toDate() {
              throw new Error('invalid');
            },
          },
        },
      ],
    ];
    const response = await call();
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('BEGIN:VCALENDAR');
    expect(response.body).not.toContain('BEGIN:VEVENT');
    expect(response.body).not.toContain('DTSTART');
  });

  test('accepts stored ISO dates, sorts by actual start and omits invalid end times', async () => {
    records = [
      ['later', { ...scheduled, startsAt: '2026-11-02T10:00:00+08:00', endsAt: 'invalid' }],
      [
        'earlier',
        { ...scheduled, startsAt: new Date('2026-11-01T02:00:00Z'), endsAt: scheduled.startsAt },
      ],
    ];
    const response = await call();
    expect(response.body).toContain('DTSTART:20261102T020000Z');
    expect(response.body.indexOf('event-earlier')).toBeLessThan(
      response.body.indexOf('event-later'),
    );
    expect(response.body).not.toContain('DTEND:');
  });

  test('skips a mismatched school record and an untitled activity', async () => {
    records = [
      ['wrong-school', { ...scheduled, schoolId: 'different-school' }],
      ['untitled', { ...scheduled, title: '' }],
    ];
    expect((await call()).body).not.toContain('BEGIN:VEVENT');
  });

  test('escapes public text and refuses to inject extra iCal entries through links', async () => {
    records = [
      [
        'public-event',
        {
          ...scheduled,
          title: 'Title\r\nBEGIN:VEVENT',
          description: '說明'.repeat(50),
          link: 'https://example.test/\r\nATTENDEE:private',
        },
      ],
    ];
    const { body } = await call();
    expect(body.match(/\r\nBEGIN:VEVENT\r\n/g)).toHaveLength(1);
    expect(body).toContain('SUMMARY:Title\\nBEGIN:VEVENT');
    expect(body).not.toContain('ATTENDEE:');
    expect(body.split('\r\n').every((line) => Buffer.byteLength(line, 'utf8') <= 75)).toBe(true);
  });

  test('unknown schools return an uncacheable 404 without querying events', async () => {
    schoolExists = false;
    const response = await call();
    expect(response.statusCode).toBe(404);
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(queriedPaths).toEqual(['schools/pu']);
  });

  test('database failures do not return a successful empty calendar or cache errors', async () => {
    readError = new Error('database unavailable with sensitive details');
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await call();
      expect(response.statusCode).toBe(500);
      expect(response.headers['Cache-Control']).toBe('no-store');
      expect(response.body).not.toContain('sensitive');
      expect(log).toHaveBeenCalledWith('Public calendar subscription failed');
    } finally {
      log.mockRestore();
    }
  });

  test('POST cannot bypass the public query boundary using a body', async () => {
    const response = await call({ schoolId: 'pu' }, { method: 'POST', body: { userId: 'victim' } });
    expect(response.statusCode).toBe(405);
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(database.collection).not.toHaveBeenCalled();
  });
});
