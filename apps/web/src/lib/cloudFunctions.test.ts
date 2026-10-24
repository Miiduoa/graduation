import { expect, it } from 'vitest';
import { getCloudFunctionUrl, getFunctionsBaseUrl } from './cloudFunctions';
import { areFunctionsConfigured } from './functionsUrl';

const fly = 'https://nuni-functions.fly.dev';

it('points hosted group invite callables at this Next.js app without a functions base URL', () => {
  const env = { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'campus-one-tw' };
  expect(getCloudFunctionUrl('joinGroupByCode', { env })).toBe('/api/fn/joinGroupByCode');
  expect(getCloudFunctionUrl('leaveGroup', { env })).toBe('/api/fn/leaveGroup');
  expect(getCloudFunctionUrl('createTimetableShare', { env })).toBe('/api/fn/createTimetableShare');
  expect(getCloudFunctionUrl('revokeTimetableShare', { env })).toBe('/api/fn/revokeTimetableShare');
  expect(getCloudFunctionUrl('createGroup', { env })).toBe(
    'https://asia-east1-campus-one-tw.cloudfunctions.net/createGroup',
  );
  expect(getCloudFunctionUrl('askCampusAssistant', { env })).toBe(
    'https://asia-east1-campus-one-tw.cloudfunctions.net/askCampusAssistant',
  );
  expect(areFunctionsConfigured(undefined, false)).toBe(false);
  expect(
    getCloudFunctionUrl('joinGroupByCode', {
      env: { ...env, NEXT_PUBLIC_FUNCTIONS_BASE_URL: fly },
    }),
  ).toBe('/api/fn/joinGroupByCode');
});

it('uses the Fly base URL when the emulator is off', () => {
  const env = {
    NEXT_PUBLIC_FUNCTIONS_BASE_URL: fly,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'campus-one-tw',
  };
  expect(getFunctionsBaseUrl(env)).toBe(fly);
  expect(getCloudFunctionUrl('joinLiveSession', { env })).toBe(`${fly}/joinLiveSession`);
});

it('reports the Fly URL as configured and an empty URL as unconfigured', () => {
  expect(areFunctionsConfigured(fly, false)).toBe(true);
  expect(areFunctionsConfigured('', false)).toBe(false);
  expect(areFunctionsConfigured(null, true)).toBe(true);
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
