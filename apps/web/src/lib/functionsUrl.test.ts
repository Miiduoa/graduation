import { expect, it } from 'vitest';
import {
  areFunctionsConfigured,
  FunctionsUnconfiguredError,
  isFunctionsUnconfiguredError,
  normalizeFunctionsBaseUrl,
  resolveFunctionsHttpUrl,
} from './functionsUrl';

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

it('treats an empty base URL as unconfigured unless the emulator is on', () => {
  expect(areFunctionsConfigured('', false)).toBe(false);
  expect(areFunctionsConfigured(null, false)).toBe(false);
  expect(areFunctionsConfigured('   ', false)).toBe(false);
  expect(areFunctionsConfigured('', true)).toBe(true);
});

it('treats a Fly base URL as configured', () => {
  expect(areFunctionsConfigured('https://nuni-functions.fly.dev', false)).toBe(true);
  expect(areFunctionsConfigured('nuni-functions.fly.dev/', false)).toBe(true);
});

it('identifies the unconfigured error without treating it as a retryable failure', () => {
  const error = new FunctionsUnconfiguredError('雲端助理尚未啟用');
  expect(isFunctionsUnconfiguredError(error)).toBe(true);
  expect(isFunctionsUnconfiguredError({ code: 'functions-unconfigured' })).toBe(true);
  expect(isFunctionsUnconfiguredError({ code: 'unconfigured' })).toBe(true);
  expect(isFunctionsUnconfiguredError({ code: 'functions/unavailable' })).toBe(false);
  expect(isFunctionsUnconfiguredError(new Error('這次未能取得回覆，請稍後重試'))).toBe(false);
});
