const { createSchoolLoginProfileWriter } = require('./schoolLoginProfile');

let records;
let retryWith;
let write;
const memberPath = 'schools/pu/members/alice';
beforeEach(() => {
  records = new Map();
  retryWith = null;
  const ref = (path) => ({ path, collection: (name) => collection(`${path}/${name}`) });
  const collection = (path) => ({ doc: (id) => ref(`${path}/${id}`) });
  const snapshot = (reference) => ({
    exists: records.has(reference.path),
    data: () => records.get(reference.path),
  });
  write = createSchoolLoginProfileWriter({
    db: {
      collection,
      async runTransaction(callback) {
        let writes;
        const attempt = async () => {
          writes = [];
          return callback({
            getAll: async (...refs) => refs.map(snapshot),
            set: (reference, data) => writes.push({ reference, data }),
          });
        };
        let result = await attempt();
        if (retryWith) {
          for (const [path, data] of retryWith) records.set(path, data);
          result = await attempt();
        }
        for (const { reference, data } of writes)
          records.set(reference.path, { ...records.get(reference.path), ...data });
        return result;
      },
    },
  });
});
const login = (role = 'student', extra = {}) =>
  write({
    uid: 'alice',
    schoolId: 'pu',
    profile: { displayName: '同學', role },
    ...extra,
  });

test.each(['admin', 'editor', 'teacher', 'staff', 'principal'])(
  'a display role of %s cannot create school administrative authority',
  async (role) => {
    records.set('users/alice', { role, primaryRole: 'admin' });
    await login(role);
    expect(records.get(memberPath)).toMatchObject({ role: 'member', status: 'active' });
    expect(records.get('users/alice').primaryRole).not.toBe('admin');
    expect(records.get('users/alice').role).not.toBe('admin');
  },
);

test.each(['admin', 'editor'])(
  'PU reauthentication preserves a school-issued %s assignment',
  async (role) => {
    records.set(memberPath, { role, status: 'active', updatedBy: 'school-admin' });
    await login('student');
    expect(records.get(memberPath)).toMatchObject({ role, updatedBy: 'school-admin' });
    expect(records.get('users/alice').role).toBe(role === 'admin' ? 'admin' : 'staff');
  },
);

test('stale SSO role claims cannot restore a demoted administrator', async () => {
  records.set(memberPath, { role: 'member', status: 'active', updatedBy: 'school-admin' });
  records.set('users/alice', { role: 'admin', primaryRole: 'admin' });
  records.set('ssoLinks/pu_alice', { role: 'admin', firebaseUid: 'alice' });
  await login('admin', { ssoLinkRef: { path: 'ssoLinks/pu_alice' } });
  expect(records.get(memberPath).role).toBe('member');
  expect(records.get('users/alice')).toMatchObject({ role: 'student', primaryRole: 'student' });
  expect(records.get('ssoLinks/pu_alice')).toMatchObject({ role: 'student', firebaseUid: 'alice' });
});

test('school authority never transfers from an account display role or another school', async () => {
  records.set('schools/other/members/alice', { role: 'admin', status: 'active' });
  records.set('users/alice', { role: 'admin', schoolId: 'other' });
  await login('admin');
  expect(records.get(memberPath).role).toBe('member');
  expect(records.get('schools/other/members/alice').role).toBe('admin');
});

test.each(['inactive', 'suspended', 'revoked'])(
  'reauthentication cannot reactivate %s membership',
  async (status) => {
    records.set(memberPath, { role: 'admin', status });
    await expect(login()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(records.get(memberPath)).toEqual({ role: 'admin', status });
    expect(records.has('users/alice')).toBe(false);
  },
);

test.each([{ status: 'deleted' }, { accountDeletionInProgress: true }])(
  'reauthentication cannot reopen an unavailable account %j',
  async (profile) => {
    records.set('users/alice', profile);
    records.set(memberPath, { role: 'admin', status: 'active' });
    await expect(login()).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(records.get('users/alice')).toEqual(profile);
  },
);

test.each(['admin', 'member'])(
  'a concurrent school role change to %s wins over a login refresh',
  async (role) => {
    records.set(memberPath, { role: role === 'admin' ? 'member' : 'admin', status: 'active' });
    retryWith = [[memberPath, { role, status: 'active', updatedBy: 'school-admin' }]];
    const result = await login('student');
    expect(result.memberRole).toBe(role);
    expect(records.get(memberPath)).toMatchObject({ role, updatedBy: 'school-admin' });
    expect(result.role).toBe(role === 'admin' ? 'admin' : 'student');
  },
);

test('a concurrent suspension aborts all login profile writes', async () => {
  records.set(memberPath, { role: 'admin', status: 'active' });
  retryWith = [[memberPath, { role: 'admin', status: 'inactive' }]];
  await expect(login()).rejects.toMatchObject({ code: 'permission-denied' });
  expect(records.has('users/alice')).toBe(false);
});
