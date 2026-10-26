import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FunctionsUnconfiguredError } from './functionsUrl';

const auth = vi.hoisted(() => ({
  currentUser: { uid: 'stu', getIdToken: async () => 'id-token' } as {
    uid: string;
    getIdToken: () => Promise<string>;
  } | null,
}));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('./firebase', () => ({
  getDb: () => ({}),
  getAuth: () => auth,
  getCloudFunctionUrl: (name: string) => `/api/fn/${name}`,
  isFirebaseConfigured: () => true,
}));

import { reviewLeaveRequest, submitLeaveRequest, withdrawLeaveRequest } from './leaveRequests';

beforeEach(() => {
  vi.clearAllMocks();
  auth.currentUser = { uid: 'stu', getIdToken: async () => 'id-token' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

it('sends submit, withdraw and review through same-origin /api/fn', async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ result: { id: 'leave-2026-good-id', alreadySubmitted: false } }),
  });
  await submitLeaveRequest('stu', {
    schoolId: 'pu',
    requestId: 'leave-2026-good-id',
    startDate: '2026-10-26',
    endDate: '2026-10-26',
    kind: 'sick',
    period: 'all',
    detail: '需要請假',
    courseIds: ['c1'],
  });
  expect(fetchMock).toHaveBeenCalledWith('/api/fn/submitLeaveRequest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer id-token' },
    body: JSON.stringify({
      data: {
        schoolId: 'pu',
        requestId: 'leave-2026-good-id',
        startDate: '2026-10-26',
        endDate: '2026-10-26',
        kind: 'sick',
        period: 'all',
        detail: '需要請假',
        courseIds: ['c1'],
      },
    }),
    cache: 'no-store',
  });

  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ result: { id: 'leave-2026-good-id', status: 'withdrawn' } }),
  });
  await withdrawLeaveRequest('stu', 'leave-2026-good-id');
  expect(fetchMock.mock.calls[1][0]).toBe('/api/fn/withdrawLeaveRequest');

  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ result: { id: 'leave-2026-good-id', status: 'partial' } }),
  });
  await reviewLeaveRequest('stu', 'leave-2026-good-id', 'c1', 'approved', '同意');
  expect(fetchMock.mock.calls[2][0]).toBe('/api/fn/reviewLeaveRequest');
});

it('maps 尚未啟用 to the existing unconfigured error instead of a network failure', async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 503,
    json: async () => ({ error: { status: 'UNAVAILABLE', message: '尚未啟用' } }),
  });
  await expect(
    submitLeaveRequest('stu', {
      schoolId: 'pu',
      requestId: 'leave-2026-good-id',
      startDate: '2026-10-26',
      endDate: '2026-10-26',
      kind: 'sick',
      period: 'all',
      detail: '',
      courseIds: ['c1'],
    }),
  ).rejects.toBeInstanceOf(FunctionsUnconfiguredError);
});
