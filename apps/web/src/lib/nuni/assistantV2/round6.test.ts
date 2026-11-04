// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { bytes, type ModelInput } from './contracts';
import { providerError } from './groq';
import { partialAnswer, run, verifyProposalAnswer } from './runner';
import { createTools } from './tools';
import { fakeModel, fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret, questions } from './fixtures';

it.each([0, 1])('finishes sequential planning/ordering within four calls and 7000 tokens (%s)', async (index) => {
  const requests: ModelInput[] = [];
  const model = fakeModel(index);
  const r = await run({ question: questions[index], history: [], binding, adapter: fixtureAdapter().adapter,
    secret, now, writes: true, signal: new AbortController().signal, log: () => {},
    model: async (input) => { requests.push(input); return model(input); },
  });
  expect(r.stopReason).toBe('');
  expect(r.cards.length).toBeGreaterThan(0);
  expect(r.modelCalls).toBeLessThanOrEqual(4);
  expect(r.usage.total_tokens).toBeLessThanOrEqual(7000);
  expect(requests.at(-1)?.tools).toBeUndefined();
  for (const request of requests) expect(bytes(request) - bytes(request.signal)).toBeLessThan(7000);
  expect(requests[1].messages.some((m) => m.role === 'tool' || m.tool_calls)).toBe(false);
});
it('corrects proposal claims and requires confirmation without losing unrelated facts', async () => {
  for (const answer of ['已為您生成提案確認卡。', '已下單。', '✅ 已為您預留。', '已加入行事曆。'])
    expect(verifyProposalAnswer(answer, [])).toContain('尚未產生確認卡');
  const tools = createTools(fixtureAdapter().adapter, binding, secret, now, true);
  await tools.call('propose_open_page', { page: 'bus' });
  expect(verifyProposalAnswer('明天有英文課。✅ 已為您預留。', tools.cards))
    .toBe('明天有英文課。請核對並按下方確認卡；確認前尚未執行。');
});
it('normalizes only visible realm and previously listed location ids', async () => {
  const tools = createTools(fixtureAdapter().adapter, binding, secret, now, true);
  await tools.call('get_food_locations', { tenantId: 'fixture-REAlM' });
  expect((await tools.call('get_food_menu', { tenantId: 'FIXTURE-REALM', locationId: 'DINING-A' })).value).toHaveProperty('items');
  await expect(tools.call('get_food_menu', { tenantId: 'foreign-realm', locationId: 'dining-a' })).rejects.toMatchObject({ code: 'FORBIDDEN_SCOPE' });
  await expect(tools.call('get_food_menu', { locationId: 'foreign-location' })).rejects.toMatchObject({ code: 'FORBIDDEN_SCOPE' });
});
it('reorders from all recent orders even if the model supplies a state', async () => {
  const adapter = fixtureAdapter().adapter;
  const orders = vi.spyOn(adapter, 'orders');
  const tools = createTools(adapter, binding, secret, now, true, true);
  await tools.call('list_food_orders', { state: 'payment-pending' });
  expect(orders.mock.calls[0][2]?.state).toBeUndefined();
  adapter.orders = async () => ({ orders: [] });
  const empty = createTools(adapter, binding, secret, now, true);
  expect((await empty.call('list_food_orders', {})).value).toHaveProperty('nextStep', expect.stringContaining('省略 state'));
});
it('switches to answer only after two rejected generations instead of aborting', async () => {
  let calls = 0;
  const r = await run({ question: '規劃明天作業', history: [], binding, adapter: fixtureAdapter().adapter,
    secret, now, writes: true, signal: new AbortController().signal, log: () => {},
    model: async (input) => {
      if (++calls <= 2) throw providerError(400, '{"error":{"code":"tool_use_failed"}}');
      expect(input.tools).toBeUndefined();
      expect(input.messages.at(-1)?.content).toContain('最終簡答');
      return { message: { role: 'assistant', content: '尚未完成查詢，請重新提問。' }, usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } };
    },
  });
  expect(r.modelCalls).toBe(3);
  expect(r.stopReason).not.toBe('ABORTED');
});
it('partial work results exclude completed and overdue items and unrelated transit hints', () => {
  const result = partialAnswer([{ tool: 'get_due_work', result: {
    pending: [{ title: '待繳作業', state: 'open' }], submitted: [{ title: '已交作業' }], overdue: [{ title: '過期小考' }],
  } }], [], '這週要交什麼');
  expect(result).toContain('待繳作業');
  expect(result).not.toMatch(/已交作業|過期小考|交通|\/bus/);
});
it('keeps unknown-tool recovery feedback when compacting previously successful results', async () => {
  let calls = 0;
  await run({ question: '規劃明天作業', history: [], binding, adapter: fixtureAdapter().adapter,
    secret, now, writes: true, signal: new AbortController().signal, log: () => {},
    model: async (input) => {
      calls++;
      if (calls <= 2) return { message: { role: 'assistant', tool_calls: [{ id: 'c' + calls, type: 'function', function: {
        name: calls === 1 ? 'get_day_overview' : 'invented', arguments: calls === 1 ? '{"date":"2026-11-05"}' : '{}',
      } }] }, usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 } };
      expect(input.messages.at(-1)?.content).toContain('UNKNOWN_TOOL');
      return { message: { role: 'assistant', content: '僅完成部分查詢。' }, usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } };
    },
  });
  expect(calls).toBe(3);
});
