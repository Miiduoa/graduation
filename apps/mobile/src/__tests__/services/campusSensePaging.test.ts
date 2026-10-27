import { refreshCampusSenseSnapshot, CAMPUS_ASSIGNMENT_MAX_PAGES } from '../../services/campusSenseSnapshot';
import { buildOfflineCampusPlan } from '../../services/offlineCampusPlanner';

let mockUid: string | null = 'A';
const mockCallable = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockCallable }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
  getFunctionsInstance: () => ({}),
  isFirebaseMockMode: () => false,
}));
const scope = { uid: 'A', schoolId: 'pu' };
const revision = 'a'.repeat(64);
const now = '2026-10-27T01:00:00.000Z';
const row = (index: number) => ({
  title: '作業 ' + index, groupName: '課程 ' + (index % 4),
  dueAt: new Date(Date.parse(now) + 3600000 + index * 60000).toISOString(),
  source: { kind: 'group-assignment', groupId: 'g_' + (index % 4), assignmentId: 'a_' + index },
});
function page(offset: number, total = 137, rev = revision) {
  const end = Math.min(offset + 50, total);
  return {
    schoolId: 'pu', checkedAt: now,
    schedule: { status: 'unavailable', count: null },
    announcements: { status: 'available', items: [{ title: '原始公告', publishedAt: now }] },
    assignments: {
      status: 'available', count: total,
      items: Array.from({ length: end - offset }, (_, i) => row(i + offset)),
      paging: { version: 1, offset, nextOffset: end < total ? end : null, revision: rev },
    },
  };
}
const read = (extra: Partial<Parameters<typeof refreshCampusSenseSnapshot>[0]> = {}) =>
  refreshCampusSenseSnapshot({ scope, isCurrent: () => true, ...extra });

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(now));
  mockUid = 'A';
  mockCallable.mockReset().mockImplementation(async (request: { assignmentPage?: { offset: number } }) => ({
    data: page(request.assignmentPage?.offset ?? 0),
  }));
});
afterEach(() => jest.useRealTimers());

test('collects all 137 assignments, and the planner can actually use the last page', async () => {
  const result = await read();
  expect(result.assignments.items).toHaveLength(137);
  expect(result.assignments.items[136].title).toBe('作業 136');
  expect(result.assignments.coverage).toEqual({ complete: true, reason: 'complete', pages: 3 });
  expect(mockCallable).toHaveBeenNthCalledWith(1, { schoolId: 'pu' });
  expect(mockCallable).toHaveBeenNthCalledWith(2, { schoolId: 'pu', assignmentPage: { offset: 50, revision } });
  expect(mockCallable).toHaveBeenNthCalledWith(3, { schoolId: 'pu', assignmentPage: { offset: 100, revision } });
  const plan = buildOfflineCampusPlan({
    question: '安排未來七天的作業', uid: 'A', snapshot: result,
    context: { schoolId: 'pu', schoolName: '靜宜大學', checkedAt: now,
      timetable: { source: 'not-available', updatedAt: null, courses: [] } },
  });
  expect(plan?.agenda?.days.flatMap((day) => day.deadlines).some((item) => item.title === '作業 136')).toBe(true);
});

test('keeps original timestamps and announcements instead of refreshing their age with later pages', async () => {
  mockCallable.mockImplementation(async (request: { assignmentPage?: { offset: number } }) => {
    const data = page(request.assignmentPage?.offset ?? 0);
    if (request.assignmentPage) {
      data.checkedAt = new Date(Date.parse(now) + 20000).toISOString();
      data.announcements = { status: 'unavailable', items: [] };
    }
    return { data };
  });
  const result = await read();
  expect(result.checkedAt).toBe(now);
  expect(result.announcements.items[0].title).toBe('原始公告');
});

test('never silently truncates a legacy server list and labels partial responses accurately', async () => {
  const data = page(0, 45);
  const { paging: _paging, ...assignments } = data.assignments;
  mockCallable.mockResolvedValueOnce({ data: { ...data, assignments } });
  const complete = await read();
  expect(complete.assignments.items).toHaveLength(45);
  expect(complete.assignments.coverage?.complete).toBe(true);
  mockCallable.mockResolvedValueOnce({ data: { ...data, assignments: { ...assignments, count: 70 } } });
  const partial = await read();
  expect(partial.assignments.coverage).toEqual({ complete: false, reason: 'legacy-partial', pages: 1 });
  expect(mockCallable).toHaveBeenCalledTimes(2);
});

test('a changed revision rejects the entire read instead of mixing old and new tasks', async () => {
  mockCallable.mockResolvedValueOnce({ data: page(0) }).mockResolvedValueOnce({ data: page(50, 137, 'b'.repeat(64)) });
  await expect(read()).rejects.toThrow('assignment-source-changed');
  expect(mockCallable).toHaveBeenCalledTimes(2);
});

test('changed totals cannot be accepted under an old revision', async () => {
  mockCallable.mockResolvedValueOnce({ data: page(0) }).mockResolvedValueOnce({ data: page(50, 138) });
  await expect(read()).rejects.toThrow('assignment-source-changed');
});

test('duplicate source identities across pages are rejected even if their display text changes', async () => {
  const duplicate = page(50);
  duplicate.assignments.items[0].source = row(0).source;
  mockCallable.mockResolvedValueOnce({ data: page(0) }).mockResolvedValueOnce({ data: duplicate });
  await expect(read()).rejects.toThrow('duplicate-assignment-page');
});

test.each(['offset', 'nextOffset', 'revision', 'version', 'empty'])('rejects malformed %s page metadata', async (kind) => {
  const invalid = page(0);
  if (kind === 'offset') invalid.assignments.paging.offset = 50;
  if (kind === 'nextOffset') invalid.assignments.paging.nextOffset = 0;
  if (kind === 'revision') invalid.assignments.paging.revision = '../fake';
  if (kind === 'version') invalid.assignments.paging.version = 2;
  if (kind === 'empty') invalid.assignments.items = [];
  mockCallable.mockResolvedValueOnce({ data: invalid });
  await expect(read()).rejects.toThrow(/invalid-assignment-page/);
  expect(mockCallable).toHaveBeenCalledTimes(1);
});

test('a server repeating page zero cannot create a loop', async () => {
  mockCallable.mockResolvedValue({ data: page(0) });
  await expect(read()).rejects.toThrow('assignment-source-changed');
  expect(mockCallable).toHaveBeenCalledTimes(2);
});

test.each(['functions/permission-denied', 'functions/unavailable'])('does not publish partial success after %s', async (code) => {
  const failure = Object.assign(new Error('read failed'), { code });
  mockCallable.mockResolvedValueOnce({ data: page(0) }).mockRejectedValueOnce(failure);
  await expect(read()).rejects.toBe(failure);
});

test('scope switch during a page discards it and prevents later requests', async () => {
  mockCallable.mockResolvedValueOnce({ data: page(0) }).mockImplementationOnce(async () => {
    mockUid = 'B';
    return { data: page(50) };
  });
  await expect(read()).rejects.toThrow('session-changed');
  expect(mockCallable).toHaveBeenCalledTimes(2);
});

test('navigation away during the first read cannot launch a continuation', async () => {
  let current = true;
  mockCallable.mockImplementationOnce(async () => { current = false; return { data: page(0) }; });
  await expect(read({ isCurrent: () => current })).rejects.toThrow('session-changed');
  expect(mockCallable).toHaveBeenCalledTimes(1);
});

test('an explicit aborted read neither begins nor continues pagination', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(read({ signal: controller.signal })).rejects.toThrow('sense-cancelled');
  expect(mockCallable).not.toHaveBeenCalled();
  const later = new AbortController();
  mockCallable.mockImplementationOnce(async () => { later.abort(); return { data: page(0) }; });
  await expect(read({ signal: later.signal })).rejects.toThrow('sense-cancelled');
  expect(mockCallable).toHaveBeenCalledTimes(1);
});

test('oversized responses fail instead of quietly cutting away data', async () => {
  const data = page(0);
  data.assignments.items.push(row(50));
  mockCallable.mockResolvedValueOnce({ data });
  await expect(read()).rejects.toThrow('invalid-sense-response');
});

test('an unusually large workload is visibly partial within a bounded number of requests', async () => {
  mockCallable.mockImplementation(async (request: { assignmentPage?: { offset: number } }) => ({
    data: page(request.assignmentPage?.offset ?? 0, 450),
  }));
  const result = await read();
  expect(result.assignments.items).toHaveLength(400);
  expect(result.assignments.count).toBe(450);
  expect(result.assignments.coverage).toEqual({ complete: false, reason: 'read-budget', pages: 8 });
  expect(mockCallable).toHaveBeenCalledTimes(CAMPUS_ASSIGNMENT_MAX_PAGES);
});

test('later pages cannot revive an expired first snapshot', async () => {
  mockCallable.mockResolvedValueOnce({ data: page(0, 70) }).mockImplementationOnce(async () => {
    jest.setSystemTime(new Date(Date.parse(now) + 16 * 60000));
    return { data: { ...page(50, 70), checkedAt: new Date().toISOString() } };
  });
  await expect(read()).rejects.toThrow('expired-sense-response');
});
