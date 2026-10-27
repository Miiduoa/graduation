import { expect, it } from 'vitest';
import {
  SCHOOL_LOGIN_GENERIC_ERROR,
  SchoolLoginHttpError,
  TEACHER_LMS_UNAVAILABLE_CODE,
  TEACHER_LMS_UNAVAILABLE_COPY,
  schoolLoginErrorCopy,
  schoolLoginFailureCopy,
} from './schoolLoginErrorCopy';

it.each([
  [401, '學號或密碼錯誤', '學號或密碼錯誤'],
  [401, '<script>alert(1)</script>', '學號或密碼錯誤'],
  [401, '', '學號或密碼錯誤'],
  [429, 'Too many requests', '嘗試太多次，請稍後再試'],
  [429, '任意文字', '嘗試太多次，請稍後再試'],
  [503, '尚未開放', '這間學校尚未開放學號登入'],
  [503, ' 尚未開放 ', '這間學校尚未開放學號登入'],
  [503, '學校系統暫時無法連線', '學校系統暫時連不上，請稍後再試'],
  [503, '老師登入暫未開放；學生請輸入純數字學號', '老師登入暫未開放；學生請輸入純數字學號'],
] as const)('maps HTTP %s with a known payload to a fixed notice', (status, serverError, copy) => {
  expect(schoolLoginErrorCopy(status, serverError)).toBe(copy);
  expect(new SchoolLoginHttpError(status, serverError).message).toBe(copy);
});

it.each([
  [503, '暫時無法驗證老師身分'],
  [503, '尚未啟用'],
  [503, '服務暫時無法使用'],
  [503, '尚未開放中'],
  [503, '系統維護'],
  [500, 'PU student login failed'],
  [400, '學號格式不正確'],
  [403, '這間學校的成員資格已停用，請聯絡校方。'],
] as const)('does not print unknown HTTP %s server text', (status, serverError) => {
  expect(schoolLoginErrorCopy(status, serverError)).toBe(SCHOOL_LOGIN_GENERIC_ERROR);
  expect(schoolLoginErrorCopy(status, serverError)).not.toBe(serverError);
  expect(new SchoolLoginHttpError(status, serverError).message).toBe(SCHOOL_LOGIN_GENERIC_ERROR);
  expect(new SchoolLoginHttpError(status, serverError).message).not.toBe(serverError);
});

it('uses the generic notice for non-HTTP failures, including teacher and student callers', () => {
  expect(schoolLoginFailureCopy(new Error('尚未開放'))).toBe(SCHOOL_LOGIN_GENERIC_ERROR);
  expect(schoolLoginFailureCopy(new TypeError('Failed to fetch'))).toBe(SCHOOL_LOGIN_GENERIC_ERROR);
  expect(schoolLoginFailureCopy('學校系統暫時無法連線')).toBe(SCHOOL_LOGIN_GENERIC_ERROR);
  expect(
    schoolLoginFailureCopy(new SchoolLoginHttpError(401, '學號或密碼錯誤')),
  ).toBe('學號或密碼錯誤');
  expect(
    schoolLoginFailureCopy(new SchoolLoginHttpError(503, '暫時無法驗證老師身分')),
  ).toBe(SCHOOL_LOGIN_GENERIC_ERROR);
  expect(
    schoolLoginFailureCopy(new SchoolLoginHttpError(503, 'ignored', TEACHER_LMS_UNAVAILABLE_CODE)),
  ).toBe(TEACHER_LMS_UNAVAILABLE_COPY);
  expect(schoolLoginErrorCopy(503, 'ignored', TEACHER_LMS_UNAVAILABLE_CODE)).toBe(
    TEACHER_LMS_UNAVAILABLE_COPY,
  );
});
