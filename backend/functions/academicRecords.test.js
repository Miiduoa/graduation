jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn() }));

const { HttpsError } = require('firebase-functions/v2/https');
const { getAuth } = require('firebase-admin/auth');
const { createPuCampusDataHandler, createGetMyAcademicRecords } = require('./academicRecords');

const timestamp = (time) => ({ toDate: () => new Date(time) });
const NOW = Date.parse('2026-10-08T00:00:00Z');
const originalEnv = process.env;
let nextUid = 0;

function fixture() {
  const uid = `student-${++nextUid}`;
  const sessions = new Map([
    [
      'own-session',
      {
        ownerUid: uid,
        cookies: { SID: 'own-cookie' },
        createdAt: timestamp(NOW - 1000),
        expiresAt: timestamp(NOW + 60000),
      },
    ],
    [
      'other-session',
      {
        ownerUid: 'other-student',
        cookies: { SID: 'private-cookie' },
        createdAt: timestamp(NOW),
        expiresAt: timestamp(NOW + 120000),
      },
    ],
  ]);
  const profile = { schoolId: 'pu' };
  const removed = jest.fn();
  const queryCalls = [];
  const db = {
    collection: jest.fn((collectionName) => {
      if (collectionName === 'users') {
        return {
          doc: (id) => ({ get: async () => ({ exists: id === uid, data: () => profile }) }),
        };
      }
      if (collectionName !== '_puSessions') throw new Error('Unexpected collection');
      const constraints = [];
      let maximum = Infinity;
      const query = {
        doc: (id) => ({
          get: async () => ({ exists: sessions.has(id), data: () => sessions.get(id) }),
          delete: async () => {
            removed(id);
            sessions.delete(id);
          },
        }),
        where: (field, op, value) => {
          constraints.push({ field, op, value });
          queryCalls.push([field, op, value]);
          return query;
        },
        orderBy: (field, direction) => {
          expect([field, direction]).toEqual(['expiresAt', 'desc']);
          return query;
        },
        limit: (count) => {
          maximum = count;
          return query;
        },
        get: async () => ({
          docs: [...sessions.values()]
            .filter((row) =>
              constraints.every(({ field, op, value }) =>
                op === '==' ? row[field] === value : row[field]?.toDate() > value,
              ),
            )
            .sort((a, b) => b.expiresAt.toDate() - a.expiresAt.toDate())
            .slice(0, maximum)
            .map((row) => ({ data: () => row })),
        }),
      };
      return query;
    }),
  };
  const result = { success: true, grades: [{ courseName: '資訊管理', score: 88, credits: 3 }] };
  const fetchers = Object.fromEntries(
    ['courses', 'grades', 'announcements', 'studentInfo', 'absence', 'creditSummary'].map(
      (type) => [
        type,
        jest.fn(async () =>
          type === 'courses'
            ? { success: true, courses: [{ code: 'CS1', name: '資訊管理' }] }
            : result,
        ),
      ],
    ),
  );
  const assertActiveSchoolMember = jest.fn(async () => ({ status: 'active' }));
  const logger = { error: jest.fn() };
  const dependencies = { db, fetchers, assertActiveSchoolMember, logger };
  const request = (data = { dataType: 'grades' }) => ({
    auth: { uid, token: { schoolId: 'pu' } },
    data,
  });
  return { uid, sessions, profile, removed, fetchers, dependencies, request, queryCalls };
}

beforeEach(() => {
  process.env = { ...originalEnv, APP_ENV: 'production' };
  jest.useFakeTimers().setSystemTime(NOW);
});
afterEach(() => {
  jest.useRealTimers();
  process.env = originalEnv;
});

describe('PU campus HTTP session ownership', () => {
  async function invoke(f, sessionId, dataType = 'grades', token = 'valid') {
    getAuth.mockReturnValue({
      verifyIdToken: jest.fn(async () => {
        if (token === 'invalid') throw new Error('Invalid token');
        return { uid: f.uid };
      }),
    });
    const res = {
      statusCode: 200,
      body: null,
      headers: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
      set(key, value) {
        this.headers[key] = value;
        return this;
      },
    };
    await createPuCampusDataHandler(f.dependencies)(
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: { sessionId, dataType },
      },
      res,
    );
    return res;
  }

  test.each(['grades', 'courses', 'studentInfo', 'absence', 'creditSummary', 'announcements'])(
    'rejects another account before accessing %s',
    async (dataType) => {
      const f = fixture();
      const res = await invoke(f, 'other-session', dataType);
      expect(res.statusCode).toBe(403);
      expect(f.fetchers[dataType]).not.toHaveBeenCalled();
      expect(f.removed).not.toHaveBeenCalled();
      expect(res.headers['Cache-Control']).toBe('no-store');
    },
  );
  test('does not delete another account expired session', async () => {
    const f = fixture();
    f.sessions.get('other-session').expiresAt = timestamp(NOW - 1);
    expect((await invoke(f, 'other-session')).statusCode).toBe(403);
    expect(f.removed).not.toHaveBeenCalled();
  });
  test('rejects ownerless sessions and invalid identity', async () => {
    const f = fixture();
    f.sessions.get('own-session').ownerUid = null;
    expect((await invoke(f, 'own-session')).statusCode).toBe(401);
    expect((await invoke(f, 'own-session', 'grades', 'invalid')).statusCode).toBe(401);
    expect(f.fetchers.grades).not.toHaveBeenCalled();
  });
  test('fetches only with the authenticated owner cookies', async () => {
    const f = fixture();
    const res = await invoke(f, 'own-session');
    expect(res.statusCode).toBe(200);
    expect(res.body.result.grades[0].score).toBe(88);
    expect(f.fetchers.grades).toHaveBeenCalledWith({ SID: 'own-cookie' }, '');
  });
  test('rejects and removes an expired owned session before fetching', async () => {
    const f = fixture();
    f.sessions.get('own-session').expiresAt = timestamp(NOW);
    expect((await invoke(f, 'own-session')).statusCode).toBe(401);
    expect(f.removed).toHaveBeenCalledWith('own-session');
    expect(f.fetchers.grades).not.toHaveBeenCalled();
  });
});

describe('authenticated academic records', () => {
  test.each(['courses', 'grades'])(
    'returns current owner %s from the school service',
    async (dataType) => {
      const f = fixture();
      f.sessions.set('newer-owned', {
        ownerUid: f.uid,
        cookies: { SID: 'latest' },
        expiresAt: timestamp(NOW + 180000),
      });
      const result = await createGetMyAcademicRecords(f.dependencies)(f.request({ dataType }));
      expect(result).toMatchObject({
        success: true,
        ownerUid: f.uid,
        schoolId: 'pu',
        source: 'pu-campus',
        fetchedAt: new Date(NOW).toISOString(),
        dataType,
      });
      expect(result.result[dataType]).toHaveLength(1);
      expect(f.fetchers[dataType]).toHaveBeenCalledWith({ SID: 'latest' }, '');
      expect(f.queryCalls).toEqual([
        ['ownerUid', '==', f.uid],
        ['expiresAt', '>', new Date(NOW)],
      ]);
      expect(f.dependencies.assertActiveSchoolMember).toHaveBeenCalledTimes(2);
    },
  );
  test.each([
    {},
    { dataType: 'creditSummary' },
    { dataType: 'grades', uid: 'other-student' },
    { dataType: 'grades', sessionId: 'other-session' },
    { dataType: 'grades', schoolId: 'other' },
  ])('rejects unsupported or client-selected identity input %j', async (data) => {
    const f = fixture();
    await expect(createGetMyAcademicRecords(f.dependencies)(f.request(data))).rejects.toMatchObject(
      { code: 'invalid-argument' },
    );
    expect(f.dependencies.db.collection).not.toHaveBeenCalled();
  });
  test('requires authentication and matching trusted school claim and profile', async () => {
    const f = fixture();
    const handler = createGetMyAcademicRecords(f.dependencies);
    await expect(handler({ data: { dataType: 'grades' } })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    const wrongClaim = f.request();
    wrongClaim.auth.token.schoolId = 'other';
    await expect(handler(wrongClaim)).rejects.toMatchObject({ code: 'permission-denied' });
    f.profile.schoolId = 'other';
    await expect(handler(f.request())).rejects.toMatchObject({ code: 'permission-denied' });
    expect(f.fetchers.grades).not.toHaveBeenCalled();
  });
  test.each([null, 'expired', 'ownerless'])(
    'requires an active owned session: %s',
    async (state) => {
      const f = fixture();
      if (state === null) f.sessions.delete('own-session');
      if (state === 'expired') f.sessions.get('own-session').expiresAt = timestamp(NOW);
      if (state === 'ownerless') f.sessions.get('own-session').ownerUid = null;
      await expect(createGetMyAcademicRecords(f.dependencies)(f.request())).rejects.toMatchObject({
        code: 'failed-precondition',
      });
      expect(f.fetchers.grades).not.toHaveBeenCalled();
    },
  );
  test('rejects membership revoked before the school response returns', async () => {
    const f = fixture();
    f.dependencies.assertActiveSchoolMember
      .mockResolvedValueOnce({ status: 'active' })
      .mockRejectedValueOnce(new HttpsError('permission-denied', 'Membership revoked'));
    await expect(createGetMyAcademicRecords(f.dependencies)(f.request())).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(f.fetchers.grades).toHaveBeenCalledTimes(1);
  });
  test('does not treat membership without active status as verified', async () => {
    const f = fixture();
    f.dependencies.assertActiveSchoolMember.mockResolvedValue({});
    await expect(createGetMyAcademicRecords(f.dependencies)(f.request())).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(f.fetchers.grades).not.toHaveBeenCalled();
  });
  test.each(['courses', 'grades'])(
    'requires reconnection when school cookies expire before the stored %s session',
    async (dataType) => {
      const f = fixture();
      f.fetchers[dataType].mockResolvedValue({
        success: false,
        code: 'session-expired',
        [dataType]: [],
        error: 'E校園 session 已失效，請重新登入',
      });
      await expect(
        createGetMyAcademicRecords(f.dependencies)(f.request({ dataType })),
      ).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(f.fetchers[dataType]).toHaveBeenCalledWith({ SID: 'own-cookie' }, '');
      expect(f.sessions.get('own-session').expiresAt.toDate().getTime()).toBeGreaterThan(NOW);
      expect(f.removed).not.toHaveBeenCalled();
    },
  );
  test('does not infer session expiration from arbitrary upstream error text', async () => {
    const f = fixture();
    f.fetchers.grades.mockResolvedValue({
      success: false,
      grades: [],
      error: 'E校園 session 已失效，請重新登入',
    });
    await expect(createGetMyAcademicRecords(f.dependencies)(f.request())).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
  test.each([{ success: false, grades: [] }, { success: true }, null])(
    'returns failure instead of fabricating empty success for %j',
    async (result) => {
      const f = fixture();
      f.fetchers.grades.mockResolvedValue(result);
      await expect(createGetMyAcademicRecords(f.dependencies)(f.request())).rejects.toMatchObject({
        code: 'unavailable',
      });
    },
  );
  test('propagates school service outage as a retryable failure', async () => {
    const f = fixture();
    f.fetchers.grades.mockRejectedValue(new Error('Network unavailable'));
    await expect(createGetMyAcademicRecords(f.dependencies)(f.request())).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
});
