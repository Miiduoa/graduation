import process from 'node:process';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath, URL } from 'node:url';

async function modules() {
  const result = await build({
    stdin: {
      contents: `export { preview } from './apps/web/src/lib/nuni/assistantV2/preview'; export { run } from './apps/web/src/lib/nuni/assistantV2/runner'; export { providerError } from './apps/web/src/lib/nuni/assistantV2/groq'; export * from './apps/web/src/lib/nuni/assistantV2/fixtures';`,
      resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: fileURLToPath(new URL('../../apps/web/tsconfig.json', import.meta.url)),
    write: false,
    logLevel: 'silent',
  });
  return import(
    'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
  );
}
test('offline preview exercises all ten cases and confirms exactly once', async () => {
  const { preview } = await modules();
  const original = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => {
    output += chunk;
    return true;
  };
  try {
    const results = await preview(['--model=fake', '--cases=all']);
    assert.equal(results.length, 10);
    assert.equal(output.trim().split('\n').length, 10);
    for (const result of results) {
      assert.equal(result.error, undefined);
      assert.equal(result.stopReason, '');
      assert.ok(
        result.toolSteps.every((s) => s.status !== 'error'),
        JSON.stringify(result.toolSteps),
      );
      assert.equal(result.simulation, true);
      assert.ok(result.modelCalls >= 1 && result.modelCalls <= 4);
      assert.ok(result.usage.total_tokens <= 7000);
      assert.doesNotMatch(JSON.stringify(result), /"token":|Bearer |GROQ_API_KEY/);
    }
    assert.deepEqual(
      results[4].tools.map((t) => t.name),
      [
        'list_food_orders',
        'get_food_order',
        'get_food_locations',
        'get_food_menu',
        'propose_food_order',
      ],
    );
    assert.deepEqual(
      results[5].tools.map((t) => t.name),
      ['list_clubs', 'get_club_feed'],
    );
    assert.ok(results[0].tools.some((t) => t.name === 'get_day_overview'));
    assert.ok(results[2].tools.some((t) => t.name === 'get_due_work'));
    assert.ok(results[9].tools.some((t) => t.name === 'get_day_overview'));
    assert.equal(results[0].actionCards.length, 2);
    assert.equal(results[7].fixtureWrites, 1);
    assert.equal(results[7].eventCount, 1);
    assert.equal(results[7].confirmationResults[1].replay, true);
    assert.equal(results.filter((r) => r.fixtureWrites).length, 1);
    const food = await preview(['--model=fake', '--ordering=on', '--cases=food']);
    assert.equal(food.length, 2);
    for (const r of food) {
      assert.equal(r.orderCalls, 1);
      assert.equal(r.confirmationResults[1].replay, true);
    }
    await assert.rejects(preview(['--model=unknown']));
    await assert.rejects(preview(['--base-url=https://example.invalid']));
  } finally {
    process.stdout.write = original;
  }
});

test('fake model failures recover, flatten the last request, sanitize args and block transit inventions', async () => {
  const m = await modules();
  const reply = (name, args = {}) => ({
    message: name
      ? {
          role: 'assistant',
          tool_calls: [
            { id: 'c', type: 'function', function: { name, arguments: JSON.stringify(args) } },
          ],
        }
      : { role: 'assistant', content: 'A1/B2 每10分鐘一班' },
    usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 },
  });
  const base = {
    question: '規劃明天作業與交通',
    history: [],
    binding: m.fixtureBinding,
    adapter: m.fixtureAdapter().adapter,
    secret: m.FIXTURE_SECRET,
    now: m.FIXTURE_NOW,
    writes: true,
    signal: new globalThis.AbortController().signal,
    log: () => {},
  };
  let calls = 0;
  const recovered = await m.run({
    ...base,
    model: async (input) => {
      calls++;
      if (calls === 1) throw m.providerError(400, '{"error":{"code":"tool_use_failed"}}');
      if (calls === 2) return reply('get_due_work', { extra: 'ignored' });
      if (calls === 3)
        return reply('propose_study_plan', { date: '2026-11-05', taskIds: ['樹與圖作業'] });
      assert.equal(input.tools, undefined);
      assert.equal(input.tool_choice, undefined);
      assert.ok(input.messages.every((r) => r.role !== 'tool' && !r.tool_calls));
      assert.match(input.messages.at(-1).content, /trust="untrusted"/);
      return reply();
    },
  });
  assert.equal(recovered.modelCalls, 4);
  assert.deepEqual(
    recovered.steps.map((s) => s.status),
    ['error', 'ok', 'ok'],
  );
  assert.equal(recovered.cards.length, 1);
  assert.match(recovered.answer, /部分結果/);
  assert.doesNotMatch(recovered.answer, /A1|B2/);
  assert.match(recovered.answer, /未查到交通/);
});
