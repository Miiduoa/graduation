// @vitest-environment node
import { expect, it } from 'vitest';
import { MAX_PERIOD_SLOTS } from '@campus/shared';
import { cleanCourse, createTimetableShareHandlers } from './timetableShareHandlers';
import { createMemoryGroupStore } from './memoryGroupStore';

function handlers(seed: Array<[string, Record<string, unknown>]> = []) {
  const store = createMemoryGroupStore(seed);
  return { store, handlers: createTimetableShareHandlers({ db: store.db }) };
}

const puCourse = {
  id: 'db',
  name: '資料庫',
  day: 1,
  start: 3,
  end: 4,
  teacher: '王',
  room: 'PH303',
  color: 'blue',
};

it('period bounds keep 13 and MAX valid, reset above MAX', () => {
  expect(cleanCourse({ name: '第13節', day: 1, start: 13, end: 13 }).start).toBe(13);
  expect(cleanCourse({ name: '第15節', day: 1, start: 15, end: 15 })).toEqual(
    expect.objectContaining({ start: 15, end: 15 }),
  );
  expect(
    cleanCourse({
      name: '超上限',
      day: 1,
      start: MAX_PERIOD_SLOTS + 1,
      end: MAX_PERIOD_SLOTS + 1,
    }).start,
  ).toBe(1);
});

it('creating a share copies the saved timetable without owner uid or teacher', async () => {
  const { store, handlers: api } = handlers([
    [
      'users/alice/schools/pu/personalTimetable/current',
      {
        schoolId: 'pu',
        courses: [puCourse],
        meta: { title: '114-1', email: 'alice@example.com', studentId: 's1234567' },
      },
    ],
  ]);
  const before = JSON.stringify(store.docs.get('users/alice/schools/pu/personalTimetable/current'));
  const created = await api.createTimetableShare({
    auth: { uid: 'alice' },
    data: { schoolId: 'pu', name: '阿瑋' },
  });
  expect(created.token).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(created.path).toBe(`/timetable/s/${created.token}`);
  expect(created.expiresAt).toMatch(/^\d{4}-/);

  const share = store.docs.get(`timetableShares/${created.token}`);
  const owner = store.docs.get(`timetableShareOwners/${created.token}`);
  expect(share).toMatchObject({
    schoolId: 'pu',
    name: '114-1',
    revoked: false,
  });
  expect(share?.ownerUid).toBeUndefined();
  expect(share?.courses).toEqual([
    expect.objectContaining({ name: '資料庫', room: 'PH303', teacher: '' }),
  ]);
  expect(share?.meta).toEqual({ title: '114-1' });
  expect(JSON.stringify(share)).not.toContain('alice');
  expect(JSON.stringify(share)).not.toContain('王');
  expect(JSON.stringify(share)).not.toContain('alice@example.com');
  expect(JSON.stringify(share)).not.toContain('s1234567');
  expect(owner).toMatchObject({ ownerUid: 'alice' });
  expect(JSON.stringify(store.docs.get('users/alice/schools/pu/personalTimetable/current'))).toBe(
    before,
  );
  expect([...store.docs.keys()].filter((key) => !key.startsWith('users/'))).toEqual(
    expect.arrayContaining([
      `timetableShareOwners/${created.token}`,
      `timetableShares/${created.token}`,
    ]),
  );
});

it('same user shares PU and NTU school-scoped courses and meta separately', async () => {
  const { store, handlers: api } = handlers([
    [
      'users/alice/schools/pu/personalTimetable/current',
      {
        schoolId: 'pu',
        courses: [
          {
            id: 'pu1',
            name: '靜宜課',
            day: 1,
            start: 1,
            end: 2,
            teacher: '王',
            room: 'A1',
            color: 'blue',
          },
        ],
        meta: { title: 'PU-114' },
      },
    ],
    [
      'users/alice/schools/ntu/personalTimetable/current',
      {
        schoolId: 'ntu',
        courses: [
          {
            id: 'ntu1',
            name: '台大課',
            day: 2,
            start: 3,
            end: 4,
            teacher: '李',
            room: 'B2',
            color: 'mint',
          },
        ],
        meta: { title: 'NTU-114' },
      },
    ],
  ]);
  const pu = await api.createTimetableShare({ auth: { uid: 'alice' }, data: { schoolId: 'pu' } });
  const ntu = await api.createTimetableShare({ auth: { uid: 'alice' }, data: { schoolId: 'ntu' } });
  expect(store.docs.get(`timetableShares/${pu.token}`)).toMatchObject({
    schoolId: 'pu',
    name: 'PU-114',
    meta: { title: 'PU-114' },
  });
  expect(store.docs.get(`timetableShares/${ntu.token}`)).toMatchObject({
    schoolId: 'ntu',
    name: 'NTU-114',
    meta: { title: 'NTU-114' },
  });
});

it('canonical-empty school doc refuses share and does not revive matching legacy', async () => {
  const { store, handlers: api } = handlers([
    [
      'users/alice/schools/pu/personalTimetable/current',
      { schoolId: 'pu', courses: [], meta: { title: 'canonical-empty' } },
    ],
    [
      'users/alice/personalTimetable/current',
      {
        schoolId: 'pu',
        courses: [
          {
            id: 'stale',
            name: '舊遺留',
            day: 1,
            start: 1,
            end: 2,
            teacher: '趙',
            room: 'L1',
            color: 'gray',
          },
        ],
        meta: { title: 'stale-legacy' },
      },
    ],
  ]);
  const before = JSON.stringify(store.docs.get('users/alice/personalTimetable/current'));
  await expect(
    api.createTimetableShare({ auth: { uid: 'alice' }, data: { schoolId: 'pu' } }),
  ).rejects.toMatchObject({
    code: 'failed-precondition',
  });
  expect([...store.docs.keys()].some((key) => key.startsWith('timetableShares/'))).toBe(false);
  expect(JSON.stringify(store.docs.get('users/alice/personalTimetable/current'))).toBe(before);
});

it('matching legacy fallback works and leaves the legacy document unchanged', async () => {
  const legacy = {
    schoolId: 'pu',
    courses: [
      {
        id: 'legacy',
        name: '舊課',
        day: 1,
        start: 1,
        end: 2,
        teacher: '趙',
        room: 'L1',
        color: 'gray',
      },
    ],
    meta: { title: 'legacy-pu' },
  };
  const { store, handlers: api } = handlers([
    ['users/alice/personalTimetable/current', { ...legacy, courses: [...legacy.courses] }],
  ]);
  const before = JSON.stringify(store.docs.get('users/alice/personalTimetable/current'));
  const created = await api.createTimetableShare({
    auth: { uid: 'alice' },
    data: { schoolId: 'pu' },
  });
  expect(store.docs.get(`timetableShares/${created.token}`)?.courses).toEqual([
    expect.objectContaining({ name: '舊課', teacher: '' }),
  ]);
  expect(JSON.stringify(store.docs.get('users/alice/personalTimetable/current'))).toBe(before);
  expect(store.docs.has('users/alice/schools/pu/personalTimetable/current')).toBe(false);
});

it('mismatched scoped and legacy provenance is rejected', async () => {
  const { handlers: api } = handlers([
    [
      'users/alice/schools/pu/personalTimetable/current',
      {
        schoolId: 'ntu',
        courses: [
          {
            id: 'bad',
            name: '錯標',
            day: 1,
            start: 1,
            end: 1,
            teacher: 'X',
            room: '',
            color: 'gray',
          },
        ],
        meta: { title: 'scoped-bad' },
      },
    ],
  ]);
  await expect(
    api.createTimetableShare({ auth: { uid: 'alice' }, data: { schoolId: 'pu' } }),
  ).rejects.toMatchObject({
    code: 'failed-precondition',
  });
});

it('rejects absent and unsafe schoolId values', async () => {
  const { handlers: api } = handlers();
  const auth = { uid: 'alice' };
  await expect(api.createTimetableShare({ auth, data: {} })).rejects.toMatchObject({
    code: 'invalid-argument',
  });
  await expect(api.createTimetableShare({ auth, data: { schoolId: '' } })).rejects.toMatchObject({
    code: 'invalid-argument',
  });
  await expect(api.createTimetableShare({ auth, data: { schoolId: 'PU' } })).rejects.toMatchObject({
    code: 'invalid-argument',
  });
  await expect(
    api.createTimetableShare({ auth, data: { schoolId: 'pu/ntu' } }),
  ).rejects.toMatchObject({
    code: 'invalid-argument',
  });
  await expect(
    api.createTimetableShare({ auth, data: { schoolId: 'a'.repeat(81) } }),
  ).rejects.toMatchObject({
    code: 'invalid-argument',
  });
});

it("rejects revoking another person's share and treats a second revoke as idempotent", async () => {
  const { store, handlers: api } = handlers([
    [
      'users/alice/schools/pu/personalTimetable/current',
      { schoolId: 'pu', courses: [puCourse], meta: { title: '114-1' } },
    ],
  ]);
  const created = await api.createTimetableShare({
    auth: { uid: 'alice' },
    data: { schoolId: 'pu' },
  });
  await expect(
    api.revokeTimetableShare({ auth: { uid: 'mallory' }, data: { token: created.token } }),
  ).rejects.toMatchObject({ code: 'not-found', message: '找不到這份分享連結。' });
  expect(store.docs.get(`timetableShares/${created.token}`)?.revoked).toBe(false);

  expect(
    await api.revokeTimetableShare({ auth: { uid: 'alice' }, data: { token: created.token } }),
  ).toEqual({
    ok: true,
  });
  expect(store.docs.get(`timetableShares/${created.token}`)?.revoked).toBe(true);
  expect(
    await api.revokeTimetableShare({ auth: { uid: 'alice' }, data: { token: created.token } }),
  ).toEqual({
    ok: true,
  });
});

it('rejects malformed revoke tokens', async () => {
  const { handlers: api } = handlers();
  const auth = { uid: 'alice' };
  await expect(api.revokeTimetableShare({ auth, data: {} })).rejects.toMatchObject({
    code: 'invalid-argument',
  });
  await expect(api.revokeTimetableShare({ auth, data: { token: '' } })).rejects.toMatchObject({
    code: 'invalid-argument',
  });
  await expect(api.revokeTimetableShare({ auth, data: { token: 'a/b' } })).rejects.toMatchObject({
    code: 'invalid-argument',
  });
  await expect(
    api.revokeTimetableShare({ auth, data: { token: 'x'.repeat(81) } }),
  ).rejects.toMatchObject({
    code: 'invalid-argument',
  });
});
