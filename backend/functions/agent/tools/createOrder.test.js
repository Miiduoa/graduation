const { transactionStore } = require('../../testSupport/transactionStore');
let mockStore;
jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: () => mockStore.db,
}));
const tool = require('./createOrder');
const input = () => ({
  requestId: 'intent-1',
  cafeteriaId: 'cafe',
  items: [{ menuItemId: 'rice', name: 'Forged', price: 0, quantity: 2 }],
  expectedTotal: 210,
  paymentMethod: 'onsite',
});
const ctx = { uid: 'alice', schoolId: 'pu' };
beforeEach(() => {
  mockStore = transactionStore([
    ['schools/pu/members/alice', { status: 'active' }],
    [
      'schools/pu/cafeterias/cafe',
      { name: 'Source café', orderingEnabled: true, pilotStatus: 'live' },
    ],
    ['schools/pu/cafeterias/cafe/operators/operator', { status: 'active' }],
    [
      'schools/pu/menus/rice',
      {
        cafeteriaId: 'cafe',
        name: 'Source rice',
        price: 100,
        available: true,
        orderingEnabled: true,
      },
    ],
  ]);
});
test('keeps confirmation required and returns the canonical price instead of user-supplied prices', async () => {
  expect(tool.requiresConfirmation).toBe(true);
  const result = await tool.execute(ctx, { ...input(), schoolId: 'other', userId: 'other' });
  expect(result).toMatchObject({
    success: true,
    userId: 'alice',
    schoolId: 'pu',
    total: 210,
    itemCount: 1,
    items: [{ name: 'Source rice', price: 100, quantity: 2 }],
  });
  expect(mockStore.docs.get(`schools/pu/orders/${result.orderId}`).source).toBe('ai_agent');
});
test('reuses one persisted request instead of adding another order on retry', async () => {
  const first = await tool.execute(ctx, input());
  const second = await tool.execute(ctx, input());
  expect(second).toMatchObject({ success: true, reused: true, orderId: first.orderId });
  expect(
    [...mockStore.docs.keys()].filter((path) => path.startsWith('schools/pu/orders/')),
  ).toHaveLength(1);
});
test('fails an old unkeyed caller before writing', async () => {
  const draft = input();
  delete draft.requestId;
  expect(await tool.execute(ctx, draft)).toMatchObject({
    success: false,
    errorCode: 'invalid_input',
  });
  expect([...mockStore.docs.keys()].some((path) => path.includes('/orders/'))).toBe(false);
});
test('does not bypass school membership or merchant activation', async () => {
  mockStore.docs.set('schools/pu/members/alice', { status: 'inactive' });
  expect(await tool.execute(ctx, input())).toMatchObject({
    success: false,
    errorCode: 'permission-denied',
  });
  mockStore.docs.set('schools/pu/members/alice', { status: 'active' });
  mockStore.docs.get('schools/pu/cafeterias/cafe').pilotStatus = 'pilot';
  expect(await tool.execute(ctx, input())).toMatchObject({
    success: false,
    errorCode: 'failed-precondition',
  });
  expect([...mockStore.docs.keys()].some((path) => path.includes('/orders/'))).toBe(false);
});
test('rejects menu price changes instead of confirming a different total', async () => {
  expect(await tool.execute(ctx, { ...input(), expectedTotal: 1 })).toMatchObject({
    success: false,
    errorCode: 'failed-precondition',
  });
  expect([...mockStore.docs.keys()].some((path) => path.includes('/orders/'))).toBe(false);
});
