import { afterEach, expect, it, vi } from 'vitest';
import { isLeaveWebApiServerEnabled } from './leaveWebApiEnabled';

afterEach(() => {
  vi.unstubAllEnvs();
});

it('伺服器端請假寫入開關沒設就是關，明確打開才算開', () => {
  expect(isLeaveWebApiServerEnabled(undefined)).toBe(false);
  expect(isLeaveWebApiServerEnabled('')).toBe(false);
  expect(isLeaveWebApiServerEnabled('false')).toBe(false);
  expect(isLeaveWebApiServerEnabled('0')).toBe(false);
  expect(isLeaveWebApiServerEnabled('true')).toBe(true);
  expect(isLeaveWebApiServerEnabled('1')).toBe(true);
  expect(isLeaveWebApiServerEnabled('on')).toBe(true);
  expect(isLeaveWebApiServerEnabled()).toBe(false);
  vi.stubEnv('LEAVE_WEB_API_ENABLED', 'true');
  expect(isLeaveWebApiServerEnabled()).toBe(true);
});

it('does not treat NEXT_PUBLIC_LEAVE_WEB_API as the server write switch', () => {
  vi.stubEnv('NEXT_PUBLIC_LEAVE_WEB_API', 'true');
  vi.stubEnv('LEAVE_WEB_API_ENABLED', '');
  expect(isLeaveWebApiServerEnabled()).toBe(false);
});
