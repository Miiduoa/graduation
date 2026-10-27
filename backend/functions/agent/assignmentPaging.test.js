'use strict';

const mockAuthorize = jest.fn();
const mockAssignments = jest.fn();
const mockProfile = jest.fn();
const mockSchedule = jest.fn();
const mockAnnouncements = jest.fn();
jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn(),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}));
jest.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }));
jest.mock('../accountLifecycle', () => ({ createAccountGuardedOnCall: () => (_options, handler) => handler }));
jest.mock('../authz', () => ({ createAuthzHelpers: () => ({ assertActiveSchoolMember: mockAuthorize }) }));
jest.mock('../securityUtils', () => ({ enforceRateLimit: jest.fn() }));
jest.mock('../lib/assistantFetchers', () => ({
  fetchAssistantUserProfile: (...args) => mockProfile(...args),
  fetchAssistantTodaySchedule: (...args) => mockSchedule(...args),
  fetchAssistantPendingAssignments: (...args) => mockAssignments(...args),
  fetchAssistantAnnouncements: (...args) => mockAnnouncements(...args),
}));
const { parseAssignmentPageRequest, summarizeAssignmentPage } = require('./assignmentPaging');
const handler = require('./handlers/getCampusAssistantSnapshot');
const { enforceRateLimit } = require('../securityUtils');
const scope = { uid: 'A', schoolId: 'pu' };
const rows = (n = 137) => Array.from({ length: n }, (_, i) => ({
  id: 'task_' + i, groupId: 'course_' + (i % 4), title: '作業 ' + i,
  groupName: '課程 ' + (i % 4), dueAt: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(),
  privateAnswer: 'Do not serialize answer content',
}));
const request = { auth: { uid: 'A' }, data: { schoolId: 'pu' } };

beforeEach(() => {
  jest.resetAllMocks();
  mockAuthorize.mockResolvedValue(undefined);
  mockProfile.mockResolvedValue({ schoolId: 'pu' });
  mockAssignments.mockResolvedValue(rows());
  mockSchedule.mockResolvedValue({ status: 'unavailable', slots: null });
  mockAnnouncements.mockResolvedValue([]);
});

test('all 137 assignments, including those beyond the old eight-row preview, have exactly one page', () => {
  const data = rows();
  const first = summarizeAssignmentPage(data, scope);
  const second = summarizeAssignmentPage(data, scope, { offset: 50, revision: first.paging.revision });
  const third = summarizeAssignmentPage(data, scope, { offset: 100, revision: first.paging.revision });
  expect(first.items).toHaveLength(50);
  expect(second.items).toHaveLength(50);
  expect(third.items).toHaveLength(37);
  expect(third.paging.nextOffset).toBeNull();
  const all = [first, second, third].flatMap((page) => page.items);
  expect(new Set(all.map((row) => row.source.assignmentId)).size).toBe(137);
  expect(all[8].title).toBe('作業 8');
  expect(all[136].title).toBe('作業 136');
  expect(JSON.stringify(all)).not.toContain('Do not serialize');
});

test('datastore ordering changes do not alter the revision or equal-deadline page boundaries', () => {
  const sameDue = rows(70).map((row) => ({ ...row, dueAt: null }));
  const before = JSON.stringify(sameDue);
  expect(summarizeAssignmentPage(sameDue, scope)).toEqual(summarizeAssignmentPage([...sameDue].reverse(), scope));
  expect(JSON.stringify(sameDue)).toBe(before);
});

test.each(['added', 'removed', 'deadline', 'title', 'identity', 'account', 'school'])(
  'a %s change cannot be mixed into an earlier synchronization', (kind) => {
    const initial = rows(70);
    const first = summarizeAssignmentPage(initial, scope);
    let changed = initial.map((row) => ({ ...row }));
    let nextScope = scope;
    if (kind === 'added') changed = rows(71);
    if (kind === 'removed') changed.pop();
    if (kind === 'deadline') changed[0].dueAt = '2026-12-01T00:00:00Z';
    if (kind === 'title') changed[0].title = '新的題目';
    if (kind === 'identity') changed[0].id = 'new_id';
    if (kind === 'account') nextScope = { ...scope, uid: 'B' };
    if (kind === 'school') nextScope = { ...scope, schoolId: 'other' };
    expect(() => summarizeAssignmentPage(changed, nextScope, { offset: 50, revision: first.paging.revision }))
      .toThrow('source changed');
  },
);

test.each([null, [], '50', { offset: -1 }, { offset: 1 }, { offset: 50 },
  { offset: 50, revision: '../escape' }, { offset: 0, revision: 'a'.repeat(64) },
  { offset: 50, revision: 'a'.repeat(64), schoolId: 'other' }])(
  'rejects malformed cursor %j before data access', (value) => {
    expect(() => parseAssignmentPageRequest(value)).toThrow('Invalid assignment page');
  },
);

test('validates the entire source, including malformed rows beyond the first page', () => {
  const data = rows(75);
  data[70].title = '';
  expect(() => summarizeAssignmentPage(data, scope)).toThrow('incomplete');
  const duplicates = [...rows(75), rows(75)[0]];
  expect(() => summarizeAssignmentPage(duplicates, scope)).toThrow('Duplicate assignment identity');
});

test('an empty authorized list is complete, while non-arrays are not treated as zero', () => {
  expect(summarizeAssignmentPage([], scope)).toMatchObject({
    status: 'available', count: 0, items: [], paging: { offset: 0, nextOffset: null },
  });
  expect(() => summarizeAssignmentPage(null, scope)).toThrow('unavailable');
});

test('continuations reauthorize source reads without repeating announcements or timetable requests', async () => {
  const first = await handler(request);
  jest.clearAllMocks();
  const second = await handler({ ...request, data: {
    schoolId: 'pu', assignmentPage: { offset: 50, revision: first.assignments.paging.revision },
  } });
  expect(second.assignments.items).toHaveLength(50);
  expect(mockAuthorize).toHaveBeenCalledTimes(2);
  expect(mockAuthorize).toHaveBeenNthCalledWith(1, 'pu', 'A');
  expect(mockAuthorize).toHaveBeenNthCalledWith(2, 'pu', 'A');
  expect(mockAssignments).toHaveBeenCalledWith('A', 'pu');
  expect(mockSchedule).not.toHaveBeenCalled();
  expect(mockAnnouncements).not.toHaveBeenCalled();
  expect(enforceRateLimit).toHaveBeenCalledWith(expect.objectContaining({ key: 'A', limit: 12 }));
});

test('a permission revoked while fetching another page prevents its release', async () => {
  const first = await handler(request);
  mockAuthorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('membership revoked'));
  await expect(handler({ ...request, data: {
    schoolId: 'pu', assignmentPage: { offset: 50, revision: first.assignments.paging.revision },
  } })).rejects.toThrow('membership revoked');
});

test('unavailable and changed continuations fail instead of returning a successful partial list', async () => {
  const first = await handler(request);
  const next = { ...request, data: { schoolId: 'pu', assignmentPage: { offset: 50, revision: first.assignments.paging.revision } } };
  mockAssignments.mockRejectedValueOnce(new Error('course permission denied'));
  await expect(handler(next)).rejects.toThrow('course permission denied');
  mockAssignments.mockResolvedValueOnce(rows(138));
  await expect(handler(next)).rejects.toMatchObject({ code: 'failed-precondition' });
});

test('invalid cursor fails before even looking up the account profile', async () => {
  await expect(handler({ ...request, data: { schoolId: 'pu', assignmentPage: { offset: 50 } } }))
    .rejects.toMatchObject({ code: 'invalid-argument' });
  expect(mockProfile).not.toHaveBeenCalled();
  expect(mockAssignments).not.toHaveBeenCalled();
});
