import AsyncStorage from '@react-native-async-storage/async-storage';
import { campusEventBus } from '../../services/campusEventBus';
import { setLastPostLoginEngineBootstrap } from '../../services/finalizePostLoginClient';
import { clearPostLoginCache, getCachedRoleInference, routePostLoginData } from '../../services/postLoginDataRouter';
import { tryCallFinalizePostLogin } from '../../services/finalizePostLoginClient';
import { getAnyCachedTCCourses } from '../../services/puDataCache';
import { hasTCSession, tcFetchCourseMembers, tcFetchProfile } from '../../services/tronClassClient';

const mockAuth = { currentUser: null as null | { uid: string; getIdToken: jest.Mock } };
jest.mock('../../firebase', () => ({ hasUsableFirebaseConfig: () => true, getAuthInstance: () => mockAuth }));
jest.mock('../../services/campusEventBus', () => ({ campusEventBus: { emit: jest.fn() } }));
jest.mock('../../services/finalizePostLoginClient', () => ({
  tryCallFinalizePostLogin: jest.fn(async () => null),
  setLastPostLoginEngineBootstrap: jest.fn(),
}));
jest.mock('../../services/mockAuth', () => ({ loadMockAuthSession: async () => null }));
jest.mock('../../services/puDataCache', () => ({
  getAnyCachedCourses: async () => ({ courses: [] }),
  getAnyCachedTCCourses: jest.fn(async () => [
    { id: 17, name: '資料庫', course_code: 'CS101', role: 'student', instructors: [] },
  ]),
}));
jest.mock('../../services/tronClassClient', () => ({
  hasTCSession: jest.fn(async () => true),
  tcFetchProfile: jest.fn(async () => ({ role: 'student' })),
  tcFetchCourseMembers: jest.fn(async () => []),
}));
jest.mock('../../services/testSeedData', () => ({ isTestAccount: () => false }));

beforeEach(async () => {
  mockAuth.currentUser = null;
  await clearPostLoginCache();
  jest.clearAllMocks();
});

test.each(['none', 'course-list'] as const)(
  'login with %s LMS access does not request classmates or a second LMS profile',
  async (access) => {
    const result = await routePostLoginData('student', access);
    expect(tryCallFinalizePostLogin).toHaveBeenCalledWith(undefined, {
      useTronClassSession: access === 'course-list',
      includeCourseRosters: false,
      assertCurrent: expect.any(Function),
    });
    expect(hasTCSession).not.toHaveBeenCalled();
    expect(tcFetchProfile).not.toHaveBeenCalled();
    expect(tcFetchCourseMembers).not.toHaveBeenCalled();
    expect(result.classmates).toEqual([]);
    if (access === 'none') {
      expect(getAnyCachedTCCourses).not.toHaveBeenCalled();
      expect(result.courseRelations).toEqual([]);
    } else {
      expect(result.courseRelations).toEqual([expect.objectContaining({ tcCourseId: 17 })]);
    }
  },
);

test('explicit detailed routing can still obtain the course membership', async () => {
  await routePostLoginData('student', 'details');
  expect(tcFetchCourseMembers).toHaveBeenCalledWith(17);
});

function deferred() {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => { finish = resolve; });
  return { promise, finish };
}

test.each(['finalize', 'persist'] as const)(
  'a pending %s for A cannot publish, persist over, or refresh B',
  async (stage) => {
    const started = deferred();
    const release = deferred();
    const a = { uid: 'first', getIdToken: jest.fn(async () => 'a-token') };
    const b = { uid: 'second', getIdToken: jest.fn(async () => 'b-token') };
    const scope = (uid: string) => ({ uid, schoolId: 'pu', assertCurrent: jest.fn() });
    let restoreStorage: undefined | (() => void);
    if (stage === 'finalize') {
      jest.mocked(tryCallFinalizePostLogin).mockImplementationOnce(async () => {
        started.finish();
        await release.promise;
        return { success: true };
      });
    } else {
      const store = AsyncStorage.setItem.bind(AsyncStorage);
      const slowWrite = jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
        started.finish();
        await release.promise;
        return store(key, value);
      });
      restoreStorage = () => slowWrite.mockRestore();
    }
    try {
      mockAuth.currentUser = a;
      const stale = expect(routePostLoginData('teacher', 'none', scope(a.uid))).rejects.toThrow('帳號已變更');
      await started.promise;
      mockAuth.currentUser = b;
      const current = routePostLoginData('student', 'none', scope(b.uid));
      if (stage === 'finalize') await current;
      release.finish();
      await Promise.all([stale, current]);

      expect(b.getIdToken).not.toHaveBeenCalled();
      expect(campusEventBus.emit).toHaveBeenCalledTimes(1);
      expect(campusEventBus.emit).toHaveBeenCalledWith('post_login_data_routed', expect.objectContaining({ role: 'student' }));
      expect(setLastPostLoginEngineBootstrap).toHaveBeenCalledTimes(1);
      expect(setLastPostLoginEngineBootstrap).toHaveBeenCalledWith(expect.objectContaining({ uid: b.uid, primaryRole: 'student' }));
      expect((await getCachedRoleInference())?.inferredRole).toBe('student');
      mockAuth.currentUser = a;
      expect(await getCachedRoleInference()).toBeNull();
    } finally {
      release.finish();
      restoreStorage?.();
    }
  },
);
