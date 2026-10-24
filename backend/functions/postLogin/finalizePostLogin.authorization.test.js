/**
 * Regression: polluted users.primaryRole must not yield admin custom claims
 * via finalizePostLogin when server-owned users.role is student.
 */
jest.mock('firebase-admin/firestore', () => {
  const actual = jest.requireActual('firebase-admin/firestore');
  return {
    ...actual,
    getFirestore: jest.fn(),
  };
});

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}));

jest.mock('../sessionSecurity', () => ({
  assertSessionOwner: jest.fn(),
}));

jest.mock('../securityUtils', () => ({
  enforceRateLimit: jest.fn(),
}));

jest.mock('../puScraper', () => ({
  puFetchCourses: jest.fn(async () => ({
    success: true,
    courses: [{ code: 'CS101', name: 'Intro' }],
    studentInfo: { studentId: 'S001' },
    semester: '1141',
  })),
}));

jest.mock('../tronClassScraper', () => ({
  tcFetchCourses: jest.fn(async () => []),
  tcFetchProfile: jest.fn(async () => ({ role: 'student' })),
  tcFetchCourseMembers: jest.fn(async () => []),
}));

jest.mock('../authz', () => ({
  normalizeServiceRoleRecord: jest.fn((d) => d),
}));

const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { resolveUserRoles } = require('../generated/shared/postLoginRoles');
const { runFinalizePostLogin } = require('./finalizePostLogin');

function makeTimestamp(msFromNow = 60_000) {
  const d = new Date(Date.now() + msFromNow);
  return { toDate: () => d };
}

function buildDb({
  uid,
  userDoc,
  schoolId = 'pu',
  schoolMemberDoc = { role: 'member', status: 'active' },
  serviceRolesDoc = null,
}) {
  const userState = { ...userDoc };
  const committed = [];
  const setCustomUserClaims = jest.fn(async () => {});

  const userRef = {
    id: uid,
    path: `users/${uid}`,
    firestore: null,
    get: async () => ({
      exists: true,
      data: () => ({ ...userState }),
    }),
    collection: (name) => {
      if (name === 'postLoginRuns') {
        return {
          doc: () => ({ id: 'run-1', path: `users/${uid}/postLoginRuns/run-1` }),
          orderBy: () => ({
            limit: () => ({
              get: async () => ({ size: 0, docs: [] }),
            }),
          }),
        };
      }
      throw new Error(`unexpected user subcollection ${name}`);
    },
  };
  userRef.firestore = { batch: () => createBatch() };

  function createBatch() {
    const ops = [];
    return {
      set: (ref, data, opts) => {
        ops.push({ type: 'set', ref, data, opts });
      },
      commit: async () => {
        for (const op of ops) {
          committed.push(op);
          if (op.ref === userRef || op.ref?.path === userRef.path) {
            Object.assign(userState, op.data);
          }
        }
      },
    };
  }

  const db = {
    batch: () => createBatch(),
    collection: (name) => {
      if (name === '_puSessions') {
        return {
          doc: (id) => ({
            get: async () => ({
              exists: id === 'pu-session-1',
              data: () => ({
                ownerUid: uid,
                cookies: { SID: 'cookie' },
                expiresAt: makeTimestamp(120_000),
                studentId: 'S001',
              }),
            }),
          }),
        };
      }
      if (name === '_puTronClassSessions') {
        return {
          doc: () => ({
            get: async () => ({ exists: false, data: () => null }),
          }),
        };
      }
      if (name === 'users') {
        return {
          doc: (id) => {
            if (id !== uid) {
              return {
                get: async () => ({ exists: false, data: () => null }),
              };
            }
            return userRef;
          },
          where: () => ({
            limit: () => ({
              get: async () => ({ empty: true, docs: [] }),
            }),
          }),
        };
      }
      if (name === 'schools') {
        return {
          doc: (sid) => ({
            collection: (sub) => ({
              doc: (memberUid) => ({
                get: async () => {
                  if (sid === schoolId && memberUid === uid && sub === 'members') {
                    if (!schoolMemberDoc) {
                      return { exists: false, data: () => null };
                    }
                    return {
                      exists: true,
                      data: () => ({ ...schoolMemberDoc }),
                    };
                  }
                  if (sid === schoolId && memberUid === uid && sub === 'serviceRoles') {
                    if (!serviceRolesDoc) {
                      return { exists: false, data: () => null };
                    }
                    return {
                      exists: true,
                      data: () => ({ ...serviceRolesDoc }),
                    };
                  }
                  return { exists: false, data: () => null };
                },
                // batch.set target for members.externalIds
                path: `schools/${sid}/${sub}/${memberUid}`,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };

  getFirestore.mockReturnValue(db);
  getAuth.mockReturnValue({ setCustomUserClaims });

  return { db, userRef, userState, committed, setCustomUserClaims };
}

describe('finalizePostLogin authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('resolveUserRoles unit: polluted primaryRole does not grant admin', () => {
    const r = resolveUserRoles({
      userDoc: { role: 'student', primaryRole: 'admin' },
      schoolMemberDoc: { role: 'member', status: 'active' },
      tcCourses: [],
    });
    expect(r.primaryRole).toBe('student');
  });

  test('polluted primaryRole admin does not set custom claims role=admin', async () => {
    const uid = 'student-1';
    const { setCustomUserClaims, committed, userState } = buildDb({
      uid,
      userDoc: {
        role: 'student',
        primaryRole: 'admin',
        email: 'student@example.edu',
        studentId: 'S001',
        schoolId: 'pu',
      },
    });

    const result = await runFinalizePostLogin({
      auth: { uid },
      data: { puSessionId: 'pu-session-1' },
    });

    expect(result.success).toBe(true);
    expect(result.resolved.primaryRole).toBe('student');
    expect(result.resolved.primaryRole).not.toBe('admin');

    const userWrites = committed.filter(
      (op) => op.ref?.path === `users/${uid}` || op.data?.role != null,
    );
    expect(userWrites.some((op) => op.data.role === 'student')).toBe(true);
    expect(userWrites.some((op) => op.data.role === 'admin')).toBe(false);

    expect(setCustomUserClaims).toHaveBeenCalled();
    const [, claims] = setCustomUserClaims.mock.calls[0];
    expect(claims.role).toBe('student');
    expect(claims.role).not.toBe('admin');
    expect(userState.role).toBe('student');
  });

  test('polluted primaryRole teacher does not set teacher claims without evidence', async () => {
    const uid = 'student-2';
    const { setCustomUserClaims } = buildDb({
      uid,
      userDoc: {
        role: 'student',
        primaryRole: 'teacher',
        email: 's2@example.edu',
        schoolId: 'pu',
      },
    });

    const result = await runFinalizePostLogin({
      auth: { uid },
      data: { puSessionId: 'pu-session-1' },
    });

    expect(result.resolved.primaryRole).toBe('student');
    const [, claims] = setCustomUserClaims.mock.calls[0];
    expect(claims.role).toBe('student');
  });

  test('server-owned users.role admin is preserved (no silent downgrade)', async () => {
    const uid = 'admin-1';
    const { setCustomUserClaims } = buildDb({
      uid,
      userDoc: {
        role: 'admin',
        primaryRole: 'student',
        email: 'admin@example.edu',
        schoolId: 'pu',
      },
    });

    const result = await runFinalizePostLogin({
      auth: { uid },
      data: { puSessionId: 'pu-session-1' },
    });

    expect(result.resolved.primaryRole).toBe('admin');
    expect(result.resolved.usedAuthoritativeUserRole).toBe(true);
    const [, claims] = setCustomUserClaims.mock.calls[0];
    expect(claims.role).toBe('admin');
  });

  test('inactive school member admin does not set admin custom claims for student', async () => {
    const uid = 'student-inactive-admin';
    const { setCustomUserClaims, committed, userState } = buildDb({
      uid,
      userDoc: {
        role: 'student',
        email: 'student-ia@example.edu',
        studentId: 'S001',
        schoolId: 'pu',
      },
      schoolMemberDoc: { role: 'admin', status: 'inactive' },
    });

    const result = await runFinalizePostLogin({
      auth: { uid },
      data: { puSessionId: 'pu-session-1' },
    });

    expect(result.success).toBe(true);
    expect(result.resolved.primaryRole).toBe('student');
    expect(result.resolved.orgRoles || []).not.toContain('schoolAdmin');

    const userWrites = committed.filter(
      (op) => op.ref?.path === `users/${uid}` || op.data?.role != null,
    );
    expect(userWrites.some((op) => op.data.role === 'student')).toBe(true);
    expect(userWrites.some((op) => op.data.role === 'admin')).toBe(false);

    expect(setCustomUserClaims).toHaveBeenCalled();
    const [, claims] = setCustomUserClaims.mock.calls[0];
    expect(claims.role).toBe('student');
    expect(claims.role).not.toBe('admin');
    expect(userState.role).toBe('student');
  });
});
