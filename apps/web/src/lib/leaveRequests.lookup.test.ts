import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LEAVE_LOAD_TIMEOUT_MS, LeaveLoadTimeoutError } from './leavePageState';

const runtime = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'stu' } as { uid: string } | null },
  read: vi.fn(),
}));

vi.mock('./firebase', () => ({
  getDb: () => ({}),
  getAuth: () => runtime.auth,
  getCloudFunctionUrl: (name: string) => `/api/fn/${name}`,
  isFirebaseConfigured: () => true,
}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => path,
  documentId: () => '__name__',
  getDocs: vi.fn(),
  getDocsFromServer: runtime.read,
  limit: (value: number) => ({ limit: value }),
  orderBy: vi.fn(),
  query: (...parts: unknown[]) => parts,
  where: (field: string, operator: string, value: unknown) => ({ field, operator, value }),
}));

import { getMyLeaveRequest } from './leaveRequests';

const id = 'leave-2026-old-id';
const data = {
  uid: 'stu', schoolId: 'pu', source: 'campus-one', courses: [],
  kind: 'sick', period: 'all', status: 'completed',
  startDate: '2025-01-01', endDate: '2025-01-01', detail: '', createdAt: null,
};

beforeEach(() => {
  runtime.auth.currentUser = { uid: 'stu' };
  runtime.read.mockReset();
  runtime.read.mockResolvedValue({ docs: [{ id, data: () => data }] });
});
afterEach(() => vi.useRealTimers());

it('reads a single matching request from the server with owner, school and source constraints', async () => {
  await expect(getMyLeaveRequest('stu', 'pu', id)).resolves.toEqual({ ...data, id });
  expect(runtime.read).toHaveBeenCalledWith([
    'leaveRequests',
    { field: 'uid', operator: '==', value: 'stu' },
    { field: 'schoolId', operator: '==', value: 'pu' },
    { field: 'source', operator: '==', value: 'campus-one' },
    { field: '__name__', operator: '==', value: id },
    { limit: 1 },
  ]);
});

it('keeps empty results, permission failures and connection failures distinct', async () => {
  runtime.read.mockResolvedValue({ docs: [] });
  await expect(getMyLeaveRequest('stu', 'pu', id)).resolves.toBeNull();
  runtime.read.mockRejectedValue({ code: 'permission-denied' });
  await expect(getMyLeaveRequest('stu', 'pu', id)).rejects.toMatchObject({ code: 'permission-denied' });
  const error = Object.assign(new Error('offline'), { code: 'unavailable' });
  runtime.read.mockRejectedValue(error);
  await expect(getMyLeaveRequest('stu', 'pu', id)).rejects.toBe(error);
});

it.each([
  { uid: 'other' },
  { schoolId: 'ntu' },
  { source: 'official' },
])('discards out-of-scope response data %s', async (override) => {
  runtime.read.mockResolvedValue({ docs: [{ id, data: () => ({ ...data, ...override }) }] });
  await expect(getMyLeaveRequest('stu', 'pu', id)).resolves.toBeNull();
});

it('discards a different document ID and reports malformed owned records as a read failure', async () => {
  runtime.read.mockResolvedValueOnce({ docs: [{ id: 'leave-2026-other-id', data: () => data }] });
  await expect(getMyLeaveRequest('stu', 'pu', id)).resolves.toBeNull();
  runtime.read.mockResolvedValueOnce({ docs: [{ id, data: () => ({ ...data, courses: null }) }] });
  await expect(getMyLeaveRequest('stu', 'pu', id)).rejects.toThrow('請假紀錄資料不完整');
});

it('does not read before authentication or for malformed paths', async () => {
  runtime.auth.currentUser = null;
  await expect(getMyLeaveRequest('stu', 'pu', id)).rejects.toMatchObject({ code: 'functions/unauthenticated' });
  runtime.auth.currentUser = { uid: 'stu' };
  await expect(getMyLeaveRequest('stu', 'pu', '../other')).rejects.toMatchObject({ code: 'functions/invalid-argument' });
  await expect(getMyLeaveRequest('stu', '../pu', id)).rejects.toMatchObject({ code: 'functions/invalid-argument' });
  expect(runtime.read).not.toHaveBeenCalled();
});

it('checks the signed-in identity again before returning a pending read', async () => {
  let resolve!: (value: unknown) => void;
  runtime.read.mockReturnValue(new Promise((done) => { resolve = done; }));
  const pending = getMyLeaveRequest('stu', 'pu', id);
  runtime.auth.currentUser = { uid: 'other' };
  resolve({ docs: [{ id, data: () => data }] });
  await expect(pending).rejects.toMatchObject({ code: 'functions/unauthenticated' });
});

it('does not hide an identity change behind an inaccessible result', async () => {
  runtime.read.mockImplementation(async () => {
    runtime.auth.currentUser = null;
    throw Object.assign(new Error('denied'), { code: 'permission-denied' });
  });
  await expect(getMyLeaveRequest('stu', 'pu', id)).rejects.toMatchObject({ code: 'functions/unauthenticated' });
});

it('bounds a stalled lookup with the existing leave timeout', async () => {
  vi.useFakeTimers();
  runtime.read.mockReturnValue(new Promise(() => {}));
  const pending = expect(getMyLeaveRequest('stu', 'pu', id)).rejects.toBeInstanceOf(LeaveLoadTimeoutError);
  await vi.advanceTimersByTimeAsync(LEAVE_LOAD_TIMEOUT_MS);
  await pending;
});
