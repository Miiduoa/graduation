'use strict';

const { MAX_TOTAL_UTF8_BYTES } = require('../inputLimits');
const mockGet = jest.fn();
const mockCollection = jest.fn(() => ({ doc: () => ({ get: mockGet }) }));

jest.mock('firebase-functions/v2/https', () => ({
  ...jest.requireActual('firebase-functions/v2/https'),
  onCall: (_, handler) => handler,
}));
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: mockCollection }),
}));
jest.mock('../runtime', () => ({
  runCampusAssistantWithAgentRuntime: jest.fn(async () => ({ ok: true })),
}));

const askCampusAssistant = require('./askCampusAssistant');
const { runCampusAssistantWithAgentRuntime } = require('../runtime');

describe('askCampusAssistant Fly HTTP admission', () => {
  beforeEach(() => {
    mockGet.mockReset().mockResolvedValue({ exists: false, data: () => ({}) });
    mockCollection.mockClear();
    runCampusAssistantWithAgentRuntime.mockClear();
  });

  test('rejects unauthenticated callers before the runtime', async () => {
    await expect(askCampusAssistant({ data: { messages: [] } })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(mockCollection).not.toHaveBeenCalled();
    expect(runCampusAssistantWithAgentRuntime).not.toHaveBeenCalled();
  });

  test('rejects oversized messages before any account read or runtime call', async () => {
    const huge = '中'.repeat(Math.ceil(MAX_TOTAL_UTF8_BYTES / 3) + 8);
    await expect(
      askCampusAssistant({
        auth: { uid: 'alice' },
        data: { messages: [{ role: 'user', content: huge }] },
      }),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(mockCollection).not.toHaveBeenCalled();
    expect(runCampusAssistantWithAgentRuntime).not.toHaveBeenCalled();
  });

  test('authenticates before checking oversized messages', async () => {
    const huge = 'x'.repeat(MAX_TOTAL_UTF8_BYTES + 1);
    await expect(
      askCampusAssistant({ data: { messages: [{ role: 'user', content: huge }] } }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mockCollection).not.toHaveBeenCalled();
    expect(runCampusAssistantWithAgentRuntime).not.toHaveBeenCalled();
  });

  test('still rejects closing accounts after valid input', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ accountDeletionInProgress: true }),
    });
    await expect(
      askCampusAssistant({ auth: { uid: 'alice' }, data: { messages: [] } }),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'account-deletion' },
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(runCampusAssistantWithAgentRuntime).not.toHaveBeenCalled();
  });

  test('runs valid requests after checking the account', async () => {
    const request = { auth: { uid: 'alice' }, data: { messages: [] } };
    await expect(askCampusAssistant(request)).resolves.toEqual({ ok: true });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(runCampusAssistantWithAgentRuntime).toHaveBeenCalledWith(request);
  });
});
