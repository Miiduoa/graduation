const FLY = 'https://nuni-functions.fly.dev';

const ORIGINAL_ENV = { ...process.env };

function loadCloudFunctions(extra: Record<string, unknown> = {}) {
  let mod: typeof import('../../services/cloudFunctions');
  jest.isolateModules(() => {
    require('expo-constants').expoConfig.extra = extra;
    mod = require('../../services/cloudFunctions');
  });
  return mod!;
}

describe('cloudFunctions URL', () => {
  beforeEach(() => {
    for (const key of [
      'EXPO_PUBLIC_FUNCTIONS_BASE_URL', 'EXPO_PUBLIC_CLOUD_FUNCTION_BASE_URL',
      'EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_CLOUD_FUNCTION_REGION',
      'EXPO_PUBLIC_USE_FIREBASE_EMULATOR', 'EXPO_PUBLIC_USE_CLOUD_FUNCTION_EMULATOR',
    ]) delete process.env[key];
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test('uses the Fly base URL when the emulator is off', () => {
    process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL = FLY;
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID = 'campus-one-tw';
    delete process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATOR;
    delete process.env.EXPO_PUBLIC_USE_CLOUD_FUNCTION_EMULATOR;
    const { getCloudFunctionUrl, getCloudFunctionBaseUrl } = loadCloudFunctions();
    expect(getCloudFunctionBaseUrl()).toBe(FLY);
    expect(getCloudFunctionUrl('joinLiveSession')).toBe(`${FLY}/joinLiveSession`);
  });

  test('lets the emulator win over EXPO_PUBLIC_FUNCTIONS_BASE_URL', () => {
    process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL = FLY;
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID = 'demo-campus';
    process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATOR = 'true';
    const { getCloudFunctionUrl } = loadCloudFunctions();
    expect(getCloudFunctionUrl('signInPuStudentId')).toBe(
      'http://127.0.0.1:5001/demo-campus/asia-east1/signInPuStudentId',
    );
  });

  test('selects the hosted credit reader without changing other configured function routes', () => {
    const { getSchoolCreditOverviewUrl, getCloudFunctionUrl } = loadCloudFunctions({
      appEnv: 'production', firebase: { projectId: 'campus-one-tw' }, functionsBaseUrl: FLY,
    });
    expect(getSchoolCreditOverviewUrl()).toBe('https://nuni.tw/api/fn/getMyAcademicRecords');
    expect(getCloudFunctionUrl('getMyAcademicRecords')).toBe(`${FLY}/getMyAcademicRecords`);
  });

  test('uses the Firebase project from the environment when Expo has no override', () => {
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID = 'campus-one-tw';
    const { getSchoolCreditOverviewUrl } = loadCloudFunctions();
    expect(getSchoolCreditOverviewUrl()).toBe('https://nuni.tw/api/fn/getMyAcademicRecords');
  });

  test.each<[string, Record<string, unknown>, boolean]>([
    ['https://functions.example/getMyAcademicRecords', {}, true],
    ['http://functions.example/getMyAcademicRecords', {}, false],
    ['https://localhost/getMyAcademicRecords', {}, false],
    ['https://api.localhost/getMyAcademicRecords', {}, false],
    ['https://127.0.0.1/getMyAcademicRecords', {}, false],
    ['https://127.2.3.4/getMyAcademicRecords', {}, false],
    ['https://[::1]/getMyAcademicRecords', {}, false],
    ['https://10.0.2.2/getMyAcademicRecords', {}, false],
    ['https://user:password@functions.example/getMyAcademicRecords', {}, false],
    ['not a valid URL', {}, false],
    ['https://functions.example/getMyAcademicRecords', { useCloudFunctionEmulator: true }, false],
    ['https://functions.example/getMyAcademicRecords', { firebase: { projectId: 'different-project' } }, false],
    ['https://functions.example/getMyAcademicRecords', { appEnv: 'development', allowLocalMockAuth: true }, false],
  ])('preserves the existing hosted fallback guard for %s with %j', (url, extra, expected) => {
    const { canUseHostedSchoolFallback } = loadCloudFunctions({
      appEnv: 'production', firebase: { projectId: 'campus-one-tw' }, ...extra,
    });
    expect(canUseHostedSchoolFallback(url)).toBe(expected);
  });
});
