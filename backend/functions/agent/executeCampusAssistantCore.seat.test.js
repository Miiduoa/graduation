'use strict';

const mockDocuments = new Map();
const mockSet = jest.fn(async () => {});
const mockModel = jest.fn();
const mockWebSearch = jest.fn();

function mockRef(path) {
  const query = {
    where: () => query, orderBy: () => query, limit: () => query,
    get: async () => ({ docs: [], empty: true, size: 0 }),
  };
  return {
    path,
    collection: name => mockRef(`${path}/${name}`),
    doc: id => mockRef(`${path}/${id}`),
    where: () => query, orderBy: () => query, limit: () => query,
    get: async () => {
      const value = mockDocuments.get(path);
      if (value instanceof Error) throw value;
      return { exists: value !== undefined, data: () => value, docs: [], empty: true, size: 0 };
    },
    set: mockSet,
  };
}
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: name => mockRef(name), doc: mockRef }),
  FieldValue: { serverTimestamp: () => 'synthetic-server-time' },
}));
jest.mock('../assistantAgent', () => ({
  ...jest.requireActual('../assistantAgent'),
  answerWithServerWebSearch: (...args) => mockWebSearch(...args),
  callAssistantModelWithTools: (...args) => mockModel(...args),
  callAssistantModel: (...args) => mockModel(...args),
}));

const { executeCampusAssistantCore } = require('./executeCampusAssistantCore');
const now = Date.parse('2026-11-17T04:00:00Z');
const runId = '11111111-2222-4333-8444-555555555555';
const explicit = '2026-11-20 14:00 到16:30 座位編號：lib-3F-A15';
async function run(message, schoolId = 'pu') {
  return executeCampusAssistantCore({
    request: {
      auth: { uid: 'alice', token: { role: 'student' } },
      data: { messages: [{ role: 'user', content: message }], context: { schoolId, timezone: 'Asia/Taipei' } },
    },
    runId, startedAt: now, routingIntent: 'reserve_seat', prefetched: {},
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  mockDocuments.clear();
  mockDocuments.set('users/alice', { schoolId: 'pu', role: 'student' });
  mockDocuments.set('schools/pu/members/alice', { status: 'active', role: 'student' });
  mockDocuments.set('schools/ntu/members/alice', { status: 'active', role: 'student' });
  mockDocuments.set('users/alice/settings/assistantPermissions', { reserveSeat: true });
  mockModel.mockImplementation(() => { throw new Error('Seat parsing must not call an AI provider'); });
  mockWebSearch.mockImplementation(() => { throw new Error('Seat parsing must not use web search'); });
});
afterEach(() => {
  expect(mockSet).not.toHaveBeenCalled();
  expect(mockModel).not.toHaveBeenCalled();
  expect(mockWebSearch).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

test.each(['pu', 'ntu'])('prepares the exact explicit interval and seat ID in the authorized %s scope without writing', async schoolId => {
  const result = await run(explicit, schoolId);
  expect(result.actions).toEqual([expect.objectContaining({
    action: 'queue_action', status: 'pending_confirmation', requiresConfirmation: true,
    params: { toolName: 'reserveSeat', agentRunId: runId,
      input: { seatId: 'lib-3F-A15', date: '2026-11-20', startTime: '14:00', endTime: '16:30' } },
  })]);
  expect(result.content).toContain('14:00–16:30');
  expect(result.content).toContain('lib-3F-A15');
  expect(result.content).not.toMatch(/已預約成功|已完成預約/);
});

test.each([
  ['any seat', '2026-11-20 14:00 到16:30 圖書館三樓隨便一席'],
  ['floor without an ID', '2026-11-20 14:00 到16:30 圖書館三樓'],
  ['missing end', '2026-11-20 14:00 座位編號：lib-3F-A15'],
  ['ambiguous seats', '2026-11-20 14:00 到16:30 座位編號：lib-3F-A15 或 lib-3F-A16'],
  ['ambiguous intervals', '2026-11-20 14:00 到16:30 或 17:00 到18:00 座位編號：lib-3F-A15'],
  ['cross midnight', '2026-11-20 23:00 到01:00 座位編號：lib-3F-A15'],
])('does not manufacture a confirmation for %s', async (_name, message) => {
  const result = await run(message);
  expect(result.actions).toEqual([]);
  expect(result.content).toMatch(/結束|起訖/);
  expect(result.content).toMatch(/座位.*(?:編號|代碼)|seatId/i);
  expect(result.content).not.toContain('我已整理');
});

test.each([false, new Error('permission source unavailable')])('preserves the permission gate before generating an exact seat action: %p', async permission => {
  mockDocuments.set('users/alice/settings/assistantPermissions', permission instanceof Error ? permission : { reserveSeat: permission });
  const result = await run(explicit);
  expect(result.debug.route).toBe('write_permission_denied');
  expect(result.actions.some(action => action.action === 'queue_action')).toBe(false);
  expect(result.content).toMatch(/預約座位/);
});
