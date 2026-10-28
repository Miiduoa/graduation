import { expect, it } from 'vitest';
import { STUDENT_LOGIN_CLIENT_TIMEOUT_MS } from '@campus/shared/src/schoolLogin';
import {
  DEFAULT_STUDENT_LMS_HOP_TIMEOUT_MS,
  DEFAULT_STUDENT_LMS_TOTAL_TIMEOUT_MS,
  MAX_STUDENT_CREDENTIAL_POSTS,
  MIN_STUDENT_PORTAL_TIMEOUT_MS,
  studentLmsHopTimeoutMs,
  studentLmsTotalTimeoutMs,
  studentPortalTimeoutMs,
} from './schoolLoginTimeouts';

it('keeps the client wait long enough for two 15s hops plus one retry', () => {
  expect(STUDENT_LOGIN_CLIENT_TIMEOUT_MS).toBeGreaterThanOrEqual(
    MIN_STUDENT_PORTAL_TIMEOUT_MS * MAX_STUDENT_CREDENTIAL_POSTS * 2,
  );
  expect(STUDENT_LOGIN_CLIENT_TIMEOUT_MS).toBeGreaterThan(
    studentPortalTimeoutMs() * MAX_STUDENT_CREDENTIAL_POSTS * 2,
  );
});

it('does not let LMS hop timeout exceed the LMS total budget', () => {
  expect(studentLmsHopTimeoutMs(undefined, 30_000)).toBe(DEFAULT_STUDENT_LMS_HOP_TIMEOUT_MS);
  expect(studentLmsHopTimeoutMs('40000', 30_000)).toBe(30_000);
  expect(studentLmsTotalTimeoutMs(undefined)).toBe(DEFAULT_STUDENT_LMS_TOTAL_TIMEOUT_MS);
});
