'use strict';

const { MAX_TOTAL_UTF8_BYTES } = require('../inputLimits');

jest.mock('firebase-functions/v2/https', () => ({
  ...jest.requireActual('firebase-functions/v2/https'),
  onCall: (_, handler) => handler,
}));
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: false, data: () => ({}) }),
      }),
    }),
  }),
}));
jest.mock('../runtime', () => ({
  runCampusAssistantWithAgentRuntime: jest.fn(async () => ({ ok: true })),
}));

const askCampusAssistant = require('./askCampusAssistant');
const { runCampusAssistantWithAgentRuntime } = require('../runtime');

describe('askCampusAssistant Fly HTTP admission', () => {
  beforeEach(() => {
    runCampusAssistantWithAgentRuntime.mockClear();
  });

  test('rejects unauthenticated callers before the runtime', async () => {
    await expect(askCampusAssistant({ data: { messages: [] } })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(runCampusAssistantWithAgentRuntime).not.toHaveBeenCalled();
  });

  test('rejects oversized messages before the runtime', async () => {
    const huge = '中'.repeat(Math.ceil(MAX_TOTAL_UTF8_BYTES / 3) + 8);
    await expect(
      askCampusAssistant({
        auth: { uid: 'alice' },
        data: { messages: [{ role: 'user', content: huge }] },
      }),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(runCampusAssistantWithAgentRuntime).not.toHaveBeenCalled();
  });
});
