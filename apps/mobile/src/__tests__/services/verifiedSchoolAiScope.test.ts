import type { PostLoginContext } from '../../data/postLoginTypes';
import { getInMemoryPostLoginContext } from '../../services/postLoginContextHolder';
import {
  bindVerifiedSchoolAiScope,
  getVerifiedSchoolAiScope,
  isVerifiedSchoolAiScopeCurrent,
} from '../../services/verifiedSchoolAiScope';

jest.mock('../../services/postLoginContextHolder', () => ({
  getInMemoryPostLoginContext: jest.fn(() => null),
}));

const identity = { userId: 'owner-a', schoolId: 'pu' };
let context: PostLoginContext;

beforeEach(() => {
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
  expect(getVerifiedSchoolAiScope(identity)).toBeNull();
  bindVerifiedSchoolAiScope({ ...context, origin: undefined }, () => {});
  expect(getVerifiedSchoolAiScope(identity)).toBeNull();
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

  jest.mocked(getInMemoryPostLoginContext).mockReturnValue({ ...context });
  expect(isVerifiedSchoolAiScopeCurrent(scope!)).toBe(false);
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
