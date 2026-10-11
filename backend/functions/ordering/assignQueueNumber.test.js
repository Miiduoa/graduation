'use strict';

const { transactionStore } = require('../testSupport/transactionStore');
const { assignQueueNumberHandler, assignNumberForOrder } = require('./queueNumber');

const NOW = new Date('2026-10-13T12:05:00+08:00');
const counterPath = 'schools/pu/queueCounters/cafe__tpe__2026-10-13';
const order = (id, extra = {}) => [
  `schools/pu/orders/${id}`,
  {
    schemaVersion: 2,
    orderId: id,
    userId: 'alice',
    schoolId: 'pu',
    cafeteriaId: 'cafe',
    merchantId: 'cafe',
    status: 'pending',
    queueNumber: null,
    queueStatus: 'pending_confirmation',
    items: [{ name: '雞腿飯', quantity: 1, price: 90 }],
    ...extra,
  },
];

describe('assignQueueNumber 綁訂單發號', () => {
  let store;
  let call;
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    store = transactionStore([
      order('o1'),
      order('o2', { userId: 'bob' }),
      order('o-other', { userId: 'carol', cafeteriaId: 'other', merchantId: 'other' }),
      ['schools/pu/cafeterias/cafe/operators/cafe-staff', { status: 'active' }],
      ['schools/pu/cafeterias/cafe/operators/gone-staff', { status: 'inactive' }],
      ['schools/pu/cafeterias/other/operators/other-staff', { status: 'active' }],
    ]);
    const handler = assignQueueNumberHandler({ db: store.db });
    call = (uid, data) => handler({ auth: uid ? { uid } : undefined, data: { schoolId: 'pu', ...data } });
  });
  afterEach(() => jest.useRealTimers());
  const counter = () => store.docs.get(counterPath)?.nextSerial ?? 0;

  test('沒帶 orderId：擋下，不發號', async () => {
    await expect(call('alice', { vendorId: 'cafe' })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(counter()).toBe(0);
  });

  test('沒登入：擋下', async () => {
    await expect(call(null, { orderId: 'o1' })).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  test('下單的學生本人拿號，號碼寫在訂單和學生自己的副本上', async () => {
    const result = await call('alice', { orderId: 'o1', vendorId: 'cafe' });
    expect(result).toMatchObject({ ok: true, serial: 1, queueNumber: 1, queueStatus: 'assigned', reused: false });
    expect(store.docs.get('schools/pu/orders/o1')).toMatchObject({ queueNumber: 1, queueStatus: 'assigned', queueAssignedBy: 'customer', status: 'pending' });
    expect(store.docs.get('users/alice/schools/pu/orders/o1')).toMatchObject({ queueNumber: 1, queueStatus: 'assigned' });
    expect(counter()).toBe(1);
  });

  test('同一筆訂單重複呼叫：回同一個號碼，不多發', async () => {
    await call('alice', { orderId: 'o1' });
    const again = await call('alice', { orderId: 'o1' });
    const byMerchant = await call('cafe-staff', { orderId: 'o1', as: 'merchant' });
    expect(again).toMatchObject({ queueNumber: 1, reused: true });
    expect(byMerchant).toMatchObject({ queueNumber: 1, reused: true });
    expect(counter()).toBe(1);
    const next = await call('bob', { orderId: 'o2' });
    expect(next.queueNumber).toBe(2);
  });

  test('無關的學生：不能幫別人的訂單拿號', async () => {
    await expect(call('bob', { orderId: 'o1' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(store.docs.get('schools/pu/orders/o1').queueNumber).toBeNull();
    expect(counter()).toBe(0);
  });

  test('別家店的店員：不能給這家店的訂單號碼', async () => {
    await expect(call('other-staff', { orderId: 'o1', as: 'merchant' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(call('other-staff', { orderId: 'o1', vendorId: 'other' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(counter()).toBe(0);
  });

  test('已停用的店員：不能給號碼', async () => {
    await expect(call('gone-staff', { orderId: 'o1', as: 'merchant' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(counter()).toBe(0);
  });

  test('vendorId 和訂單的店對不上：擋下', async () => {
    await expect(call('alice', { orderId: 'o1', vendorId: 'other' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(counter()).toBe(0);
  });

  test('店家按「給號碼」：拿到真的號碼，待接單的訂單一併接單，不卡在待接單', async () => {
    const result = await call('cafe-staff', { orderId: 'o1', as: 'merchant' });
    expect(result).toMatchObject({ queueNumber: 1, status: 'confirmed' });
    expect(store.docs.get('schools/pu/orders/o1')).toMatchObject({ queueNumber: 1, queueStatus: 'assigned', queueAssignedBy: 'merchant', status: 'confirmed' });
    expect(store.docs.get('users/alice/schools/pu/orders/o1')).toMatchObject({ queueNumber: 1, status: 'confirmed' });
  });

  test('店家給號碼和學生自己拿號共用同一個計數器', async () => {
    await call('alice', { orderId: 'o1' });
    store.docs.set(...order('o3', { userId: 'dave' }));
    const result = await call('cafe-staff', { orderId: 'o3', as: 'merchant' });
    expect(result.queueNumber).toBe(2);
    expect(counter()).toBe(2);
  });

  test('已取消的訂單：不發號', async () => {
    store.docs.set(...order('o4', { status: 'cancelled' }));
    await expect(call('cafe-staff', { orderId: 'o4', as: 'merchant' })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(counter()).toBe(0);
  });

  test('系統建單後拿號接著舊 UTC 鍵今天已發的號碼', async () => {
    store.docs.set('schools/pu/queueCounters/cafe__2026-10-13', { vendorId: 'cafe', date: '2026-10-13', nextSerial: 7, updatedAt: new Date('2026-10-13T10:00:00+08:00') });
    const result = await assignNumberForOrder(store.db, { schoolId: 'pu', orderId: 'o1', actor: 'system', now: NOW });
    expect(result.queueNumber).toBe(8);
  });
});
