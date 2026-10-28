import { expect, it } from 'vitest';
import {
  STUDENT_LOGIN_CLIENT_MARGIN_MS,
  STUDENT_LOGIN_CLIENT_TIMEOUT_MS,
  STUDENT_LOGIN_TOTAL_TIMEOUT_MS,
} from '@campus/shared/src/schoolLogin';
import {
  DEFAULT_STUDENT_LMS_HOP_TIMEOUT_MS,
  DEFAULT_STUDENT_LMS_TOTAL_TIMEOUT_MS,
  studentLmsHopTimeoutMs,
  studentLmsTotalTimeoutMs,
  studentLoginHopTimeoutMs,
  studentLoginTotalTimeoutMs,
  studentPortalTimeoutMs,
} from './schoolLoginTimeouts';

it('keeps the client wait longer than the backend login total budget with margin', () => {
  expect(studentLoginTotalTimeoutMs()).toBe(STUDENT_LOGIN_TOTAL_TIMEOUT_MS);
  expect(STUDENT_LOGIN_CLIENT_TIMEOUT_MS).toBeGreaterThan(STUDENT_LOGIN_TOTAL_TIMEOUT_MS);
  expect(STUDENT_LOGIN_CLIENT_TIMEOUT_MS - STUDENT_LOGIN_TOTAL_TIMEOUT_MS).toBeGreaterThanOrEqual(
    STUDENT_LOGIN_CLIENT_MARGIN_MS,
  );
});

it('caps a login hop by the remaining total budget', () => {
  expect(studentLoginHopTimeoutMs(15_000, 8_000)).toBe(8_000);
  expect(studentLoginHopTimeoutMs(15_000, 60_000)).toBe(15_000);
  expect(studentLoginHopTimeoutMs(studentPortalTimeoutMs(), studentLoginTotalTimeoutMs())).toBe(
    studentPortalTimeoutMs(),
  );
});

it('does not let LMS hop timeout exceed the LMS total budget', () => {
  expect(studentLmsHopTimeoutMs(undefined, 30_000)).toBe(DEFAULT_STUDENT_LMS_HOP_TIMEOUT_MS);
  expect(studentLmsHopTimeoutMs('40000', 30_000)).toBe(30_000);
  expect(studentLmsTotalTimeoutMs(undefined)).toBe(DEFAULT_STUDENT_LMS_TOTAL_TIMEOUT_MS);
});
