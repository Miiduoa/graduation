jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: jest.fn(),
}));
jest.mock('./agent/runtime', () => ({ runCampusAssistantWithAgentRuntime: jest.fn() }));
const { getFirestore } = require('firebase-admin/firestore');
const { runCampusAssistantWithAgentRuntime } = require('./agent/runtime');
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
  },
);
test('active accounts still reach the assistant runtime', async () => {
  get.mockResolvedValue({ exists: true, data: () => ({}) });
  runCampusAssistantWithAgentRuntime.mockResolvedValue({ text: 'reply' });
  const request = { auth: { uid: 'alice' }, data: { question: '課表' } };
  expect(await callables[0][1].run(request)).toEqual({ text: 'reply' });
  expect(runCampusAssistantWithAgentRuntime).toHaveBeenCalledWith(request);
});
