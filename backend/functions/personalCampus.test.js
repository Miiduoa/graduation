'use strict';

const { Timestamp } = require('firebase-admin/firestore');
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

describe('personal timetable share', () => {
  test('night periods stay on the 13-period table', () => {
    expect(cleanCourse({ name: '夜課', day: 1, start: 13, end: 13 }).start).toBe(13);
    expect(cleanCourse({ name: '壞節次', day: 1, start: 20, end: 20 }).start).toBe(1);
  });

  test('creating a share copies the saved timetable and can be read then revoked', async () => {
    const docs = new Map([
      [
        'users/alice/personalTimetable/current',
        {
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

    const res = {
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
    await createGetTimetableShareHandler({ db })({ method: 'GET', query: { token: created.token } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.courses[0].name).toBe('資料庫');

    await createRevokeTimetableShareHandler({ db })({
      auth: { uid: 'alice' },
      data: { token: created.token },
    });
    const after = {
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
    const shareDoc = [...docs.entries()].find(([key]) => key.startsWith('timetableShares/'));
    shareDoc[1].expiresAt = Timestamp.fromMillis(Date.now() + 60_000);
    await createGetTimetableShareHandler({ db })({ method: 'GET', query: { token: created.token } }, after);
    expect(after.statusCode).toBe(410);
  });
});
