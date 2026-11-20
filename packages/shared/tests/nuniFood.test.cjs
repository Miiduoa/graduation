/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, structuredClone */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const original = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  module._compile(source, filename);
};
const food = require('../src/nuniFood.ts');
require.extensions['.ts'] = original;

const key = 'test-request-0001';
const at = '2026-10-13T04:00:00.000Z';
const money = (amountMinor = 120) => ({ amountMinor, currency: 'TWD' });
const command = (state = 'paid') => ({ orderId: 'order-1', state, updatedAt: at, replayed: false });
test('keeps whole TWD and caller idempotency key for counter collection', async () => {
  const calls = [];
  const client = food.createNuniFoodClient(async (...args) => {
    calls.push(args);
    return command();
  });
  assert.equal(
    (
      await client.recordCounterPayment('campus-one', 'location-1', 'order-1', {
        idempotencyKey: key,
      })
    ).state,
    'paid',
  );
  assert.deepEqual(calls, [
    [
      'merchant-workspaces/campus-one/location-1/orders/order-1/counter-payment',
      { idempotencyKey: key },
    ],
  ]);
  assert.deepEqual(food.parseNuniFoodMoney(money()), money());
});
test('refuses display code as pickup token before calling transport', async () => {
  let count = 0;
  const client = food.createNuniFoodClient(async () => {
    count++;
    return command('fulfilled');
  });
  await assert.rejects(
    client.fulfillOrder('campus-one', 'location-1', 'order-1', {
      pickupToken: 'ABC123',
      idempotencyKey: key,
    }),
    { status: 422 },
  );
  assert.equal(count, 0);
});
test('an unknown mutation result is not retried or fabricated as success', async () => {
  const calls = [];
  const client = food.createNuniFoodClient(async (...args) => {
    calls.push(args);
    if (calls.length === 1) throw new Error('connection lost');
    return command();
  });
  const input = { idempotencyKey: key };
  await assert.rejects(
    client.recordCounterPayment('campus-one', 'location-1', 'order-1', input),
    /connection lost/,
  );
  assert.equal(calls.length, 1);
  await client.recordCounterPayment('campus-one', 'location-1', 'order-1', input);
  assert.deepEqual(calls[0], calls[1]);
});
test('accept reads the actual service receipt including its issued kitchen ticket', async () => {
  const receipt = { ...command('accepted'), kitchenTicketId: 'ticket-1' };
  const client = food.createNuniFoodClient(async () => receipt);
  assert.deepEqual(
    await client.acceptOrder('campus-one', 'location-1', 'order-1', { idempotencyKey: key }),
    receipt,
  );
});

const location = () => ({
  id: 'location-1',
  campusId: '',
  name: '午餐店',
  description: '',
  zoneLabel: '',
  timeZone: 'Asia/Taipei',
  state: 'open',
  merchantMode: 'full',
  sourceLabel: '',
  sourceUpdatedAt: null,
  allowedActions: ['view-menu'],
});
const line = () => ({
  menuItemId: 'item-1',
  nameSnapshot: '雞腿飯',
  quantity: 1,
  selectedOptions: [],
  unitPrice: money(),
  lineTotal: money(),
});
const menu = () => ({
  location: location(),
  menuVersion: 'menu-1',
  generatedAt: at,
  sections: [
    {
      id: 'section-1',
      name: '主餐',
      items: [
        {
          id: 'item-1',
          name: '雞腿飯',
          description: '',
          basePrice: money(),
          available: true,
          dietaryTags: [],
          allergenTags: [],
          nutrition: { declared: false },
          optionGroups: [],
          allowedActions: ['add-to-quote'],
        },
      ],
    },
  ],
});
test('normalizes actual PostgreSQL menu timestamps before Hermes or browser use', () => {
  const value = menu();
  value.generatedAt = '2026-10-13 13:12:33.401001+00';
  assert.equal(food.parseNuniFoodMenu(value).generatedAt, '2026-10-13T13:12:33.401Z');
});
test('normalizes PostgreSQL offsets and microseconds without accepting ambiguous date strings', () => {
  for (const [raw, expected] of [
    ['2026-10-13 21:12:33+08', '2026-10-13T13:12:33.000Z'],
    ['2026-10-13 18:42:33.123456+05:30', '2026-10-13T13:12:33.123Z'],
  ]) {
    const value = menu();
    value.generatedAt = raw;
    assert.equal(food.parseNuniFoodMenu(value).generatedAt, expected);
  }
  for (const invalid of [
    'October 13, 2026',
    '2026-10-13 13:12:33',
    '2026-02-31T13:12:33Z',
    '2026-10-13T24:00:00Z',
    '2026-10-13 13:12:33.1234567+00',
    '2026-10-13 13:12:33+25',
  ]) {
    const value = menu();
    value.generatedAt = invalid;
    assert.throws(() => food.parseNuniFoodMenu(value), { status: 502 });
  }
  assert.throws(
    () =>
      food.validateNuniFoodQuoteInput({
        ...quoteInput(),
        requestedPickupAt: '2026-10-13 13:12:33+00',
      }),
    { status: 422 },
  );
});
const quote = () => ({
  id: 'quote-1',
  locationId: 'location-1',
  menuVersion: 'menu-1',
  state: 'active',
  requestedPickupAt: at,
  lines: [line()],
  subtotal: money(),
  fees: [],
  total: money(),
  expiresAt: at,
  allowedActions: ['create-order', 'refresh-quote'],
});
const quoteInput = () => ({
  locationId: 'location-1',
  requestedPickupAt: at,
  items: [{ menuItemId: 'item-1', quantity: 1 }],
  idempotencyKey: key,
});
const summary = () => ({
  id: 'order-1',
  locationId: 'location-1',
  locationName: '午餐店',
  state: 'payment-pending',
  requestedPickupAt: at,
  itemCount: 1,
  total: money(),
  createdAt: at,
  updatedAt: at,
  allowedActions: ['cancel'],
});
const detail = () => ({
  ...summary(),
  quoteId: 'quote-1',
  lines: [line()],
  pickup: {
    state: 'awaiting-preparation',
    displayCode: 'ABC123',
    calls: [],
    callCount: 0,
    allowedActions: [],
  },
});
const shift = () => ({
  id: 'shift-1',
  locationId: 'location-1',
  state: 'open',
  openedAt: at,
  openingCash: money(100),
  campusLedgerTotal: money(0),
  allowedActions: ['handover'],
});
const closedShift = () => ({
  ...shift(),
  state: 'closed',
  closedAt: at,
  countedCash: money(220),
  expectedCash: money(220),
  allowedActions: ['view'],
});
const queue = () => ({
  orders: [
    {
      id: 'order-1',
      locationId: 'location-1',
      state: 'paid',
      requestedPickupAt: at,
      pickupDisplayCode: 'ABC123',
      allowedActions: ['accept', 'reject'],
      viewerScope: 'cash-register',
      lines: [line()],
      total: money(),
      paymentChannel: 'counter',
      paidAt: at,
    },
  ],
});
const payment = () => ({
  id: 'payment-1',
  orderId: 'order-1',
  progress: 'awaiting-payment',
  method: 'credit-card',
  checkoutUrl: 'https://checkout.example.test/payment-1',
  expiresAt: at,
  allowedActions: ['open-checkout'],
});
test('failed payment without a checkout URL remains a truthful failed attempt', () => {
  const receipt = {
    ...payment(),
    progress: 'failed',
    checkoutUrl: '',
    failureReason: '供應商沒有完成結帳',
    allowedActions: ['start-over'],
  };
  assert.deepEqual(food.parseNuniFoodPayment(receipt), receipt);
  assert.throws(
    () => food.parseNuniFoodPayment({ ...receipt, allowedActions: ['open-checkout'] }),
    { status: 502 },
  );
});
test('payment receipt must correspond to the requested payment method', async () => {
  const client = food.createNuniFoodClient(async () => payment());
  await assert.rejects(
    client.createPaymentSession('campus-one', 'order-1', {
      method: 'mobile-pay',
      idempotencyKey: key,
    }),
    { status: 502 },
  );
});

for (const [name, parser, fixture] of [
  ['money', food.parseNuniFoodMoney, money],
  ['menu', food.parseNuniFoodMenu, menu],
  ['quote', food.parseNuniFoodQuote, quote],
  ['detail', food.parseNuniFoodOrder, detail],
  ['shift', food.parseNuniFoodShift, shift],
  ['command', food.parseNuniFoodOrderCommand, command],
  ['queue', food.parseNuniFoodMerchantOrders, queue],
  ['payment', food.parseNuniFoodPayment, payment],
]) {
  test(`${name} round-trips all required provider fields`, () =>
    assert.deepEqual(parser(fixture()), fixture()));
  test(`${name} rejects unknown response keys`, () =>
    assert.throws(() => parser({ ...fixture(), invented: true }), { status: 502 }));
  for (const field of Object.keys(fixture()).filter(
    (field) => !['paymentChannel', 'paidAt'].includes(field),
  )) {
    test(`${name} rejects missing required ${field}`, () => {
      const value = fixture();
      delete value[field];
      assert.throws(() => parser(value), { status: 502 });
    });
  }
}
for (const amount of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '120']) {
  test(`money rejects unsafe or non-integer value ${String(amount)}`, () =>
    assert.throws(() => food.parseNuniFoodMoney(money(amount)), { status: 502 }));
}
test('money rejects currency substitution', () =>
  assert.throws(() => food.parseNuniFoodMoney({ amountMinor: 120, currency: 'USD' }), {
    status: 502,
  }));
test('undeclared nutrition stays undeclared and never gains zero values', () => {
  const result = food.parseNuniFoodMenu(menu());
  assert.deepEqual(result.sections[0].items[0].nutrition, { declared: false });
  const bad = menu();
  bad.sections[0].items[0].nutrition.caloriesKcal = 0;
  assert.throws(() => food.parseNuniFoodMenu(bad), { status: 502 });
});
test('declared nutrition and required option groups parse without suppressing options', () => {
  const value = menu();
  value.sections[0].items[0].nutrition = {
    declared: true,
    basis: 'per-serving',
    caloriesKcal: 650,
    proteinMg: 22000,
    fatMg: 15000,
    carbohydrateMg: 90000,
    sodiumMg: 900,
    sugarMg: 2000,
    declaredAt: at,
  };
  value.sections[0].items[0].optionGroups = [
    {
      id: 'group-1',
      name: '飯量',
      minimumSelections: 1,
      maximumSelections: 1,
      options: [{ id: 'option-1', name: '正常', priceDelta: money(0), available: true }],
    },
  ];
  assert.deepEqual(food.parseNuniFoodMenu(value), value);
  value.sections[0].items[0].optionGroups[0].minimumSelections = 2;
  assert.throws(() => food.parseNuniFoodMenu(value), { status: 502 });
});
test('strict enums never guess unknown merchant modes, states or actions', () => {
  for (const [field, value] of [
    ['merchantMode', 'active'],
    ['state', 'online'],
    ['allowedActions', ['order-now']],
  ]) {
    const bad = menu();
    bad.location[field] = value;
    assert.throws(() => food.parseNuniFoodMenu(bad), { status: 502 });
  }
  assert.throws(() => food.parseNuniFoodOrderCommand({ ...command(), state: 'cancelled' }), {
    status: 502,
  });
});
test('order details preserve merchant cancellation reasons and pending refunds', () => {
  const value = detail();
  value.state = 'cancellation-pending-refund';
  value.allowedActions = [];
  value.cancellation = { reason: 'item-unavailable', requestedAt: at };
  value.refund = { state: 'pending', amount: money(), requestedAt: at };
  assert.deepEqual(food.parseNuniFoodOrder(value), value);
});
test('order pickup credentials are available only with ready state and token action', () => {
  const value = detail();
  value.state = 'ready';
  value.allowedActions = ['show-pickup-credential'];
  value.pickup = {
    state: 'ready',
    displayCode: 'ABC123',
    credential: { kind: 'one-time-token', token: 'x'.repeat(43), expiresAt: at },
    calls: [{ sequence: 1, calledAt: at }],
    callCount: 1,
    lastCalledAt: at,
    allowedActions: ['present-one-time-token'],
  };
  assert.deepEqual(food.parseNuniFoodOrder(value), value);
  value.pickup.credential.token = value.pickup.displayCode;
  assert.throws(() => food.parseNuniFoodOrder(value), { status: 502 });
  value.pickup.credential.token = 'x'.repeat(43);
  value.pickup.state = 'fulfilled';
  assert.throws(() => food.parseNuniFoodOrder(value), { status: 502 });
});
test('kitchen projection never accepts leaked payment fields', () => {
  const order = queue().orders[0];
  order.viewerScope = 'kitchen';
  delete order.total;
  delete order.paidAt;
  delete order.paymentChannel;
  order.allowedActions = ['start-preparation'];
  order.kitchenTickets = [
    { id: 'ticket-1', station: 'hot', state: 'queued', allowedActions: ['start-preparation'] },
  ];
  order.lines = [
    { menuItemId: 'item-1', nameSnapshot: '雞腿飯', quantity: 1, selectedOptions: [] },
  ];
  assert.deepEqual(food.parseNuniFoodMerchantOrders({ orders: [order] }), { orders: [order] });
  order.total = money();
  assert.throws(() => food.parseNuniFoodMerchantOrders({ orders: [order] }), { status: 502 });
});
test('response resource identity is checked for menu, order, queue, payment, command and shift', () => {
  for (const [parser, value] of [
    [food.parseNuniFoodMenu, menu()],
    [food.parseNuniFoodOrder, detail()],
    [food.parseNuniFoodMerchantOrders, queue()],
    [food.parseNuniFoodPayment, payment()],
    [food.parseNuniFoodOrderCommand, command()],
    [food.parseNuniFoodShift, shift()],
  ]) {
    assert.throws(() => parser(value, 'someone-else'), { status: 502 });
  }
});
test('realms and retained order realms have distinct strict projections', () => {
  assert.deepEqual(
    food.parseNuniFoodRealms({
      realms: [{ tenantId: 'campus-one', name: '校園', services: ['food'] }],
    }),
    [{ tenantId: 'campus-one', name: '校園', services: ['food'] }],
  );
  assert.deepEqual(
    food.parseNuniFoodOrderRealms({ realms: [{ tenantId: 'campus-one', name: '校園' }] }),
    [{ tenantId: 'campus-one', name: '校園' }],
  );
  assert.throws(
    () => food.parseNuniFoodRealms({ realms: [{ tenantId: 'campus-one', name: '校園' }] }),
    { status: 502 },
  );
  assert.throws(
    () =>
      food.parseNuniFoodOrderRealms({
        realms: [{ tenantId: 'campus-one', name: '校園', services: ['food'] }],
      }),
    { status: 502 },
  );
});
for (const invalid of ['', '../escape', 'tenant?state=paid', 'a/b', '%2f', 'a#b', 'UPPER-CASE']) {
  test(`rejects unsafe tenant scope ${JSON.stringify(invalid)}`, async () => {
    const client = food.createNuniFoodClient(async () =>
      assert.fail('must reject before transport'),
    );
    await assert.rejects(client.listOrders(invalid), { status: 422 });
  });
}
for (const invalid of ['', '../escape', 'item?x=1', 'a/b', '%2f', 'a#b', '😀']) {
  test(`rejects unsafe resource path ${JSON.stringify(invalid)}`, async () => {
    const client = food.createNuniFoodClient(async () =>
      assert.fail('must reject before transport'),
    );
    await assert.rejects(client.getOrder('campus-one', invalid), { status: 422 });
  });
}
test('structured pagination preserves cursor data and omits false boolean for provider coercion', () => {
  const cursor = 'eyJpZCI6IjEifQ==';
  assert.deepEqual(food.validateNuniFoodLocationQuery({ limit: '100', cursor }), {
    limit: '100',
    cursor,
  });
  assert.deepEqual(food.validateNuniFoodMerchantOrderQuery({ currentShiftOnly: false }), {});
  assert.deepEqual(food.validateNuniFoodMerchantOrderQuery({ currentShiftOnly: 'false' }), {});
  assert.deepEqual(
    food.validateNuniFoodMerchantOrderQuery({
      currentShiftOnly: 'true',
      state: 'paid',
      station: 'hot',
    }),
    { currentShiftOnly: 'true', state: 'paid', station: 'hot' },
  );
});
for (const invalid of [
  { limit: 0 },
  { limit: 101 },
  { limit: '1.5' },
  { limit: 'Infinity' },
  { limit: true },
  { cursor: '' },
  { unknown: 1 },
  { state: 'fulfilled' },
  { currentShiftOnly: '0' },
  { limit: ['2'] },
]) {
  test(`rejects invalid merchant query ${JSON.stringify(invalid)}`, () =>
    assert.throws(() => food.validateNuniFoodMerchantOrderQuery(invalid), { status: 422 }));
}
test('quote bounds match provider and do not scale prices', () => {
  const value = quoteInput();
  value.items = Array.from({ length: 20 }, (_, i) => ({
    menuItemId: `item-${i}`,
    quantity: 20,
    selectedOptionIds: Array.from({ length: 20 }, (_, j) => `option-${j}`),
    customerNote: '備註'.repeat(150),
  }));
  assert.equal(food.validateNuniFoodQuoteInput(value).items.length, 20);
  for (const change of [
    (v) => v.items.push(v.items[0]),
    (v) => {
      v.items[0].quantity = 21;
    },
    (v) => {
      v.items[0].selectedOptionIds.push('overflow');
    },
    (v) => {
      v.items[0].customerNote += '多';
    },
    (v) => {
      v.items[0].unitPrice = 1;
    },
  ]) {
    const bad = structuredClone(value);
    change(bad);
    assert.throws(() => food.validateNuniFoodQuoteInput(bad), { status: 422 });
  }
});
test('other cancellation and rejection reasons require actual detail', () => {
  for (const validate of [food.validateNuniFoodCancelInput, food.validateNuniFoodRejectInput]) {
    assert.throws(() => validate({ reason: 'other', idempotencyKey: key }), { status: 422 });
    assert.throws(() => validate({ reason: 'other', reasonDetail: '  ', idempotencyKey: key }), {
      status: 422,
    });
    assert.equal(
      validate({ reason: 'other', reasonDetail: '  有其他原因  ', idempotencyKey: key })
        .reasonDetail,
      '有其他原因',
    );
  }
});
test('shift inputs preserve whole TWD and require next opening cash when requested', () => {
  assert.deepEqual(
    food.validateNuniFoodOpenShiftInput({ openingCashMinor: 120, idempotencyKey: key }),
    { openingCashMinor: 120, idempotencyKey: key },
  );
  for (const amount of [-1, 0.5, 10000001, '120'])
    assert.throws(
      () => food.validateNuniFoodOpenShiftInput({ openingCashMinor: amount, idempotencyKey: key }),
      { status: 422 },
    );
  assert.throws(
    () =>
      food.validateNuniFoodHandoverInput({
        countedCashMinor: 120,
        openNext: true,
        idempotencyKey: key,
      }),
    { status: 422 },
  );
  assert.equal(
    food.validateNuniFoodHandoverInput({
      countedCashMinor: 120,
      openNext: true,
      nextOpeningCashMinor: 0,
      idempotencyKey: key,
    }).nextOpeningCashMinor,
    0,
  );
});
for (const invalid of ['x'.repeat(7), 'x'.repeat(101), '', 123, undefined]) {
  test(`rejects invalid mutation key length/type ${String(invalid).length}`, () =>
    assert.throws(() => food.validateNuniFoodKeyInput({ idempotencyKey: invalid }), {
      status: 422,
    }));
}
test('all write validators reject unknown fields', () => {
  for (const [validate, input] of [
    [food.validateNuniFoodKeyInput, { idempotencyKey: key }],
    [food.validateNuniFoodQuoteInput, quoteInput()],
    [food.validateNuniFoodCreateOrderInput, { quoteId: 'quote-1', idempotencyKey: key }],
    [food.validateNuniFoodCancelInput, { reason: 'changed-mind', idempotencyKey: key }],
    [food.validateNuniFoodRejectInput, { reason: 'item-unavailable', idempotencyKey: key }],
    [food.validateNuniFoodPaymentInput, { method: 'credit-card', idempotencyKey: key }],
    [food.validateNuniFoodOpenShiftInput, { openingCashMinor: 0, idempotencyKey: key }],
    [
      food.validateNuniFoodHandoverInput,
      { countedCashMinor: 0, openNext: false, idempotencyKey: key },
    ],
    [food.validateNuniFoodFulfillInput, { pickupToken: 'x'.repeat(43), idempotencyKey: key }],
  ])
    assert.throws(() => validate({ ...input, operatorOverride: true }), { status: 422 });
});
test('read-only calls use exact platform scope and structured query arguments', async () => {
  const cases = [
    ['listRealms', [], 'realms', { realms: [] }, undefined],
    ['listOrderRealms', [], 'food-order-realms', { realms: [] }, undefined],
    [
      'listLocations',
      ['campus-one', { limit: 20 }],
      'realms/campus-one/food/locations',
      { locations: [] },
      { limit: '20' },
    ],
    [
      'listOrders',
      ['campus-one', { state: 'canceled', cursor: 'opaque' }],
      'realms/campus-one/food/orders',
      { orders: [] },
      { state: 'canceled', cursor: 'opaque' },
    ],
    [
      'listMerchantOrders',
      ['campus-one', 'location-1', { station: 'hot' }],
      'merchant-workspaces/campus-one/location-1/orders',
      { orders: [] },
      { station: 'hot' },
    ],
    [
      'getMenu',
      ['campus-one', 'location-1'],
      'realms/campus-one/food/locations/location-1/menu',
      menu(),
      undefined,
    ],
    [
      'getPaymentMethods',
      ['campus-one', 'location-1'],
      'realms/campus-one/food/locations/location-1/payment-methods',
      { methods: [], unavailableMessage: '此店未提供線上付款' },
      undefined,
    ],
    [
      'getOrder',
      ['campus-one', 'order-1'],
      'realms/campus-one/food/orders/order-1',
      detail(),
      undefined,
    ],
    [
      'getShift',
      ['campus-one', 'location-1'],
      'merchant-workspaces/campus-one/location-1/shift',
      shift(),
      undefined,
    ],
  ];
  for (const [method, args, path, response, query] of cases) {
    const calls = [];
    const client = food.createNuniFoodClient(async (...args) => {
      calls.push(args);
      return response;
    });
    await client[method](...args);
    assert.deepEqual(calls, [query ? [path, undefined, query] : [path]]);
  }
});
test('no open shift is a provider 404, not a fabricated empty shift', async () => {
  const error = { status: 404, code: 'FOOD_SHIFT_NOT_FOUND' };
  const client = food.createNuniFoodClient(async () => {
    throw error;
  });
  await assert.rejects(client.getShift('campus-one', 'location-1'), (actual) => actual === error);
});
test('quote receipt verifies location, pickup instant and selected items/options', async () => {
  const good = quote();
  good.fees = [{ code: 'qualification', label: '資格折扣', amount: money(20) }];
  good.total = money(100);
  const client = food.createNuniFoodClient(async () => good);
  assert.equal((await client.createQuote('campus-one', quoteInput())).total.amountMinor, 100);
  for (const change of [
    (v) => {
      v.locationId = 'other';
    },
    (v) => {
      v.requestedPickupAt = '2026-10-14T04:00:00Z';
    },
    (v) => {
      v.lines[0].menuItemId = 'other';
    },
    (v) => {
      v.lines[0].selectedOptions = [
        { optionId: 'other', nameSnapshot: '加料', priceDelta: money(10) },
      ];
    },
    (v) => {
      v.lines[0].customerNote = 'different';
    },
  ]) {
    const bad = quote();
    change(bad);
    await assert.rejects(
      food.createNuniFoodClient(async () => bad).createQuote('campus-one', quoteInput()),
      { status: 502 },
    );
  }
});
const mutations = [
  [
    'createOrder',
    ['campus-one', { quoteId: 'quote-1', idempotencyKey: key }],
    'realms/campus-one/food/orders',
    command('payment-pending'),
  ],
  [
    'cancelOrder',
    ['campus-one', 'order-1', { reason: 'changed-mind', idempotencyKey: key }],
    'realms/campus-one/food/orders/order-1/cancel',
    command('canceled'),
  ],
  [
    'createPaymentSession',
    ['campus-one', 'order-1', { method: 'credit-card', idempotencyKey: key }],
    'realms/campus-one/food/orders/order-1/payment-session',
    payment(),
  ],
  [
    'recordCounterPayment',
    ['campus-one', 'location-1', 'order-1', { idempotencyKey: key }],
    'merchant-workspaces/campus-one/location-1/orders/order-1/counter-payment',
    command('paid'),
  ],
  [
    'acceptOrder',
    ['campus-one', 'location-1', 'order-1', { idempotencyKey: key }],
    'merchant-workspaces/campus-one/location-1/orders/order-1/accept',
    { ...command('accepted'), kitchenTicketId: 'ticket-1' },
  ],
  [
    'rejectOrder',
    ['campus-one', 'location-1', 'order-1', { reason: 'item-unavailable', idempotencyKey: key }],
    'merchant-workspaces/campus-one/location-1/orders/order-1/reject',
    command('rejection-pending-refund'),
  ],
  [
    'cancelAcceptedOrder',
    ['campus-one', 'location-1', 'order-1', { reason: 'item-unavailable', idempotencyKey: key }],
    'merchant-workspaces/campus-one/location-1/orders/order-1/cancel-accepted',
    command('cancellation-pending-refund'),
  ],
  [
    'confirmCounterRefund',
    ['campus-one', 'location-1', 'order-1', { idempotencyKey: key }],
    'merchant-workspaces/campus-one/location-1/orders/order-1/confirm-counter-refund',
    command('rejected'),
  ],
  [
    'startTicket',
    ['campus-one', 'location-1', 'order-1', 'ticket-1', { idempotencyKey: key }],
    'merchant-workspaces/campus-one/location-1/kitchen-tickets/ticket-1/start',
    command('preparing'),
  ],
  [
    'readyTicket',
    ['campus-one', 'location-1', 'order-1', 'ticket-1', { idempotencyKey: key }],
    'merchant-workspaces/campus-one/location-1/kitchen-tickets/ticket-1/ready',
    command('ready'),
  ],
  [
    'fulfillOrder',
    ['campus-one', 'location-1', 'order-1', { pickupToken: 'x'.repeat(43), idempotencyKey: key }],
    'merchant-workspaces/campus-one/location-1/orders/order-1/fulfill',
    { orderId: 'order-1', state: 'fulfilled', fulfilledAt: at, replayed: false },
  ],
];
for (const [method, args, path, response] of mutations) {
  test(`${method} sends the original explicit operation and returns validated receipt`, async () => {
    const calls = [];
    const client = food.createNuniFoodClient(async (...args) => {
      calls.push(args);
      return response;
    });
    assert.deepEqual(await client[method](...args), response);
    assert.deepEqual(calls, [[path, args.at(-1)]]);
  });
  test(`${method} rejects malformed success without retry`, async () => {
    let calls = 0;
    const client = food.createNuniFoodClient(async () => {
      calls++;
      return { ok: true };
    });
    await assert.rejects(client[method](...args), { status: 502 });
    assert.equal(calls, 1);
  });
  if (method !== 'createOrder')
    test(`${method} rejects receipt for another customer's order`, async () => {
      const client = food.createNuniFoodClient(async () => ({
        ...response,
        orderId: 'someone-else',
      }));
      await assert.rejects(client[method](...args), { status: 502 });
    });
}
test('ticket-ready receipt may remain preparing until every station finishes', async () => {
  const client = food.createNuniFoodClient(async () => command('preparing'));
  assert.equal(
    (
      await client.readyTicket('campus-one', 'location-1', 'order-1', 'ticket-1', {
        idempotencyKey: key,
      })
    ).state,
    'preparing',
  );
});
test('BFF may validate ticket command without an unavailable order identity', async () => {
  const client = food.createNuniFoodClient(async () => command('preparing'));
  assert.equal(
    (
      await client.startTicket('campus-one', 'location-1', undefined, 'ticket-1', {
        idempotencyKey: key,
      })
    ).orderId,
    'order-1',
  );
});
test('shift opening and handover verify actual saved amounts and next shift', async () => {
  const client = food.createNuniFoodClient(async () => shift());
  assert.equal(
    (
      await client.openShift('campus-one', 'location-1', {
        openingCashMinor: 100,
        idempotencyKey: key,
      })
    ).openingCash.amountMinor,
    100,
  );
  await assert.rejects(
    client.openShift('campus-one', 'location-1', { openingCashMinor: 200, idempotencyKey: key }),
    { status: 502 },
  );
  const receipt = { closed: closedShift(), next: { ...shift(), id: 'shift-2' } };
  const handover = food.createNuniFoodClient(async () => receipt);
  const input = {
    countedCashMinor: 220,
    openNext: true,
    nextOpeningCashMinor: 100,
    idempotencyKey: key,
  };
  assert.deepEqual(await handover.handoverShift('campus-one', 'location-1', input), receipt);
  await assert.rejects(
    handover.handoverShift('campus-one', 'location-1', { ...input, openNext: false }),
    { status: 502 },
  );
  receipt.next.id = receipt.closed.id;
  await assert.rejects(handover.handoverShift('campus-one', 'location-1', input), { status: 502 });
});
