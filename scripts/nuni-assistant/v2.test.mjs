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
    const directReadQuestion = '下一堂課在哪，幾點';
    assert.equal(results.filter((result) => result.question === directReadQuestion).length, 1);
    for (const result of results) {
      assert.equal(result.error, undefined);
      // The preview intentionally has no campus-map fixture. The new location
      // dependency must remain explicitly unavailable while its verified class
      // time survives; no other case may silently acquire a source failure.
      assert.equal(result.stopReason, result.caseId === 4 ? 'TASKS_INCOMPLETE' : '');
      if (result.caseId === 4) {
        assert.deepEqual(result.toolSteps.filter((step) => step.status === 'error'), [
          { name: 'get_campus_map', status: 'error', summary: 'CAMPUS_MAP_UNAVAILABLE' },
        ]);
      } else {
        assert.ok(
          result.toolSteps.every((s) => s.status !== 'error'),
          JSON.stringify(result.toolSteps),
        );
      }
      assert.equal(result.simulation, true);
      if ([3, 4].includes(result.caseId)) {
        // These explicit data queries deliberately bypass the model. Every
        // available source must succeed and retain the fixture's actual data.
        assert.equal(result.modelCalls, 0);
        assert.deepEqual(result.usage, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
        assert.equal(result.orderCalls, 0);
        assert.deepEqual(result.tools, []);
        assert.deepEqual(result.actionCards, []);
        assert.equal(result.fixtureWrites, 0);
        assert.deepEqual(
          result.toolSteps.map(({ name, status }) => ({ name, status })),
          result.caseId === 3 ? [{ name: 'get_due_work', status: 'ok' }]
            : [{ name: 'get_schedule', status: 'ok' }, { name: 'get_campus_map', status: 'error' }],
        );
        if (result.caseId === 3) {
          assert.match(result.finalAnswer, /樹與圖作業.*2026-11-05 23:59/);
          assert.match(result.finalAnswer, /程式練習.*2026-11-07 23:59/);
          assert.doesNotMatch(result.finalAnswer, /已交報告/);
        } else {
          assert.match(result.finalAnswer, /13:00–15:00.*資料結構.*資訊202/);
          assert.match(result.finalAnswer, /來源：已同步的個人課表/);
          assert.match(result.finalAnswer, /這個來源暫時無法完整讀取/);
          assert.doesNotMatch(result.finalAnswer, /座標：|已找到地點|已建立導航/);
          assert.doesNotMatch(result.finalAnswer, /程式設計|語文館|請開啟/);
        }
      } else {
        assert.ok(result.modelCalls >= 1 && result.modelCalls <= 4);
      }
      assert.ok(result.usage.total_tokens <= 7000);
      assert.doesNotMatch(JSON.stringify(result), /"token":|Bearer |GROQ_API_KEY/);
    }
    assert.deepEqual(
      results[4].tools.map((t) => t.name),
      ['reorder_last_food_order'],
    );
    assert.deepEqual(
      results[5].tools.map((t) => t.name),
      ['list_clubs', 'get_club_feed'],
    );
    assert.ok(results[0].tools.some((t) => t.name === 'get_day_overview'));
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

test('a verified map source completes next-class location without a model or a write', async () => {
  const m = await modules();
  const fixture = m.fixtureAdapter(), mapCalls = [];
  const schoolId = m.fixtureBinding.schoolId;
  const input = { question: '下一堂課在哪，幾點', history: [], binding: m.fixtureBinding,
    adapter: fixture.adapter, secret: m.FIXTURE_SECRET, now: m.FIXTURE_NOW, writes: true,
    signal: new globalThis.AbortController().signal, log: () => {},
    model: async () => assert.fail('the verified classroom-to-map task must not call a model'),
  };
  const missing = await m.run(input);
  assert.equal(missing.stopReason, 'TASKS_INCOMPLETE');
  assert.deepEqual(missing.taskPlan.steps.map(({ serviceId, status }) => ({ serviceId, status })), [
    { serviceId: 'timetable', status: 'completed' }, { serviceId: 'map', status: 'blocked' },
  ]);
  assert.match(missing.answer, /13:00–15:00.*資料結構.*資訊202/);
  assert.doesNotMatch(missing.answer, /座標：/);
  assert.equal(missing.modelCalls, 0);
  assert.deepEqual(missing.cards, []);
  fixture.adapter.campusMap = async (args) => {
    mapCalls.push(args);
    const parameters = new URLSearchParams({ schoolId, query: args.query });
    const href = '/map?' + parameters.toString();
    parameters.set('focus', 'fixture-classroom');
    return { version: 1, kind: 'map', schoolId, query: args.query, limit: args.limit,
      checkedAt: new Date(m.FIXTURE_NOW).toISOString(), source: 'school-pois',
      sourcePath: `schools/${schoolId}/pois`, status: 'ready', partial: false, resolution: 'matched', href,
      items: [{ id: 'fixture-classroom', schoolId, name: '資訊202', category: '教室', description: '',
        lat: 24.2, lng: 120.58, facilities: ['電梯'], source: 'school-pois', sourcePath: `schools/${schoolId}/pois`,
        href: '/map?' + parameters.toString(), match: 'place', verification: 'published' }],
    };
  };
  const result = await m.run(input);
  assert.equal(result.stopReason, '');
  assert.equal(result.dataRead, true);
  assert.equal(result.modelCalls, 0);
  assert.deepEqual(result.usage, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  assert.deepEqual(mapCalls, [{ query: '資訊202', limit: 5 }]);
  assert.deepEqual(result.steps.map(({ name, status }) => ({ name, status })), [
    { name: 'get_schedule', status: 'ok' }, { name: 'get_campus_map', status: 'ok' },
  ]);
  assert.deepEqual(result.taskPlan.steps.map(({ serviceId, status }) => ({ serviceId, status })), [
    { serviceId: 'timetable', status: 'completed' }, { serviceId: 'map', status: 'completed' },
  ]);
  assert.deepEqual(result.taskPlan.steps[1].dependsOn, [result.taskPlan.steps[0].id]);
  assert.match(result.answer, /13:00–15:00.*資料結構.*資訊202/);
  assert.match(result.answer, /校園：fixture-school.*查詢「資訊202」/);
  assert.match(result.answer, /資料來自校園地圖/);
  assert.match(result.answer, /座標：24\.2, 120\.58/);
  assert.match(result.answer, /尚未建立導航路線或計算到達時間/);
  assert.deepEqual(result.cards, []);
  assert.deepEqual(fixture.writes, []);
  assert.deepEqual(fixture.orderCalls, []);
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
    // Strategy comparison stays conversational; the simpler compound request
    // now deliberately uses the source-backed task runner without a model.
    question: '幫我比較兩種讀書策略，規劃明天作業與交通',
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
  assert.equal(recovered.steps[0].status, 'error');
  assert.ok(recovered.steps.slice(1).every((s) => s.status === 'ok'));
  assert.ok(recovered.cards.length >= 1);
  assert.match(recovered.answer, /依已查資料規劃如下|部分結果/);
  assert.doesNotMatch(recovered.answer, /A1|B2/);
  assert.match(recovered.answer, /未查到交通/);
});

test('direct private reads mark plain text responses, including an interrupted read', async () => {
  const m = await modules();
  const fixture = m.fixtureAdapter();
  const ledger = fixture.snapshot();
  ledger.records[0].title = '**課名** [校名](https://example.invalid)\n\u202E尾';
  fixture.adapter.ledger = async () => ledger;
  const base = {
    question: '今天課表',
    history: [],
    binding: m.fixtureBinding,
    adapter: fixture.adapter,
    secret: m.FIXTURE_SECRET,
    now: m.FIXTURE_NOW,
    writes: true,
    signal: new globalThis.AbortController().signal,
    model: async () => assert.fail('a direct read must not call the model'),
    log: () => {},
  };
  const result = await m.run(base);
  assert.equal(result.dataRead, true);
  assert.equal(result.modelCalls, 0);
  assert.match(result.answer, /\*\*課名\*\* \[校名\]\(https:\/\/example\.invalid\)/);
  assert.doesNotMatch(result.answer, /\u202E/);

  const interrupted = await m.run({
    ...base,
    adapter: { ...fixture.adapter, ledger: async () => new Promise(() => {}) },
    previewDeadlineMs: 10,
  });
  assert.equal(interrupted.dataRead, true);
  assert.equal(interrupted.modelCalls, 0);
  assert.match(interrupted.answer, /目前無法讀取已同步課表|課表目前未能讀取/);
});
