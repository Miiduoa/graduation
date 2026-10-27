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
jest.mock('../accountLifecycle', () => ({
  createAccountGuardedOnCall: () => (_options, handler) => handler,
}));
jest.mock('../authz', () => ({ createAuthzHelpers: () => ({ assertActiveSchoolMember: mockAuthorize }) }));
jest.mock('../securityUtils', () => ({ enforceRateLimit: jest.fn() }));
jest.mock('../lib/assistantFetchers', () => ({
  fetchAssistantUserProfile: (...args) => mockProfile(...args),
  fetchAssistantTodaySchedule: (...args) => mockSchedule(...args),
  fetchAssistantPendingAssignments: (...args) => mockAssignments(...args),
  fetchAssistantAnnouncements: (...args) => mockAnnouncements(...args),
}));

const { summarizeAssignmentRows } = require('./assignmentSummary');
const snapshotHandler = require('./handlers/getCampusAssistantSnapshot');
const row = {
  id: 'assignment_1', groupId: 'group_1', schoolId: 'pu',
  title: '資料庫報告', groupName: '資料庫', dueAt: '2026-10-30T09:00:00Z',
  content: 'Private answer text must not be serialized',
};
const request = { auth: { uid: 'A' }, data: { schoolId: 'pu' } };

beforeEach(() => {
  jest.resetAllMocks();
  mockAuthorize.mockResolvedValue(undefined);
  mockProfile.mockResolvedValue({ schoolId: 'pu' });
  mockSchedule.mockResolvedValue({ status: 'unavailable', slots: null });
  mockAssignments.mockResolvedValue([row]);
  mockAnnouncements.mockResolvedValue([]);
});

test('summarizes only display data and literal assignment identity', () => {
  expect(summarizeAssignmentRows([row])).toEqual({
    status: 'available', count: 1, items: [{
      title: '資料庫報告', groupName: '資料庫', dueAt: '2026-10-30T09:00:00.000Z',
      source: { kind: 'group-assignment', groupId: 'group_1', assignmentId: 'assignment_1' },
    }],
  });
});

test('retains the total count while bounding summary size', () => {
  const result = summarizeAssignmentRows(Array.from({ length: 11 }, (_, i) => ({ ...row, id: 'task_' + i })));
  expect(result.count).toBe(11);
  expect(result.items).toHaveLength(8);
});

test.each([undefined, null, {}, 'not a list'])(
  'does not convert an unavailable source %j into a verified zero count', (value) => {
    expect(() => summarizeAssignmentRows(value)).toThrow('unavailable');
  },
);

test.each(['../escape', 'https://invalid.example', '%2F', '', 'a'.repeat(129)])(
  'unsupported identifier %s never becomes a client destination', (id) => {
    const result = summarizeAssignmentRows([{ ...row, id }]);
    expect(result.items[0].title).toBe(row.title);
    expect(result.items[0].source).toBeUndefined();
  },
);

test('missing IDs or dates remain readable without manufactured source metadata', () => {
  const result = summarizeAssignmentRows([{ title: '核對題目', dueAt: null }]);
  expect(result.items[0]).toEqual({ title: '核對題目', groupName: '', dueAt: null });
});

test('the handler keeps authorization checks before and after source reads', async () => {
  const response = await snapshotHandler(request);
  expect(mockAuthorize).toHaveBeenCalledTimes(2);
  expect(mockAuthorize).toHaveBeenNthCalledWith(1, 'pu', 'A');
  expect(mockAuthorize).toHaveBeenNthCalledWith(2, 'pu', 'A');
  expect(mockAssignments).toHaveBeenCalledWith('A', 'pu');
  expect(response.assignments.items[0].source).toEqual({
    kind: 'group-assignment', groupId: 'group_1', assignmentId: 'assignment_1',
  });
  expect(JSON.stringify(response)).not.toContain(row.content);
});

test('revoked membership cannot release assignment identifiers', async () => {
  mockAuthorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('membership revoked'));
  await expect(snapshotHandler(request)).rejects.toThrow('membership revoked');
});

test('malformed assignment responses degrade only that source to unavailable', async () => {
  mockAssignments.mockResolvedValueOnce(null);
  const result = await snapshotHandler(request);
  expect(result.assignments).toEqual({ status: 'unavailable', count: null, items: [] });
  expect(result.announcements.status).toBe('available');
});

test('failed course reads disclose neither partial assignment data nor route references', async () => {
  mockAssignments.mockRejectedValueOnce(new Error('course permission denied'));
  const result = await snapshotHandler(request);
  expect(result.assignments).toEqual({ status: 'unavailable', count: null, items: [] });
});
