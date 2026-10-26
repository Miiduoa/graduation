import { afterEach, expect, it, vi } from 'vitest';
import { isLeaveBackendAvailable, isLeaveWebApiEnabled } from './leaveWebApi';

afterEach(() => {
  vi.unstubAllEnvs();
});

it('請假網頁 API 沒設就是關，明確打開才算開', () => {
  expect(isLeaveWebApiEnabled(undefined)).toBe(false);
  expect(isLeaveWebApiEnabled('')).toBe(false);
  expect(isLeaveWebApiEnabled('false')).toBe(false);
  expect(isLeaveWebApiEnabled('0')).toBe(false);
  expect(isLeaveWebApiEnabled('true')).toBe(true);
  expect(isLeaveWebApiEnabled('1')).toBe(true);
  expect(isLeaveWebApiEnabled('on')).toBe(true);
  expect(isLeaveWebApiEnabled()).toBe(false);
  vi.stubEnv('NEXT_PUBLIC_LEAVE_WEB_API', 'true');
  expect(isLeaveWebApiEnabled()).toBe(true);
});

it('未開請假網頁 API 且 Functions 未設定時，後端視為不可用', () => {
  vi.stubEnv('NEXT_PUBLIC_LEAVE_WEB_API', '');
  vi.stubEnv('NEXT_PUBLIC_FUNCTIONS_BASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_USE_FIREBASE_EMULATOR', '');
  expect(isLeaveBackendAvailable()).toBe(false);
});

it('只開請假網頁 API 時，不必設定 Functions 網址也視為可用', () => {
  vi.stubEnv('NEXT_PUBLIC_LEAVE_WEB_API', 'true');
  vi.stubEnv('NEXT_PUBLIC_FUNCTIONS_BASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_USE_FIREBASE_EMULATOR', '');
  expect(isLeaveBackendAvailable()).toBe(true);
});
