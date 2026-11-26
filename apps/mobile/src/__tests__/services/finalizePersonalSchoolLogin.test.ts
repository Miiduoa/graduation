import { httpsCallable } from 'firebase/functions';
import { getTCBackendSessionId } from '../../services/tronClassClient';
import { tryCallFinalizePostLogin } from '../../services/finalizePostLoginClient';

let mockAuthUser = { uid: 'teacher' };
let mockSchoolSession = { backendSessionId: 'test-pu' };

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('@campus/shared/src/puEcampusDataPolicy', () => ({ isPuEcampusDataFetchEnabled: () => true }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockAuthUser }),
  getFunctionsInstance: () => ({}),
  hasUsableFirebaseConfig: () => true,
  isFirebaseMockMode: () => false,
}));
jest.mock('../../services/mockAuth', () => ({ loadMockAuthSession: async () => null }));
jest.mock('../../services/testSeedData', () => ({ isTestAccount: () => false }));
jest.mock('../../services/studentIdAuth', () => ({ getPUSession: () => mockSchoolSession }));
jest.mock('../../services/tronClassClient', () => ({ getTCBackendSessionId: jest.fn(async () => 'test-lms') }));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthUser = { uid: 'teacher' };
  mockSchoolSession = { backendSessionId: 'test-pu' };
});

test('a deployment without personal sign-in finalization never receives the LMS session at its legacy endpoint', async () => {
  const missing = jest.fn().mockRejectedValue({ code: 'functions/not-found' });
  jest.mocked(httpsCallable).mockReturnValue(missing);
  const result = await tryCallFinalizePostLogin(undefined, { includeCourseRosters: false });
  expect(result).toMatchObject({ success: false, errorCode: 'not-found' });
  expect(httpsCallable).toHaveBeenCalledTimes(1);
  expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'finalizePersonalSchoolLogin');
  expect(missing).toHaveBeenCalledWith({ puSessionId: 'test-pu', tronSessionId: 'test-lms' });
});

test.each(['Firebase user', 'school session'])('a changed %s cancels finalization before dispatch', async (change) => {
  jest.mocked(getTCBackendSessionId).mockImplementationOnce(async () => {
    if (change === 'Firebase user') mockAuthUser = { uid: 'another-person' };
    else mockSchoolSession = { backendSessionId: 'another-session' };
    return 'late-handle';
  });
  const result = await tryCallFinalizePostLogin(undefined, { includeCourseRosters: false });
  expect(result?.errorCode).toBe('school_session_changed');
  expect(httpsCallable).not.toHaveBeenCalled();
});
