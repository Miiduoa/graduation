const { transactionStore } = require('./testSupport/transactionStore');
let mockStore;
jest.mock('firebase-functions/v2/https', () => ({
  ...jest.requireActual('firebase-functions/v2/https'),
  onCall: (_, handler) => handler,
}));
jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: () => mockStore.db,
}));
const aiOrderFood = require('./aiOrderFood');
const data = () => ({
  userId: 'alice',
  schoolId: 'pu',
  cafeteriaId: 'cafe',
  requestId: 'confirmed-intent',
  expectedTotal: 210,
  paymentMethod: 'onsite',
  items: [{ menuItemId: 'rice', name: 'Forged rice', price: 0, quantity: 2 }],
});
const request = (patch = {}) => ({ auth: { uid: 'alice' }, data: { ...data(), ...patch } });
const orderPaths = () =>
  [...mockStore.docs.keys()].filter(
    (path) => path.includes('/orders/') || path.startsWith('orders/'),
  );
beforeEach(() => {
  mockStore = transactionStore([
    ['schools/pu/members/alice', { status: 'active' }],
    [
      'schools/pu/cafeterias/cafe',
      { name: 'Verified café', orderingEnabled: true, pilotStatus: 'live' },
    ],
    ['schools/pu/cafeterias/cafe/operators/operator', { status: 'active' }],
    [
      'schools/pu/menus/rice',
      {
        cafeteriaId: 'cafe',
        name: 'Verified rice',
        price: 100,
        available: true,
        orderingEnabled: true,
      },
    ],
  ]);
});
test('rejects the legacy natural-language payload without making up a key, mapping a vendor, or creating an order', async () => {
  await expect(
    aiOrderFood({
      auth: { uid: 'alice' },
      data: { userId: 'alice', schoolId: 'pu', vendorId: 'cafe', itemId: 'rice', quantity: 2 },
    }),
  ).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(orderPaths()).toEqual([]);
  expect([...mockStore.docs.keys()].some((path) => path.startsWith('_orderRequests/'))).toBe(false);
});
test.each([
  { requestId: undefined },
  { expectedTotal: undefined },
  { cafeteriaId: undefined },
  { items: undefined },
  { expectedTotal: NaN },
])('requires a complete canonical confirmation payload: %j', async (patch) => {
  await expect(aiOrderFood(request(patch))).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(orderPaths()).toEqual([]);
});
test('uses canonical source prices and names, keeping old result aliases tied to the real receipt', async () => {
  const result = await aiOrderFood(request());
  expect(result).toMatchObject({
    success: true,
    id: result.orderId,
    orderNo: result.orderId,
    vendorId: 'cafe',
    vendorName: 'Verified café',
    itemName: 'Verified rice',
    quantity: 2,
    total: 210,
    paymentStatus: 'pending',
    items: [{ menuItemId: 'rice', name: 'Verified rice', price: 100, quantity: 2 }],
  });
  expect(orderPaths()).toHaveLength(2);
  expect([...mockStore.docs.keys()].some((path) => path.startsWith('orders/'))).toBe(false);
});
test('returns the same order on repeat confirmation with the persisted key', async () => {
  const first = await aiOrderFood(request());
  expect(await aiOrderFood(request())).toMatchObject({
    success: true,
    reused: true,
    orderId: first.orderId,
  });
  expect(orderPaths()).toHaveLength(2);
});
test('cannot impersonate another user or create an order without active school membership', async () => {
  await expect(aiOrderFood(request({ userId: 'bob' }))).rejects.toMatchObject({
    code: 'permission-denied',
  });
  mockStore.docs.set('schools/pu/members/alice', { status: 'inactive' });
  await expect(aiOrderFood(request())).rejects.toMatchObject({ code: 'permission-denied' });
  expect(orderPaths()).toEqual([]);
});
test.each(['operator', 'menu-school', 'menu-cafeteria', 'merchant', 'price'])(
  'does not bypass canonical eligibility or price checks: %s',
  async (kind) => {
    if (kind === 'operator') mockStore.docs.delete('schools/pu/cafeterias/cafe/operators/operator');
    if (kind === 'menu-school') mockStore.docs.get('schools/pu/menus/rice').schoolId = 'other';
    if (kind === 'menu-cafeteria')
      mockStore.docs.get('schools/pu/menus/rice').cafeteriaId = 'another';
    if (kind === 'merchant')
      delete mockStore.docs.get('schools/pu/cafeterias/cafe').orderingEnabled;
    if (kind === 'price') mockStore.docs.get('schools/pu/menus/rice').price = 200;
    await expect(aiOrderFood(request())).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { orderOutcome: 'not_created' },
    });
    expect(orderPaths()).toEqual([]);
  },
);
test('does not report success when committing the canonical transaction fails', async () => {
  mockStore.failNextCommit();
  await expect(aiOrderFood(request())).rejects.toThrow('commit unavailable');
  expect(orderPaths()).toEqual([]);
});
