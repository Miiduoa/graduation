const { z } = require('zod');
const {
  MAX_PROVIDER_RESPONSE_BYTES,
  MAX_TOOL_ARGUMENTS_UTF8_BYTES,
  MAX_TOOL_CALLS_PER_ROUND,
  answerWithServerWebSearch,
  buildToolDefinitions,
  callAssistantModel,
  callAssistantModelWithTools,
  normalizeAssistantActions,
  parseProviderOrder,
  readResponseJsonBounded,
  resolvePermissionScope,
  shouldUseServerWebSearch,
} = require('./assistantAgent');

function mockResponse({
  ok = true,
  status = 200,
  json = {},
  text,
  retryAfter = null,
  contentLength = undefined,
  bodyBytes = null,
}) {
  const payload = text !== undefined ? String(text) : JSON.stringify(json);
  const bytes = bodyBytes != null ? bodyBytes : Buffer.from(payload, 'utf8');
  let offset = 0;
  return {
    ok,
    status,
    headers: {
      get(name) {
        const lower = name.toLowerCase();
        if (lower === 'retry-after') return retryAfter;
        if (lower === 'content-length') {
          if (contentLength === null) return null;
          if (contentLength !== undefined) return String(contentLength);
          return String(bytes.length);
        }
        return null;
      },
    },
    body: {
      getReader() {
        return {
          async read() {
            if (offset >= bytes.length) return { done: true, value: undefined };
            const value = Uint8Array.from(bytes.subarray(offset));
            offset = bytes.length;
            return { done: false, value };
          },
          async cancel() {
            offset = bytes.length;
          },
        };
      },
    },
    async json() {
      return JSON.parse(Buffer.from(bytes).toString('utf8'));
    },
    async text() {
      return Buffer.from(bytes).toString('utf8');
    },
  };
}

/** Real fetch Response + ReadableStream; no Content-Length; text() must not be the production path. */
function createHugeStreamingErrorResponse({
  status = 400,
  totalBytes = MAX_PROVIDER_RESPONSE_BYTES + 256 * 1024,
  chunkSize = 64 * 1024,
  prefix = 'provider_error_prefix ',
} = {}) {
  let cancelled = false;
  let enqueued = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (cancelled) {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        return;
      }
      if (enqueued >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkSize, totalBytes - enqueued);
      const chunk = new Uint8Array(size);
      chunk.fill(0x61);
      if (enqueued === 0) {
        const head = Buffer.from(prefix, 'utf8');
        chunk.set(head.subarray(0, Math.min(head.length, size)), 0);
      }
      enqueued += size;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });

  const response = new Response(stream, {
    status,
    statusText: 'Bad Request',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

  return {
    response,
    getCancelled: () => cancelled,
    getEnqueued: () => enqueued,
  };
}

describe('assistant agent policy', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  test('keeps personal data intents away from public web search', () => {
    expect(shouldUseServerWebSearch('今天有什麼作業要交？', 'assignment_status')).toBe(false);
    expect(shouldUseServerWebSearch('最新公告是什麼？', 'announcements')).toBe(false);
    expect(shouldUseServerWebSearch('靜宜今天會下雨嗎？', 'general')).toBe(true);
    expect(resolvePermissionScope('assignment_status', true)).toBe('user_private');
    expect(resolvePermissionScope('credit_audit', true)).toBe('academic_private');
  });

  test('normalizes action allowlist and forces sensitive actions into confirmation', () => {
    const actions = normalizeAssistantActions(
      [
        { label: '提醒', action: 'schedule_reminder', params: { title: '作業' } },
        { label: '未知', action: 'delete_everything' },
        { label: '導頁', action: 'navigate', requiresConfirmation: false },
      ],
      'user_private',
    );

    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({
      action: 'schedule_reminder',
      requiresConfirmation: true,
      status: 'pending_confirmation',
      permissionScope: 'user_private',
    });
    expect(actions[1]).toMatchObject({
      action: 'navigate',
      requiresConfirmation: false,
      status: 'proposed',
    });
  });

  test('retries Groq 429 with retry-after before returning model output', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    process.env.GROQ_MODEL = 'qwen/qwen3-32b';
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 429, retryAfter: '0.001' }))
      .mockResolvedValueOnce(
        mockResponse({
          json: {
            choices: [{ message: { content: '後端模型回答' } }],
            usage: { total_tokens: 12 },
          },
        }),
      );

    const result = await callAssistantModel({
      providerOrder: ['groq'],
      fetchImpl,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      provider: 'groq',
      model: 'qwen/qwen3-32b',
      content: '後端模型回答',
      usage: { total_tokens: 12 },
    });
  });

  test('falls back from Groq to Gemini when the first provider fails', async () => {
    process.env.GROQ_API_KEY = 'groq-key';
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.GEMINI_MODEL = 'gemini-2.0-flash';
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('groq.com')) {
        return mockResponse({ ok: false, status: 400, text: 'bad request' });
      }
      return mockResponse({
        json: {
          candidates: [{ content: { parts: [{ text: 'Gemini 後端回答' }] } }],
          usageMetadata: { totalTokenCount: 8 },
        },
      });
    });

    const result = await callAssistantModel({
      providerOrder: ['groq', 'gemini'],
      fetchImpl,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result).toMatchObject({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      content: 'Gemini 後端回答',
      usage: { totalTokenCount: 8 },
    });
  });

  test('Groq returns tool_calls in body when toolDefs provided', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    process.env.GROQ_MODEL = 'qwen/qwen3-32b';
    const toolCall = {
      id: 'call_1',
      type: 'function',
      function: { name: 'fakeTool', arguments: '{}' },
    };
    const fetchImpl = jest.fn().mockResolvedValue(
      mockResponse({
        json: {
          choices: [{ message: { content: '', tool_calls: [toolCall] } }],
          usage: { total_tokens: 5 },
        },
      }),
    );

    const toolDefs = buildToolDefinitions([
      { name: 'fakeTool', description: '測試', inputSchema: z.object({ foo: z.string().optional() }) },
    ]);

    const result = await callAssistantModel({
      messages: [{ role: 'user', content: 'hi' }],
      toolDefs,
      fetchImpl,
      providerOrder: ['groq'],
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe('fakeTool');
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.tools?.length).toBe(1);
    expect(body.tool_choice).toBe('auto');
  });

  test('parseProviderOrder reads ASSISTANT_MODEL_PROVIDERS as groq then gemini', () => {
    process.env.ASSISTANT_MODEL_PROVIDERS = 'groq,gemini';
    expect(parseProviderOrder()).toEqual(['groq', 'gemini']);
    process.env.ASSISTANT_MODEL_PROVIDERS = ' GROQ , Gemini ';
    expect(parseProviderOrder()).toEqual(['groq', 'gemini']);
  });

  test('defaults to free Groq then Gemini provider order', async () => {
    delete process.env.ASSISTANT_MODEL_PROVIDERS;
    process.env.GROQ_API_KEY = 'groq-key';
    process.env.GEMINI_API_KEY = 'gemini-key';
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('groq.com')) {
        return mockResponse({ ok: false, status: 400, text: 'bad request' });
      }
      return mockResponse({
        json: {
          candidates: [{ content: { parts: [{ text: 'Gemini fallback' }] } }],
          usageMetadata: { totalTokenCount: 5 },
        },
      });
    });

    const result = await callAssistantModel({
      fetchImpl,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.provider).toBe('gemini');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url]) => String(url)).join('\n')).not.toContain(
      'api.openai.com',
    );
  });

  test('answers route questions with grounded sources without model calls', async () => {
    const result = await answerWithServerWebSearch('從靜宜大學怎麼去台中車站？');
    expect(result.content).toContain('Google Maps');
    expect(result.sources.some((source) => source.source.includes('公車'))).toBe(true);
  });

  test('rejects oversized provider responses before JSON.parse', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    process.env.GROQ_MODEL = 'qwen/qwen3-32b';
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OLLAMA_BASE_URL;

    const parseSpy = jest.spyOn(JSON, 'parse');
    let readerChunks = 0;
    const oversizedResponse = {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return name.toLowerCase() === 'content-length' ? null : null;
        },
      },
      body: {
        getReader() {
          let sent = false;
          return {
            async read() {
              if (sent) return { done: true, value: undefined };
              sent = true;
              readerChunks += 1;
              return {
                done: false,
                value: new Uint8Array(MAX_PROVIDER_RESPONSE_BYTES + 16),
              };
            },
            async cancel() {
              sent = true;
            },
          };
        },
      },
      async json() {
        throw new Error('json() must not be used for bounded provider reads');
      },
      async text() {
        throw new Error('unbounded text() must not be used when body stream exists');
      },
    };

    const fetchImpl = jest.fn().mockResolvedValue(oversizedResponse);

    await expect(
      callAssistantModel({
        providerOrder: ['groq'],
        fetchImpl,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).resolves.toMatchObject({ provider: 'none' });

    expect(readerChunks).toBeGreaterThan(0);
    expect(
      parseSpy.mock.calls.some(
        ([value]) => Buffer.isBuffer(value) || (typeof value === 'string' && value.length > 1000),
      ),
    ).toBe(false);

    await expect(readResponseJsonBounded(oversizedResponse, MAX_PROVIDER_RESPONSE_BYTES)).rejects.toThrow(
      /size limit/,
    );
  });

  test('cancels body when declared Content-Length exceeds provider bound', async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('{"ok":true}'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(MAX_PROVIDER_RESPONSE_BYTES + 1),
      },
    });

    await expect(readResponseJsonBounded(response, MAX_PROVIDER_RESPONSE_BYTES)).rejects.toThrow(
      /size limit/,
    );
    expect(cancelled).toBe(true);
  });

  test('Groq non-2xx huge streaming error body stays bounded and cancels', async () => {
    process.env.GROQ_API_KEY = 'groq-key';
    process.env.GROQ_MODEL = 'qwen/qwen3-32b';
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    const huge = createHugeStreamingErrorResponse({
      status: 400,
      prefix: 'groq_bad_request ',
    });
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('groq.com')) return huge.response;
      // Non-retryable failure for Ollama fallback (avoid 5xx sleep retries).
      return mockResponse({ ok: false, status: 400, text: 'unavailable' });
    });

    const result = await callAssistantModel({
      providerOrder: ['groq'],
      fetchImpl,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.provider).toBe('none');
    const groqError = result.errors?.find((entry) => entry.provider === 'groq');
    expect(groqError?.message).toMatch(/groq failed: HTTP 400/);
    expect(groqError?.message).toContain('groq_bad_request');
    expect(groqError?.message.length).toBeLessThan(280);
    expect(huge.getCancelled()).toBe(true);
    // At most a couple of 64KiB pull chunks before cancel; never the full 2MiB+ body.
    expect(huge.getEnqueued()).toBeLessThan(512 * 1024);
    expect(huge.getEnqueued()).toBeLessThan(MAX_PROVIDER_RESPONSE_BYTES);
  });

  test('Gemini non-2xx huge streaming error body stays bounded and cancels', async () => {
    delete process.env.GROQ_API_KEY;
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.GEMINI_MODEL = 'gemini-2.0-flash';

    const huge = createHugeStreamingErrorResponse({
      status: 400,
      prefix: 'gemini_bad_request ',
    });
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('generativelanguage.googleapis.com')) return huge.response;
      return mockResponse({ ok: false, status: 400, text: 'unavailable' });
    });

    const result = await callAssistantModel({
      providerOrder: ['gemini'],
      fetchImpl,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.provider).toBe('none');
    const geminiError = result.errors?.find((entry) => entry.provider === 'gemini');
    expect(geminiError?.message).toMatch(/gemini failed: HTTP 400/);
    expect(geminiError?.message).toContain('gemini_bad_request');
    expect(geminiError?.message.length).toBeLessThan(280);
    expect(huge.getCancelled()).toBe(true);
    expect(huge.getEnqueued()).toBeLessThan(512 * 1024);
    expect(huge.getEnqueued()).toBeLessThan(MAX_PROVIDER_RESPONSE_BYTES);
  });

  test('caps tool_calls per round and rejects huge/malformed args before runTool', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    process.env.GROQ_MODEL = 'qwen/qwen3-32b';

    const registry = require('./agent/tools/registry');
    const runToolSpy = jest.spyOn(registry, 'runTool').mockResolvedValue({ ok: true });

    const hugeArgs = `"${'x'.repeat(MAX_TOOL_ARGUMENTS_UTF8_BYTES + 8)}"`;

    const cappedFetch = jest
      .fn()
      .mockResolvedValueOnce(
        mockResponse({
          json: {
            choices: [
              {
                message: {
                  content: '',
                  tool_calls: Array.from({ length: MAX_TOOL_CALLS_PER_ROUND + 5 }, (_, index) => ({
                    id: `call_${index}`,
                    type: 'function',
                    function: { name: 'getTodaySchedule', arguments: '{}' },
                  })),
                },
              },
            ],
          },
        }),
      )
      .mockResolvedValue(
        mockResponse({
          json: { choices: [{ message: { content: '完成' } }] },
        }),
      );

    await callAssistantModelWithTools({
      messages: [{ role: 'user', content: '課表' }],
      toolCtx: { uid: 'u1', schoolId: 'pu' },
      fetchImpl: cappedFetch,
      providerOrder: ['groq'],
      maxRounds: 1,
    });

    expect(runToolSpy).toHaveBeenCalledTimes(MAX_TOOL_CALLS_PER_ROUND);

    runToolSpy.mockClear();
    const boundedFetch = jest
      .fn()
      .mockResolvedValueOnce(
        mockResponse({
          json: {
            choices: [
              {
                message: {
                  content: '',
                  tool_calls: [
                    {
                      id: 'call_huge_only',
                      type: 'function',
                      function: { name: 'getTodaySchedule', arguments: hugeArgs },
                    },
                    {
                      id: 'call_bad_only',
                      type: 'function',
                      function: { name: 'getTodaySchedule', arguments: '{not-json' },
                    },
                  ],
                },
              },
            ],
          },
        }),
      )
      .mockResolvedValue(
        mockResponse({
          json: { choices: [{ message: { content: 'done' } }] },
        }),
      );

    const bounded = await callAssistantModelWithTools({
      messages: [{ role: 'user', content: '課表' }],
      toolCtx: { uid: 'u1', schoolId: 'pu' },
      fetchImpl: boundedFetch,
      providerOrder: ['groq'],
      maxRounds: 1,
    });

    expect(runToolSpy).not.toHaveBeenCalled();
    expect(bounded.toolCallsTrace.map((entry) => entry.output?.error)).toEqual([
      'tool arguments too large',
      'malformed tool arguments',
    ]);
    expect(JSON.stringify(bounded.toolCallsTrace).length).toBeLessThan(500);
  });
});
