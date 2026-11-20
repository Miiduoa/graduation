'use strict';

const mockSavedRuns = [];
const mockDb = {
  collection: jest.fn(),
  doc: jest.fn(),
  set: jest.fn(),
};

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => mockDb,
  FieldValue: { serverTimestamp: () => 'server-timestamp' },
}));
jest.mock('../authz', () => ({
  createAuthzHelpers: () => ({ assertActiveSchoolMember: async () => undefined }),
}));
jest.mock('../assistantAgent', () => ({
  createRequestId: jest.fn(() => 'run-containment'),
  resolvePermissionScope: jest.fn(() => 'student'),
}));
jest.mock('../securityUtils', () => ({
  enforceRateLimit: jest.fn(),
  getClientIp: jest.fn(() => '127.0.0.1'),
  isProductionRuntime: jest.fn(() => false),
}));
jest.mock('../lib/assistantFetchers', () => ({
  fetchAssistantUserProfile: jest.fn(),
  fetchAssistantDailyBrief: jest.fn(),
}));
jest.mock('../lib/assistantQueue', () => ({
  writeReviewAiSuggestionQueueItem: jest.fn(),
}));
jest.mock('./classifyIntent', () => ({ classifyIntent: jest.fn() }));
jest.mock('./evaluateAnswer', () => ({ evaluateAnswer: jest.fn() }));
jest.mock('./executeCampusAssistantCore', () => ({ executeCampusAssistantCore: jest.fn() }));
jest.mock('./tools/registry', () => ({ runTool: jest.fn() }));
jest.mock('./intentWritePlan', () => ({ getIntentWritePlan: jest.fn() }));

const { fetchAssistantUserProfile, fetchAssistantDailyBrief } = require('../lib/assistantFetchers');
const { writeReviewAiSuggestionQueueItem } = require('../lib/assistantQueue');
const { classifyIntent } = require('./classifyIntent');
const { evaluateAnswer } = require('./evaluateAnswer');
const { executeCampusAssistantCore } = require('./executeCampusAssistantCore');
const { runTool } = require('./tools/registry');
const { getIntentWritePlan } = require('./intentWritePlan');
const { runCampusAssistantWithAgentRuntime } = require('./runtime');

function request() {
  return {
    auth: { uid: 'student-a', token: { role: 'student' } },
    rawRequest: {},
    data: {
      messages: [{ role: 'user', content: '幫我整理今天的校園資訊' }],
      context: { schoolId: 'school-a', sessionId: 'session-a', timezone: 'Asia/Taipei' },
    },
  };
}

function denial(code) {
  return Object.assign(new Error('private-denial-detail'), { code });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function successfulRead(name) {
  return name === 'getPrioritySummary' ? { summary: 'private-priority-summary' } : [];
}

function expectContained(response, source) {
  expect(response).toMatchObject({
    run: { status: 'blocked' },
    intent: { name: 'security_block', source: 'authorization_guard' },
    actions: [],
    cards: [],
    citations: [],
    assistantToolsUsed: [],
    evaluation: { needsUserReview: false },
  });
  expect(evaluateAnswer).not.toHaveBeenCalled();
  expect(writeReviewAiSuggestionQueueItem).not.toHaveBeenCalled();
  const saved = mockSavedRuns.at(-1);
  expect(saved).toMatchObject({
    status: 'blocked',
    actionProposals: [],
    actionQueueId: null,
    errorCode: 'authorization_denied',
  });
  expect(saved.steps).toEqual(expect.arrayContaining([
    expect.objectContaining({
      tool: source,
      input: {},
      output: { success: false, errorCode: 'authorization_denied' },
    }),
    expect.objectContaining({
      tool: 'security_containment',
      input: {},
      output: { action: 'stop_tool_run', reason: 'authorization_denied' },
    }),
  ]));
  expect(JSON.stringify({ response, saved })).not.toContain('private-');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSavedRuns.length = 0;
  mockDb.collection.mockReturnValue(mockDb);
  mockDb.doc.mockReturnValue(mockDb);
  mockDb.set.mockImplementation(async (value) => {
    mockSavedRuns.push(JSON.parse(JSON.stringify(value)));
  });
  fetchAssistantUserProfile.mockReset().mockResolvedValue({ schoolId: 'school-a', role: 'student' });
  fetchAssistantDailyBrief.mockReset().mockResolvedValue({ summary: 'private-daily-brief' });
  classifyIntent.mockReturnValue({ name: 'general', confidence: 1, source: 'test' });
  getIntentWritePlan.mockReturnValue(null);
  runTool.mockReset().mockImplementation(async (name) => successfulRead(name));
  executeCampusAssistantCore.mockReset().mockResolvedValue({
    content: '今天的校園資訊已整理完成。',
    suggestions: [],
    actions: [],
    citations: [],
    cards: [],
    assistantToolsUsed: [],
    intent: 'general',
    modelTrace: null,
  });
  evaluateAnswer.mockResolvedValue({ score: 1, needsUserReview: false, reason: 'test' });
});

test.each(['permission-denied', 'unauthenticated'])(
  'a pending first prefetch starts no sibling, and %s stops core and evaluation',
  async (code) => {
    const started = deferred();
    const first = deferred();
    runTool.mockImplementationOnce(() => {
      started.resolve();
      return first.promise;
    });
    const pending = runCampusAssistantWithAgentRuntime(request());
    await started.promise;
    // Observe the unresolved read itself; a concurrent fan-out fails here even
    // before its authorization rejection becomes visible to the runtime.
    const dispatchedBeforeDenial = runTool.mock.calls.map(([name]) => name);
    const briefCallsBeforeDenial = fetchAssistantDailyBrief.mock.calls.length;
    first.reject(denial(code));
    const response = await pending;

    expect(dispatchedBeforeDenial).toEqual(['getTodaySchedule']);
    expect(briefCallsBeforeDenial).toBe(0);
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(fetchAssistantDailyBrief).not.toHaveBeenCalled();
    expect(executeCampusAssistantCore).not.toHaveBeenCalled();
    expectContained(response, 'getTodaySchedule');
  },
);

test('an explicit denied receipt stops prefetch without exposing receipt details', async () => {
  runTool.mockResolvedValueOnce({
    success: false,
    errorCode: 'role_denied',
    message: 'private-receipt-detail',
    records: ['private-record'],
  });

  const response = await runCampusAssistantWithAgentRuntime(request());

  expect(runTool).toHaveBeenCalledTimes(1);
  expect(fetchAssistantDailyBrief).not.toHaveBeenCalled();
  expect(executeCampusAssistantCore).not.toHaveBeenCalled();
  expectContained(response, 'getTodaySchedule');
});

test('priority denial stops a configured write plan before inputs are built', async () => {
  const buildInput = jest.fn(() => ({ body: 'private-write-input' }));
  getIntentWritePlan.mockReturnValue({
    toolName: 'proposeOrder',
    requiresConfirmation: false,
    buildInput,
  });
  runTool.mockImplementation(async (name) => {
    if (name === 'getPrioritySummary') throw denial('permission-denied');
    return successfulRead(name);
  });

  const response = await runCampusAssistantWithAgentRuntime(request());

  expect(runTool.mock.calls.map(([name]) => name)).toEqual([
    'getTodaySchedule', 'getAssignments', 'getAnnouncements', 'getPrioritySummary',
  ]);
  expect(buildInput).not.toHaveBeenCalled();
  expect(executeCampusAssistantCore).not.toHaveBeenCalled();
  expectContained(response, 'getPrioritySummary');
});

test('core denial withholds previously collected summaries and core step inputs', async () => {
  executeCampusAssistantCore.mockImplementationOnce(async ({ recordStep }) => {
    await recordStep('core_read', { recordId: 'private-core-input' }, { body: 'private-core-output' }, 1);
    throw denial('unauthenticated');
  });

  const response = await runCampusAssistantWithAgentRuntime(request());

  expect(executeCampusAssistantCore).toHaveBeenCalledTimes(1);
  expectContained(response, 'executeCampusAssistantCore');
  const saved = mockSavedRuns.at(-1);
  for (const tool of ['getPrioritySummary', 'core_read']) {
    expect(saved.steps).toContainEqual(expect.objectContaining({
      tool, input: {}, output: { status: 'withheld' },
    }));
  }
  expect(saved.toolCalls).toEqual(saved.steps);
});

test('an ordinary unavailable reader preserves other sources and continues through evaluation', async () => {
  runTool.mockRejectedValueOnce(Object.assign(new Error('source temporarily offline'), { code: 'unavailable' }));

  const response = await runCampusAssistantWithAgentRuntime(request());

  expect(response.run.status).toBe('completed');
  expect(runTool.mock.calls.map(([name]) => name)).toEqual([
    'getTodaySchedule', 'getAssignments', 'getAnnouncements', 'getPrioritySummary',
  ]);
  expect(fetchAssistantDailyBrief).toHaveBeenCalledTimes(1);
  expect(executeCampusAssistantCore).toHaveBeenCalledWith(expect.objectContaining({
    prefetched: expect.objectContaining({
      assignments: [],
      announcements: [],
      dailyBrief: { summary: 'private-daily-brief' },
    }),
  }));
  expect(evaluateAnswer).toHaveBeenCalledTimes(1);
  expect(mockSavedRuns.at(-1)).toMatchObject({ status: 'completed' });
});

test('containment is scoped to one invocation and a subsequent authorized run succeeds', async () => {
  runTool.mockRejectedValueOnce(denial('permission-denied'));
  const blocked = await runCampusAssistantWithAgentRuntime(request());
  expectContained(blocked, 'getTodaySchedule');

  const recovered = await runCampusAssistantWithAgentRuntime(request());

  expect(recovered.run.status).toBe('completed');
  expect(recovered.content).toBe('今天的校園資訊已整理完成。');
  expect(executeCampusAssistantCore).toHaveBeenCalledTimes(1);
  expect(evaluateAnswer).toHaveBeenCalledTimes(1);
  expect(mockSavedRuns.at(-1).steps).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ tool: 'security_containment' }),
  ]));
});
