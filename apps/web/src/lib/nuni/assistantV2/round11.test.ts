// @vitest-environment node
import { expect, it } from 'vitest';
import { bytes, type Message, type ModelInput, type Obj } from './contracts';
import { formatProviderMessages, groqModel, providerError } from './groq';
import { run } from './runner';
import { compactTransitResult, createTools } from './tools';
import {
  fixtureAdapter,
  fixtureBinding as binding,
  FIXTURE_NOW as now,
  FIXTURE_SECRET as secret,
} from './fixtures';

const usage = { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 };
const transitCall = {
  message: {
    role: 'assistant' as const,
    tool_calls: [
      {
        id: 't1',
        type: 'function' as const,
        function: { name: 'get_transit', arguments: '{"action":"campus"}' },
      },
    ],
  },
  usage,
};

function hugeTransit() {
  return {
    status: 'ready',
    kind: 'stops',
    fetchedAt: '2026-11-06T00:00:00+08:00',
    source: 'x'.repeat(4000),
    stops: Array.from({ length: 40 }, (_, i) => ({
      id: 'TCOD_' + i,
      name: '靜宜大學站' + i,
      lat: 24.226,
      lon: 120.577,
      source: 'taichung-open-data',
      routes: Array.from({ length: 24 }, (_, r) => ({
        name: 'R' + r,
        direction: '去',
        destination: '合成終點'.repeat(12),
        extra: 'y'.repeat(400),
      })),
    })),
  };
}

it('formats tool follow-up messages with string content, tool_call_id and valid arguments JSON', () => {
  const formatted = formatProviderMessages([
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 't1',
          type: 'function',
          function: { name: 'get_transit', arguments: '{bad' },
        },
      ],
    },
    {
      role: 'tool',
      tool_call_id: 12 as unknown as string,
      content: { route: '301', minutes: 8 } as unknown as string,
    },
  ]);
  expect(formatted).toEqual([
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 't1',
          type: 'function',
          function: { name: 'get_transit', arguments: '{}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: '12', content: '{"route":"301","minutes":8}' },
  ]);
  expect(formatted.every((m) => typeof m.content === 'string')).toBe(true);
  expect(JSON.stringify(formatted)).not.toContain('"content":null');
});

it('sends formatted string content to the provider instead of null', async () => {
  let body = '';
  const model = groqModel('synthetic-provider-key', async (_url, init) => {
    body = String(init?.body);
    return Response.json({
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage,
    });
  });
  await model({
    messages: [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 't1', type: 'function', function: { name: 'get_transit', arguments: '{"action":"campus"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 't1', content: '{"route":"301"}' },
    ],
    max_completion_tokens: 16,
    signal: new AbortController().signal,
  });
  const payload = JSON.parse(body) as { messages: Message[] };
  expect(payload.messages[0]?.content).toBe('');
  expect(payload.messages[1]).toMatchObject({ role: 'tool', tool_call_id: 't1', content: '{"route":"301"}' });
  expect(body).not.toContain('"content":null');
});

it('follows up get_transit like other tools with flattened string results', async () => {
  const requests: ModelInput[] = [];
  let calls = 0;
  const result = await run({
    question: '公車交通',
    history: [],
    binding,
    adapter: fixtureAdapter().adapter,
    secret,
    now,
    writes: true,
    signal: new AbortController().signal,
    log: () => {},
    model: async (input) => {
      requests.push(input);
      return ++calls === 1 ? transitCall : { message: { role: 'assistant', content: '請至公車頁確認。' }, usage };
    },
  });
  expect(requests).toHaveLength(2);
  const follow = requests[1]!;
  expect(follow.messages.some((m) => m.role === 'tool' || m.tool_calls)).toBe(false);
  expect(follow.messages.every((m) => typeof m.content === 'string')).toBe(true);
  expect(JSON.stringify(follow.messages)).not.toContain('"content":null');
  expect(follow.messages.at(-1)?.content).toContain('get_transit');
  expect(result.steps[0]).toMatchObject({ name: 'get_transit', status: 'ok' });
});

it('flattens a failed get_transit result instead of sending null tool messages', async () => {
  const f = fixtureAdapter();
  f.adapter.transit = async () => {
    throw Object.assign(new Error('invalid-query'), { code: 'invalid-query' });
  };
  const requests: ModelInput[] = [];
  let calls = 0;
  await run({
    question: '公車交通',
    history: [],
    binding,
    adapter: f.adapter,
    secret,
    now,
    writes: true,
    signal: new AbortController().signal,
    log: () => {},
    model: async (input) => {
      requests.push(input);
      if (++calls === 1) return transitCall;
      expect(input.messages.some((m) => m.role === 'tool' || m.tool_calls)).toBe(false);
      expect(input.messages.every((m) => typeof m.content === 'string')).toBe(true);
      expect(JSON.stringify(input.messages)).not.toContain('"content":null');
      expect(input.messages.at(-1)?.content).toMatch(/get_transit/);
      return { message: { role: 'assistant', content: '未查到交通資料，請至公車頁面確認：/bus' }, usage };
    },
  });
  expect(requests).toHaveLength(2);
});

it('compacts oversized get_transit payloads before the next model call', async () => {
  const f = fixtureAdapter();
  f.adapter.transit = async () => hugeTransit();
  const value = (await createTools(f.adapter, binding, secret, now, true).call('get_transit', {
    action: 'campus',
  })).value as Obj;
  expect(JSON.stringify(value)).not.toMatch(/TCOD_|taichung-open-data|24\.226/);
  expect((value.stops as unknown[]).length).toBeLessThanOrEqual(4);
  expect(bytes(value)).toBeLessThan(2500);
  expect(compactTransitResult(hugeTransit())).toEqual(value);

  const requests: ModelInput[] = [];
  let calls = 0;
  await run({
    question: '公車交通',
    history: [],
    binding,
    adapter: f.adapter,
    secret,
    now,
    writes: true,
    signal: new AbortController().signal,
    log: () => {},
    model: async (input) => {
      requests.push(input);
      return ++calls === 1 ? transitCall : { message: { role: 'assistant', content: '請至 /bus 確認。' }, usage };
    },
  });
  expect(bytes(requests[1]!.messages)).toBeLessThan(4000);
  expect(JSON.stringify(requests[1]!.messages)).not.toContain('TCOD_');
});

it('keeps a partial transit answer when the follow-up model call is rejected', async () => {
  let calls = 0;
  const result = await run({
    question: '公車交通',
    history: [],
    binding,
    adapter: fixtureAdapter().adapter,
    secret,
    now,
    writes: true,
    signal: new AbortController().signal,
    log: () => {},
    model: async () => {
      if (++calls === 1) return transitCall;
      throw providerError(400, '{"error":{"code":"invalid_request_error"}}');
    },
  });
  expect(result.modelCalls).toBe(2);
  expect(result.steps[0]).toMatchObject({ name: 'get_transit', status: 'ok' });
  expect(result.answer).toMatch(/合成301|\/bus/);
  expect(result.stopReason).toBe('PROVIDER_BAD_REQUEST');
});
