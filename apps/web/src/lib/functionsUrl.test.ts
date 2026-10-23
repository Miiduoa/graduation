import { expect, it } from 'vitest';
import { normalizeFunctionsBaseUrl, resolveFunctionsHttpUrl } from './functionsUrl';

it('keeps Firebase Cloud Functions URLs when no override is set', () => {
  expect(
    resolveFunctionsHttpUrl({
      functionName: 'joinLiveSession',
      projectId: 'campus-one-tw',
      region: 'asia-east1',
    }),
  ).toBe('https://asia-east1-campus-one-tw.cloudfunctions.net/joinLiveSession');
});

it('points at the Fly service when a base URL is set', () => {
  expect(normalizeFunctionsBaseUrl('https://nuni-functions.fly.dev/')).toBe(
    'https://nuni-functions.fly.dev',
  );
  expect(
    resolveFunctionsHttpUrl({
      functionName: 'signInPuStudentId',
      projectId: 'campus-one-tw',
      baseUrl: 'https://nuni-functions.fly.dev',
    }),
  ).toBe('https://nuni-functions.fly.dev/signInPuStudentId');
});

it('keeps emulator URLs when the emulator is on', () => {
  expect(
    resolveFunctionsHttpUrl({
      functionName: 'joinLiveSession',
      projectId: 'demo-campus',
      emulator: { host: 'localhost', port: 5001 },
    }),
  ).toBe('http://localhost:5001/demo-campus/asia-east1/joinLiveSession');
});

it('lets the emulator win over a Fly base URL', () => {
  expect(
    resolveFunctionsHttpUrl({
      functionName: 'joinLiveSession',
      projectId: 'campus-one-tw',
      baseUrl: 'https://nuni-functions.fly.dev',
      emulator: { host: 'localhost', port: 5001 },
    }),
  ).toBe('http://localhost:5001/campus-one-tw/asia-east1/joinLiveSession');
});
