jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: jest.fn(),
}));
jest.mock('./agent/runtime', () => ({ runCampusAssistantWithAgentRuntime: jest.fn() }));
jest.mock('./agent/cloudNavigationTask', () => ({ handleCloudNavigationTask: jest.fn() }));
const { getFirestore } = require('firebase-admin/firestore');
const { runCampusAssistantWithAgentRuntime } = require('./agent/runtime');
const { handleCloudNavigationTask } = require('./agent/cloudNavigationTask');
const get = jest.fn();
const db = { collection: jest.fn(() => ({ doc: () => ({ get }) })) };
getFirestore.mockReturnValue(db);
const callables = [
  ['assistant', require('./agent/handlers/askCampusAssistant')],
  ['confirmed assistant write', require('./agent/handlers/executeAgentWrite')],
  ['food order', require('./aiOrderFood')],
  ['queue number', require('./ordering/queueNumber').assignQueueNumber],
  ['pickup confirmation', require('./ordering/pickupCode').verifyPickupCode],
];

beforeEach(() => jest.clearAllMocks());
test.each(callables)(
  '%s rejects a deleted account before its handler reads or writes anything',
  async (_, callable) => {
    get.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'deleted', accountDeletionInProgress: true }),
    });
    await expect(
      callable.run({ auth: { uid: 'alice' }, data: { context: { schoolId: 'pu' } } }),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'account-deletion' },
    });
    expect(db.collection.mock.calls).toEqual([['users']]);
    expect(runCampusAssistantWithAgentRuntime).not.toHaveBeenCalled();
    expect(handleCloudNavigationTask).not.toHaveBeenCalled();
  },
);
test('active accounts reach only the public navigation service', async () => {
  get.mockResolvedValue({ exists: true, data: () => ({}) });
  handleCloudNavigationTask.mockResolvedValue({ phase: 'preview' });
  const request = {
    auth: { uid: 'alice' },
    data: { task: 'public-campus-navigation', phase: 'preview' },
  };
  expect(await callables[0][1].run(request)).toEqual({ phase: 'preview' });
  expect(handleCloudNavigationTask).toHaveBeenCalledWith(request);
  expect(runCampusAssistantWithAgentRuntime).not.toHaveBeenCalled();
});
test('active accounts cannot enter the old assistant runtime with a legacy question', async () => {
  get.mockResolvedValue({ exists: true, data: () => ({}) });
  await expect(callables[0][1].run({
    auth: { uid: 'alice' },
    data: { question: '課表' },
  })).rejects.toMatchObject({
    code: 'failed-precondition',
    details: { reason: 'cloud-consent-required' },
  });
  expect(runCampusAssistantWithAgentRuntime).not.toHaveBeenCalled();
  expect(handleCloudNavigationTask).not.toHaveBeenCalled();
});
