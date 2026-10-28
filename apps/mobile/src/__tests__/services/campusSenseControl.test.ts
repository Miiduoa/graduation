import { awaitCampusSenseRead, CAMPUS_SENSE_PAGE_TIMEOUT_MS } from '../../services/campusSenseReadTask';
import { refreshCampusSenseSnapshot, CAMPUS_SENSE_TOTAL_TIMEOUT_MS } from '../../services/campusSenseSnapshot';

const mockCallable = jest.fn();
let mockUid = 'A';
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockCallable }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: { uid: mockUid } }),
  getFunctionsInstance: () => ({}),
  isFirebaseMockMode: () => false,
}));
const now = '2026-10-28T02:00:00.000Z';
const scope = { uid: 'A', schoolId: 'pu' };
function page(offset: number, total = 137) {
  const size = Math.min(50, total - offset);
  return {
    schoolId: 'pu', checkedAt: now,
    schedule: { status: 'unavailable', count: null },
    announcements: { status: 'available', items: [] },
    assignments: {
      status: 'available', count: total,
      items: Array.from({ length: size }, (_, index) => ({
        title: 'Private assignment ' + (offset + index), groupName: 'Course', dueAt: null,
        source: { kind: 'group-assignment', groupId: 'g', assignmentId: 'a_' + (offset + index) },
      })),
      paging: { version: 1, offset, nextOffset: offset + size < total ? offset + size : null, revision: 'a'.repeat(64) },
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(now));
  mockUid = 'A';
  mockCallable.mockReset().mockImplementation(async (input: { assignmentPage?: { offset: number } }) => ({
    data: page(input.assignmentPage?.offset ?? 0),
  }));
});
afterEach(() => jest.useRealTimers());

test('already cancelled reads never start a network request', async () => {
  const controller = new AbortController();
  controller.abort();
  const start = jest.fn();
  await expect(awaitCampusSenseRead(start, controller.signal)).rejects.toThrow('sense-cancelled');
  expect(start).not.toHaveBeenCalled();
});

test.each(['resolve', 'reject'] as const)('cancellation rejects immediately and observes a late %s', async (settlement) => {
  const pending = deferred<number>();
  const controller = new AbortController();
  const remove = jest.spyOn(controller.signal, 'removeEventListener');
  const result = awaitCampusSenseRead(() => pending.promise, controller.signal);
  const rejection = expect(result).rejects.toThrow('sense-cancelled');
  controller.abort();
  await rejection;
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(jest.getTimerCount()).toBe(0);
  if (settlement === 'resolve') pending.resolve(7);
  else pending.reject(new Error('late native failure'));
  await Promise.resolve();
});

test('a stalled page expires and releases its abort listener', async () => {
  const controller = new AbortController();
  const pending = deferred<number>();
  const remove = jest.spyOn(controller.signal, 'removeEventListener');
  const result = awaitCampusSenseRead(() => pending.promise, controller.signal);
  const rejection = expect(result).rejects.toThrow('sense-timeout');
  await jest.advanceTimersByTimeAsync(CAMPUS_SENSE_PAGE_TIMEOUT_MS);
  await rejection;
  expect(remove).toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
  pending.resolve(2);
});

test('successful and synchronously failed reads remove timers', async () => {
  await expect(awaitCampusSenseRead(async () => 5)).resolves.toBe(5);
  await expect(awaitCampusSenseRead(() => { throw new Error('start failed'); })).rejects.toThrow('start failed');
  expect(jest.getTimerCount()).toBe(0);
});

test('reports only validated counts and publishes completion after all pages', async () => {
  const onProgress = jest.fn();
  const snapshot = await refreshCampusSenseSnapshot({ scope, isCurrent: () => true, onProgress });
  expect(snapshot.assignments.items).toHaveLength(137);
  expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
    { phase: 'reading', loaded: 0, total: null, pages: 0 },
    { phase: 'reading', loaded: 50, total: 137, pages: 1 },
    { phase: 'reading', loaded: 100, total: 137, pages: 2 },
    { phase: 'reading', loaded: 137, total: 137, pages: 3 },
    { phase: 'complete', loaded: 137, total: 137, pages: 3 },
  ]);
  expect(JSON.stringify(onProgress.mock.calls)).not.toContain('Private assignment');
  expect(jest.getTimerCount()).toBe(0);
});

test('cancelling a stalled continuation stops further pages and never publishes partial success', async () => {
  const pending = deferred<{ data: ReturnType<typeof page> }>();
  mockCallable.mockResolvedValueOnce({ data: page(0) }).mockReturnValueOnce(pending.promise);
  const controller = new AbortController();
  const onProgress = jest.fn();
  const result = refreshCampusSenseSnapshot({ scope, isCurrent: () => true, signal: controller.signal, onProgress });
  const rejection = expect(result).rejects.toThrow('sense-cancelled');
  for (let i = 0; i < 20 && mockCallable.mock.calls.length < 2; i += 1) await Promise.resolve();
  expect(mockCallable).toHaveBeenCalledTimes(2);
  controller.abort();
  await rejection;
  const reported = onProgress.mock.calls.length;
  pending.resolve({ data: page(50) });
  await Promise.resolve();
  await Promise.resolve();
  expect(mockCallable).toHaveBeenCalledTimes(2);
  expect(onProgress).toHaveBeenCalledTimes(reported);
  expect(onProgress.mock.calls.some(([p]) => p.phase === 'complete')).toBe(false);
});

test('cancellation from a progress listener prevents the next request', async () => {
  const controller = new AbortController();
  await expect(refreshCampusSenseSnapshot({
    scope, isCurrent: () => true, signal: controller.signal,
    onProgress: (p) => { if (p.loaded === 50) controller.abort(); },
  })).rejects.toThrow('sense-cancelled');
  expect(mockCallable).toHaveBeenCalledTimes(1);
});

test('scope changes cannot emit personal progress or trigger continuations', async () => {
  mockCallable.mockImplementationOnce(async () => { mockUid = 'B'; return { data: page(0) }; });
  const onProgress = jest.fn();
  await expect(refreshCampusSenseSnapshot({ scope, isCurrent: () => true, onProgress }))
    .rejects.toThrow('session-changed');
  expect(onProgress).toHaveBeenCalledTimes(1);
  expect(onProgress).toHaveBeenCalledWith({ phase: 'reading', loaded: 0, total: null, pages: 0 });
});

test('the whole refresh has a bounded wait even when individual pages stay below their timeout', async () => {
  mockCallable.mockImplementation((input: { assignmentPage?: { offset: number } }) =>
    new Promise((resolve) => setTimeout(() => resolve({ data: page(input.assignmentPage?.offset ?? 0) }), 40_000)));
  const result = refreshCampusSenseSnapshot({ scope, isCurrent: () => true });
  const rejection = expect(result).rejects.toThrow('sense-timeout');
  await jest.advanceTimersByTimeAsync(CAMPUS_SENSE_TOTAL_TIMEOUT_MS);
  await rejection;
  expect(mockCallable).toHaveBeenCalledTimes(3);
  await jest.advanceTimersByTimeAsync(40_000); // Observe the already-sent late response.
});
