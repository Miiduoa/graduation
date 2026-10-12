import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { parseSignInOptions, useSignInOptions } from './signInOptions';

const request = vi.fn();
vi.mock('@/features/nuni/Session', () => ({
  browserRequest: (...args: unknown[]) => request(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  request.mockResolvedValue({ google: true, studentId: false });
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
  request.mockResolvedValueOnce({ google: true, studentId: true });
  await act(async () => result.current.retry());
  await waitFor(() => expect(result.current.studentId).toBe(true));
  expect(result.current.google).toBe(true);
});
