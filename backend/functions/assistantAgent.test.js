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
      if (new URL(String(url)).hostname === 'api.groq.com') {
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
      if (new URL(String(url)).hostname === 'api.groq.com') {
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

  test.each([
    [
      'nested elements and quoted angle brackets',
      '<p title="a > b">公開 <span>校務 <b>公告</b></span></p>',
      '公開 校務 公告',
    ],
    [
      'non-content elements and comments',
      '公開<script>script-secret</script><style>style-secret</style>' +
        '<template><b>template-secret</b></template><noscript>noscript-secret</noscript>' +
        '<!-- comment-secret --> <span>可見</span>',
      '公開 可見',
    ],
    [
      'malformed nested script opening',
      '公開 <<script>script-secret</script> <span>可見</span>',
      '公開 < 可見',
    ],
    [
      'unclosed script content',
      '公開<script src=x />script-secret<p>still-script-content</p>',
      '公開',
    ],
    [
      'exactly-once named and numeric entity decoding',
      'A &amp;lt;b&amp;gt; &#38;lt;i&#38;gt; &amp;amp; &quot;B&quot; &#039; ' +
        '&lt;u&gt;字&lt;/u&gt; &#x4e2d; &nbsp; 文',
      'a &lt;b&gt; &lt;i&gt; &amp; "b" \' <u>字</u> 中 文',
    ],
    [
      'deeply nested source HTML',
      '<div>'.repeat(12000) + '公開內容' + '</div>'.repeat(12000),
      '公開內容',
    ],
  ])('extracts source text safely from %s', async (_name, snippet, expected) => {
    const fetchImpl = jest.fn(async (url) => mockResponse({
      json: new URL(String(url)).hostname === 'zh.wikipedia.org'
        ? { query: { search: [{ title: '校務資訊', snippet }] } }
        : {},
    }));

    const result = await answerWithServerWebSearch('搜尋公開校園資訊', {
      schoolId: 'nthu',
      fetchImpl,
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].snippet).toBe(expected);
    expect(result.content).toContain(expected);
    expect(result.content).not.toContain('secret');
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
      if (new URL(String(url)).hostname === 'api.groq.com') return huge.response;
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
      if (new URL(String(url)).hostname === 'generativelanguage.googleapis.com') return huge.response;
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

  test.each([
    ['ntu', '國立臺灣大學'],
    ['ncku', '國立成功大學'],
    ['ntpu', '國立臺北大學'],
    ['tw-pu', '靜宜大學'],
    ['pu', '靜宜大學'],
  ])(
    'implicit route origin uses verified selected-school label for %s',
    async (schoolId, expectedOrigin) => {
      const result = await answerWithServerWebSearch('怎麼去火車站？', { schoolId });
      expect(result.content).toContain(`${expectedOrigin} → 火車站`);
      expect(result.content).toContain(encodeURIComponent(expectedOrigin));
      if (schoolId === 'pu' || schoolId === 'tw-pu') {
        expect(result.content).toContain('靜宜大學');
      } else {
        expect(result.content).not.toMatch(/靜宜大學 →/);
        expect(result.sources.every((source) => !String(source.source || '').includes('公車'))).toBe(
          true,
        );
      }
    },
  );

  test('unknown school implicit route asks for origin and never defaults to PU', async () => {
    const result = await answerWithServerWebSearch('怎麼去火車站？', { schoolId: 'unknown-school' });
    expect(result.content).toContain('無法判斷出發地');
    expect(result.content).not.toContain('靜宜大學 →');
    expect(result.content).not.toContain('origin=%E9%9D%9C%E5%AE%9C%E5%A4%A7%E5%AD%B8');
    expect(result.sources[0].url).toContain('maps/search');
  });

  test('explicit other origin is preserved even when selected school differs', async () => {
    const result = await answerWithServerWebSearch('從台大怎麼去台北車站？', { schoolId: 'pu' });
    expect(result.content).toContain('台大 → 台北車站');
    expect(result.content).not.toMatch(/靜宜大學 →/);
  });

  test('known explicit PU route remains supported without selected school', async () => {
    const result = await answerWithServerWebSearch('從靜宜大學怎麼去台中車站？');
    expect(result.content).toContain('靜宜大學 → 台中車站');
    expect(result.sources.some((source) => source.source.includes('公車'))).toBe(true);
  });

  test('weather for non-PU selected school without locality never fetches PU coordinates', async () => {
    const fetchImpl = jest.fn();
    const result = await answerWithServerWebSearch('今天會下雨嗎？', {
      schoolId: 'ntu',
      fetchImpl,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.weatherUnavailable).toBe(true);
    expect(result.content).toMatch(/無法查|不能依所選學校自動查天氣/);
    expect(result.content).not.toMatch(/已驗證|座標/);
    expect(result.content).not.toContain('沙鹿');
    expect(result.suggestions.join(' ')).not.toMatch(/靜宜/);
  });

  test('weather for unknown named locality never fetches PU coordinates', async () => {
    const fetchImpl = jest.fn();
    for (const query of [
      '高雄天氣如何？',
      '臺北今天天氣',
      '東京今天天氣',
      '巴黎天氣',
      '紐約今天會下雨嗎',
      '明天的香港天氣',
    ]) {
      fetchImpl.mockClear();
      const result = await answerWithServerWebSearch(query, {
        schoolId: 'pu',
        fetchImpl,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(result.weatherUnavailable).toBe(true);
      expect(result.weatherReason).toBe('unknown_locality');
      expect(result.content).not.toContain('我剛剛連網查到');
      expect(result.content).not.toContain('台中市沙鹿區靜宜大學');
      expect(result.content).not.toMatch(/已驗證|座標/);
    }

    fetchImpl.mockClear();
    const mixed = await answerWithServerWebSearch('東京今天天氣', {
      schoolId: 'ncku',
      fetchImpl,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mixed.weatherUnavailable).toBe(true);
    expect(mixed.weatherReason).toBe('unknown_locality');
  });

  test('ordinary PU 帶傘/下雨 weather uses ShaLu; explicit PU locality still works', async () => {
    const fetchImpl = jest.fn(async () =>
      mockResponse({
        json: {
          current: {
            time: '2026-10-24T12:00',
            temperature_2m: 28,
            relative_humidity_2m: 70,
            precipitation: 0,
            rain: 0,
            weather_code: 1,
            wind_speed_10m: 8,
          },
        },
      }),
    );

    for (const query of ['今天需要帶傘嗎？', '今天會下雨嗎？', '今天天氣？', '今天的天氣怎麼樣']) {
      fetchImpl.mockClear();
      const selected = await answerWithServerWebSearch(query, {
        schoolId: 'tw-pu',
        fetchImpl,
      });
      expect(selected.content).toContain('沙鹿');
      expect(String(fetchImpl.mock.calls[0][0])).toContain('latitude=24.226');
      expect(String(fetchImpl.mock.calls[0][0])).toContain('longitude=120.563');
    }

    fetchImpl.mockClear();
    const explicit = await answerWithServerWebSearch('靜宜今天天氣？', {
      schoolId: 'ntu',
      fetchImpl,
    });
    expect(explicit.content).toContain('沙鹿');
    expect(String(fetchImpl.mock.calls[0][0])).toContain('latitude=24.226');
  });

  test('school-topic web grounding uses selected school only when question is implicit', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('wikipedia')) {
        return mockResponse({
          json: {
            query: {
              search: [
                {
                  title: '選課',
                  snippet: '選課說明',
                  timestamp: '2026-10-24T00:00:00Z',
                },
              ],
            },
          },
        });
      }
      return mockResponse({ json: {} });
    });

    await answerWithServerWebSearch('選課規定是什麼？', { schoolId: 'ncku', fetchImpl });
    const schoolTopicUrl = String(fetchImpl.mock.calls.find(([url]) => String(url).includes('wikipedia'))[0]);
    expect(decodeURIComponent(schoolTopicUrl)).toContain('國立成功大學');

    fetchImpl.mockClear();
    await answerWithServerWebSearch('臺大宿舍規定', { schoolId: 'pu', fetchImpl });
    const otherSchoolUrl = String(fetchImpl.mock.calls.find(([url]) => String(url).includes('wikipedia'))[0]);
    expect(decodeURIComponent(otherSchoolUrl)).toContain('臺大宿舍規定');
    expect(decodeURIComponent(otherSchoolUrl)).not.toContain('靜宜大學');

    fetchImpl.mockClear();
    await answerWithServerWebSearch('什麼是光合作用？', { schoolId: 'ncku', fetchImpl });
    const generalUrl = String(fetchImpl.mock.calls.find(([url]) => String(url).includes('wikipedia'))[0]);
    expect(decodeURIComponent(generalUrl)).toContain('光合作用');
    expect(decodeURIComponent(generalUrl)).not.toContain('國立成功大學');
  });
});
