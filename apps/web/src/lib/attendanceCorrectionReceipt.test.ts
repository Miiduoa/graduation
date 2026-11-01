import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getDocFromServer } from 'firebase/firestore';
import { loadCorrectionReview } from './attendanceCorrectionReview';
import { loadSavedCorrectionReceipt } from './attendanceCorrectionReceipt';
import type { CorrectionBookmark } from './attendanceCorrectionBookmark';

const auth = vi.hoisted(() => ({ currentUser: { uid: 'teacher' } as { uid: string } | null }));
vi.mock('./firebase', () => ({ getAuth: () => auth, getDb: () => ({}), isFirebaseConfigured: () => true }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'), getDocFromServer: vi.fn(),
}));
vi.mock('./attendanceCorrectionReview', () => ({ loadCorrectionReview: vi.fn() }));
const bookmark: CorrectionBookmark = {
  version: 1, actorUid: 'teacher', courseId: 'course', sessionId: 'session', requestId: 'request', createdAt: 100,
};
const snapshot = (data: Record<string, unknown> | null, cached = false) => ({
  exists: () => data !== null, data: () => data,
  metadata: { fromCache: cached, hasPendingWrites: false },
});
// Matches the audit field written by attendanceSessions.js / attendanceSessionHandlers.ts.
const audit = { teacherUid: 'teacher', groupId: 'course', sessionId: 'session', studentUid: 'student',
  requestId: 'request', nextStatus: 'late', revision: 2, correctedAt: '2026-10-28T01:00:00Z' };
function seed(data: Record<string, unknown> | null = audit) {
  vi.mocked(getDocFromServer)
    .mockResolvedValueOnce(snapshot({ role: 'instructor', status: 'active' }) as never)
    .mockResolvedValueOnce(snapshot(data) as never);
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal('crypto', webcrypto); auth.currentUser = { uid: 'teacher' };
  vi.mocked(loadCorrectionReview).mockResolvedValue({
    scope: '["course","session","student"]', revision: 2, active: false,
    row: { uid: 'student', displayName: '學生甲', studentId: 'S001', status: 'late', source: 'manual',
      checkedInAt: '2026-10-28T01:00:00Z', correctedAt: '2026-10-28T01:00:00Z' },
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('reads the authenticated immutable receipt and distinguishes it from the current attendance status', async () => {
  seed();
  const result = await loadSavedCorrectionReceipt(bookmark);
  expect(result).toMatchObject({ kind: 'saved', status: 'late', changedSinceSave: false });
  const id = 'correction_' + createHash('sha256').update(JSON.stringify(['course', 'session', 'teacher', 'request'])).digest('hex');
  expect(getDocFromServer).toHaveBeenLastCalledWith(`groups/course/attendanceSessions/session/attendanceCorrections/${id}`);
  expect(loadCorrectionReview).toHaveBeenCalledWith('course', 'session', 'student');
});
it('a newer teacher decision is shown as current instead of overwritten by the older receipt', async () => {
  seed();
  const current = await vi.mocked(loadCorrectionReview).getMockImplementation()?.('course', 'session', 'student');
  expect(current).toBeTruthy();
  vi.mocked(loadCorrectionReview).mockResolvedValueOnce({ ...current!, revision: 3,
    row: { ...current!.row, status: 'excused' } });
  expect(await loadSavedCorrectionReceipt(bookmark)).toMatchObject({
    kind: 'saved', status: 'late', changedSinceSave: true, current: { row: { status: 'excused' } },
  });
});
it('detects a later correction via audit.revision even when status text matches', async () => {
  seed();
  const current = await vi.mocked(loadCorrectionReview).getMockImplementation()?.('course', 'session', 'student');
  expect(current).toBeTruthy();
  vi.mocked(loadCorrectionReview).mockResolvedValueOnce({ ...current!, revision: 4,
    row: { ...current!.row, status: 'late' } });
  expect(await loadSavedCorrectionReceipt(bookmark)).toMatchObject({
    kind: 'saved', status: 'late', changedSinceSave: true,
  });
});
it('ignores a stale nextRevision alias and falls back to status when revision is absent', async () => {
  const { revision: _ignored, ...withoutRevision } = audit;
  seed({ ...withoutRevision, nextRevision: 2 });
  const current = await vi.mocked(loadCorrectionReview).getMockImplementation()?.('course', 'session', 'student');
  expect(current).toBeTruthy();
  vi.mocked(loadCorrectionReview).mockResolvedValueOnce({ ...current!, revision: 9,
    row: { ...current!.row, status: 'late' } });
  expect(await loadSavedCorrectionReceipt(bookmark)).toMatchObject({
    kind: 'saved', status: 'late', changedSinceSave: false,
  });
});
it('absence of a receipt is not a failed mutation and never writes or retries', async () => {
  seed(null);
  expect(await loadSavedCorrectionReceipt(bookmark)).toEqual({ kind: 'not-found' });
  expect(loadCorrectionReview).not.toHaveBeenCalled();
});
it('keeps a proven saved receipt separate from an unavailable current record', async () => {
  seed(); vi.mocked(loadCorrectionReview).mockRejectedValueOnce(new Error('student removed'));
  expect(await loadSavedCorrectionReceipt(bookmark)).toMatchObject({ kind: 'saved', current: null, changedSinceSave: null });
});
it.each([
  { teacherUid: 'other' }, { groupId: 'other' }, { sessionId: 'other' }, { requestId: 'other' },
  { studentUid: '../student' }, { nextStatus: ['late'] }, { correctedAt: 'invalid' },
  { revision: '2' }, { revision: -1 }, { revision: null },
])('rejects receipt identity or structural mismatch: %j', async (changes) => {
  seed({ ...audit, ...changes });
  await expect(loadSavedCorrectionReceipt(bookmark)).rejects.toMatchObject({ code: 'functions/failed-precondition' });
  expect(loadCorrectionReview).not.toHaveBeenCalled();
});
it.each(['removed', 'pending'])('refuses a teacher with %s membership', async (status) => {
  vi.mocked(getDocFromServer).mockResolvedValueOnce(snapshot({ role: 'instructor', status }) as never);
  await expect(loadSavedCorrectionReceipt(bookmark)).rejects.toMatchObject({ code: 'functions/permission-denied' });
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
});
it('does not use cached membership as permission', async () => {
  vi.mocked(getDocFromServer).mockResolvedValueOnce(snapshot({ role: 'instructor', status: 'active' }, true) as never);
  await expect(loadSavedCorrectionReceipt(bookmark)).rejects.toMatchObject({ code: 'functions/permission-denied' });
});
it('refuses a cached receipt even after a server-verified teacher read', async () => {
  vi.mocked(getDocFromServer)
    .mockResolvedValueOnce(snapshot({ role: 'instructor', status: 'active' }) as never)
    .mockResolvedValueOnce(snapshot(audit, true) as never);
  await expect(loadSavedCorrectionReceipt(bookmark)).rejects.toMatchObject({ code: 'functions/unavailable' });
});
it('does not leak another teacher receipt after the signed-in account changes', async () => {
  auth.currentUser = { uid: 'someone-else' };
  await expect(loadSavedCorrectionReceipt(bookmark)).rejects.toMatchObject({ code: 'functions/unauthenticated' });
  expect(getDocFromServer).not.toHaveBeenCalled();
});
it('discards a result when the account changes during the current-record lookup', async () => {
  seed(); vi.mocked(loadCorrectionReview).mockImplementationOnce(async () => {
    auth.currentUser = { uid: 'other' }; throw new Error('switched');
  });
  await expect(loadSavedCorrectionReceipt(bookmark)).rejects.toMatchObject({ code: 'functions/unauthenticated' });
});
it('bounds a stalled read and does not continue additional reads when it finishes late', async () => {
  vi.useFakeTimers(); let finish!: (value: never) => void;
  vi.mocked(getDocFromServer).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const promise = loadSavedCorrectionReceipt(bookmark);
  const rejected = expect(promise).rejects.toMatchObject({ code: 'functions/unavailable' });
  await vi.advanceTimersByTimeAsync(15_000); await rejected;
  finish(snapshot({ role: 'instructor', status: 'active' }) as never);
  await Promise.resolve(); await Promise.resolve();
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
});
