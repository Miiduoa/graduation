const { createListTeacherAppealsHandler, createAppealTeacherStatusHandler, studentNumberOf } = require('./teacherAppeals');

function fakeDb(data, onRead = () => {}) {
  const snap = (path) => ({ exists: path in data, data: () => data[path] });
  const query = (prefix, filters) => ({
    where(field, op, value) {
      return query(prefix, [...filters, [field, op, value]]);
    },
    async get() {
      const docs = Object.keys(data)
        .filter((path) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/'))
        .filter((path) =>
          filters.every(([field, op, value]) =>
            op === 'array-contains' ? (data[path][field] || []).includes(value) : data[path][field] === value,
          ),
        )
        .map((path) => ({ id: path.split('/').pop(), data: () => data[path] }));
      return { docs };
    },
  });
  return { doc: (path) => ({ get: async () => { await onRead(path); return snap(path); } }), collection: (path) => query(path, []) };
}

const base = { schoolId: 'pu', title: '期中考成績', body: '第三題', status: 'pending', createdAt: new Date('2026-10-12T02:00:00Z') };
const data = {
  'schools/pu/members/t1': { role: 'teacher', status: 'active' },
  'schools/pu/members/s1': { role: 'student', status: 'active' },
  'schools/pu/courseTeachers/資料庫｜王老師': { teacherUids: ['t1'] },
  'schools/pu/courseTeachers/資料庫｜李老師': { teacherUids: ['t2'] },
  'users/test-student-a': { displayName: '測試學生甲', email: 's0000001@test.campus-one.local' },
  'courseAppeals/a1': { ...base, studentUid: 'test-student-a', courseName: '資料庫', offeringId: '資料庫｜王老師' },
  'courseAppeals/a2': { ...base, studentUid: 'test-student-a', courseName: '英文', offeringId: '英文｜陳老師' },
  // 同名的課、別的老師開的：t1 看不到
  'courseAppeals/a3': { ...base, studentUid: 'test-student-a', courseName: '資料庫', offeringId: '資料庫｜李老師' },
};

test('a teacher gets only their course, with the student name, ID and submit time', async () => {
  const handle = createListTeacherAppealsHandler({ db: fakeDb(data) });
  const result = await handle({ auth: { uid: 't1' }, data: { schoolId: 'pu' } });
  expect(result.courses).toEqual(['資料庫（王老師）']);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    id: 'a1',
    courseName: '資料庫',
    studentName: '測試學生甲',
    studentNumber: 'S0000001',
    createdAt: '2026-10-12T02:00:00.000Z',
  });
});

test('students and signed-out users are refused', async () => {
  const handle = createListTeacherAppealsHandler({ db: fakeDb(data) });
  await expect(handle({ auth: { uid: 's1' }, data: { schoolId: 'pu' } })).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(handle({ data: { schoolId: 'pu' } })).rejects.toMatchObject({ code: 'unauthenticated' });
});

test.each(['member', 'editor', 'teacher'])('an assigned %s sees only the exact trusted offering', async (role) => {
  const handle = createListTeacherAppealsHandler({ db: fakeDb({
    ...data, 'schools/pu/members/t1': { role, status: 'active' },
  }) });
  const result = await handle({ auth: { uid: 't1' }, data: { schoolId: 'pu' } });
  expect(result.rows.map((row) => row.id)).toEqual(['a1']);
  expect(result.courses).toEqual(['資料庫（王老師）']);
});

test.each(['member', 'editor', 'teacher'])('an unassigned %s cannot list school appeals', async (role) => {
  const handle = createListTeacherAppealsHandler({ db: fakeDb({
    ...data, 'schools/pu/members/outsider': { role, status: 'active' },
  }) });
  await expect(handle({ auth: { uid: 'outsider' }, data: { schoolId: 'pu' } })).rejects.toMatchObject({ code: 'permission-denied' });
});

test('only a same-school active admin receives the school-wide list', async () => {
  const handle = createListTeacherAppealsHandler({ db: fakeDb({
    ...data, 'schools/pu/members/admin': { role: 'admin', status: 'active' },
  }) });
  const result = await handle({ auth: { uid: 'admin' }, data: { schoolId: 'pu' } });
  expect(result.courses).toBeNull();
  expect(result.rows.map((row) => row.id)).toEqual(['a1', 'a2', 'a3']);
  await expect(handle({ auth: { uid: 'admin' }, data: { schoolId: 'other' } })).rejects.toMatchObject({ code: 'permission-denied' });
});

test.each(['inactive', undefined])('a teaching binding does not override membership status %s', async (status) => {
  const handle = createListTeacherAppealsHandler({ db: fakeDb({
    ...data, 'schools/pu/members/t1': { role: 'teacher', status },
  }) });
  await expect(handle({ auth: { uid: 't1' }, data: { schoolId: 'pu' } })).rejects.toMatchObject({ code: 'permission-denied' });
});

test.each([{ status: 'deleted' }, { accountDeletionInProgress: true }])('a teaching binding does not override unavailable account %j', async (profile) => {
  const handle = createListTeacherAppealsHandler({ db: fakeDb({ ...data, 'users/t1': profile }) });
  await expect(handle({ auth: { uid: 't1' }, data: { schoolId: 'pu' } })).rejects.toMatchObject({ code: 'failed-precondition' });
});

test.each(['assignment', 'membership', 'account'])('a concurrent %s revocation withholds previously loaded private appeals', async (kind) => {
  const records = { ...data };
  const db = fakeDb(records, (path) => {
    if (path !== 'users/test-student-a') return;
    if (kind === 'assignment') records['schools/pu/courseTeachers/資料庫｜王老師'] = { teacherUids: [] };
    if (kind === 'membership') records['schools/pu/members/t1'] = { role: 'teacher', status: 'inactive' };
    if (kind === 'account') records['users/t1'] = { accountDeletionInProgress: true };
  });
  await expect(createListTeacherAppealsHandler({ db })({ auth: { uid: 't1' }, data: { schoolId: 'pu' } })).rejects.toMatchObject({
    code: kind === 'account' ? 'failed-precondition' : 'permission-denied',
  });
});

test('a revoked teaching binding immediately removes access', async () => {
  const handle = createListTeacherAppealsHandler({ db: fakeDb({
    ...data, 'schools/pu/courseTeachers/資料庫｜王老師': { teacherUids: [] },
  }) });
  await expect(handle({ auth: { uid: 't1' }, data: { schoolId: 'pu' } })).rejects.toMatchObject({ code: 'permission-denied' });
});

test('another school admin assignment cannot widen or restore a selected-school editor teaching scope', async () => {
  const records = {
    ...data,
    'schools/pu/members/t1': { role: 'editor', status: 'active' },
    'schools/ntu/members/t1': { role: 'admin', status: 'active' },
    'schools/ntu/courseTeachers/資料庫｜王老師': { teacherUids: ['t1'] },
    'users/ntu-private': { displayName: '他校學生' },
    'courseAppeals/ntu-private': {
      ...base, schoolId: 'ntu', studentUid: 'ntu-private', courseName: '資料庫', offeringId: '資料庫｜王老師',
    },
  };
  const reads = [];
  let revoke = false;
  const handle = createListTeacherAppealsHandler({ db: fakeDb(records, (path) => {
    reads.push(path);
    if (revoke && path === 'users/test-student-a') {
      records['schools/pu/courseTeachers/資料庫｜王老師'] = { teacherUids: [] };
    }
  }) });
  const request = { auth: { uid: 't1' }, data: { schoolId: ' pu ' } };

  expect((await handle(request)).rows.map((row) => row.id)).toEqual(['a1']);
  expect(reads).not.toContain('users/ntu-private');

  revoke = true;
  await expect(handle(request)).rejects.toMatchObject({ code: 'permission-denied' });
  expect(records['schools/ntu/members/t1']).toEqual({ role: 'admin', status: 'active' });
  expect(records['schools/ntu/courseTeachers/資料庫｜王老師'].teacherUids).toEqual(['t1']);
  expect(reads).not.toContain('users/ntu-private');
});

test('student ID comes from the profile, the PU uid, or the login email', () => {
  expect(studentNumberOf('x', { studentId: 's1100001' })).toBe('S1100001');
  expect(studentNumberOf('pu-s1234567', {})).toBe('S1234567');
  expect(studentNumberOf('u', { email: 's0000002@test.campus-one.local' })).toBe('S0000002');
  expect(studentNumberOf('u', { email: 'someone@example.com' })).toBe('');
});

test('a student learns only whether courses in their own timetable have a teacher, nothing about who', async () => {
  const db = fakeDb({
    ...data,
    'schools/pu/members/test-student-a': { role: 'student', status: 'active' },
    'schools/pu/courseTeachers/空的｜張老師': { teacherUids: [] },
    'schools/pu/courseTeachers/統計學｜林老師': { teacherUids: ['t9'] },
    'users/test-student-a/schools/pu/personalTimetable/current': {
      schoolId: 'pu',
      offeringIds: ['資料庫｜王老師', '英文｜陳老師', '空的｜張老師'],
    },
  });
  const handle = createAppealTeacherStatusHandler({ db });
  const result = await handle({
    auth: { uid: 'test-student-a' },
    data: { schoolId: 'pu', offeringIds: ['資料庫｜王老師', '英文｜陳老師', '空的｜張老師', '統計學｜林老師'] },
  });
  // 有對應：true；沒有對應或沒有老師：false；不在自己課表、也沒申訴過的（林老師的統計學）根本不查
  expect(result).toEqual({ assigned: { '資料庫｜王老師': true, '英文｜陳老師': false, '空的｜張老師': false } });
  expect(JSON.stringify(result)).not.toContain('t1');
  await expect(handle({ data: { schoolId: 'pu', offeringIds: [] } })).rejects.toMatchObject({ code: 'unauthenticated' });
  await expect(
    handle({ auth: { uid: 'outsider' }, data: { schoolId: 'pu', offeringIds: ['資料庫｜王老師'] } }),
  ).rejects.toMatchObject({ code: 'permission-denied' });
});

test('with no mapping at all every course comes back as not assigned', async () => {
  const db = fakeDb({
    'schools/pu/members/s9': { role: 'student', status: 'active' },
    'users/s9/schools/pu/personalTimetable/current': { schoolId: 'pu', offeringIds: ['資料庫｜王老師'] },
    // 舊申訴沒有開課代號：不會出現在查詢裡
    'courseAppeals/old': { schoolId: 'pu', studentUid: 's9', courseName: '資料庫', status: 'pending' },
  });
  const result = await createAppealTeacherStatusHandler({ db })({
    auth: { uid: 's9' },
    data: { schoolId: 'pu', offeringIds: ['資料庫｜王老師'] },
  });
  expect(result).toEqual({ assigned: { '資料庫｜王老師': false } });
});

test('a course later removed from the timetable is still checked for the student own appeal', async () => {
  const db = fakeDb({
    ...data,
    'schools/pu/members/test-student-a': { role: 'student', status: 'active' },
    'users/test-student-a/schools/pu/personalTimetable/current': { schoolId: 'pu', offeringIds: [] },
  });
  const result = await createAppealTeacherStatusHandler({ db })({
    auth: { uid: 'test-student-a' },
    data: { schoolId: 'pu', offeringIds: ['資料庫｜王老師', '資料庫｜李老師'] },
  });
  // a1（王老師）、a3（李老師）都是自己的申訴
  expect(result).toEqual({ assigned: { '資料庫｜王老師': true, '資料庫｜李老師': true } });
});

test('same UID with PU and NTU scoped indexes only authorizes the requested school offerings', async () => {
  const sharedOffering = '微積分｜周老師';
  const db = fakeDb({
    'schools/pu/members/multi': { role: 'student', status: 'active' },
    'schools/ntu/members/multi': { role: 'student', status: 'active' },
    'schools/pu/courseTeachers/資料庫｜王老師': { teacherUids: ['t1'] },
    'schools/pu/courseTeachers/微積分｜周老師': { teacherUids: ['t-pu'] },
    'schools/ntu/courseTeachers/微積分｜周老師': { teacherUids: ['t-ntu'] },
    'schools/ntu/courseTeachers/程式設計｜吳老師': { teacherUids: ['t-ntu2'] },
    'users/multi/schools/pu/personalTimetable/current': {
      schoolId: 'pu',
      offeringIds: ['資料庫｜王老師', sharedOffering],
    },
    'users/multi/schools/ntu/personalTimetable/current': {
      schoolId: 'ntu',
      offeringIds: [sharedOffering, '程式設計｜吳老師'],
    },
  });
  const handle = createAppealTeacherStatusHandler({ db });
  expect(
    await handle({
      auth: { uid: 'multi' },
      data: { schoolId: 'pu', offeringIds: ['資料庫｜王老師', sharedOffering, '程式設計｜吳老師'] },
    }),
  ).toEqual({ assigned: { '資料庫｜王老師': true, [sharedOffering]: true } });
  expect(
    await handle({
      auth: { uid: 'multi' },
      data: { schoolId: 'ntu', offeringIds: ['資料庫｜王老師', sharedOffering, '程式設計｜吳老師'] },
    }),
  ).toEqual({ assigned: { [sharedOffering]: true, '程式設計｜吳老師': true } });
});

test('matching legacy timetable authorizes when the canonical school path is absent', async () => {
  const db = fakeDb({
    'schools/pu/members/legacy': { role: 'student', status: 'active' },
    'schools/pu/courseTeachers/資料庫｜王老師': { teacherUids: ['t1'] },
    'users/legacy/personalTimetable/current': {
      schoolId: 'pu',
      offeringIds: ['資料庫｜王老師', '英文｜陳老師'],
    },
  });
  const result = await createAppealTeacherStatusHandler({ db })({
    auth: { uid: 'legacy' },
    data: { schoolId: 'pu', offeringIds: ['資料庫｜王老師', '英文｜陳老師', '統計學｜林老師'] },
  });
  expect(result).toEqual({ assigned: { '資料庫｜王老師': true, '英文｜陳老師': false } });
});

test('legacy mismatch or missing schoolId does not authorize offerings', async () => {
  const handleMismatch = createAppealTeacherStatusHandler({
    db: fakeDb({
      'schools/pu/members/legacy-bad': { role: 'student', status: 'active' },
      'schools/pu/courseTeachers/資料庫｜王老師': { teacherUids: ['t1'] },
      'users/legacy-bad/personalTimetable/current': {
        schoolId: 'ntu',
        offeringIds: ['資料庫｜王老師'],
      },
    }),
  });
  expect(
    await handleMismatch({
      auth: { uid: 'legacy-bad' },
      data: { schoolId: 'pu', offeringIds: ['資料庫｜王老師'] },
    }),
  ).toEqual({ assigned: {} });

  const handleMissing = createAppealTeacherStatusHandler({
    db: fakeDb({
      'schools/pu/members/legacy-none': { role: 'student', status: 'active' },
      'schools/pu/courseTeachers/資料庫｜王老師': { teacherUids: ['t1'] },
      'users/legacy-none/personalTimetable/current': {
        offeringIds: ['資料庫｜王老師'],
      },
    }),
  });
  expect(
    await handleMissing({
      auth: { uid: 'legacy-none' },
      data: { schoolId: 'pu', offeringIds: ['資料庫｜王老師'] },
    }),
  ).toEqual({ assigned: {} });
});

test('canonical mismatch or missing schoolId does not fall back to legacy', async () => {
  const db = fakeDb({
    'schools/pu/members/no-fallback': { role: 'student', status: 'active' },
    'schools/pu/courseTeachers/資料庫｜王老師': { teacherUids: ['t1'] },
    'users/no-fallback/schools/pu/personalTimetable/current': {
      schoolId: 'ntu',
      offeringIds: ['資料庫｜王老師'],
    },
    'users/no-fallback/personalTimetable/current': {
      schoolId: 'pu',
      offeringIds: ['資料庫｜王老師'],
    },
  });
  expect(
    await createAppealTeacherStatusHandler({ db })({
      auth: { uid: 'no-fallback' },
      data: { schoolId: 'pu', offeringIds: ['資料庫｜王老師'] },
    }),
  ).toEqual({ assigned: {} });

  const missingProvenance = fakeDb({
    'schools/pu/members/no-fallback-2': { role: 'student', status: 'active' },
    'schools/pu/courseTeachers/資料庫｜王老師': { teacherUids: ['t1'] },
    'users/no-fallback-2/schools/pu/personalTimetable/current': {
      offeringIds: ['資料庫｜王老師'],
    },
    'users/no-fallback-2/personalTimetable/current': {
      schoolId: 'pu',
      offeringIds: ['資料庫｜王老師'],
    },
  });
  expect(
    await createAppealTeacherStatusHandler({ db: missingProvenance })({
      auth: { uid: 'no-fallback-2' },
      data: { schoolId: 'pu', offeringIds: ['資料庫｜王老師'] },
    }),
  ).toEqual({ assigned: {} });
});

test('prior school-specific own appeals still authorize removed offerings', async () => {
  const db = fakeDb({
    'schools/pu/members/alumni': { role: 'student', status: 'active' },
    'schools/ntu/members/alumni': { role: 'student', status: 'active' },
    'schools/pu/courseTeachers/資料庫｜王老師': { teacherUids: ['t1'] },
    'schools/ntu/courseTeachers/資料庫｜王老師': { teacherUids: ['t-ntu'] },
    'users/alumni/schools/pu/personalTimetable/current': { schoolId: 'pu', offeringIds: [] },
    'users/alumni/schools/ntu/personalTimetable/current': { schoolId: 'ntu', offeringIds: [] },
    'courseAppeals/pu-only': {
      schoolId: 'pu',
      studentUid: 'alumni',
      courseName: '資料庫',
      offeringId: '資料庫｜王老師',
      status: 'pending',
    },
    'courseAppeals/ntu-only': {
      schoolId: 'ntu',
      studentUid: 'alumni',
      courseName: '資料庫',
      offeringId: '資料庫｜王老師',
      status: 'pending',
    },
  });
  const handle = createAppealTeacherStatusHandler({ db });
  expect(
    await handle({
      auth: { uid: 'alumni' },
      data: { schoolId: 'pu', offeringIds: ['資料庫｜王老師'] },
    }),
  ).toEqual({ assigned: { '資料庫｜王老師': true } });
  expect(
    await handle({
      auth: { uid: 'alumni' },
      data: { schoolId: 'ntu', offeringIds: ['資料庫｜王老師'] },
    }),
  ).toEqual({ assigned: { '資料庫｜王老師': true } });
});

test('an identical offering in another school cannot authorize the selected school', async () => {
  const handle = createAppealTeacherStatusHandler({ db: fakeDb({
    'schools/pu/members/multi': { role: 'student', status: 'active' },
    'schools/pu/courseTeachers/資料庫｜王老師': { teacherUids: ['t-pu'] },
    'users/multi/schools/ntu/personalTimetable/current': {
      schoolId: 'ntu', offeringIds: ['資料庫｜王老師'],
    },
  }) });
  expect(await handle({
    auth: { uid: 'multi' }, data: { schoolId: 'pu', offeringIds: ['資料庫｜王老師'] },
  })).toEqual({ assigned: {} });
});

test.each([
  { schoolId: 'pu', offeringIds: [] },
  { schoolId: ' pu ', offeringIds: ['資料庫｜王老師'] },
])('an existing canonical record never revives legacy offerings: %o', async (canonical) => {
  const handle = createAppealTeacherStatusHandler({ db: fakeDb({
    'schools/pu/members/student': { role: 'student', status: 'active' },
    'schools/pu/courseTeachers/資料庫｜王老師': { teacherUids: ['t1'] },
    'users/student/schools/pu/personalTimetable/current': canonical,
    'users/student/personalTimetable/current': {
      schoolId: 'pu', offeringIds: ['資料庫｜王老師'],
    },
  }) });
  expect(await handle({
    auth: { uid: 'student' }, data: { schoolId: 'pu', offeringIds: ['資料庫｜王老師'] },
  })).toEqual({ assigned: {} });
});

test.each([undefined, null, '', '.', '..', 'pu/ntu', 'PU', 'a b', 123])(
  'teacher endpoints reject unsafe or absent school ids before reading: %p', async (schoolId) => {
    const db = fakeDb({});
    for (const create of [createAppealTeacherStatusHandler, createListTeacherAppealsHandler]) {
      await expect(create({ db })({ auth: { uid: 'student' }, data: { schoolId } }))
        .rejects.toMatchObject({ code: 'invalid-argument' });
    }
  },
);
