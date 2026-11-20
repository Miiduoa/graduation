import { refreshCampusSenseSnapshot, type CampusSenseProgress } from '../../services/campusSenseSnapshot';
import { abortableCampusRead } from '../../services/abortableCampusRead';

let mockUid = 'A';
const mockCallable = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockCallable }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: { uid: mockUid } }),
  getFunctionsInstance: () => ({}), isFirebaseMockMode: () => false,
}));
const scope = { uid: 'A', schoolId: 'pu' };
const checkedAt = '2026-10-28T01:00:00.000Z';
const revision = 'b'.repeat(64);
const page = (offset: number, rev = revision) => ({ data: {
  schoolId: 'pu', checkedAt,
  schedule: { status: 'unavailable', count: null },
  announcements: { status: 'unavailable', items: [] },
  assignments: {
    status: 'available', count: 137,
    items: Array.from({ length: Math.min(50, 137 - offset) }, (_, index) => ({
      title: '私人的作業 ' + (offset + index), groupName: '課程', dueAt: null,
      source: { kind: 'group-assignment', groupId: 'course', assignmentId: 'a_' + (offset + index) },
    })),
    paging: { version: 1, offset, nextOffset: offset + 50 < 137 ? offset + 50 : null, revision: rev },
  },
} });
const input = () => ({ scope, isCurrent: () => true });
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date(checkedAt));
  mockUid = 'A'; mockCallable.mockReset();
  mockCallable.mockImplementation(async (request: { assignmentPage?: { offset: number } }) => page(request.assignmentPage?.offset ?? 0));
});
afterEach(() => jest.useRealTimers());

test('publishes monotonic count-only progress and completes only after all valid pages', async () => {
  const updates: CampusSenseProgress[] = [];
  const snapshot = await refreshCampusSenseSnapshot({ ...input(), onProgress: (value) => updates.push(value) });
  expect(snapshot.assignments.items).toHaveLength(137);
  expect(updates.map((value) => value.loaded)).toEqual([0, 50, 100, 137, 137]);
  expect(updates.map((value) => value.phase)).toEqual(['reading', 'reading', 'reading', 'reading', 'complete']);
  expect(updates[4]).toEqual({ phase: 'complete', loaded: 137, total: 137, pages: 3, pageLimit: 8 });
  expect(JSON.stringify(updates)).not.toContain('私人的作業');
});

test('cancel during a stalled first read settles immediately, discards late data and sends no next page', async () => {
  let resolve!: (value: ReturnType<typeof page>) => void;
  mockCallable.mockReturnValueOnce(new Promise((next) => { resolve = next; }));
  const onProgress = jest.fn();
  const controller = new AbortController();
  const request = refreshCampusSenseSnapshot({ ...input(), signal: controller.signal, onProgress });
  expect(mockCallable).toHaveBeenCalledTimes(1);
  controller.abort();
  await expect(request).rejects.toThrow('sense-cancelled');
  resolve(page(0));
  await Promise.resolve(); await Promise.resolve();
  expect(mockCallable).toHaveBeenCalledTimes(1);
  expect(onProgress).toHaveBeenCalledTimes(1);
});

test('cancel during page two never exposes partial results or reads page three', async () => {
  let rejectSecond!: (error: Error) => void;
  const controller = new AbortController();
  const onProgress = jest.fn();
  mockCallable.mockResolvedValueOnce(page(0)).mockImplementationOnce(() => new Promise((_, reject) => { rejectSecond = reject; }));
  const request = refreshCampusSenseSnapshot({ ...input(), signal: controller.signal, onProgress });
  for (let i = 0; i < 10 && mockCallable.mock.calls.length < 2; i += 1) await Promise.resolve();
  expect(mockCallable).toHaveBeenCalledTimes(2);
  controller.abort();
  await expect(request).rejects.toThrow('sense-cancelled');
  // Late transport failures must be handled, not become an unhandled rejection.
  rejectSecond(new Error('late network error'));
  await Promise.resolve(); await Promise.resolve();
  expect(mockCallable).toHaveBeenCalledTimes(2);
  expect(onProgress.mock.calls.some(([value]) => value.phase === 'complete')).toBe(false);
});

test('changing identity inside a progress callback stops all continuations', async () => {
  const onProgress = jest.fn((progress: CampusSenseProgress) => { if (progress.loaded > 0) mockUid = 'B'; });
  await expect(refreshCampusSenseSnapshot({ ...input(), onProgress })).rejects.toThrow('session-changed');
  expect(mockCallable).toHaveBeenCalledTimes(1);
});

test('a changed revision fails the read and never emits a completed progress event', async () => {
  const onProgress = jest.fn();
  mockCallable.mockResolvedValueOnce(page(0)).mockResolvedValueOnce(page(50, 'c'.repeat(64)));
  await expect(refreshCampusSenseSnapshot({ ...input(), onProgress })).rejects.toThrow('assignment-source-changed');
  expect(onProgress.mock.calls.map(([value]) => value.loaded)).toEqual([0, 50]);
});

test('an already aborted operation calls neither source nor progress observer', async () => {
  const controller = new AbortController(); controller.abort();
  const onProgress = jest.fn();
  await expect(refreshCampusSenseSnapshot({ ...input(), signal: controller.signal, onProgress })).rejects.toThrow('sense-cancelled');
  expect(mockCallable).not.toHaveBeenCalled(); expect(onProgress).not.toHaveBeenCalled();
});

test('the local wait removes its abort listener on success and on failure', async () => {
  const controller = new AbortController();
  const remove = jest.spyOn(controller.signal, 'removeEventListener');
  await expect(abortableCampusRead(async () => 7, controller.signal)).resolves.toBe(7);
  expect(remove).toHaveBeenCalledTimes(1);
  await expect(abortableCampusRead(async () => { throw new Error('source failure'); }, controller.signal)).rejects.toThrow('source failure');
  expect(remove).toHaveBeenCalledTimes(2);
  controller.abort();
});

test('synchronous native errors reject cleanly and do not leave abort listeners', async () => {
  const controller = new AbortController();
  const remove = jest.spyOn(controller.signal, 'removeEventListener');
  await expect(abortableCampusRead(() => { throw new Error('bridge failure'); }, controller.signal)).rejects.toThrow('bridge failure');
  expect(remove).toHaveBeenCalledTimes(1);
});
