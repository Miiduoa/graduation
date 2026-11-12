// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { confirm, issueRoute, routeOwner, signCard, verifyCard } from './actions';
import { bytes, type ModelInput } from './contracts';
import { cartArgs } from './food';
import { groqModel, providerError } from './groq';
import { maskSensitive } from './privacy';
import { run, verifyProposalAnswer } from './runner';
import { createTools } from './tools';
import { fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
afterEach(() => vi.unstubAllEnvs());
const event = { title: '讀書', date: '2026-11-04', startTime: '20:00', endTime: '21:00', allDay: false };
const usage = { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 };
it('binds conversation routes to owner and binding and rejects forgery / old boot epoch', async () => {
  vi.stubEnv('FLY_MACHINE_ID', 'A');
  const token = issueRoute(binding, secret);
  expect(routeOwner(token, binding, secret)).toBe('A');
  expect(() => routeOwner(token, { ...binding, conversationId: 'other' }, secret)).toThrow();
  expect(() => routeOwner(token + 'x', binding, secret)).toThrow();
  const card = signCard(binding, 'propose_personal_event', event, 1, secret, now);
  vi.stubEnv('FLY_MACHINE_ID', 'B');
  expect(routeOwner(token, binding, secret)).toBe('A');
  expect(() => verifyCard(binding, card, secret, now)).toThrow();
  vi.stubEnv('FLY_MACHINE_ID', 'A');
  // Independent module instance models a restarted issuer, with no prior epoch or seq.
  vi.resetModules();
  const restarted = await import('./actions');
  expect(() => restarted.routeOwner(token, binding, secret)).toThrow();
  expect(() => restarted.verifyCard(binding, card, secret, now)).toThrow();
});
it('rechecks expiry after ledger I/O immediately before writing', async () => {
  const f = fixtureAdapter();
  const card = signCard(binding, 'propose_personal_event', event, 1, secret, now);
  let clock = now + 299999;
  const original = f.adapter.ledger;
  f.adapter.ledger = async () => { clock = now + 300001; return original(); };
  await expect(confirm(binding, card, secret, now + 299999, f.adapter, true, () => clock)).rejects.toThrow();
  expect(f.writes).toHaveLength(0);
});
it('accepts ISO milliseconds, Z and offsets and normalizes to Taipei', () => {
  const base = { tenantId: 't', locationId: 'l', items: [{ menuItemId: 'i', quantity: 1, selectedOptionIds: [] }] };
  for (const pickup of ['2026-11-04T04:00:00.000Z', '2026-11-04T12:00:00+08:00', '2026-11-04T05:00:00+01:00'])
    expect(cartArgs({ ...base, requestedPickupAt: pickup }).requestedPickupAt).toBe('2026-11-04T12:00:00+08:00');
});
it('allows only locations from server-validated own orders without listing locations first', async () => {
  const tools = createTools(fixtureAdapter().adapter, binding, secret, now, true);
  const orders = (await tools.call('list_food_orders', {})).value as { orders: { id: string }[] };
  await tools.call('get_food_order', { orderId: orders.orders[0].id });
  await expect(tools.call('get_food_menu', { locationId: 'dining-a' })).resolves.toHaveProperty('value.items');
  await expect(tools.call('get_food_menu', { locationId: 'foreign' })).rejects.toMatchObject({ code: 'FORBIDDEN_SCOPE' });
});
it('retains every unknown usage reservation across a minute boundary and a later success', async () => {
  let accounted = 0;
  let calls = 0;
  const sent: number[] = [];
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 59999);
  try {
    const result = await run({ question: '你好', history: [], binding, adapter: fixtureAdapter().adapter,
      secret, now, writes: true, signal: new AbortController().signal, log: () => {},
      model: async (input) => {
        const reservation = bytes({ messages: input.messages, tools: input.tools }) + input.max_completion_tokens + 128;
        sent.push(reservation);
        accounted += reservation;
        expect(accounted).toBeLessThanOrEqual(7000);
        clock.mockReturnValue(now + 60001);
        if (++calls === 1) throw providerError(400, '{"error":{"code":"tool_use_failed"}}');
        accounted += usage.total_tokens - reservation;
        return { message: { role: 'assistant', content: '您好' }, usage };
      },
    });
    expect(result.modelCalls).toBe(2);
    expect(sent.length).toBe(2);
  } finally { clock.mockRestore(); }
});
it.each(['question', 'history', 'context', 'tool'])('masks secrets, student ids and grades at final provider egress: %s', async (source) => {
  const marker = 'gsk_SYNTHETICKEY123456789 學號 S123456789 成績 87 分';
  const f = fixtureAdapter();
  if (source === 'context') {
    const ledger = await f.adapter.ledger();
    ledger.records.forEach((r) => { r.title = marker; });
    f.adapter.ledger = async () => ledger;
  }
  const requests: ModelInput[] = [];
  const logs: unknown[] = [];
  let calls = 0;
  f.adapter.courses = async () => ({ courses: [{ id: 'course', title: marker }], partial: false });
  await run({ question: source === 'question' ? marker : source === 'context' ? '請解釋今天課表' : '教材',
    history: source === 'history' ? [{ role: 'user', content: marker }] : [], binding, adapter: f.adapter,
    secret, now, writes: true, signal: new AbortController().signal, log: (r) => logs.push(r),
    model: async (input) => {
      requests.push(input);
      return ++calls === 1 && source === 'tool'
        ? { message: { role: 'assistant', tool_calls: [{ id: 'c', type: 'function', function: { name: 'list_courses', arguments: '{}' } }] }, usage }
        : { message: { role: 'assistant', content: '已查詢' }, usage };
    },
  });
  expect(requests.length).toBeGreaterThan(0);
  expect(JSON.stringify([requests, logs])).not.toMatch(/S123456789|SYNTHETICKEY123456789|87 分/);
  let payload = '';
  const provider = groqModel('synthetic-provider-key', async (_url, init) => {
    payload = String(init?.body);
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage }));
  });
  await provider({ messages: [{ role: 'user', content: marker }], max_completion_tokens: 128, signal: new AbortController().signal });
  expect(payload).not.toMatch(/S123456789|SYNTHETICKEY123456789|87 分/);
  expect(maskSensitive(marker)).toContain('遮罩');
});
it('does not ask for a nonexistent card', () => {
  expect(verifyProposalAnswer('請按下方確認卡。', [], '幫我點一份')).toContain('尚未產生確認卡');
  expect(verifyProposalAnswer('攝影社週五有活動。請按確認卡。', [], '我加入的社團最近有什麼消息'))
    .toContain('攝影社');
  expect(
    verifyProposalAnswer('攝影社週五有活動。請按確認卡。', [], '我加入的社團最近有什麼消息'),
  ).not.toMatch(/尚未產生確認卡|請按確認卡/);
});
it('corrects tonight to the server Taipei date and grounds planning / navigation replies', async () => {
  let calls = 0;
  const result = await run({ question: '今晚八點幫我新增讀書行程', history: [], binding, adapter: fixtureAdapter().adapter,
    secret, now, writes: true, signal: new AbortController().signal, log: () => {}, model: async () => ++calls === 1
      ? { message: { role: 'assistant', tool_calls: [{ id: 'c', type: 'function', function: { name: 'propose_personal_event', arguments: JSON.stringify({ ...event, date: '2026-11-05' }) } }] }, usage }
      : { message: { role: 'assistant', content: '2026-11-05（今晚）請按確認卡。' }, usage },
  });
  expect(result.cards[0].args.date).toBe('2026-11-04');
  expect(result.answer).not.toContain('2026-11-05');
  for (const question of ['規劃明天', '圖書館怎麼走，公車']) {
    const answer = await run({ question, history: [], binding, adapter: fixtureAdapter().adapter, secret, now,
      writes: true, signal: new AbortController().signal, log: () => {}, model: async () => ({
        message: { role: 'assistant', content: '13:00-15:00 程式設計（資訊101）。list_food_orders 失敗，FORBIDDEN_SCOPE，請按確認卡。' }, usage,
      }),
    });
    expect(answer.answer).not.toMatch(/資訊101|list_food_orders|FORBIDDEN_SCOPE|請按確認卡/);
    if (question.includes('圖書館')) {
      expect(answer.steps.map((s) => s.name)).toEqual(expect.arrayContaining(['get_campus_info', 'get_transit']));
      expect(answer.answer).toContain('校園地圖');
    }
  }
});

it('context excludes expired work using instants across timezones', async () => {
  const f = fixtureAdapter();
  f.adapter.courses = async () => ({ courses: [{ id: 'c', title: '課程' }], partial: false });
  f.adapter.work = async () => [
    { id: 'old', courseId: 'c', title: '逾期', state: 'open', submitted: false, dueAt: new Date(now - 1).toISOString() },
    { id: 'new', courseId: 'c', title: '近期', state: 'open', submitted: false, dueAt: new Date(now + 3600000).toISOString() },
  ];
  const context = await createTools(f.adapter, binding, secret, now, true).context();
  expect(context.due).toEqual([expect.objectContaining({ id: 'new' })]);
});
