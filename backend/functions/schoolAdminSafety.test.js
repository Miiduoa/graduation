jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: jest.fn(),
}));

const { getFirestore } = require('firebase-admin/firestore');
const { createSchoolLoginProfileWriter } = require('./schoolLoginProfile');
const database = { collection: jest.fn(), runTransaction: jest.fn(), batch: jest.fn() };
getFirestore.mockReturnValue(database);
const {
  updateSchoolMemberRole,
  clearSchoolAdminTestData,
  deleteSchoolAnnouncement,
  updateSchoolServiceRole,
  upsertSchoolCafeteriaConfig,
  upsertCafeteriaOperatorAssignment,
  updateSSOConfig,
} = require('./index');

describe('school administration safety', () => {
  let records;
  let retryWith;
  let auditUnavailable;
  const actorPath = 'schools/pu/members/actor';
  const targetPath = 'schools/pu/members/target';
  const request = (data = {}, auth = { uid: 'actor', token: { email: 'admin@example.test' } }) =>
    updateSchoolMemberRole.run({
      auth,
      data: { schoolId: 'pu', targetUid: 'target', role: 'editor', ...data },
    });

  beforeEach(() => {
    jest.clearAllMocks();
    records = new Map([
      [actorPath, { role: 'admin', status: 'active' }],
      [targetPath, { role: 'member', status: 'active', displayName: '同學' }],
      ['schools/pu/announcements/published', { title: '正式公告' }],
      ['schools/pu/clubEvents/published', { title: '正式活動' }],
      ['schools/pu/cafeterias/main', { name: '原餐廳', activeOperatorCount: 0 }],
    ]);
    retryWith = null;
    auditUnavailable = false;
    const snapshot = (ref) => {
      if (ref.isQuery) {
        const docs = [...records.keys()]
          .filter(
            (key) =>
              key.startsWith(`${ref.path}/`) && !key.slice(ref.path.length + 1).includes('/'),
          )
          .filter((key) =>
            ref.filters.every(({ field, value }) => records.get(key)[field] === value),
          )
          .map((key) => ({ ref: reference(key), data: () => records.get(key) }));
        return { docs, size: docs.length };
      }
      return { exists: records.has(ref.path), data: () => records.get(ref.path) };
    };
    const write = (ref, data, merge = false) => {
      if (ref.path.includes('/adminLogs/') && auditUnavailable)
        throw new Error('Audit unavailable');
      records.set(ref.path, { ...(merge ? records.get(ref.path) : {}), ...data });
    };
    const reference = (path) => ({
      path,
      collection: (name) => collection(`${path}/${name}`),
      get: async () => snapshot({ path }),
      set: async (data, options) => write({ path }, data, options?.merge),
      delete: async () => records.delete(path),
    });
    const collection = (path, filters = []) => ({
      path,
      filters,
      isQuery: true,
      where: (field, operator, value) => collection(path, [...filters, { field, operator, value }]),
      doc: (id = 'audit-one') => reference(`${path}/${id}`),
      add: async (data) => write({ path: `${path}/audit-one` }, data),
      get: async () => ({
        docs: [...records.keys()]
          .filter((key) => key.startsWith(`${path}/`))
          .map((key) => ({ ref: reference(key) })),
      }),
    });
    database.collection.mockImplementation(collection);
    database.batch.mockImplementation(() => {
      const deletes = [];
      return {
        delete: (ref) => deletes.push(ref.path),
        commit: async () => deletes.forEach((path) => records.delete(path)),
      };
    });
    database.runTransaction.mockImplementation(async (callback) => {
      let writes;
      const attempt = async () => {
        writes = [];
        return callback({
          get: async (ref) => snapshot(ref),
          getAll: async (...refs) => refs.map(snapshot),
          set: (ref, data, options) => writes.push({ ref, data, merge: options?.merge }),
          update: (ref, data) => writes.push({ ref, data, merge: true }),
          create: (ref, data) => writes.push({ ref, data }),
          delete: (ref) => writes.push({ ref, remove: true }),
        });
      };
      let result = await attempt();
      if (retryWith) {
        for (const [path, data] of retryWith) records.set(path, data);
        result = await attempt();
      }
      if (auditUnavailable && writes.some(({ ref }) => ref.path.includes('/adminLogs/'))) {
        throw new Error('Audit unavailable');
      }
      for (const { ref, data, merge, remove } of writes) {
        if (remove) records.delete(ref.path);
        else write(ref, data, merge);
      }
      return result;
    });
  });

  test.each(
    ['admin', 'editor', 'member'].flatMap((targetRole) =>
      ['admin', 'editor', 'member'].map((role) => [targetRole, role]),
    ),
  )('an editor cannot change a %s member to %s', async (targetRole, role) => {
    records.set(actorPath, { role: 'editor', status: 'active' });
    records.set(targetPath, { role: targetRole, status: 'active' });
    await expect(request({ role })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(records.get(targetPath).role).toBe(targetRole);
    expect([...records.keys()].some((path) => path.includes('/adminLogs/'))).toBe(false);
  });

  test.each(['admin', 'editor', 'member'])(
    'an active school admin can assign %s with an audit',
    async (role) => {
      await expect(request({ role })).resolves.toEqual({ success: true });
      expect(records.get(targetPath)).toMatchObject({
        role,
        displayName: '同學',
        updatedBy: 'actor',
      });
      expect(records.get('schools/pu/adminLogs/audit-one')).toMatchObject({
        action: 'update_member_role',
        actorUid: 'actor',
        details: `member=target;role=${role}`,
      });
    },
  );

  test('rejects callers without an active admin assignment in the requested school', async () => {
    records.set(actorPath, { role: 'admin', status: 'inactive' });
    await expect(request()).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(request({ schoolId: 'another-school' })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(request({}, null)).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(records.get(targetPath).role).toBe('member');
  });

  test('preserves legacy active membership semantics when status was omitted', async () => {
    records.set(actorPath, { role: 'admin' });
    await expect(request()).resolves.toEqual({ success: true });
  });

  test('blocks self-demotion and missing targets', async () => {
    await expect(request({ targetUid: 'actor' })).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    await expect(request({ targetUid: 'missing' })).rejects.toMatchObject({ code: 'not-found' });
    expect(records.get(actorPath).role).toBe('admin');
  });

  test.each([
    [actorPath, { role: 'editor', status: 'active' }],
    [actorPath, { role: 'admin', status: 'inactive' }],
    ['users/actor', { accountDeletionInProgress: true }],
  ])('rechecks authorization after a concurrent change to %s', async (path, value) => {
    retryWith = [[path, value]];
    await expect(request()).rejects.toMatchObject({
      code: path.startsWith('users/') ? 'failed-precondition' : 'permission-denied',
    });
    expect(records.get(targetPath).role).toBe('member');
    expect(records.has('schools/pu/adminLogs/audit-one')).toBe(false);
  });

  test('does not change permissions if the audit cannot commit', async () => {
    auditUnavailable = true;
    await expect(request()).rejects.toThrow('Audit unavailable');
    expect(records.get(targetPath).role).toBe('member');
  });

  test.each(['admin', 'editor'])(
    'the legacy wipe is disabled for %s without deleting published records',
    async (role) => {
      records.set(actorPath, { role, status: 'active' });
      await expect(
        clearSchoolAdminTestData.run({
          auth: { uid: 'actor' },
          data: { schoolId: 'pu' },
        }),
      ).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(records.get('schools/pu/announcements/published')).toEqual({ title: '正式公告' });
      expect(records.get('schools/pu/clubEvents/published')).toEqual({ title: '正式活動' });
      expect(database.batch).not.toHaveBeenCalled();
    },
  );

  test('editors can still delete one explicitly chosen announcement', async () => {
    records.set(actorPath, { role: 'editor', status: 'active' });
    records.set('schools/pu/announcements/keep', { title: '保留公告' });
    await expect(
      deleteSchoolAnnouncement.run({
        auth: { uid: 'actor' },
        data: { schoolId: 'pu', announcementId: 'published' },
      }),
    ).resolves.toEqual({ success: true });
    expect(records.has('schools/pu/announcements/published')).toBe(false);
    expect(records.get('schools/pu/announcements/keep')).toEqual({ title: '保留公告' });
    expect(records.get('schools/pu/clubEvents/published')).toEqual({ title: '正式活動' });
    expect(records.get('schools/pu/adminLogs/audit-one')).toMatchObject({
      action: 'delete_announcement',
      details: 'id=published',
      actorUid: 'actor',
    });
  });

  const provisioning = [
    [
      'school SSO',
      updateSSOConfig,
      { publicConfig: { allowEmailLogin: true } },
      'schools/pu/settings/sso',
    ],
    [
      'service role',
      updateSchoolServiceRole,
      { targetUid: 'target', repairs: true },
      'schools/pu/serviceRoles/target',
    ],
    [
      'cafeteria config',
      upsertSchoolCafeteriaConfig,
      { cafeteriaId: 'main', name: '新餐廳', orderingEnabled: true, pilotStatus: 'pilot' },
      'schools/pu/cafeterias/main',
    ],
    [
      'cafeteria operator',
      upsertCafeteriaOperatorAssignment,
      { cafeteriaId: 'main', targetUid: 'target', role: 'manager' },
      'schools/pu/cafeterias/main/operators/target',
    ],
  ];
  const provision = (handler, data) =>
    handler.run({
      auth: { uid: 'actor', token: { email: 'admin@example.test' } },
      data: { schoolId: 'pu', ...data },
    });

  test.each(provisioning)(
    'an editor cannot provision %s even with a service assignment',
    async (_name, handler, data) => {
      records.set(actorPath, { role: 'editor', status: 'active' });
      records.set('schools/pu/serviceRoles/actor', {
        status: 'active',
        orders: true,
        repairs: true,
        health: true,
      });
      const before = new Map(records);
      await expect(provision(handler, data)).rejects.toMatchObject({ code: 'permission-denied' });
      expect(records).toEqual(before);
    },
  );

  test.each(provisioning)(
    'a school admin can provision %s with one atomic audit',
    async (_name, handler, data, path) => {
      await expect(provision(handler, data)).resolves.toMatchObject({ success: true });
      expect(records.get(path)).toMatchObject({ updatedBy: 'actor' });
      expect(records.get('schools/pu/adminLogs/audit-one')).toMatchObject({ actorUid: 'actor' });
    },
  );

  test.each(provisioning)(
    'a concurrent demotion blocks %s provisioning',
    async (_name, handler, data, path) => {
      retryWith = [[actorPath, { role: 'editor', status: 'active' }]];
      const before = records.get(path);
      await expect(provision(handler, data)).rejects.toMatchObject({ code: 'permission-denied' });
      expect(records.get(path)).toEqual(before);
      expect(records.has('schools/pu/adminLogs/audit-one')).toBe(false);
    },
  );

  test.each(provisioning)(
    'an audit failure rolls back %s provisioning',
    async (_name, handler, data, path) => {
      auditUnavailable = true;
      const before = records.get(path);
      await expect(provision(handler, data)).rejects.toThrow('Audit unavailable');
      expect(records.get(path)).toEqual(before);
    },
  );

  test('rechecks the recipient membership when assigning a service role', async () => {
    retryWith = [[targetPath, { role: 'member', status: 'inactive' }]];
    await expect(
      provision(updateSchoolServiceRole, { targetUid: 'target', repairs: true }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(records.has('schools/pu/serviceRoles/target')).toBe(false);
  });

  test('does not grant operational rights to a deleted recipient', async () => {
    records.set('users/target', { status: 'deleted' });
    for (const [handler, data] of [
      [updateSchoolServiceRole, { targetUid: 'target', repairs: true }],
      [upsertCafeteriaOperatorAssignment, { cafeteriaId: 'main', targetUid: 'target' }],
    ]) {
      await expect(provision(handler, data)).rejects.toMatchObject({ code: 'failed-precondition' });
    }
    expect(records.has('schools/pu/serviceRoles/target')).toBe(false);
    expect(records.has('schools/pu/cafeterias/main/operators/target')).toBe(false);
  });

  test('operator assignment and cafeteria count commit together without double counting', async () => {
    const data = { cafeteriaId: 'main', targetUid: 'target', role: 'manager' };
    await provision(upsertCafeteriaOperatorAssignment, data);
    await expect(provision(upsertCafeteriaOperatorAssignment, data)).resolves.toEqual({
      success: true,
      activeOperatorCount: 1,
    });
    await expect(
      provision(upsertCafeteriaOperatorAssignment, { ...data, status: 'inactive' }),
    ).resolves.toEqual({ success: true, activeOperatorCount: 0 });
    expect(records.get('schools/pu/cafeterias/main').activeOperatorCount).toBe(0);
  });

  test('an editor cannot change school identity-provider configuration', async () => {
    records.set(actorPath, { role: 'editor', status: 'active' });
    await expect(
      provision(updateSSOConfig, { publicConfig: { allowEmailLogin: true } }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  test.each(['PU', 'SSO'])(
    'an audited grant and demotion survive %s reauthentication',
    async (source) => {
      const writeLogin = createSchoolLoginProfileWriter({ db: database });
      await request({ role: 'admin' });
      await writeLogin({
        uid: 'target',
        schoolId: 'pu',
        profile: { role: source === 'PU' ? 'student' : 'teacher' },
      });
      expect(records.get(targetPath).role).toBe('admin');
      expect(records.get('users/target').role).toBe('admin');
      await request({ role: 'member' });
      await writeLogin({ uid: 'target', schoolId: 'pu', profile: { role: 'admin' } });
      expect(records.get(targetPath).role).toBe('member');
      expect(records.get('users/target').role).toBe('student');
    },
  );
});
