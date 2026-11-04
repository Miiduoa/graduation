// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { confirm } from './actions';
import { foodHref } from './food';
import { GROQ_URL, createProviderModel, fallbackUrl, groqModel, providerError, providerUserMessage } from './groq';
import { planningAnswer, run } from './runner';
import { createTools, selectTools } from './tools';
import { fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const cart = {
  tenantId: 'fixture-realm',
  locationId: 'dining-a',
  requestedPickupAt: '2026-11-04T12:10:00+08:00',
  items: [{ menuItemId: 'veggie', quantity: 1, selectedOptionIds: ['regular'] }],
};
const usage = { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 };

it('schedules pending work without asking for task codes', async () => {
  const tools = createTools(fixtureAdapter().adapter, binding, secret, now, true);
  const byAlias = await tools.call('propose_study_plan', { date: '2026-11-04', from: '17:00', taskId: '樹與圖作業' });
  expect(byAlias.value).toMatchObject({ planned: [expect.objectContaining({ proposed: true })] });
  const auto = createTools(fixtureAdapter().adapter, binding, secret, now, true);
  const planned = await auto.call('propose_study_plan', { date: '2026-11-04', from: '15:00' });
  expect((planned.value as { planned: unknown[] }).planned.length).toBeGreaterThan(0);
  expect(auto.cards.length).toBeGreaterThan(0);
});

it('reorders the latest own order in one step and keeps pickup time from the question', async () => {
  expect(selectTools('跟上次一樣再點一次', false)[0]).toBe('reorder_last_food_order');
  const result = await run({
    question: '跟上次一樣再點一次，12:10 去拿',
    history: [],
    binding,
    adapter: fixtureAdapter().adapter,
    secret,
    now,
    writes: true,
    signal: new AbortController().signal,
    log: () => {},
    model: async (input) =>
      input.tools?.length
        ? {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'c',
                  type: 'function',
                  function: { name: 'reorder_last_food_order', arguments: '{}' },
                },
              ],
            },
            usage,
          }
        : { message: { role: 'assistant', content: '請核對確認卡。' }, usage },
  });
  expect(result.steps.map((s) => s.name)).toEqual(['reorder_last_food_order']);
  expect(result.cards[0].args.cart).toMatchObject({
    locationId: 'dining-a',
    requestedPickupAt: '2026-11-04T12:10:00+08:00',
    items: [{ menuItemId: 'veggie', quantity: 1, selectedOptionIds: ['regular'] }],
  });
  expect(result.cards[0].args.href).toBe(foodHref(cart));
});

it('page-mode confirmation returns a prefilled food link and never submits', async () => {
  const f = fixtureAdapter(false);
  const tools = createTools(f.adapter, binding, secret, now, true);
  await tools.call('reorder_last_food_order', { requestedPickupAt: '2026-11-04T12:10:00+08:00' });
  const card = tools.cards[0];
  expect(card.args.mode).toBe('page');
  expect(String(card.args.href)).toContain('items=veggie.1.regular');
  const receipt = await confirm(binding, { token: card.token, args: card.args }, secret, now, f.adapter, true);
  expect(receipt).toMatchObject({ href: foodHref(cart) });
  expect(f.orderCalls).toHaveLength(0);
});

it('completes tomorrow planning with classes, dining and study cards', async () => {
  const result = await run({
    question: '幫我規劃明天：課、作業、吃飯',
    history: [],
    binding,
    adapter: fixtureAdapter().adapter,
    secret,
    now,
    writes: true,
    signal: new AbortController().signal,
    log: () => {},
    model: async () => ({ message: { role: 'assistant', content: '明天有空。' }, usage }),
  });
  expect(result.steps.map((s) => s.name)).toEqual(
    expect.arrayContaining(['get_day_overview', 'get_dining', 'propose_study_plan']),
  );
  expect(result.cards.length).toBeGreaterThan(0);
  expect(result.answer).toContain('依已查資料規劃如下');
  expect(result.answer).toMatch(/英文|樹與圖|合成蔬食/);
  expect(result.answer).not.toContain('資訊101');
});

it('logs Groq non-2xx status and type without secrets or user text', async () => {
  const logs: string[] = [];
  vi.spyOn(console, 'info').mockImplementation((line) => {
    logs.push(String(line));
  });
  const model = groqModel('synthetic-provider-key', async () => new Response('Access denied. Please check your network settings.', { status: 403 }));
  await expect(
    model({ messages: [{ role: 'user', content: '學號 S123456789' }], max_completion_tokens: 32, signal: new AbortController().signal }),
  ).rejects.toMatchObject({ code: 'PROVIDER_EGRESS_DENIED' });
  expect(logs.join()).toContain('"event":"provider.http_error"');
  expect(logs.join()).toContain('"provider":"groq"');
  expect(logs.join()).toContain('"status":403');
  expect(logs.join()).toContain('PROVIDER_EGRESS_DENIED');
  expect(logs.join()).not.toMatch(/synthetic-provider-key|S123456789|Access denied/);
});

it('uses the configured fallback after Groq fails and reports Chinese when both fail', async () => {
  vi.stubEnv('GROQ_API_KEY', 'synthetic-provider-key');
  vi.stubEnv('CAMPUS_ASSISTANT_V2_FALLBACK_ACCOUNT_ID', 'acct_fallback_1');
  vi.stubEnv('CAMPUS_ASSISTANT_V2_FALLBACK_API_TOKEN', 'synthetic-fallback-token');
  const usageOk = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
  const ok = {
    choices: [{ message: { role: 'assistant', content: '備援回答' }, finish_reason: 'stop' }],
    usage: usageOk,
  };
  const hits: string[] = [];
  const success = createProviderModel(async (url) => {
    hits.push(String(url));
    if (String(url) === GROQ_URL) return new Response('Access denied. Please check your network settings.', { status: 403 });
    expect(String(url)).toBe(fallbackUrl('acct_fallback_1'));
    return Response.json(ok);
  });
  const answered = await success({
    messages: [{ role: 'user', content: '你好' }],
    max_completion_tokens: 32,
    signal: new AbortController().signal,
  });
  expect(answered.message.content).toBe('備援回答');
  expect(hits).toHaveLength(2);
  const failed = createProviderModel(async (url) => {
    if (String(url) === GROQ_URL) return new Response('blocked', { status: 403 });
    return new Response('unavailable', { status: 503 });
  });
  await expect(
    failed({ messages: [{ role: 'user', content: '你好' }], max_completion_tokens: 32, signal: new AbortController().signal }),
  ).rejects.toMatchObject({ code: 'PROVIDER_ALL_FAILED' });
  expect(providerUserMessage('PROVIDER_ALL_FAILED')).toMatch(/主要與備援模型都無法連線/);
  expect(providerError(403, '').code).not.toMatch(/503/);
});

it('keeps fallback disabled when backup settings are absent', async () => {
  vi.stubEnv('GROQ_API_KEY', 'synthetic-provider-key');
  const model = createProviderModel(async () => new Response('blocked', { status: 403 }));
  await expect(
    model({ messages: [], max_completion_tokens: 8, signal: new AbortController().signal }),
  ).rejects.toMatchObject({ code: 'PROVIDER_FORBIDDEN' });
});

it('planning answer labels a complete plan without inventing classes', () => {
  const text = planningAnswer(
    [
      {
        tool: 'get_day_overview',
        result: { date: '2026-11-05', schedule: { classes: [{ title: '英文', startTime: '09:00' }] } },
      },
      { tool: 'get_dining', result: { cafeterias: [{ name: '合成蔬食餐廳' }] } },
    ],
    [],
    '幫我規劃明天吃飯',
    now,
  );
  expect(text).toContain('依已查資料規劃如下');
  expect(text).toContain('英文');
  expect(text).toContain('合成蔬食餐廳');
  expect(text).not.toContain('資訊101');
});
