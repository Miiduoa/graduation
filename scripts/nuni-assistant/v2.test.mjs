import process from 'node:process';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath, URL } from 'node:url';

async function modules() {
  const result = await build({
    stdin: {
      contents: `export { preview } from './apps/web/src/lib/nuni/assistantV2/preview';`,
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
      ['list_food_orders', 'get_food_order', 'get_food_locations', 'propose_food_order'],
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
