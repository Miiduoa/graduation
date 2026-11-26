// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { answerPublicCourseQuestion as answer } from '@campus/shared/src/publicCourseAssistantClient';
import { resolvePublicCourseOperation } from '@campus/shared/src/publicCourseOperations';

function data(schoolId = 'nthu') {
  return {
    schoolId,
    sourceUrl: resolvePublicCourseOperation(schoolId)!.sourceUrl,
    courses: [],
    truncated: false,
    fetchedAt: '2026-11-07T11:53:52.366Z',
    operation: {
      id: schoolId + '.courses.search',
      version: 1,
      responseSchemaVersion: 1,
      access: 'anonymous-public',
    },
  };
}
const reply = (value: unknown, init?: ResponseInit) => Response.json(value, init);
const options = { question: '幫我找清大的資料庫課程', schoolId: 'pu', origin: 'web' as const };
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('public course transport', () => {
  it.each(['web', 'mobile'] as const)(
    'sends the complete filtered request from %s without any private context',
    async (origin) => {
      const filters = { weekday: 3, credits: 0 };
      const response = {
        ...data(),
        filters,
        unresolvedCount: 2,
        operation: { ...data().operation, version: 2, responseSchemaVersion: 2 },
      };
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(response));
      const result = await answer({
        ...options,
        origin,
        question: '查清大星期三0學分的課程',
        fetcher,
      });
      expect(result?.read).toMatchObject({
        status: 'ready',
        filters,
        unresolvedCount: 2,
        matchCount: 0,
      });
      const [url, init] = fetcher.mock.calls[0];
      expect(Object.fromEntries(new URL(String(url), 'https://nuni.tw').searchParams)).toEqual({
        schoolId: 'nthu',
        q: '',
        weekday: '3',
        credits: '0',
      });
      expect(init?.credentials).toBe('omit');
      expect(init?.body).toBeUndefined();
      expect(init?.headers).toEqual({ Accept: 'application/json' });
      expect(JSON.stringify(init)).not.toContain('pu');
    },
  );

  it('does not fall back to an unfiltered search when an old server cannot apply the conditions', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(data()));
    const result = await answer({ ...options, question: '查清大星期三3學分課程', fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result?.read).toMatchObject({
      status: 'unavailable',
      filters: { weekday: 3, credits: 3 },
    });
    expect(result?.content).not.toContain('0 筆');
  });

  it.each(['web', 'mobile'] as const)(
    'makes only the reviewed anonymous request from %s',
    async (origin) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(data()));
      const result = await answer({ ...options, origin, fetcher });
      expect(result?.read?.status).toBe('ready');
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe(
        (origin === 'web' ? '' : 'https://nuni.tw') +
          '/api/public-course-catalog?schoolId=nthu&q=' +
          encodeURIComponent('資料庫'),
      );
      expect(init).toEqual({
        method: 'GET',
        signal: expect.any(AbortSignal),
        credentials: 'omit',
        redirect: 'error',
        ...(origin === 'web' ? { cache: 'no-store' } : {}),
        headers: { Accept: 'application/json' },
      });
      expect(JSON.stringify(init)).not.toContain('pu');
    },
  );

  it('does not make requests for other intents or unsupported schools', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await answer({ ...options, question: '我下一堂課在哪裡？', fetcher })).toBeNull();
    expect(
      (await answer({ ...options, question: '查台大資料庫課程', fetcher }))?.read,
    ).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    () => new Response('no', { status: 502 }),
    () => new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    () => new Response(JSON.stringify(data()), { headers: { 'content-type': 'text/plain' } }),
    () => reply(data('ncnu')),
    () => reply({ ...data(), sourceUrl: 'https://example.test/courses' }),
    () => reply({ ...data(), operation: { ...data().operation, version: 2 } }),
    () => reply(data(), { headers: { 'content-length': '600000' } }),
    () => reply({ ...data(), extra: '字'.repeat(180000) }),
  ])('keeps upstream failure distinct from a valid empty result', async (makeResponse) => {
    const result = await answer({
      ...options,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(makeResponse()),
    });
    expect(result?.read?.status).toBe('unavailable');
    expect(result?.content).toContain('暫時無法取得');
    expect(result?.content).not.toContain('0 筆');
  });

  it.each([
    ['HTTP 503', { status: 503, headers: { 'content-type': 'application/json' } }, undefined],
    ['non-JSON media type', { headers: { 'content-type': 'text/html' } }, undefined],
    ['unexpected mobile final URL', { headers: { 'content-type': 'application/json' } }, 'https://untrusted.example/courses'],
  ] as Array<[string, ResponseInit, string | undefined]>)(
    'cancels an unread streaming body for %s instead of relying on fetch abort',
    async (_reason, init, redirectedUrl) => {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // An adapter may deliver headers and an open body, but ignore AbortSignal.
          controller.enqueue(new Uint8Array([123]));
        },
        cancel() { cancelled = true; },
      });
      const response = new Response(stream, init);
      if (redirectedUrl) Object.defineProperty(response, 'url', { value: redirectedUrl });
      const result = await answer({
        ...options,
        origin: redirectedUrl ? 'mobile' : 'web',
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(response),
      });
      expect(result?.read?.status).toBe('unavailable');
      expect(result?.content).toContain('暫時無法取得');
      expect(cancelled).toBe(true);
    },
  );

  it('stops an unbounded chunked course reply before buffering the full body', async () => {
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        // Missing Content-Length: the previous response.text() path buffered
        // all 1.8 MiB before rejecting, rather than stopping at the second chunk.
        if (pulls <= 6) controller.enqueue(new Uint8Array(300_000).fill(65));
        else controller.close();
      },
      cancel() { cancelled = true; },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stream, { headers: { 'content-type': 'application/json' } }),
    );
    const result = await answer({ ...options, fetcher });
    expect(result?.read?.status).toBe('unavailable');
    expect(result?.content).not.toContain('0 筆');
    expect(pulls).toBeGreaterThanOrEqual(2);
    expect(cancelled).toBe(true);
  });

  it('decodes an official Chinese course name split across streaming UTF-8 chunks', async () => {
    const course = {
      code: 'CS100', section: '01', title: '資料庫', department: '資工系',
      teacher: '王老師', time: '一2', room: '教室101', semester: '1151', credits: '3',
    };
    const bytes = new TextEncoder().encode(JSON.stringify({ ...data(), courses: [course] }));
    const chinese = bytes.findIndex((byte) => byte >= 0xe0);
    expect(chinese).toBeGreaterThan(0);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, chinese + 1));
        controller.enqueue(bytes.slice(chinese + 1));
        controller.close();
      },
    });
    const result = await answer({
      ...options,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(stream, { headers: { 'content-type': 'application/json' } }),
      ),
    });
    expect(result?.read?.status).toBe('ready');
    expect(result?.content).toContain('資料庫');
  });

  it('rejects damaged UTF-8 in a chunked Chinese course instead of accepting replacement text', async () => {
    const course = {
      code: 'CS100', section: '01', title: '資料庫', department: '資工系',
      teacher: '王老師', time: '一2', room: '教室101', semester: '1151', credits: '3',
    };
    const bytes = new TextEncoder().encode(JSON.stringify({ ...data(), courses: [course] }));
    const chinese = bytes.findIndex((byte) => byte >= 0xe0);
    expect(chinese).toBeGreaterThan(0);
    bytes[chinese + 1] = 0xff;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, chinese + 1));
        controller.enqueue(bytes.slice(chinese + 1));
        controller.close();
      },
    });
    const result = await answer({
      ...options,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(stream, { headers: { 'content-type': 'application/json' } }),
      ),
    });
    expect(result?.read?.status).toBe('unavailable');
    expect(result?.content).not.toContain('資料庫');
  });

  it('omits error and request details from failures', async () => {
    const result = await answer({
      ...options,
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error('Cookie=secret')),
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result?.read?.status).toBe('unavailable');
  });

  it('settles cancellation immediately even if fetch ignores abort, and rejects late results', async () => {
    const controller = new AbortController();
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const task = answer({ ...options, signal: controller.signal, fetcher });
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    finish(reply(data()));
    await Promise.resolve();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('cancels an unread late response after a school switch even if fetch ignores abort', async () => {
    const controller = new AbortController();
    let resolveLate!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () => new Promise<Response>((resolve) => { resolveLate = resolve; }),
    );
    const pending = answer({ ...options, signal: controller.signal, fetcher });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) { streamController.enqueue(new Uint8Array([123])); },
      cancel() { cancelled = true; },
    });
    resolveLate(new Response(stream, { headers: { 'content-type': 'application/json' } }));
    await vi.waitFor(() => expect(cancelled).toBe(true));
  });

  it('cancels a stale response when the selected school changes during fetch', async () => {
    let current = true;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) { streamController.enqueue(new Uint8Array([123])); },
      cancel() { cancelled = true; },
    });
    const response = new Response(stream, { headers: { 'content-type': 'application/json' } });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      current = false;
      return response;
    });
    await expect(answer({
      ...options,
      fetcher,
      isCurrent: () => current,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toBe(true);
  });

  it('rejects changed school/account scope after a response arrives', async () => {
    let current = true;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      current = false;
      return reply(data());
    });
    await expect(answer({ ...options, fetcher, isCurrent: () => current })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(
      await answer({ ...options, fetcher: vi.fn<typeof fetch>().mockResolvedValue(reply(data())) }),
    ).not.toBeNull();
  });

  it('times out an unresponsive request and does not turn later completion into success', async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const task = answer({ ...options, fetcher });
    await vi.advanceTimersByTimeAsync(25_000);
    expect((await task)?.read?.status).toBe('unavailable');
    finish(reply(data()));
    await Promise.resolve();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    'same',
    'https://unreviewed.example/catalog',
    'https://nuni.tw/api/public-course-catalog?schoolId=ncnu&q=資料庫',
    'https://nuni.tw/api/public-course-catalog?schoolId=nthu&q=資料庫&_=123',
  ])('checks real native fetch URL behavior: %s', async (destination) => {
    const native = createRequire(import.meta.url)('whatwg-fetch') as { fetch: typeof fetch };
    const opened: string[] = [];
    const headers: Record<string, string> = {};
    let credentials: boolean | undefined;
    class NativeXhr {
      status = 200;
      statusText = 'OK';
      responseURL = '';
      responseText = JSON.stringify(data());
      readyState = 4;
      withCredentials?: boolean;
      onload?: () => void;
      onreadystatechange?: () => void;
      onabort?: () => void;
      open(_method: string, url: string) {
        opened.push(url);
        this.responseURL = destination === 'same' ? url : destination;
      }
      setRequestHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      }
      getAllResponseHeaders() {
        return 'content-type: application/json\r\ncache-control: no-store';
      }
      send() {
        credentials = this.withCredentials;
        this.onreadystatechange?.();
        this.onload?.();
      }
      abort() {
        this.onabort?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', NativeXhr);
    const result = await answer({ ...options, origin: 'mobile', fetcher: native.fetch });
    expect(opened).toHaveLength(1);
    expect(Object.fromEntries(new URL(opened[0]).searchParams)).toEqual({
      schoolId: 'nthu',
      q: '資料庫',
    });
    expect(credentials).toBe(false);
    expect(headers).toEqual({ accept: 'application/json' });
    expect(result?.read?.status).toBe(destination === 'same' ? 'ready' : 'unavailable');
  });
});
