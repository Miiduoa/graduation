import { beforeEach, expect, it, vi } from 'vitest';
import { getDocFromServer } from 'firebase/firestore';
import { loadCorrectionReview } from './attendanceCorrectionReview';

const access = vi.hoisted(() => ({ uid: 'teacher' as string | null }));
vi.mock('./firebase', () => ({
  isFirebaseConfigured: () => true, getDb: () => ({}),
  getAuth: () => ({ currentUser: access.uid ? { uid: access.uid } : null }),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'), getDocFromServer: vi.fn(),
}));
const snapshot = (data: Record<string, unknown> | null, metadata = {}) => ({
  exists: () => data !== null, data: () => data,
  metadata: { fromCache: false, hasPendingWrites: false, ...metadata },
});
const scope = { courseId: 'course', sessionId: 'session' };
const member = { status: 'active', role: 'student', displayName: '陳同學', studentId: 'S001' };
const receipt = { uid: 'student', groupId: 'course', sessionId: 'session', status: 'present',
  source: 'qr', checkedInAt: '2026-10-28T01:00:00Z' };
function seed(record: Record<string, unknown> | null = receipt) {
  vi.mocked(getDocFromServer)
    .mockResolvedValueOnce(snapshot({ role: 'instructor', status: 'active' }) as never)
    .mockResolvedValueOnce(snapshot(member) as never)
    .mockResolvedValueOnce(snapshot({ schemaVersion: 2, groupId: 'course', sessionId: 'session', active: false }) as never)
    .mockResolvedValueOnce(snapshot(record) as never);
}
beforeEach(() => { vi.resetAllMocks(); access.uid = 'teacher'; });
it('separates a missing receipt from an existing legacy revision zero', async () => {
  seed(null);
  expect(await loadCorrectionReview(scope.courseId, scope.sessionId, 'student')).toMatchObject({ revision: null, row: { status: 'unconfirmed' } });
  seed();
  expect(await loadCorrectionReview(scope.courseId, scope.sessionId, 'student')).toMatchObject({ revision: 0, row: { status: 'present', source: 'qr' } });
});
it('does not read another student before verifying the instructor', async () => {
  vi.mocked(getDocFromServer).mockResolvedValueOnce(snapshot({ role: 'student', status: 'active' }) as never);
  await expect(loadCorrectionReview('course', 'session', 'student')).rejects.toMatchObject({ code: 'functions/permission-denied' });
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
});
it.each([null, '1', false, [], {}, -1, 0.5, Number.MAX_SAFE_INTEGER])('rejects malformed persisted revision %j', async (revision) => {
  seed({ ...receipt, revision });
  await expect(loadCorrectionReview('course', 'session', 'student')).rejects.toMatchObject({ code: 'functions/failed-precondition' });
});
it.each([{ uid: 'other' }, { groupId: 'other' }, { status: ['present'] }, { source: 'manual', correctedAt: null }])(
  'does not produce an editable review from a malformed record %j', async (patch) => {
    seed({ ...receipt, ...patch });
    await expect(loadCorrectionReview('course', 'session', 'student')).rejects.toMatchObject({ code: 'functions/failed-precondition' });
  },
);
it('does not expose a completed read after the account changes', async () => {
  vi.mocked(getDocFromServer).mockImplementationOnce(async () => {
    access.uid = 'other'; return snapshot({ role: 'instructor', status: 'active' }) as never;
  });
  await expect(loadCorrectionReview('course', 'session', 'student')).rejects.toMatchObject({ code: 'functions/unauthenticated' });
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
});
it.each([{ fromCache: true }, { hasPendingWrites: true }])('rejects unconfirmed permissions %j', async (metadata) => {
  vi.mocked(getDocFromServer).mockResolvedValueOnce(snapshot({ role: 'instructor', status: 'active' }, metadata) as never);
  await expect(loadCorrectionReview('course', 'session', 'student')).rejects.toMatchObject({ code: 'functions/permission-denied' });
});
it('preserves a network failure instead of inferring that no receipt exists', async () => {
  vi.mocked(getDocFromServer).mockRejectedValueOnce(new Error('offline'));
  await expect(loadCorrectionReview('course', 'session', 'student')).rejects.toThrow('offline');
});
it('rejects path traversal before any database read', async () => {
  await expect(loadCorrectionReview('../course', 'session', 'student')).rejects.toMatchObject({ code: 'functions/invalid-argument' });
  expect(getDocFromServer).not.toHaveBeenCalled();
});
