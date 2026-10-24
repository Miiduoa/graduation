'use strict';

const { transactionStore } = require('../../testSupport/transactionStore');
const { MAX_ARRAY_ITEMS } = require('../inputLimits');

let mockStore;
jest.mock('firebase-functions/v2/https', () => ({
  ...jest.requireActual('firebase-functions/v2/https'),
  onCall: (_, handler) => handler,
}));
jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: () => mockStore.db,
}));

mockStore = transactionStore([
  ['users/alice', { schoolId: 'pu', role: 'student' }],
  ['schools/pu/members/alice', { status: 'active', role: 'student' }],
]);

const executeAgentWrite = require('./executeAgentWrite');
const { byName } = require('../tools/registry');

describe('executeAgentWrite input bounds', () => {
  beforeEach(() => {
    mockStore = transactionStore([
      ['users/alice', { schoolId: 'pu', role: 'student' }],
      ['schools/pu/members/alice', { status: 'active', role: 'student' }],
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('preserves resource-exhausted for oversized quiz answers without calling execute', async () => {
    const tool = byName.get('submitQuizAttempt');
    const parseSpy = jest.spyOn(tool.inputSchema, 'parse');
    const executeSpy = jest.spyOn(tool, 'execute');

    const answers = Array.from({ length: MAX_ARRAY_ITEMS + 1 }, (_, index) => ({
      questionId: `q${index}`,
      value: 'x',
    }));

    await expect(
      executeAgentWrite({
        auth: { uid: 'alice' },
        data: {
          toolName: 'submitQuizAttempt',
          input: { quizId: 'quiz', courseSpaceId: 'course', answers },
        },
      }),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });

    expect(parseSpy).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  test('still rejects unauthenticated callers before tool execution', async () => {
    const tool = byName.get('submitQuizAttempt');
    const executeSpy = jest.spyOn(tool, 'execute');

    await expect(
      executeAgentWrite({
        data: {
          toolName: 'submitQuizAttempt',
          input: { quizId: 'quiz', courseSpaceId: 'course', answers: [] },
        },
      }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });

    expect(executeSpy).not.toHaveBeenCalled();
  });
});
