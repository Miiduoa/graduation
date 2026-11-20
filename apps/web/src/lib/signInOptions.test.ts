import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { parseSignInOptions, STUDENT_ID_PREPARING_COPY, useSignInOptions } from './signInOptions';
import { hasUsableSchoolLoginProvider } from '@campus/shared/src/schoolLogin';

const request = vi.fn();
vi.mock('@/features/nuni/Session', () => ({
  browserRequest: (...args: unknown[]) => request(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  request.mockResolvedValue({ google: true, studentId: false });
});

it('hides school login unless a usable school-issued provider is listed', () => {
  expect(STUDENT_ID_PREPARING_COPY).toBe(
    '此校園尚未開放學號直接登入。你仍可匯入自己取得的課表、成績與活動；Google 帳號用於平台交流與課班服務。',
  );
  expect(hasUsableSchoolLoginProvider(['google-consumer'])).toBe(false);
  expect(hasUsableSchoolLoginProvider([])).toBe(false);
  expect(hasUsableSchoolLoginProvider(['school-issued'])).toBe(true);
  expect(hasUsableSchoolLoginProvider(['student-id'])).toBe(true);
});

it('requests sign-in options for the selected school', async () => {
  request.mockResolvedValueOnce({ google: true, studentId: false });
  const { result } = renderHook(() => useSignInOptions('ntu'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(request).toHaveBeenCalledWith(
    'sign-in-options',
    undefined,
    undefined,
    undefined,
    { schoolId: 'ntu' },
  );
  expect(result.current.studentId).toBe(false);
});

it('treats student ID as unavailable unless the backend says it is available', () => {
  expect(parseSignInOptions({ google: true })).toEqual({ google: true, studentId: false });
  expect(parseSignInOptions({ google: true, studentId: true })).toEqual({
    google: true,
    studentId: true,
  });
  expect(parseSignInOptions({ google: 'yes', studentId: 'true' })).toEqual({
    google: false,
    studentId: false,
  });
  expect(parseSignInOptions(null)).toEqual({ google: false, studentId: false });
});

it('does not treat a failed lookup as student ID being available', async () => {
  request.mockRejectedValueOnce(new Error('offline'));
  const { result } = renderHook(() => useSignInOptions());
  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current).toMatchObject({ google: false, studentId: false });
  expect(result.current.error).toBe(true);
  request.mockResolvedValueOnce({ google: true, studentId: true });
  await act(async () => result.current.retry());
  await waitFor(() => expect(result.current.studentId).toBe(true));
  expect(result.current.google).toBe(true);
  expect(result.current.error).toBe(false);
});

it.each([null, {}, { google: true }, { google: 'true', studentId: false }])(
  'keeps an invalid response distinguishable from closed login: %j',
  async (value) => {
    request.mockResolvedValueOnce(value);
    const { result } = renderHook(() => useSignInOptions());
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.studentId).toBe(false);
    expect(result.current.loading).toBe(false);
  },
);

it('clears previously enabled options while retrying and ignores a superseded response', async () => {
  const pending: Array<(value: unknown) => void> = [];
  request.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const { result } = renderHook(() => useSignInOptions());
  await act(async () => pending[0]({ google: true, studentId: true }));
  expect(result.current.studentId).toBe(true);
  act(() => result.current.retry());
  expect(result.current).toMatchObject({ loading: true, studentId: false, error: false });
  act(() => result.current.retry());
  await act(async () => pending[2]({ google: true, studentId: false }));
  await act(async () => pending[1]({ google: true, studentId: true }));
  expect(result.current).toMatchObject({ loading: false, studentId: false, error: false });
});
