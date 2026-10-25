import { beforeEach, expect, it, vi } from 'vitest';
import { loadAcademicRecords } from './academicClient';

const { call, auth, functions } = vi.hoisted(() => ({
  call: vi.fn(),
  auth: { currentUser: { uid: 'student-a' } as { uid: string } | null },
  functions: { configured: true },
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => call }));
vi.mock('./firebase', () => ({
  getAuth: () => auth,
  isFirebaseConfigured: () => true,
  getFunctionsInstance: () => ({}),
}));
vi.mock('./functionsUrl', async (original) => ({
  ...(await original<typeof import('./functionsUrl')>()),
  areFunctionsConfigured: () => functions.configured,
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
  functions.configured = true;
  call.mockResolvedValue({ data: response() });
});
it('requests only the record kind and preserves source text grades', async () => {
  const result = await loadAcademicRecords('grades', 'student-a');
  expect(call).toHaveBeenCalledWith({ dataType: 'grades' });
  expect(call.mock.calls[0]?.[0]).toEqual({ dataType: 'grades' });
  expect(result.records.grades[0].score).toBe('Pass');
  expect(result.ownerUid).toBe('student-a');
  expect(result.schoolId).toBe('pu');
});
it('accepts an explicit Providence expected school without sending it to the callable', async () => {
  const result = await loadAcademicRecords('grades', 'student-a', 'pu');
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith({ dataType: 'grades' });
  expect(result.schoolId).toBe('pu');
});
it('rejects an unsupported expected school before calling the network', async () => {
  await expect(loadAcademicRecords('grades', 'student-a', 'nthu')).rejects.toMatchObject({
    reason: 'unavailable',
  });
  await expect(loadAcademicRecords('grades', 'student-a', 'all')).rejects.toMatchObject({
    reason: 'unavailable',
  });
  await expect(loadAcademicRecords('grades', 'student-a', 'tw-pu')).rejects.toMatchObject({
    reason: 'unavailable',
  });
  expect(call).not.toHaveBeenCalled();
});

it('does not call Cloud Functions when the functions base URL is unset', async () => {
  functions.configured = false;
  await expect(loadAcademicRecords('grades', 'student-a')).rejects.toMatchObject({
    reason: 'unconfigured',
  });
  expect(call).not.toHaveBeenCalled();
});

it('calls Cloud Functions when the functions base URL is set', async () => {
  functions.configured = true;
  await loadAcademicRecords('grades', 'student-a');
  expect(call).toHaveBeenCalledWith({ dataType: 'grades' });
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
it('keeps the original fetch failure so copy can distinguish network from other errors', async () => {
  const cause = new TypeError('Failed to fetch');
  call.mockRejectedValue(cause);
  const error = await loadAcademicRecords('grades', 'student-a').catch((item) => item);
  expect(error).toMatchObject({ reason: 'unavailable' });
  expect(error.cause).toBe(cause);
});

it('rejects a malformed source rather than reporting an empty transcript', async () => {
  call.mockResolvedValue({ data: { ...response(), result: { success: false, grades: [] } } });
  await expect(loadAcademicRecords('grades', 'student-a')).rejects.toMatchObject({
    reason: 'unavailable',
  });
});
