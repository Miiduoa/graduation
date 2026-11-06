'use strict';

const { Timestamp } = require('firebase-admin/firestore');
const { MAX_PERIOD_SLOTS } = require('./generated/shared/timetable/schoolPeriods');
const {
  publicTimetableCourses,
  readPublicTimetableShare,
} = require('./generated/shared/timetable/publicShare');
const {
  cleanCourse,
  createCreateTimetableShareHandler,
  createGetTimetableShareHandler,
  createRevokeTimetableShareHandler,
} = require('./personalCampus');

function mockDb(docs) {
  return {
    collection(name) {
      return {
        doc(id) {
          const path = `${name}/${id}`;
          return {
            collection(child) {
              return mockDb(docs).collection(`${name}/${id}/${child}`);
            },
            async get() {
              const data = docs.get(path);
              return { exists: data != null, data: () => data };
            },
            async set(value) {
              docs.set(path, value);
            },
            async update(value) {
              docs.set(path, { ...docs.get(path), ...value });
            },
          };
        },
      };
    },
  };
}

function makeRes() {
  return {
    statusCode: 0,
    body: null,
    set() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe('personal timetable share', () => {
  test('missing course ids cannot collide with existing numbered ids', () => {
    const courses = publicTimetableCourses([
      { id: 'course-2', name: '資料庫' },
      { name: '程式設計' },
    ]);
    expect(courses[0].id).toBe('course-2');
    expect(courses[1].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(courses.map((course) => course.id)).size).toBe(2);
  });

  test('shared projection accepts Firestore timestamps and treats the exact deadline as expired', async () => {
    const now = Date.UTC(2026, 10, 6);
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const data = {
        revoked: false,
        schoolId: 'pu',
        courses: [],
        expiresAt: Timestamp.fromMillis(now + 1),
      };
      const db = mockDb(new Map([['timetableShares/valid-token', data]]));
      const active = await readPublicTimetableShare(db, 'valid-token');
      expect(active.status).toBe(200);
      expect(active.body.expiresAt).toBe(new Date(now + 1).toISOString());
      data.expiresAt = Timestamp.fromMillis(now);
      await expect(readPublicTimetableShare(db, 'valid-token')).resolves.toMatchObject({
        status: 410, body: { code: 'expired' },
      });
    } finally {
      clock.mockRestore();
    }
  });

  test.each([undefined, null, 1, 'tomorrow', {}, { toMillis: 'invalid' }])(
    'shared projection rejects malformed stored expiry %j', async (expiresAt) => {
      const db = mockDb(new Map([['timetableShares/invalid-expiry', { revoked: false, expiresAt }]]));
      await expect(readPublicTimetableShare(db, 'invalid-expiry')).resolves.toMatchObject({
        status: 410, body: { code: 'expired' },
      });
    },
  );

  test('period bounds keep 13 and MAX valid, reset above MAX', () => {
    expect(cleanCourse({ name: '第13節', day: 1, start: 13, end: 13 }).start).toBe(13);
    expect(cleanCourse({ name: '第15節', day: 1, start: 15, end: 15 })).toEqual(
      expect.objectContaining({ start: 15, end: 15 }),
    );
    expect(cleanCourse({ name: '超上限', day: 1, start: MAX_PERIOD_SLOTS + 1, end: MAX_PERIOD_SLOTS + 1 }).start).toBe(
      1,
    );
  });

  test('creating a share copies the saved timetable and can be read then revoked', async () => {
    const docs = new Map([
      [
        'users/alice/schools/pu/personalTimetable/current',
        {
          schoolId: 'pu',
          courses: [{ id: 'db', name: '資料庫', day: 1, start: 3, end: 4, teacher: '王', room: 'PH303', color: 'blue' }],
          meta: { title: '114-1' },
        },
      ],
    ]);
    const db = mockDb(docs);
    const created = await createCreateTimetableShareHandler({ db })({
      auth: { uid: 'alice' },
      data: { schoolId: 'pu', name: '阿瑋' },
    });
    expect(created.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(created.path).toContain(created.token);

    const res = makeRes();
    await createGetTimetableShareHandler({ db })({ method: 'GET', query: { token: created.token } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.schoolId).toBe('pu');
    expect(res.body.courses[0].name).toBe('資料庫');
    expect(res.body.courses[0].room).toBe('PH303');
    expect(res.body.courses[0].teacher).toBe('');
    const stored = [...docs.entries()].find(([key]) => key.startsWith('timetableShares/'))[1];
    expect(stored.ownerUid).toBeUndefined();
    expect(stored.schoolId).toBe('pu');
    expect(JSON.stringify(stored)).not.toContain('alice');
    expect(JSON.stringify(stored)).not.toContain('王');
    await expect(
      createRevokeTimetableShareHandler({ db })({ auth: { uid: 'mallory' }, data: { token: created.token } }),
    ).rejects.toThrow();

    await createRevokeTimetableShareHandler({ db })({
      auth: { uid: 'alice' },
      data: { token: created.token },
    });
    const after = makeRes();
    const shareDoc = [...docs.entries()].find(([key]) => key.startsWith('timetableShares/'));
    shareDoc[1].expiresAt = Timestamp.fromMillis(Date.now() + 60_000);
    await createGetTimetableShareHandler({ db })({ method: 'GET', query: { token: created.token } }, after);
    expect(after.statusCode).toBe(410);
  });

  test('never copies private timetable metadata to the public share document', async () => {
    const docs = new Map([
      ['users/alice/schools/pu/personalTimetable/current', {
        schoolId: 'pu',
        courses: [{ name: '資料庫' }],
        meta: { title: '114-1', credits: 3, studentId: 'private-id', email: 'private@example.test' },
      }],
    ]);
    const { token } = await createCreateTimetableShareHandler({ db: mockDb(docs) })({
      auth: { uid: 'alice' }, data: { schoolId: 'pu' },
    });

    expect(docs.get(`timetableShares/${token}`).publicSchemaVersion).toBe(1);
    expect(docs.get(`timetableShares/${token}`).meta).toEqual({ title: '114-1', credits: 3 });
  });

  test('projects metadata on anonymous reads of legacy shares', async () => {
    const docs = new Map([
      ['timetableShares/old-link', {
        name: '舊課表', revoked: false, ownerUid: 'private-owner',
        courses: [{ name: '國文', teacher: 'private-teacher', studentId: 'private-id' }],
        meta: { school: 'PU', className: { email: 'private@example.test' }, studentId: 'private-id' },
        expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      }],
    ]);
    const response = makeRes();
    await createGetTimetableShareHandler({ db: mockDb(docs) })(
      { method: 'GET', query: { token: 'old-link' } }, response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.meta).toEqual({ school: 'PU' });
    expect(response.body.courses[0].name).toBe('國文');
    expect(JSON.stringify(response.body)).not.toContain('private-');
  });

  test('same user shares PU and NTU school-scoped courses and meta separately', async () => {
    const docs = new Map([
      [
        'users/alice/schools/pu/personalTimetable/current',
        {
          schoolId: 'pu',
          courses: [{ id: 'pu1', name: '靜宜課', day: 1, start: 1, end: 2, teacher: '王', room: 'A1', color: 'blue' }],
          meta: { title: 'PU-114' },
        },
      ],
      [
        'users/alice/schools/ntu/personalTimetable/current',
        {
          schoolId: 'ntu',
          courses: [{ id: 'ntu1', name: '台大課', day: 2, start: 3, end: 4, teacher: '李', room: 'B2', color: 'mint' }],
          meta: { title: 'NTU-114' },
        },
      ],
    ]);
    const create = createCreateTimetableShareHandler({ db: mockDb(docs) });

    const pu = await create({ auth: { uid: 'alice' }, data: { schoolId: 'pu' } });
    const ntu = await create({ auth: { uid: 'alice' }, data: { schoolId: 'ntu' } });
    const puShare = docs.get(`timetableShares/${pu.token}`);
    const ntuShare = docs.get(`timetableShares/${ntu.token}`);

    expect(puShare.schoolId).toBe('pu');
    expect(puShare.name).toBe('PU-114');
    expect(puShare.courses).toEqual([
      expect.objectContaining({ name: '靜宜課', room: 'A1', teacher: '' }),
    ]);
    expect(puShare.meta).toEqual({ title: 'PU-114' });

    expect(ntuShare.schoolId).toBe('ntu');
    expect(ntuShare.name).toBe('NTU-114');
    expect(ntuShare.courses).toEqual([
      expect.objectContaining({ name: '台大課', room: 'B2', teacher: '' }),
    ]);
    expect(ntuShare.meta).toEqual({ title: 'NTU-114' });
  });

  test('public share keeps NCKU night class period 15 and strips teacher', async () => {
    const docs = new Map([
      [
        'users/alice/schools/ncku/personalTimetable/current',
        {
          schoolId: 'ncku',
          courses: [
            {
              id: 'night-d',
              name: '夜間課D',
              day: 1,
              start: 15,
              end: 15,
              teacher: '張老師',
              room: 'C1',
              color: 'orange',
            },
          ],
          meta: { title: 'NCKU-night' },
        },
      ],
    ]);
    const db = mockDb(docs);
    const created = await createCreateTimetableShareHandler({ db })({
      auth: { uid: 'alice' },
      data: { schoolId: 'ncku' },
    });
    const res = makeRes();
    await createGetTimetableShareHandler({ db })({ method: 'GET', query: { token: created.token } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.schoolId).toBe('ncku');
    expect(res.body.courses[0]).toEqual(
      expect.objectContaining({ name: '夜間課D', start: 15, end: 15, teacher: '', room: 'C1' }),
    );
  });

  test('canonical-empty school doc refuses share and does not revive matching legacy', async () => {
    const docs = new Map([
      [
        'users/alice/schools/pu/personalTimetable/current',
        {
          schoolId: 'pu',
          courses: [],
          meta: { title: 'canonical-empty' },
        },
      ],
      [
        'users/alice/personalTimetable/current',
        {
          schoolId: 'pu',
          courses: [
            { id: 'stale', name: '舊遺留', day: 1, start: 1, end: 2, teacher: '趙', room: 'L1', color: 'gray' },
          ],
          meta: { title: 'stale-legacy' },
        },
      ],
    ]);
    const before = JSON.stringify(docs.get('users/alice/personalTimetable/current'));
    await expect(
      createCreateTimetableShareHandler({ db: mockDb(docs) })({
        auth: { uid: 'alice' },
        data: { schoolId: 'pu' },
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect([...docs.keys()].some((key) => key.startsWith('timetableShares/'))).toBe(false);
    expect(JSON.stringify(docs.get('users/alice/personalTimetable/current'))).toBe(before);
  });

  test('matching legacy fallback works and leaves the legacy document unchanged', async () => {
    const legacy = {
      schoolId: 'pu',
      courses: [{ id: 'legacy', name: '舊課', day: 1, start: 1, end: 2, teacher: '趙', room: 'L1', color: 'gray' }],
      meta: { title: 'legacy-pu' },
    };
    const docs = new Map([['users/alice/personalTimetable/current', { ...legacy, courses: [...legacy.courses] }]]);
    const before = JSON.stringify(docs.get('users/alice/personalTimetable/current'));
    const created = await createCreateTimetableShareHandler({ db: mockDb(docs) })({
      auth: { uid: 'alice' },
      data: { schoolId: 'pu' },
    });
    const share = docs.get(`timetableShares/${created.token}`);
    expect(share.schoolId).toBe('pu');
    expect(share.courses[0]).toEqual(expect.objectContaining({ name: '舊課', teacher: '' }));
    expect(JSON.stringify(docs.get('users/alice/personalTimetable/current'))).toBe(before);
    expect(docs.has('users/alice/schools/pu/personalTimetable/current')).toBe(false);
  });

  test('mismatched legacy and missing schoolId on legacy are rejected', async () => {
    const create = createCreateTimetableShareHandler({
      db: mockDb(
        new Map([
          [
            'users/alice/personalTimetable/current',
            {
              schoolId: 'ntu',
              courses: [{ id: 'x', name: '外校', day: 1, start: 1, end: 1, teacher: 'A', room: '', color: 'gray' }],
              meta: {},
            },
          ],
        ]),
      ),
    });
    await expect(create({ auth: { uid: 'alice' }, data: { schoolId: 'pu' } })).rejects.toMatchObject({
      code: 'failed-precondition',
    });

    const missingSchool = createCreateTimetableShareHandler({
      db: mockDb(
        new Map([
          [
            'users/bob/personalTimetable/current',
            {
              courses: [{ id: 'y', name: '無校', day: 1, start: 1, end: 1, teacher: 'B', room: '', color: 'gray' }],
              meta: {},
            },
          ],
        ]),
      ),
    });
    await expect(missingSchool({ auth: { uid: 'bob' }, data: { schoolId: 'pu' } })).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  test('malformed or mismatched scoped doc fails without falling back to legacy', async () => {
    const docs = new Map([
      [
        'users/alice/schools/pu/personalTimetable/current',
        {
          schoolId: 'ntu',
          courses: [{ id: 'bad', name: '錯標', day: 1, start: 1, end: 1, teacher: 'X', room: '', color: 'gray' }],
          meta: { title: 'scoped-bad' },
        },
      ],
      [
        'users/alice/personalTimetable/current',
        {
          schoolId: 'pu',
          courses: [{ id: 'ok', name: '可退回', day: 2, start: 2, end: 2, teacher: 'Y', room: '', color: 'blue' }],
          meta: { title: 'legacy-ok' },
        },
      ],
    ]);
    await expect(
      createCreateTimetableShareHandler({ db: mockDb(docs) })({
        auth: { uid: 'alice' },
        data: { schoolId: 'pu' },
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect([...docs.keys()].some((key) => key.startsWith('timetableShares/'))).toBe(false);

    const missingProvenance = new Map([
      [
        'users/alice/schools/pu/personalTimetable/current',
        {
          courses: [{ id: 'noprove', name: '無標記', day: 1, start: 1, end: 1, teacher: 'Z', room: '', color: 'gray' }],
          meta: {},
        },
      ],
      [
        'users/alice/personalTimetable/current',
        {
          schoolId: 'pu',
          courses: [{ id: 'ok', name: '可退回', day: 2, start: 2, end: 2, teacher: 'Y', room: '', color: 'blue' }],
          meta: {},
        },
      ],
    ]);
    await expect(
      createCreateTimetableShareHandler({ db: mockDb(missingProvenance) })({
        auth: { uid: 'alice' },
        data: { schoolId: 'pu' },
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  test('absent and unsafe schoolId values are rejected', async () => {
    const create = createCreateTimetableShareHandler({ db: mockDb(new Map()) });
    const auth = { uid: 'alice' };
    await expect(create({ auth, data: {} })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(create({ auth, data: { schoolId: '' } })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(create({ auth, data: { schoolId: '   ' } })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(create({ auth, data: { schoolId: 'PU' } })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(create({ auth, data: { schoolId: 'pu/ntu' } })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(create({ auth, data: { schoolId: '../x' } })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(create({ auth, data: { schoolId: 'a'.repeat(81) } })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  test('literal personal schoolId is accepted when explicitly passed', async () => {
    const docs = new Map([
      [
        'users/alice/schools/personal/personalTimetable/current',
        {
          schoolId: 'personal',
          courses: [{ id: 'p1', name: '個人課', day: 1, start: 1, end: 1, teacher: '隱', room: 'P', color: 'lime' }],
          meta: { title: 'personal' },
        },
      ],
    ]);
    const created = await createCreateTimetableShareHandler({ db: mockDb(docs) })({
      auth: { uid: 'alice' },
      data: { schoolId: 'personal' },
    });
    expect(docs.get(`timetableShares/${created.token}`).schoolId).toBe('personal');
  });
});
