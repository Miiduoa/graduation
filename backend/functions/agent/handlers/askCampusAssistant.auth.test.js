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
jest.mock('../cloudNavigationTask', () => ({
  handleCloudNavigationTask: jest.fn(async () => ({ phase: 'preview' })),
}));

const askCampusAssistant = require('./askCampusAssistant');
const { runCampusAssistantWithAgentRuntime } = require('../runtime');
const { handleCloudNavigationTask } = require('../cloudNavigationTask');

describe('askCampusAssistant Fly HTTP admission', () => {
  beforeEach(() => {
    mockGet.mockReset().mockResolvedValue({ exists: false, data: () => ({}) });
    mockCollection.mockClear();
    runCampusAssistantWithAgentRuntime.mockClear();
    handleCloudNavigationTask.mockClear();
  });

  test('rejects unauthenticated callers before the runtime', async () => {
    await expect(askCampusAssistant({ data: { messages: [] } })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(mockCollection).not.toHaveBeenCalled();
    expect(runCampusAssistantWithAgentRuntime).not.toHaveBeenCalled();
    expect(handleCloudNavigationTask).not.toHaveBeenCalled();
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
    expect(handleCloudNavigationTask).not.toHaveBeenCalled();
  });

  test('authenticates before checking oversized messages', async () => {
    const huge = 'x'.repeat(MAX_TOTAL_UTF8_BYTES + 1);
    await expect(
      askCampusAssistant({ data: { messages: [{ role: 'user', content: huge }] } }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mockCollection).not.toHaveBeenCalled();
    expect(runCampusAssistantWithAgentRuntime).not.toHaveBeenCalled();
    expect(handleCloudNavigationTask).not.toHaveBeenCalled();
  });

  test('still rejects closing accounts after valid input', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ accountDeletionInProgress: true }),
    });
    await expect(
      askCampusAssistant({
        auth: { uid: 'alice' },
        data: { task: 'public-campus-navigation', phase: 'preview' },
      }),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'account-deletion' },
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(runCampusAssistantWithAgentRuntime).not.toHaveBeenCalled();
    expect(handleCloudNavigationTask).not.toHaveBeenCalled();
  });

  test.each(['preview', 'execute'])('delegates %s requests after checking the account', async (phase) => {
    const request = {
      auth: { uid: 'alice' },
      data: { task: 'public-campus-navigation', phase },
    };
    await expect(askCampusAssistant(request)).resolves.toEqual({ phase: 'preview' });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(handleCloudNavigationTask).toHaveBeenCalledTimes(1);
    expect(handleCloudNavigationTask).toHaveBeenCalledWith(request);
    expect(runCampusAssistantWithAgentRuntime).not.toHaveBeenCalled();
  });

  test.each([
    undefined,
    { messages: [{ role: 'user', content: '查課表' }] },
    { messages: [], consent: true },
    { task: 'public-campus-navigation ', phase: 'preview' },
    { task: 'other-task', phase: 'execute' },
  ])('rejects legacy or unknown requests before any task or runtime executes: %p', async (data) => {
    await expect(askCampusAssistant({ auth: { uid: 'alice' }, data })).rejects.toMatchObject({
      code: 'failed-precondition',
      message: '請先預覽並確認要傳送的公開地點資料。',
      details: { reason: 'cloud-consent-required' },
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(runCampusAssistantWithAgentRuntime).not.toHaveBeenCalled();
    expect(handleCloudNavigationTask).not.toHaveBeenCalled();
  });

  test('preserves the task service rejection without falling back to the legacy runtime', async () => {
    const { HttpsError } = require('firebase-functions/v2/https');
    const failure = new HttpsError('failed-precondition', '請先確認這份預覽。');
    handleCloudNavigationTask.mockRejectedValueOnce(failure);
    await expect(askCampusAssistant({
      auth: { uid: 'alice' },
      data: { task: 'public-campus-navigation', phase: 'execute' },
    })).rejects.toBe(failure);
    expect(runCampusAssistantWithAgentRuntime).not.toHaveBeenCalled();
  });
});
