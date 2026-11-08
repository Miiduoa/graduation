// @vitest-environment node
import { createHmac } from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { confirm, signCard, verifyCard, pageHref } from './actions';
import { bounded, canonical, eventArgs, history, V2Error, type Model, type Obj } from './contracts';
import {
  fakeModel,
  fixtureAdapter,
  fixtureBinding as binding,
  FIXTURE_NOW as now,
  FIXTURE_SECRET as secret,
  questions,
} from './fixtures';
import { createTools, freeTime, schemas, selectTools, toolNames, validateTool } from './tools';
import { compactContext, run, toolSummary } from './runner';
import { groqModel, providerError } from './groq';
import { createAdapter } from './adapter';
const event = {
  title: '寫作業',
  date: '2026-11-04',
  startTime: '20:00',
  endTime: '21:00',
  allDay: false,
};
const signal = () => new AbortController().signal;
const runCase = (model: Model, extra = {}) =>
  run({
    question: questions[0],
    history: [],
    binding,
    adapter: fixtureAdapter().adapter,
    model,
    secret,
    writes: true,
    signal: signal(),
    now,
    log: () => {},
    ...extra,
  });
const result = (name?: string, args = '{}') => ({
  message: name
    ? {
        role: 'assistant',
        tool_calls: [
          { id: 'call1', type: 'function' as const, function: { name, arguments: args } },
        ],
      }
    : { role: 'assistant', content: '資料有限的回答' },
  usage: { prompt_tokens: 300, completion_tokens: 100, total_tokens: 400 },
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('allowlisted tools', () => {
  it.each([
    ['confirm', {}],
    ['get_today_context', { url: 'https://example.invalid' }],
    ['get_food_order', { tenantId: 'a', orderId: 'x'.repeat(101) }],
    ['get_schedule', { from: '2026-02-30', to: '2026-03-01' }],
    ['get_schedule', { from: '2026-11-01', to: '2026-11-09' }],
    ['propose_open_page', { page: 'javascript:alert(1)' }],
    ['propose_open_page', { page: 'map', entityId: '../a' }],
    ['find_free_time', { date: '2026-11-04', from: '25:00' }],
    ['get_calendar', { from: '2026-11-01', to: '2026-12-20' }],
    ['get_transit', { action: 'campus', schoolId: 'other' }],
  ])('rejects %s invalid arguments', (name, args) => {
    expect(() => validateTool(String(name), args)).toThrow();
  });
  it('never dispatches forged course/order/community/tenant IDs', async () => {
    const f = fixtureAdapter();
    const order = vi.spyOn(f.adapter, 'order'),
      feed = vi.spyOn(f.adapter, 'feed'),
      work = vi.spyOn(f.adapter, 'work');
    const tools = createTools(f.adapter, binding, secret, now, true);
    for (const [name, args] of [
      ['get_food_order', { tenantId: 'fixture-realm', orderId: 'stolen' }],
      ['get_club_feed', { tenantId: 'fixture-realm', communityId: 'stolen' }],
      ['get_course_work', { workspaceId: 'stolen' }],
      ['list_food_orders', { tenantId: 'other-school' }],
    ] as [string, Obj][])
      await expect(tools.call(name, args)).rejects.toMatchObject({ status: 403 });
    expect(order).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });
  it('does not guess a realm school; production notification is not advertised', async () => {
    const f = fixtureAdapter();
    f.adapter.realms = async () => [{ tenantId: 'fixture-realm' }];
    await expect(
      createTools(f.adapter, binding, secret, now, true).call('list_clubs', {
        tenantId: 'fixture-realm',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(selectTools('通知', false)).not.toContain('get_notifications');
    expect(selectTools('通知', true)).toContain('get_notifications');
    expect(toolNames).not.toContain('confirm');
    expect(schemas(selectTools(questions[0], false)).length).toBeLessThanOrEqual(8);
  });
  it('computes merged class/event free slots and blocks conflicts', async () => {
    const f = fixtureAdapter();
    const ledger = await f.adapter.ledger();
    expect(
      freeTime(ledger, {
        date: '2026-11-04',
        from: '12:00',
        to: '18:00',
        minMinutes: 60,
      }).slots.map((s) => [s.startTime, s.endTime]),
    ).toEqual([
      ['12:00', '13:00'],
      ['15:00', '16:00'],
      ['17:00', '18:00'],
    ]);
    const tools = createTools(f.adapter, binding, secret, now, true);
    await expect(
      tools.call('propose_personal_event', { ...event, startTime: '13:30', endTime: '14:30' }),
    ).rejects.toMatchObject({ code: 'EVENT_CONFLICT' });
    expect(f.writes).toHaveLength(0);
  });
});
describe('confirmation and CAS', () => {
  it('requires a valid binding, canonical arguments and exact lifetime', () => {
    const card = signCard(binding, 'propose_personal_event', event, 1, secret, now);
    expect(
      verifyCard(
        binding,
        {
          token: card.token,
          args: {
            allDay: false,
            endTime: '21:00',
            startTime: '20:00',
            date: event.date,
            title: event.title,
          },
        },
        secret,
        now,
      ).revision,
    ).toBe(1);
    for (const changed of [
      { ...event, title: 'tampered' },
      { ...event, date: '2026-11-05' },
    ])
      expect(() => verifyCard(binding, { ...card, args: changed }, secret, now)).toThrow();
    for (const key of ['account', 'session', 'conversationId', 'schoolId'])
      expect(() =>
        verifyCard({ ...binding, [key]: 'other' }, { token: card.token, args: event }, secret, now),
      ).toThrow();
    for (const time of [now - 1, now + 300000])
      expect(() => verifyCard(binding, { token: card.token, args: event }, secret, time)).toThrow();
    expect(() =>
      verifyCard(binding, { token: card.token + 'x', args: event }, secret, now),
    ).toThrow();
    const future = signCard(binding, 'propose_personal_event', event, 1, secret, now + 1000000);
    expect(() => verifyCard(binding, { token: future.token, args: event }, secret, now)).toThrow();
    expect(() => eventArgs({ ...event, endTime: '19:00' })).toThrow();
    expect(canonical({ a: 1, b: 2 })).toBe(canonical({ b: 2, a: 1 }));
  });
  it('writes only after confirmation, preserves all ledger records and replays once', async () => {
    const f = fixtureAdapter(),
      original = f.snapshot();
    const tools = createTools(f.adapter, binding, secret, now, true);
    await tools.call('propose_personal_event', event);
    expect(f.writes).toHaveLength(0);
    const card = tools.cards[0],
      payload = { token: card.token, args: card.args };
    expect(await confirm(binding, payload, secret, now, f.adapter, true)).toMatchObject({
      replay: false,
    });
    expect(await confirm(binding, payload, secret, now, f.adapter, true)).toMatchObject({
      replay: true,
    });
    expect(f.writes).toHaveLength(1);
    expect(f.snapshot().records.slice(0, original.records.length)).toEqual(original.records);
    await expect(confirm(binding, payload, secret, now, f.adapter, false)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('retains ledger on CAS conflict; retries uncertain write with same mutationId', async () => {
    const f = fixtureAdapter(),
      original = f.snapshot(),
      card = signCard(binding, 'propose_personal_event', event, 0, secret, now);
    await expect(
      confirm(binding, { token: card.token, args: card.args }, secret, now, f.adapter, true),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.snapshot()).toEqual(original);
    const valid = signCard(binding, 'propose_personal_event', event, 1, secret, now);
    const write = f.adapter.write;
    f.adapter.write = async (p) => {
      await write(p);
      throw new V2Error(504, 'TIMEOUT');
    };
    const payload = { token: valid.token, args: valid.args };
    await expect(confirm(binding, payload, secret, now, f.adapter, true)).rejects.toThrow();
    expect(await confirm(binding, payload, secret, now, f.adapter, true)).toMatchObject({
      replay: true,
    });
    expect(f.writes).toHaveLength(1);
  });
  it('plans multiple individually signed cards and confirms all in order', async () => {
    const f = fixtureAdapter(),
      tools = createTools(f.adapter, binding, secret, now, true);
    await tools.context();
    await tools.call('propose_study_plan', {
      date: '2026-11-04',
      from: '17:00',
      taskIds: ['task-urgent', 'task-next'],
    });
    expect(tools.cards).toHaveLength(2);
    expect(new Set(tools.cards.map((c) => c.token)).size).toBe(2);
    for (const card of tools.cards)
      await confirm(binding, { token: card.token, args: card.args }, secret, now, f.adapter, true);
    expect(f.writes).toHaveLength(2);
  });
  it('rejects a later card when an unrelated edit advanced the calendar revision', async () => {
    const f = fixtureAdapter();
    const tools = createTools(f.adapter, binding, secret, now, true);
    await tools.context();
    await tools.call('propose_study_plan', {
      date: '2026-11-04', from: '17:00', taskIds: ['task-urgent', 'task-next'],
    });
    const [, second] = tools.cards;
    const before = f.snapshot();
    await f.adapter.write({
      schoolId: binding.schoolId,
      records: before.records.slice(1),
      expectedRevision: before.revision,
      mutationId: 'independent-edit',
    });
    await expect(confirm(binding, { token: second.token, args: second.args }, secret, now, f.adapter, true))
      .rejects.toMatchObject({ code: 'PERSONAL_IMPORT_REVISION_CONFLICT' });
    expect(f.writes).toHaveLength(1);
  });
  it('signs server routes and falls back when writes unavailable', async () => {
    expect(pageHref({ page: 'orders' }, binding.schoolId)).toBe('/food?schoolId=fixture-school');
    const f = fixtureAdapter(),
      tools = createTools(f.adapter, binding, secret, now, false);
    await tools.call('propose_personal_event', event);
    expect(tools.cards).toHaveLength(0);
    await tools.call('propose_open_page', { page: 'map' });
    const card = tools.cards[0];
    expect(
      await confirm(binding, { token: card.token, args: card.args }, secret, now, f.adapter, false),
    ).toHaveProperty('href', '/map?schoolId=fixture-school');
    expect(f.writes).toHaveLength(0);
    f.adapter.ledger = async () => {
      throw new V2Error(404, 'IMPORT_SYNC_DISABLED');
    };
    await expect(
      confirm(
        binding,
        {
          token: signCard(binding, 'propose_personal_event', event, 1, secret, now).token,
          args: event,
        },
        secret,
        now,
        f.adapter,
        true,
      ),
    ).rejects.toMatchObject({ code: 'IMPORT_SYNC_DISABLED' });
  });
});
describe('runner and budget', () => {
  it.each([0, 1, 3])('handles %i sequential tools, never a fifth call', async (count) => {
    let n = 0;
    const inputs: Parameters<Model>[0][] = [];
    const r = await runCase(async (input) => {
      inputs.push(input);
      return n++ < count ? result('get_today_context') : result();
    }, { question: '你好' });
    expect(r.modelCalls).toBe(count + 1);
    expect(r.steps.length).toBe(count);
    if (count === 3) expect(inputs[3].tools).toBeUndefined();
  });
  it('bounds multiple calls, malformed args, unknown tools, and ignores injection', async () => {
    let n = 0;
    const r = await runCase(
      async () =>
        n++
          ? result()
          : {
              ...result(),
              message: {
                role: 'assistant',
                tool_calls: [
                  result('get_today_context').message.tool_calls![0],
                  { ...result('confirm', '{').message.tool_calls![0], id: 'second' },
                ],
              },
            },
      { question: '你好' },
    );
    expect(r.steps.map((s) => s.status)).toEqual(['ok', 'error']);
    const f = fixtureAdapter();
    const answer = await runCase(fakeModel(5), { question: questions[5], adapter: f.adapter });
    expect(answer.steps.map((s) => s.name)).toEqual(['list_clubs', 'get_club_feed']);
    expect(f.writes).toHaveLength(0);
    expect(answer.cards).toHaveLength(0);
  });
  it('repeated reads are cached; third repeat stops tools', async () => {
    const r = await runCase(async (input) =>
      input.tools ? result('get_today_context') : result(),
    );
    expect(r.steps[1].status).toBe('cached');
    expect(r.stopReason).toBe('REPEATED_TOOL');
    expect(r.modelCalls).toBeLessThanOrEqual(4);
  });
  it('allows partial answers but terminates on 401', async () => {
    const f = fixtureAdapter();
    f.adapter.dining = async () => {
      throw new V2Error(403, 'FORBIDDEN');
    };
    let count = 0;
    const r = await runCase(async () => (count++ ? result() : result('get_dining')), {
      question: '中午吃什麼',
      adapter: f.adapter,
    });
    expect(r.steps[0].status).toBe('error');
    expect(r.answer).toContain('回答');
    f.adapter.ledger = async () => {
      throw new V2Error(401, 'SESSION_EXPIRED');
    };
    const model = vi.fn();
    await expect(runCase(model, { adapter: f.adapter })).rejects.toMatchObject({ status: 401 });
    expect(model).not.toHaveBeenCalled();
  });
  it('handles empty output, one bounded final retry, and token exhaustion', async () => {
    const model = vi.fn(async () => ({
      ...result(),
      message: { role: 'assistant', content: ' ' },
      finishReason: 'length',
    }));
    const r = await runCase(model);
    expect(r.answer.trim()).not.toBe('');
    expect(model).toHaveBeenCalledTimes(2);
    const huge = await runCase(async () => ({
      ...result('get_today_context'),
      usage: { prompt_tokens: 6999, completion_tokens: 1, total_tokens: 7000 },
    }));
    expect(huge.modelCalls).toBe(1);
    expect(huge.stopReason).toBe('TOKEN_BUDGET');
  });
  it('aborts and limits model/tool duration and total deadline', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    await expect(runCase(vi.fn(), { signal: controller.signal })).rejects.toBeDefined();
    const promise = runCase(async () => new Promise(() => {}));
    const rejected = expect(promise).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(12001);
    await rejected;
    const deadline = new AbortController();
    const never = bounded(() => new Promise(() => {}), deadline.signal, 55000);
    const stopped = expect(never).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(55001);
    await stopped;
  });
  it('validates memory, bounds context and logs only fixed safe fields', async () => {
    expect(() => history([{ role: 'system', content: 'bad' }])).toThrow();
    expect(() => history([{ role: 'tool', content: 'bad' }])).toThrow();
    expect(() => history([{ role: 'user', content: 'ok', tool_calls: [] }])).toThrow();
    expect(
      Buffer.byteLength(
        JSON.stringify(
          history(Array.from({ length: 12 }, () => ({ role: 'user', content: '測'.repeat(200) }))),
        ),
      ),
    ).toBeLessThan(600);
    expect(
      Buffer.byteLength(
        compactContext({ now: 'x', classes: ['測'.repeat(2000)], missing: ['imports'] }),
      ),
    ).toBeLessThanOrEqual(400);
    const logs: Obj[] = [];
    await runCase(async () => result(), {
      question: '私密問題 SECRET_MARKER',
      log: (r: Obj) => logs.push(r),
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].event).toBe('assistant.completed');
    expect(JSON.stringify(logs)).not.toMatch(/SECRET_MARKER|fixture-account|fixture-session/);
  });
});
describe('provider and transport', () => {
  it.each([
    [401, 'PROVIDER_AUTH_FAILED'],
    [403, 'PROVIDER_FORBIDDEN'],
    [429, 'PROVIDER_RATE_LIMITED'],
    [500, 'PROVIDER_UNAVAILABLE'],
  ])('classifies %i', (status, code) => expect(providerError(Number(status), '').code).toBe(code));
  it('identifies egress vs model denial', () => {
    expect(providerError(403, 'Access denied. Please check your network settings.').code).toBe(
      'PROVIDER_EGRESS_DENIED',
    );
    expect(providerError(403, 'model access blocked').code).toBe('PROVIDER_MODEL_FORBIDDEN');
  });
  it('uses only fixed Groq URL, no redirect; rejects malformed/empty output', async () => {
    const fetcher = vi.fn(async (url: unknown, init: RequestInit) => {
      expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
      expect(init.redirect).toBe('error');
      return Response.json({ choices: [{ message: { content: '' } }], usage: {} });
    });
    const model = groqModel('synthetic-only', fetcher as typeof fetch);
    await expect(
      model({ messages: [], max_completion_tokens: 100, signal: signal() }),
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' });
    await expect(
      groqModel(undefined)({ messages: [], max_completion_tokens: 100, signal: signal() }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
  it('budgets every API call including session and cannot access production in test', async () => {
    vi.stubEnv('NUNI_API_BASE_URL', 'http://127.0.0.1:4317');
    const fetcher = vi.fn(async (url: string) => {
      expect(new URL(url).origin).toBe('http://127.0.0.1:4317');
      return Response.json({
        authenticated: true,
        platformAccountId: 'pa_00000000-0000-4000-8000-000000000001',
        isPlatformOperator: false,
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const source = createAdapter(
      { sessionHandle: 'fixture', expiresAt: Date.now() + 1000 },
      'pu',
      signal(),
    );
    for (let i = 0; i < 12; i++) await source.principal();
    await expect(source.principal()).rejects.toMatchObject({ code: 'API_BUDGET_EXCEEDED' });
    expect(fetcher).toHaveBeenCalledTimes(12);
    vi.unstubAllEnvs();
  });
});

it('preview retries 429 at most once, counts the call and respects deadline', async () => {
  vi.useFakeTimers();
  let calls = 0;
  const promise = runCase(
    async () => {
      if (++calls === 1) throw new V2Error(429, 'PROVIDER_RATE_LIMITED', 1);
      return result();
    },
    { question: '你好', retry429: true },
  );
  await vi.advanceTimersByTimeAsync(1001);
  expect((await promise).modelCalls).toBe(2);
  expect(calls).toBe(2);
  const noRetry = vi.fn(async () => {
    throw new V2Error(429, 'PROVIDER_RATE_LIMITED', 60);
  });
  await expect(runCase(noRetry, { retry429: true })).rejects.toMatchObject({ status: 429 });
  expect(noRetry).toHaveBeenCalledTimes(1);
});
it('tool timeout remains partial, while the fourth call cannot execute tools', async () => {
  vi.useFakeTimers();
  const f = fixtureAdapter();
  f.adapter.dining = async () => new Promise(() => {});
  let calls = 0;
  const pending = runCase(async () => (calls++ ? result() : result('get_dining')), {
    adapter: f.adapter,
    question: '中午吃什麼',
  });
  await vi.advanceTimersByTimeAsync(4001);
  expect((await pending).steps[0]).toMatchObject({ status: 'error', summary: 'DEADLINE_EXCEEDED' });
  const repeated = await runCase(async () => result('get_today_context'), { question: '你好' });
  expect(repeated.modelCalls).toBe(4);
  expect(repeated.steps).toHaveLength(3);
  expect(f.writes).toHaveLength(0);
});
it('403 egress detection reads bounded body and opens a one minute circuit', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response('Access denied. Please check your network settings.' + 'x'.repeat(3000), {
        status: 403,
      }),
  );
  const model = groqModel('synthetic-only', fetcher);
  const input = { messages: [], max_completion_tokens: 100, signal: signal() };
  await expect(model(input)).rejects.toMatchObject({ code: 'PROVIDER_EGRESS_DENIED' });
  await expect(model(input)).rejects.toMatchObject({ code: 'PROVIDER_CIRCUIT_OPEN' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('production projections keep explicit realm scope and omit payment, pickup credentials and authors', async () => {
  vi.stubEnv('NUNI_API_BASE_URL', 'http://127.0.0.1:4317');
  vi.stubEnv(
    'CAMPUS_ASSISTANT_V2_REALM_MAP',
    JSON.stringify({ 'fixture-school': ['fixture-realm'] }),
  );
  const fetcher = vi.fn(async (url: string) => {
    const target = new URL(url);
    expect(target.origin).toBe('http://127.0.0.1:4317');
    if (target.pathname.endsWith('/realms'))
      return Response.json({
        realms: [{ tenantId: 'fixture-realm' }, { tenantId: 'other-realm' }],
      });
    if (target.pathname.endsWith('/order-a'))
      return Response.json({
        id: 'order-a',
        state: 'ready',
        locationName: '餐廳',
        pickup: { displayCode: 'SYN-12', credential: { token: 'PRIVATE_MARKER' } },
        paymentSession: { checkoutUrl: 'PRIVATE_MARKER' },
        lines: [{ nameSnapshot: '便當', quantity: 1, customerNote: 'PRIVATE_MARKER' }],
      });
    if (target.pathname.endsWith('/feed'))
      return Response.json({
        items: [
          {
            post: {
              text: '社團消息',
              author: { email: 'PRIVATE_MARKER' },
              createdAt: '2026-11-04T00:00:00Z',
            },
          },
        ],
      });
    throw new Error('unexpected fixture route');
  });
  vi.stubGlobal('fetch', fetcher);
  const source = createAdapter(
    { sessionHandle: 'fixture', expiresAt: Date.now() + 1000 },
    'fixture-school',
    signal(),
  );
  expect(await source.adapter.realms()).toEqual([
    { tenantId: 'fixture-realm', schoolId: 'fixture-school' },
  ]);
  const order = await source.adapter.order('fixture-realm', 'order-a');
  expect(order).toMatchObject({
    state: 'ready',
    pickupNumber: 'SYN-12',
    lines: [{ name: '便當', quantity: 1 }],
  });
  const feed = await source.adapter.feed('fixture-realm', 'club-a');
  expect(JSON.stringify(feed)).toContain('社團消息');
  expect(JSON.stringify({ order, feed })).not.toContain('PRIVATE_MARKER');
  vi.unstubAllEnvs();
});

it('only exposes student workspaces reviewed for the selected school', async () => {
  const ids = [1, 2, 3, 4].map((n) => 'cw_11111111-1111-4111-8111-11111111111' + n);
  const workspaces = ids.map((id) => ({ id, title: 'private account-wide title', state: 'active', memberRole: 'student' }));
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/class-workspaces')) return Response.json({ workspaces });
    expect(url).toMatch(/\/course-access\/workspace-course$/);
    const { workspaceId, schoolId } = JSON.parse(String(init.body));
    expect(schoolId).toBe('pu');
    const membership = { workspaceId, memberRole: 'student', membershipActive: true };
    if (workspaceId === ids[1]) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
    if (workspaceId === ids[2]) return Response.json({ ...membership, status: 'unreviewed', course: null });
    expect(workspaceId).toBe(ids[0]);
    return Response.json({ ...membership, status: 'reviewed', course: {
      workspaceId, schoolId, id: 'ccd_11111111-1111-4111-8111-111111111111',
      version: 1, verification: 'administrator-reviewed', academicYear: '115', semester: '1',
      courseCode: 'CS301', teacher: '老師', className: '三甲', title: '本校已核對課程',
    } });
  });
  vi.stubGlobal('fetch', fetcher);
  const { adapter } = createAdapter({ sessionHandle: 'fixture', expiresAt: now + 1000 }, 'pu', signal());
  const tools = createTools(adapter, { ...binding, schoolId: 'pu' }, secret, now, false);
  expect((await tools.call('list_courses', {})).value).toEqual({
    courses: [{ id: ids[0], title: '本校已核對課程' }], truncated: true,
  });
  for (const workspaceId of ids.slice(1))
    await expect(tools.call('get_course_work', { workspaceId })).rejects.toMatchObject({ code: 'FORBIDDEN_SCOPE' });
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it('rejects signed wrong stage, lifetime and revision mutation', async () => {
  const card = signCard(binding, 'propose_personal_event', event, 1, secret, now);
  const payload = JSON.parse(Buffer.from(card.token.split('.')[0], 'base64url').toString());
  const altered = (patch: Obj) => {
    const body = Buffer.from(canonical({ ...payload, ...patch })).toString('base64url');
    const signature = createHmac('sha256', secret)
      .update('nuni-assistant-v2-confirm\0' + body)
      .digest('base64url');
    return { token: body + '.' + signature, args: event };
  };
  for (const patch of [
    { stage: 'preview' },
    { exp: now + 600000 },
    { revision: -1 },
    { argsHash: 'forged' },
  ])
    expect(() => verifyCard(binding, altered(patch), secret, now)).toThrow();
  const f = fixtureAdapter();
  await expect(
    confirm(binding, altered({ revision: 0 }), secret, now, f.adapter, true),
  ).rejects.toMatchObject({ status: 409 });
  expect(f.writes).toHaveLength(0);
});
it('concurrent confirmation cannot duplicate an event', async () => {
  const f = fixtureAdapter(),
    card = signCard(binding, 'propose_personal_event', event, 1, secret, now);
  const input = { token: card.token, args: card.args };
  const results = await Promise.allSettled([
    confirm(binding, input, secret, now, f.adapter, true),
    confirm(binding, input, secret, now, f.adapter, true),
  ]);
  expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
  expect(f.writes).toHaveLength(1);
  expect(f.snapshot().records.filter((r) => r.id === card.mutationId)).toHaveLength(1);
});
it('known tool malformed JSON returns bounded error and missing data remains marked', async () => {
  let calls = 0;
  const f = fixtureAdapter();
  f.adapter.ledger = async () => {
    throw new V2Error(403, 'FORBIDDEN');
  };
  const reply = await runCase(async () => (calls++ ? result() : result('get_today_context', '{')), {
    adapter: f.adapter,
  });
  expect(reply.steps[0]).toMatchObject({ status: 'error', summary: 'INVALID_TOOL_ARGUMENTS' });
  expect(reply.context).toContain('personal-imports');
});

it('tool summaries remain valid bounded JSON even with escaped large data', () => {
  const value = toolSummary({ posts: [{ text: '\\'.repeat(3000) }] });
  expect(Buffer.byteLength(value)).toBeLessThanOrEqual(600);
  expect(JSON.parse(value).truncated).toBe(true);
});
