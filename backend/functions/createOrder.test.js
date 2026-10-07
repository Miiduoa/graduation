const nodeCrypto = require('node:crypto');
const { createOrderHandler } = require('./createOrder');
const { transactionStore } = require('./testSupport/transactionStore');

describe('canonical priced idempotent orders', () => {
  let store;
  let createOrder;
  const request = (data = {}, uid = 'alice') => ({
    auth: { uid },
    data: {
      schoolId: 'pu',
      cafeteriaId: 'cafe',
      requestId: 'attempt-1',
      items: [{ menuItemId: 'rice', quantity: 2 }],
      paymentMethod: 'onsite',
      expectedTotal: 210,
      ...data,
    },
  });
  const paths = () =>
    [...store.docs.keys()].filter(
      (path) => path.includes('/orders/') || path.startsWith('_orderRequests/'),
    );
  beforeEach(() => {
    store = transactionStore([
      ['schools/pu/members/alice', { status: 'active' }],
      ['schools/pu/members/bob', { status: 'active' }],
      [
        'schools/pu/cafeterias/cafe',
        { name: '校園餐廳', merchantId: 'merchant-1', orderingEnabled: true, pilotStatus: 'live' },
      ],
      ['schools/pu/cafeterias/cafe/operators/operator', { status: 'active' }],
      [
        'schools/pu/menus/rice',
        {
          cafeteriaId: 'cafe',
          name: '店家餐點',
          price: 100,
          available: true,
          orderingEnabled: true,
        },
      ],
    ]);
    createOrder = createOrderHandler({ db: store.db });
  });
  test('ignores forged client prices, names and merchant identities and stores matching server receipts', async () => {
    const result = await createOrder(
      request({
        merchantId: 'attacker',
        cafeteria: '偽造店名',
        items: [{ menuItemId: 'rice', quantity: 2, price: -999, name: '假餐點' }],
      }),
    );
    const id = 'co_' + nodeCrypto.createHash('sha256').update('alice\u0000attempt-1').digest('hex');
    expect(result).toMatchObject({
      success: true,
      orderId: id,
      requestId: 'attempt-1',
      userId: 'alice',
      schoolId: 'pu',
      cafeteriaId: 'cafe',
      merchantId: 'merchant-1',
      cafeteria: '校園餐廳',
      subtotal: 200,
      tax: 10,
      total: 210,
      currency: 'TWD',
      status: 'pending',
      paymentStatus: 'pending',
      paymentMethod: 'onsite',
      items: [{ menuItemId: 'rice', name: '店家餐點', price: 100, quantity: 2, amount: 200 }],
    });
    const canonical = store.docs.get(`schools/pu/orders/${id}`);
    expect(store.docs.get(`users/alice/schools/pu/orders/${id}`)).toEqual(canonical);
    expect(canonical.requestId).toBe('attempt-1');
    expect(paths()).toHaveLength(3);
  });
  test('fresh sessions repeat the same request as the original receipt even if the merchant closes or menu changes later', async () => {
    const first = await createOrder(request());
    store.docs.get('schools/pu/menus/rice').price = 300;
    store.docs.get('schools/pu/cafeterias/cafe').orderingEnabled = false;
    createOrder = createOrderHandler({ db: store.db });
    expect(await createOrder(request())).toEqual({ ...first, reused: true });
    expect(paths()).toHaveLength(3);
  });
  test('identical request IDs are isolated by UID and cannot return another user receipt', async () => {
    const alice = await createOrder(request());
    const bob = await createOrder(request({}, 'bob'));
    expect(alice.orderId).not.toBe(bob.orderId);
    expect(bob.userId).toBe('bob');
    expect(paths()).toHaveLength(6);
  });
  test.each([
    { items: [{ menuItemId: 'rice', quantity: 1 }], expectedTotal: 105 },
    { paymentMethod: 'campus_card' },
    { note: 'changed' },
    { expectedTotal: 211 },
  ])('does not reuse an existing key for changed intent %j', async (change) => {
    await createOrder(request());
    await expect(createOrder(request(change))).rejects.toMatchObject({ code: 'already-exists' });
    expect(paths()).toHaveLength(3);
  });
  test('a reused key cannot create another order by switching schools', async () => {
    await createOrder(request());
    store.docs.set('schools/nthu/members/alice', { status: 'active' });
    await expect(createOrder(request({ schoolId: 'nthu' }))).rejects.toMatchObject({
      code: 'already-exists',
    });
    expect(paths()).toHaveLength(3);
  });
  test.each([
    { requestId: undefined },
    { items: [{ menuItemId: '../rice', quantity: 1 }] },
    { items: [{ menuItemId: 'rice', quantity: -1 }] },
    { items: [{ menuItemId: 'rice', quantity: 0.5 }] },
    { items: [{ menuItemId: 'rice', quantity: '2' }] },
    { expectedTotal: NaN },
    { requestId: 'a/b' },
  ])('rejects malformed intent without writes %j', async (change) => {
    await expect(createOrder(request(change))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(paths()).toHaveLength(0);
  });
  test('supports the old menu id and orderId aliases but never uses the old client price', async () => {
    const result = await createOrder(
      request({
        requestId: undefined,
        orderId: 'old-client-id',
        items: [{ id: 'rice', quantity: 2, price: 1 }],
      }),
    );
    expect(result.requestId).toBe('old-client-id');
    expect(result.total).toBe(210);
  });
  test('requires authentication and explicit active school membership', async () => {
    await expect(createOrder({ data: request().data })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    store.docs.get('schools/pu/members/alice').status = 'inactive';
    await expect(createOrder(request())).rejects.toMatchObject({ code: 'permission-denied' });
    expect(paths()).toHaveLength(0);
  });
  test.each([
    { orderingEnabled: false },
    { orderingEnabled: undefined },
    { pilotStatus: 'pilot' },
    { schoolId: 'nthu' },
  ])('rejects unavailable or wrong-school merchant configuration %j', async (config) => {
    Object.assign(store.docs.get('schools/pu/cafeterias/cafe'), config);
    await expect(createOrder(request())).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(paths().filter((path) => path.includes('/orders/'))).toHaveLength(0);
  });
  test('rejects a merchant without an active operator', async () => {
    store.docs.get('schools/pu/cafeterias/cafe/operators/operator').status = 'inactive';
    await expect(createOrder(request())).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(paths().filter((path) => path.includes('/orders/'))).toHaveLength(0);
  });
  test.each([
    { available: false },
    { available: undefined },
    { orderingEnabled: false },
    { orderingEnabled: undefined },
    { soldOut: true },
    { cafeteriaId: 'other' },
    { schoolId: 'nthu' },
    { price: -1 },
    { price: '100' },
    { price: Infinity },
    { price: 0.123 },
  ])('rejects untrusted or unavailable menu data %j', async (menu) => {
    Object.assign(store.docs.get('schools/pu/menus/rice'), menu);
    await expect(createOrder(request())).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(paths().filter((path) => path.includes('/orders/'))).toHaveLength(0);
  });
  test('a canonical menu record takes precedence over the legacy school menu', async () => {
    store.docs.set('schools/pu/cafeteriaMenus/rice', {
      ...store.docs.get('schools/pu/menus/rice'),
      price: 1,
    });
    expect((await createOrder(request())).total).toBe(210);
  });
  test('reads only same-school fallback menu documents when the canonical item is absent', async () => {
    store.docs.set('schools/pu/cafeteriaMenus/rice', store.docs.get('schools/pu/menus/rice'));
    store.docs.delete('schools/pu/menus/rice');
    expect((await createOrder(request())).total).toBe(210);
  });
  test('does not establish an order when the server price differs from the price the user confirmed', async () => {
    store.docs.get('schools/pu/menus/rice').price = 101;
    await expect(createOrder(request())).rejects.toMatchObject({
      code: 'failed-precondition',
      message: '菜單或金額已變更，請重新確認',
    });
    expect(paths().filter((path) => path.includes('/orders/'))).toHaveLength(0);
  });
  test('failed commits leave no canonical order, user receipt or consumed request key', async () => {
    store.failNextCommit();
    await expect(createOrder(request())).rejects.toThrow('commit unavailable');
    expect(paths()).toHaveLength(0);
    expect((await createOrder(request())).reused).toBe(false);
    expect(paths()).toHaveLength(3);
  });
  test.each([{ total: 1 }, { items: [] }, { merchantId: 'other' }, { requestId: 'other' }])(
    'rejects a changed immutable receipt on replay without claiming no order exists %j',
    async (change) => {
      const result = await createOrder(request());
      Object.assign(store.docs.get(`schools/pu/orders/${result.orderId}`), change);
      await expect(createOrder(request())).rejects.toMatchObject({
        code: 'failed-precondition',
        details: undefined,
      });
      expect(paths()).toHaveLength(3);
    },
  );
  test('returns actual operational status and repairs the mirror from the protected canonical receipt', async () => {
    const result = await createOrder(request());
    store.docs.get(`schools/pu/orders/${result.orderId}`).status = 'preparing';
    store.docs.get(`users/alice/schools/pu/orders/${result.orderId}`).total = 1;
    expect(await createOrder(request())).toMatchObject({
      total: 210,
      status: 'preparing',
      reused: true,
    });
    expect(store.docs.get(`users/alice/schools/pu/orders/${result.orderId}`).total).toBe(210);
  });
  test('durably marks a definitive rejection without creating an order, so concurrent retries cannot reverse its outcome', async () => {
    store.docs.get('schools/pu/menus/rice').available = false;
    await expect(createOrder(request())).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { orderOutcome: 'not_created' },
    });
    expect(paths()).toHaveLength(1);
    expect(store.docs.get(paths()[0]).outcome).toBe('rejected');
    store.docs.get('schools/pu/menus/rice').available = true;
    await expect(createOrder(request())).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { orderOutcome: 'not_created' },
    });
    expect(paths()).toHaveLength(1);
    expect((await createOrder(request({ requestId: 'reviewed-again' }))).success).toBe(true);
  });
  test('a missing original order remains unknown and does not permit a replacement request', async () => {
    const result = await createOrder(request());
    store.docs.delete(`schools/pu/orders/${result.orderId}`);
    await expect(createOrder(request())).rejects.toMatchObject({
      code: 'failed-precondition',
      details: undefined,
    });
  });
  test('rejects a captured account A payload authenticated as account B before any writes', async () => {
    await expect(createOrder(request({ userId: 'alice' }, 'bob'))).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(paths()).toHaveLength(0);
  });
  test('failed rejection commits are unknown and never tell clients to discard the original request key', async () => {
    store.docs.get('schools/pu/menus/rice').available = false;
    store.failNextCommit();
    await expect(createOrder(request())).rejects.toThrow('commit unavailable');
    expect(paths()).toHaveLength(0);
  });
});
