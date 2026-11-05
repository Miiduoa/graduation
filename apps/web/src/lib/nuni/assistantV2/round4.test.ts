// @vitest-environment node
import { expect, it } from 'vitest';
import { providerError } from './groq';
import { run, unsupportedTransit } from './runner';
import { createTools } from './tools';
import { V2Error, type Model, type ModelResult } from './contracts';
import {
  fixtureAdapter,
  fixtureBinding as binding,
  FIXTURE_NOW as now,
  FIXTURE_SECRET as secret,
} from './fixtures';
const response = (name?: string, args: unknown = {}): ModelResult => ({
  message: name
    ? {
        role: 'assistant',
        tool_calls: [
          { id: 'c', type: 'function', function: { name, arguments: JSON.stringify(args) } },
        ],
      }
    : { role: 'assistant', content: '完成' },
  usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 },
});
const ask = (model: Model, question = '交通公車') =>
  run({
    model,
    question,
    history: [],
    binding,
    adapter: fixtureAdapter().adapter,
    secret,
    now,
    writes: true,
    signal: new AbortController().signal,
    log: () => {},
  });
it('only retains whitelisted 400 subcodes', () => {
  for (const code of [
    'tool_use_failed',
    'json_validate_failed',
    'context_length_exceeded',
    'invalid_request_error',
  ])
    expect(
      providerError(400, JSON.stringify({ error: { code, message: 'private' } })),
    ).toMatchObject({ code: 'PROVIDER_BAD_REQUEST', providerCode: code });
  expect(providerError(400, '{"error":{"code":"secret"}}').providerCode).toBe(
    'invalid_request_error',
  );
});
it('flattens the fourth round to untrusted obtained results without tool metadata', async () => {
  let calls = 0;
  await ask(async (input) => {
    if (++calls < 4) return response('get_today_context');
    expect(input.tools).toBeUndefined();
    expect(input.tool_choice).toBeUndefined();
    expect(input.messages.some((m) => m.role === 'tool' || m.tool_calls)).toBe(false);
    expect(input.messages.at(-1)?.content).toContain('<results trust="untrusted">');
    return response();
  }, '你好');
  expect(calls).toBe(4);
});
it('counts tool_use_failed and unknown calls as failed steps and continues', async () => {
  let calls = 0;
  const r = await ask(async () => {
    calls++;
    if (calls === 1) throw providerError(400, '{"error":{"code":"tool_use_failed"}}');
    if (calls === 2) return response('invented');
    return response();
  });
  expect(r.modelCalls).toBe(3);
  expect(r.steps.map((s) => s.status)).toEqual(['error', 'error']);
});
it('retains deterministic partial results and cards when a later model call fails', async () => {
  let calls = 0;
  const r = await ask(async () => {
    if (++calls === 1) return response('get_due_work');
    throw new V2Error(503, 'PROVIDER_UNAVAILABLE');
  }, '作業');
  expect(r.answer).toContain('部分結果');
  expect(r.answer).toContain('樹與圖');
  expect(r.answer).toContain('/classroom');
});
it('strips unknown fields, resolves only exact unique titles, and reports available ids', async () => {
  const tools = createTools(fixtureAdapter().adapter, binding, secret, now, true);
  expect(
    (await tools.call('get_transit', { action: 'campus', city: 'Taipei', extra: true })).value,
  ).toHaveProperty('note');
  await tools.call('get_due_work', {});
  const r = await tools.call('propose_study_plan', {
    date: '2026-11-04',
    from: '17:00',
    taskIds: ['樹與圖作業'],
  });
  expect(r.value).toHaveProperty('planned');
  await expect(
    tools.call('propose_study_plan', { date: '2026-11-04', taskIds: ['樹與圖'] }),
  ).rejects.toThrow();
  expect(tools.recovery('propose_study_plan').availableIds).toContain('task-urgent');
});
it('replaces transit hallucinations without successful transit evidence', async () => {
  for (const text of [
    'A1/B2 每 10 分鐘一班、首班 06:30',
    '301路約8分鐘到站',
    '公車班距 10 分鐘',
    '紅5',
    '公車301',
  ])
    expect(unsupportedTransit(text, [])).toBe(true);
  const r = await ask(async () => ({
    ...response(),
    message: { role: 'assistant', content: 'A1/B2 每10分鐘一班' },
  }));
  expect(r.answer).not.toContain('A1');
  expect(r.answer).toContain('未查到交通');
  expect(
    unsupportedTransit('合成301約8分鐘', [{ name: 'get_transit', status: 'ok', summary: '' }]),
  ).toBe(false);
});
it('preserves generated confirmation cards after final model failure', async () => {
  let calls = 0;
  const r = await ask(async () => {
    if (++calls === 1) return response('propose_open_page', { page: 'bus' });
    throw providerError(400, '{"error":{"code":"invalid_request_error"}}');
  });
  expect(r.cards).toHaveLength(1);
  expect(r.answer).toContain('部分結果');
  expect(r.answer).toContain('確認卡');
});
