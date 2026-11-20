const FLY = 'https://nuni-functions.fly.dev';

const ORIGINAL_ENV = { ...process.env };

function loadCloudFunctions() {
  let mod: typeof import('../../services/cloudFunctions');
  jest.isolateModules(() => {
    mod = require('../../services/cloudFunctions');
  });
  return mod!;
}

describe('cloudFunctions URL', () => {
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
});
