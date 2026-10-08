import { beforeEach, expect, it, vi } from 'vitest';
import { loadAcademicRecords } from './academicClient';

const { call, auth } = vi.hoisted(() => ({
  call: vi.fn(),
  auth: { currentUser: { uid: 'student-a' } as { uid: string } | null },
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => call }));
vi.mock('./firebase', () => ({
  getAuth: () => auth,
  isFirebaseConfigured: () => true,
  getFunctionsInstance: () => ({}),
}));
const response = () => ({
  success: true,
  ownerUid: 'student-a',
  schoolId: 'pu',
  source: 'pu-campus',
  dataType: 'grades',
  fetchedAt: '2026-10-08T00:00:00.000Z',
  result: {
    success: true,
    grades: [
      { semester: '1151', courseName: '數學', credits: 3, courseType: '必修', score: 'Pass' },
    ],
    allSemesters: ['1151'],
    summary: {},
  },
});
beforeEach(() => {
  vi.clearAllMocks();
  auth.currentUser = { uid: 'student-a' };
  call.mockResolvedValue({ data: response() });
});
it('requests only the record kind and preserves source text grades', async () => {
  const result = await loadAcademicRecords('grades', 'student-a');
  expect(call).toHaveBeenCalledWith({ dataType: 'grades' });
  expect(result.records.grades[0].score).toBe('Pass');
  expect(result.ownerUid).toBe('student-a');
});
it.each([
  { ownerUid: 'student-b' },
  { schoolId: 'other' },
  { source: 'cache' },
  { dataType: 'courses' },
  { success: false },
  { fetchedAt: 'not-a-date' },
])('rejects a response with mismatched provenance %j', async (change) => {
  call.mockResolvedValue({ data: { ...response(), ...change } });
  await expect(loadAcademicRecords('grades', 'student-a')).rejects.toMatchObject({
    reason: 'unavailable',
  });
});
it('rejects a late response after the Firebase account changes', async () => {
  call.mockImplementation(async () => {
    auth.currentUser = { uid: 'student-b' };
    return { data: response() };
  });
  await expect(loadAcademicRecords('grades', 'student-a')).rejects.toMatchObject({
    reason: 'unavailable',
  });
});
it('does not query while the captured account no longer matches Firebase', async () => {
  auth.currentUser = null;
  await expect(loadAcademicRecords('grades', 'student-a')).rejects.toMatchObject({
    reason: 'unavailable',
  });
  expect(call).not.toHaveBeenCalled();
});
it.each(['functions/failed-precondition', 'functions/unauthenticated'])(
  'offers school reconnection for %s',
  async (code) => {
    call.mockRejectedValue({ code });
    await expect(loadAcademicRecords('grades', 'student-a')).rejects.toMatchObject({
      reason: 'reconnect',
    });
  },
);
it('rejects a malformed source rather than reporting an empty transcript', async () => {
  call.mockResolvedValue({ data: { ...response(), result: { success: false, grades: [] } } });
  await expect(loadAcademicRecords('grades', 'student-a')).rejects.toMatchObject({
    reason: 'unavailable',
  });
});
