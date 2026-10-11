const { createListTeacherAppealsHandler, studentNumberOf } = require('./teacherAppeals');

function fakeDb(data) {
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
  return { doc: (path) => ({ get: async () => snap(path) }), collection: (path) => query(path, []) };
}

const base = { schoolId: 'pu', title: '期中考成績', body: '第三題', status: 'pending', createdAt: new Date('2026-10-12T02:00:00Z') };
const data = {
  'schools/pu/members/t1': { role: 'teacher', status: 'active' },
  'schools/pu/members/s1': { role: 'student', status: 'active' },
  'schools/pu/courseTeachers/資料庫': { teacherUids: ['t1'] },
  'users/test-student-a': { displayName: '測試學生甲', email: 's0000001@test.campus-one.local' },
  'courseAppeals/a1': { ...base, studentUid: 'test-student-a', courseName: '資料庫' },
  'courseAppeals/a2': { ...base, studentUid: 'test-student-a', courseName: '英文' },
};

test('a teacher gets only their course, with the student name, ID and submit time', async () => {
  const handle = createListTeacherAppealsHandler({ db: fakeDb(data) });
  const result = await handle({ auth: { uid: 't1' }, data: { schoolId: 'pu' } });
  expect(result.courses).toEqual(['資料庫']);
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

test('student ID comes from the profile, the PU uid, or the login email', () => {
  expect(studentNumberOf('x', { studentId: 's1100001' })).toBe('S1100001');
  expect(studentNumberOf('pu-s1234567', {})).toBe('S1234567');
  expect(studentNumberOf('u', { email: 's0000002@test.campus-one.local' })).toBe('S0000002');
  expect(studentNumberOf('u', { email: 'someone@example.com' })).toBe('');
});
