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

const seed = () => [
  ['users/alice', { schoolId: 'pu', role: 'student' }],
  ['schools/pu/members/alice', { status: 'active', role: 'student' }],
  ['schools/pu/cafeterias/cafe', { name: '校園餐廳', orderingEnabled: true, pilotStatus: 'live' }],
  ['schools/pu/cafeterias/cafe/operators/operator', { status: 'active' }],
  ['schools/pu/menus/rice', { cafeteriaId: 'cafe', name: '雞腿飯', price: 100, available: true, orderingEnabled: true }],
  ['schools/pu/cafeterias/cafe/menuItems/rice', { name: '雞腿飯', price: 100, available: true }],
];
mockStore = transactionStore(seed());

const { isOnlineOrderingEnabled, isOrderAssistantAction } = require('./lib/onlineOrdering');
const { createOrderHandler } = require('./createOrder');
const aiOrderFood = require('./aiOrderFood');
const executeAgentWrite = require('./agent/handlers/executeAgentWrite');
const { assignQueueNumberHandler } = require('./ordering/queueNumber');
const createOrderTool = require('./agent/tools/createOrder');
const proposeOrderTool = require('./agent/tools/proposeOrder');

const orderData = {
  schoolId: 'pu',
  cafeteriaId: 'cafe',
  requestId: 'attempt-1',
  items: [{ menuItemId: 'rice', quantity: 1 }],
  expectedTotal: 100,
  paymentMethod: 'onsite',
};
const writtenOrders = () =>
  [...mockStore.docs.keys()].filter(
    (path) =>
      path.includes('/orders/') ||
      path.startsWith('orders/') ||
      path.startsWith('_orderRequests/') ||
      path.includes('/queueCounters/'),
  );

describe('online ordering switch', () => {
  const saved = process.env.ONLINE_ORDERING_ENABLED;
  afterEach(() => {
    if (saved === undefined) delete process.env.ONLINE_ORDERING_ENABLED;
    else process.env.ONLINE_ORDERING_ENABLED = saved;
  });

  test('is off in production unless explicitly turned on; on by default in emulator and tests', () => {
    expect(isOnlineOrderingEnabled({})).toBe(false);
    expect(isOnlineOrderingEnabled({ GCLOUD_PROJECT: 'campus-one-tw' })).toBe(false);
    expect(isOnlineOrderingEnabled({ ONLINE_ORDERING_ENABLED: 'false', FUNCTIONS_EMULATOR: 'true' })).toBe(false);
    expect(isOnlineOrderingEnabled({ ONLINE_ORDERING_ENABLED: 'true' })).toBe(true);
    expect(isOnlineOrderingEnabled({ FUNCTIONS_EMULATOR: 'true' })).toBe(true);
    expect(isOnlineOrderingEnabled({ JEST_WORKER_ID: '1' })).toBe(true);
  });

  describe('when off, a plain student cannot create an order or a number through any callable', () => {
    beforeEach(() => {
      process.env.ONLINE_ORDERING_ENABLED = 'false';
      mockStore = transactionStore(seed());
    });
    const offError = { code: 'failed-precondition', message: '目前還不能線上點餐', details: { orderOutcome: 'not_created', reason: 'online_ordering_off' } };

    test('createOrder', async () => {
      await expect(createOrderHandler({ db: mockStore.db })({ auth: { uid: 'alice' }, data: orderData })).rejects.toMatchObject(offError);
      expect(writtenOrders()).toEqual([]);
    });

    test('aiOrderFood', async () => {
      await expect(aiOrderFood({ auth: { uid: 'alice' }, data: { ...orderData, userId: 'alice' } })).rejects.toMatchObject(offError);
      expect(writtenOrders()).toEqual([]);
    });

    test('executeAgentWrite with createOrder', async () => {
      await expect(executeAgentWrite({ auth: { uid: 'alice' }, data: { toolName: 'createOrder', input: orderData } })).rejects.toMatchObject(offError);
      expect(writtenOrders()).toEqual([]);
    });

    test('assistant tools: createOrder fails and proposeOrder makes no draft', async () => {
      const created = await createOrderTool.execute({ uid: 'alice', schoolId: 'pu' }, orderData);
      expect(created).toMatchObject({ success: false, errorMessage: '目前還不能線上點餐', orderOutcome: 'not_created' });
      const proposed = await proposeOrderTool.execute({ uid: 'alice', schoolId: 'pu' }, { cafeteriaId: 'cafe', items: [{ menuItemId: 'rice', quantity: 1 }] });
      expect(proposed).toMatchObject({ success: false, errorCode: 'online_ordering_off' });
      expect(writtenOrders()).toEqual([]);
    });

    test('assignQueueNumber, even for an order that already exists', async () => {
      mockStore.docs.set('schools/pu/orders/o1', { userId: 'alice', cafeteriaId: 'cafe', status: 'pending' });
      await expect(assignQueueNumberHandler({ db: mockStore.db })({ auth: { uid: 'alice' }, data: { schoolId: 'pu', orderId: 'o1' } })).rejects.toMatchObject(offError);
      await expect(assignQueueNumberHandler({ db: mockStore.db })({ auth: { uid: 'operator' }, data: { schoolId: 'pu', orderId: 'o1', as: 'merchant' } })).rejects.toMatchObject(offError);
      expect(mockStore.docs.get('schools/pu/orders/o1').queueNumber).toBeUndefined();
      expect(writtenOrders()).toEqual(['schools/pu/orders/o1']);
    });

    test('enqueueAssistantAction treats queued order actions as orders', () => {
      expect(isOrderAssistantAction({ action: 'queue_action', params: { toolName: 'createOrder', input: orderData } })).toBe(true);
      expect(isOrderAssistantAction({ action: 'queue_action', params: { toolName: 'proposeOrder' } })).toBe(true);
      expect(isOrderAssistantAction({ action: 'queue_action', params: { toolName: 'reserveWashingMachine' } })).toBe(false);
      expect(isOrderAssistantAction({ action: 'navigate', params: {} })).toBe(false);
    });

    test('signed-out callers still get the sign-in error first', async () => {
      await expect(createOrderHandler({ db: mockStore.db })({ data: orderData })).rejects.toMatchObject({ code: 'unauthenticated' });
    });
  });
});
