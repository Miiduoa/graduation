import type { PostLoginContext } from '../../data/postLoginTypes';
import { getInMemoryPostLoginContext } from '../../services/postLoginContextHolder';
import {
  bindVerifiedSchoolAiScope,
  getVerifiedSchoolAiScope,
  isVerifiedSchoolAiScopeCurrent,
  revokeVerifiedSchoolAiScope,
} from '../../services/verifiedSchoolAiScope';

jest.mock('../../services/postLoginContextHolder', () => ({
  getInMemoryPostLoginContext: jest.fn(() => null),
}));

const identity = { userId: 'owner-a', schoolId: 'pu' };
let context: PostLoginContext;

beforeEach(() => {
  revokeVerifiedSchoolAiScope();
  context = {
    uid: identity.userId, schoolId: identity.schoolId, origin: 'verified-school-login',
    roles: {
      primaryRole: 'student', subRoles: [], source: 'firestore',
      flags: { isStudent: true, isTeacher: false, isDeptAdmin: false, isAdmin: false },
    },
    latestAnnouncements: [], partialErrors: [], builtAt: new Date().toISOString(),
  };
  jest.mocked(getInMemoryPostLoginContext).mockReturnValue(context);
});

test('a matching persisted or caller-supplied context cannot establish a live school session', () => {
  jest.isolateModules(() => {
    const holder = require('../../services/postLoginContextHolder') as typeof import('../../services/postLoginContextHolder');
    const fresh = require('../../services/verifiedSchoolAiScope') as typeof import('../../services/verifiedSchoolAiScope');
    jest.mocked(holder.getInMemoryPostLoginContext).mockReturnValue(JSON.parse(JSON.stringify(context)));
    expect(fresh.getVerifiedSchoolAiScope(identity)).toBeNull();
    fresh.bindVerifiedSchoolAiScope({ ...context, origin: undefined }, () => {});
    expect(fresh.getVerifiedSchoolAiScope(identity)).toBeNull();
  });
});

test('a verified session is usable only for its exact owner, school, and in-memory context', () => {
  bindVerifiedSchoolAiScope(context, () => {});
  const scope = getVerifiedSchoolAiScope(identity);
  expect(scope?.context).toBe(context);
  expect(getVerifiedSchoolAiScope({ ...identity, userId: 'owner-b' })).toBeNull();
  expect(getVerifiedSchoolAiScope({ ...identity, schoolId: 'nthu' })).toBeNull();
  expect(getVerifiedSchoolAiScope({ ...identity, schoolId: 'tw-pu' })).toBeNull();
  expect(getVerifiedSchoolAiScope({ schoolId: 'pu' })).toBeNull();
  expect(getVerifiedSchoolAiScope()).toBeNull();

  jest.mocked(getInMemoryPostLoginContext).mockReturnValue(null);
  expect(isVerifiedSchoolAiScopeCurrent(scope!)).toBe(false);
});

test('the same verified snapshot can resume after a profile refresh while its live session is valid', () => {
  bindVerifiedSchoolAiScope(context, () => {});
  const scope = getVerifiedSchoolAiScope(identity)!;
  jest.mocked(getInMemoryPostLoginContext).mockReturnValue(null);
  expect(getVerifiedSchoolAiScope(identity)).toBeNull();
  const restored: PostLoginContext = JSON.parse(JSON.stringify(context));
  expect(restored).not.toBe(context);
  jest.mocked(getInMemoryPostLoginContext).mockReturnValue(restored);
  expect(getVerifiedSchoolAiScope(identity)).toBe(scope);
});

test.each([
  { uid: 'owner-b' },
  { schoolId: 'nthu' },
  { origin: undefined },
  { builtAt: '2000-01-01T00:00:00.000Z' },
])('rejects a restored context with changed identity, origin, or snapshot %j', (changed) => {
  bindVerifiedSchoolAiScope(context, () => {});
  const scope = getVerifiedSchoolAiScope(identity)!;
  jest.mocked(getInMemoryPostLoginContext).mockReturnValue({ ...context, ...changed });
  expect(isVerifiedSchoolAiScopeCurrent(scope)).toBe(false);
  expect(getVerifiedSchoolAiScope(identity)).toBeNull();
});

test.each(['user', 'session', 'generation'] as const)('revokes the scope when its %s changes', (changed) => {
  const requester = { uid: identity.userId };
  const schoolSession = { backendOwnerUid: identity.userId };
  let currentUser = requester;
  let currentSession = schoolSession;
  let generation = 1;
  bindVerifiedSchoolAiScope(context, () => {
    if (currentUser !== requester || currentSession !== schoolSession || generation !== 1) {
      throw new Error('school session changed');
    }
  });
  const scope = getVerifiedSchoolAiScope(identity)!;
  if (changed === 'user') currentUser = { uid: identity.userId };
  if (changed === 'session') currentSession = { backendOwnerUid: identity.userId };
  if (changed === 'generation') generation++;
  jest.mocked(getInMemoryPostLoginContext).mockReturnValue(JSON.parse(JSON.stringify(context)));
  expect(isVerifiedSchoolAiScopeCurrent(scope)).toBe(false);
  expect(getVerifiedSchoolAiScope(identity)).toBeNull();
});

test('a new verified login invalidates an earlier scope even for the same account', () => {
  bindVerifiedSchoolAiScope(context, () => {});
  const previous = getVerifiedSchoolAiScope(identity)!;
  bindVerifiedSchoolAiScope(context, () => {});
  expect(isVerifiedSchoolAiScopeCurrent(previous)).toBe(false);
  expect(getVerifiedSchoolAiScope(identity)).not.toBe(previous);
});

test('explicit revocation immediately invalidates captured reads and survives JSON restoration', () => {
  bindVerifiedSchoolAiScope(context, () => {});
  const scope = getVerifiedSchoolAiScope(identity)!;
  revokeVerifiedSchoolAiScope();
  expect(isVerifiedSchoolAiScopeCurrent(scope)).toBe(false);
  expect(getVerifiedSchoolAiScope(identity)).toBeNull();
  jest.mocked(getInMemoryPostLoginContext).mockReturnValue(JSON.parse(JSON.stringify(context)));
  revokeVerifiedSchoolAiScope();
  expect(getVerifiedSchoolAiScope(identity)).toBeNull();
});
