import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPostLoginContext } from '../../data/postLoginDataRouter';
import { puCacheSet } from '../../data/puDataCache';
import { getInMemoryPostLoginContext, setInMemoryPostLoginContext } from '../../services/postLoginContextHolder';
import { resolveActivePostLoginContext, syncPostLoginContextFromCaches } from '../../services/postLoginContextFromCaches';
import { getAnyCachedTCCourses } from '../../services/puDataCache';

jest.mock('../../services/puDataCache', () => ({
  getAnyCachedCourses: jest.fn(async () => null),
  getAnyCachedTCCourses: jest.fn(async () => null),
  getAnyCachedTCTodos: jest.fn(async () => null),
  getAnyCachedAnnouncements: jest.fn(async () => null),
}));
jest.mock('../../services/postLoginContextHolder', () => ({
  setInMemoryPostLoginContext: jest.fn(), getInMemoryPostLoginContext: jest.fn(),
}));

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.mocked(getInMemoryPostLoginContext).mockReturnValue(null);
});
const identity = { uid: 'firebase-a', schoolId: 'pu', role: 'student' as const };

test('only the bound school login marks the persisted payload restorable by Firebase', async () => {
  await syncPostLoginContextFromCaches(identity);
  expect((await getPostLoginContext('pu', identity.uid))?.origin).toBeUndefined();
  const assertVerifiedSession = jest.fn();
  const verified = await syncPostLoginContextFromCaches({ ...identity, assertVerifiedSession });
  expect(verified).toMatchObject({ uid: identity.uid, schoolId: 'pu', origin: 'verified-school-login' });
  expect(await getPostLoginContext('pu', identity.uid)).toEqual(verified);
  expect(setInMemoryPostLoginContext).toHaveBeenLastCalledWith(verified);
});

test('a revoked school session during cache reads cannot label or publish their result', async () => {
  let valid = true;
  jest.mocked(getAnyCachedTCCourses).mockImplementationOnce(async () => { valid = false; return null; });
  await expect(syncPostLoginContextFromCaches({
    ...identity, assertVerifiedSession: () => { if (!valid) throw Error('account changed'); },
  })).resolves.toBeNull();
  expect(await getPostLoginContext('pu', identity.uid)).toBeNull();
  expect(setInMemoryPostLoginContext).not.toHaveBeenCalled();
});

test('persisted context requires the exact owner and school in the payload', async () => {
  const context = await syncPostLoginContextFromCaches(identity);
  expect(context).not.toBeNull();
  expect(await getPostLoginContext('pu', 'firebase-b')).toBeNull();
  expect(await getPostLoginContext('pu', '')).toBeNull();
  expect(await getPostLoginContext('', identity.uid)).toBeNull();
  await puCacheSet('nthu:postLoginContext', context, 'computed');
  expect(await getPostLoginContext('nthu', identity.uid)).toBeNull();
});

test('active context accepts matching memory and storage for the supplied identity', async () => {
  const context = await syncPostLoginContextFromCaches(identity);
  const scope = { schoolId: identity.schoolId, userId: identity.uid };
  expect(await resolveActivePostLoginContext(scope)).toEqual(context);
  jest.mocked(getInMemoryPostLoginContext).mockReturnValue(context);
  expect(await resolveActivePostLoginContext(scope)).toBe(context);
});

test('active context rejects another owner, another school, or missing identity', async () => {
  const context = await syncPostLoginContextFromCaches(identity);
  jest.mocked(getInMemoryPostLoginContext).mockReturnValue(context);
  expect(await resolveActivePostLoginContext({ schoolId: 'pu', userId: 'firebase-b' })).toBeNull();
  expect(await resolveActivePostLoginContext({ schoolId: 'nthu', userId: identity.uid })).toBeNull();
  expect(await resolveActivePostLoginContext({ schoolId: 'pu' })).toBeNull();
  expect(await resolveActivePostLoginContext()).toBeNull();
});
