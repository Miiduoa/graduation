import { expect, it } from 'vitest';
import { getCloudFunctionUrl, getFunctionsBaseUrl } from './cloudFunctions';

const fly = 'https://nuni-functions.fly.dev';

it('uses the Fly base URL when the emulator is off', () => {
  const env = {
    NEXT_PUBLIC_FUNCTIONS_BASE_URL: fly,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'campus-one-tw',
  };
  expect(getFunctionsBaseUrl(env)).toBe(fly);
  expect(getCloudFunctionUrl('joinLiveSession', { env })).toBe(`${fly}/joinLiveSession`);
});

it('lets the emulator win over NEXT_PUBLIC_FUNCTIONS_BASE_URL', () => {
  const env = {
    NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true',
    NEXT_PUBLIC_FUNCTIONS_BASE_URL: fly,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-campus',
    NEXT_PUBLIC_FIREBASE_EMULATOR_HOST: 'localhost',
    NEXT_PUBLIC_FIREBASE_EMULATOR_FUNCTIONS_PORT: '5001',
  };
  expect(getFunctionsBaseUrl(env)).toBeNull();
  expect(getCloudFunctionUrl('signInPuStudentId', { env })).toBe(
    'http://localhost:5001/demo-campus/asia-east1/signInPuStudentId',
  );
});
