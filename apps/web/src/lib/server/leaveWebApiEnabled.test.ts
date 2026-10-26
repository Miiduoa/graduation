import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { isLeaveWebApiServerEnabled } from './leaveWebApiEnabled';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

afterEach(() => {
  vi.unstubAllEnvs();
});

it('伺服器端請假開關沒設就是關，明確打開才算開', () => {
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

it('does not treat leftover NEXT_PUBLIC_LEAVE_WEB_API as the runtime switch', () => {
  vi.stubEnv('NEXT_PUBLIC_LEAVE_WEB_API', 'true');
  vi.stubEnv('LEAVE_WEB_API_ENABLED', '');
  expect(isLeaveWebApiServerEnabled()).toBe(false);
});

it('請假頁與核閱頁在 request time 讀同一個開關，且不靜態化', () => {
  for (const file of ['app/leave/page.tsx', 'app/leave/review/page.tsx', 'app/leave/layout.tsx']) {
    const source = readFileSync(join(webRoot, 'src', file), 'utf8');
    expect(source).toMatch(/export const dynamic = 'force-dynamic'/);
    expect(source).toMatch(/export const revalidate = 0/);
  }
  const leavePage = readFileSync(join(webRoot, 'src/app/leave/page.tsx'), 'utf8');
  const reviewPage = readFileSync(join(webRoot, 'src/app/leave/review/page.tsx'), 'utf8');
  expect(leavePage).toMatch(/isLeaveWebApiServerEnabled\(\)/);
  expect(reviewPage).toMatch(/isLeaveWebApiServerEnabled\(\)/);
  const envExample = readFileSync(join(webRoot, '.env.example'), 'utf8');
  expect(envExample).toMatch(/LEAVE_WEB_API_ENABLED/);
  expect(envExample).not.toMatch(/NEXT_PUBLIC_LEAVE_WEB_API/);
});
