const {
  hasActiveCafeteriaOperator,
  buildSchoolDirectoryProfile,
  createAuthzHelpers,
  hasServiceDomainAccess,
  normalizeCafeteriaOperatorRecord,
  normalizeServiceRoleRecord,
} = require('./authz');

function createDocSnapshot(data) {
  return {
    exists: data != null,
    data: () => data,
  };
}

function createFakeDb({
  members = {},
  serviceRoles = {},
  cafeteriaOperators = {},
  accounts = {},
} = {}) {
  return {
    collection(collectionName) {
      if (collectionName === 'users') {
        return { doc: (uid) => ({ get: async () => createDocSnapshot(accounts[uid] ?? null) }) };
      }
      if (collectionName !== 'schools') {
        throw new Error(`Unsupported collection: ${collectionName}`);
      }

      return {
        doc(schoolId) {
          return {
            collection(childName) {
              if (childName === 'cafeterias') {
                return {
                  doc(cafeteriaId) {
                    return {
                      collection(grandChildName) {
                        if (grandChildName !== 'operators') {
                          throw new Error(`Unsupported grand child collection: ${grandChildName}`);
                        }

                        return {
                          doc(operatorUid) {
                            return {
                              async get() {
                                return createDocSnapshot(
                                  cafeteriaOperators[`${schoolId}/${cafeteriaId}/${operatorUid}`] ??
                                    null,
                                );
                              },
                            };
                          },
                        };
                      },
                    };
                  },
                };
              }

              return {
                doc(uid) {
                  return {
                    async get() {
                      if (childName === 'members') {
                        return createDocSnapshot(members[`${schoolId}/${uid}`] ?? null);
                      }
                      if (childName === 'serviceRoles') {
                        return createDocSnapshot(serviceRoles[`${schoolId}/${uid}`] ?? null);
                      }
                      throw new Error(`Unsupported child collection: ${childName}`);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

describe('authz helpers', () => {
  test('normalizeServiceRoleRecord defaults unknown values to inactive domains false', () => {
    expect(normalizeServiceRoleRecord({ orders: true, status: 'inactive' })).toEqual({
      status: 'inactive',
      orders: true,
      repairs: false,
      packages: false,
      printing: false,
      health: false,
    });
  });

  test('hasServiceDomainAccess only allows active matching domains', () => {
    expect(hasServiceDomainAccess({ status: 'active', orders: true }, 'orders')).toBe(true);
    expect(hasServiceDomainAccess({ status: 'active', printing: true }, 'orders')).toBe(false);
    expect(hasServiceDomainAccess({ status: 'inactive', orders: true }, 'orders')).toBe(false);
  });

  test('normalizeCafeteriaOperatorRecord defaults invalid roles to staff and inactive only when explicit', () => {
    expect(normalizeCafeteriaOperatorRecord({ role: 'bad-role' })).toEqual({
      status: 'active',
      role: 'staff',
      displayName: null,
      email: null,
      lastActiveAt: null,
    });
    expect(hasActiveCafeteriaOperator({ status: 'inactive', role: 'owner' })).toBe(false);
  });

  test('buildSchoolDirectoryProfile never falls back to email prefix', () => {
    expect(
      buildSchoolDirectoryProfile({
        uid: 'abcdef123456',
        userData: { email: 'private-user@example.com' },
        membership: { role: 'member' },
      }),
    ).toMatchObject({
      displayName: 'abcdef12',
      roleLabel: '學生',
    });
  });

  test('assertSchoolAdminOrEditor allows editors and rejects ordinary members', async () => {
    const db = createFakeDb({
      members: {
        'school-1/editor-1': { role: 'editor', status: 'active' },
        'school-1/member-1': { role: 'member', status: 'active' },
      },
    });
    const { assertSchoolAdminOrEditor } = createAuthzHelpers(db);

    await expect(assertSchoolAdminOrEditor('school-1', 'editor-1')).resolves.toMatchObject({
      role: 'editor',
    });
    await expect(assertSchoolAdminOrEditor('school-1', 'member-1')).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  test('assertServiceRole grants admin override and matching operator access', async () => {
    const db = createFakeDb({
      members: {
        'school-1/admin-1': { role: 'admin', status: 'active' },
        'school-1/operator-1': { role: 'member', status: 'active' },
      },
      serviceRoles: {
        'school-1/operator-1': { status: 'active', orders: true },
      },
    });
    const { assertServiceRole } = createAuthzHelpers(db);

    await expect(assertServiceRole('school-1', 'admin-1', 'orders')).resolves.toMatchObject({
      override: true,
      membership: { role: 'admin' },
    });
    await expect(assertServiceRole('school-1', 'operator-1', 'orders')).resolves.toMatchObject({
      override: false,
      membership: { role: 'member' },
      serviceRole: expect.objectContaining({ orders: true }),
    });
  });

  test('assertServiceRole rejects missing service domain access', async () => {
    const db = createFakeDb({
      members: {
        'school-1/operator-1': { role: 'member', status: 'active' },
      },
      serviceRoles: {
        'school-1/operator-1': { status: 'active', printing: true },
      },
    });
    const { assertServiceRole } = createAuthzHelpers(db);

    await expect(assertServiceRole('school-1', 'operator-1', 'orders')).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  test('only a school admin can provision permissions, with account lifecycle checks', async () => {
    const { assertSchoolAdmin } = createAuthzHelpers(
      createFakeDb({
        members: {
          'school-1/admin': { role: 'admin', status: 'active' },
          'school-1/editor': { role: 'editor', status: 'active' },
          'school-1/legacy': { role: 'admin' },
          'school-1/closing': { role: 'admin', status: 'active' },
        },
        accounts: { closing: { accountDeletionInProgress: true } },
      }),
    );
    await expect(assertSchoolAdmin('school-1', 'admin')).resolves.toMatchObject({ role: 'admin' });
    await expect(assertSchoolAdmin('school-1', 'legacy')).resolves.toMatchObject({ role: 'admin' });
    await expect(assertSchoolAdmin('school-1', 'editor')).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(assertSchoolAdmin('school-2', 'admin')).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(assertSchoolAdmin('school-1', 'closing')).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  test('an editor has no operational override but can hold an explicit scoped assignment', async () => {
    const members = { 'school-1/editor': { role: 'editor', status: 'active' } };
    const unassigned = createAuthzHelpers(createFakeDb({ members }));
    await expect(
      unassigned.assertServiceRole('school-1', 'editor', 'repairs'),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    const assigned = createAuthzHelpers(
      createFakeDb({
        members,
        serviceRoles: { 'school-1/editor': { status: 'active', repairs: true } },
      }),
    );
    await expect(
      assigned.assertServiceRole('school-1', 'editor', 'repairs'),
    ).resolves.toMatchObject({ override: false });
    await expect(assigned.assertServiceRole('school-1', 'editor', 'health')).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(assigned.assertServiceRole('school-2', 'editor', 'repairs')).rejects.toMatchObject(
      { code: 'permission-denied' },
    );
  });

  test.each(['inactive', undefined])(
    'service assignments require explicit active status: %s',
    async (status) => {
      const { assertServiceRole } = createAuthzHelpers(
        createFakeDb({
          members: { 'school-1/staff': { role: 'member', status: 'active' } },
          serviceRoles: { 'school-1/staff': { status, repairs: true } },
        }),
      );
      await expect(assertServiceRole('school-1', 'staff', 'repairs')).rejects.toMatchObject({
        code: 'permission-denied',
      });
    },
  );

  test('assertCafeteriaOperator only allows active operators on the same cafeteria', async () => {
    const db = createFakeDb({
      cafeteriaOperators: {
        'school-1/cafeteria-1/operator-1': { status: 'active', role: 'manager' },
        'school-1/cafeteria-2/operator-1': { status: 'inactive', role: 'staff' },
      },
    });
    const { assertCafeteriaOperator } = createAuthzHelpers(db);

    await expect(
      assertCafeteriaOperator('school-1', 'cafeteria-1', 'operator-1'),
    ).resolves.toMatchObject({
      role: 'manager',
      status: 'active',
    });
    await expect(
      assertCafeteriaOperator('school-1', 'cafeteria-2', 'operator-1'),
    ).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });
});
