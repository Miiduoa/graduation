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
const reply = (value: unknown, init?: ResponseInit) => new Response(JSON.stringify(value), init);
const options = { question: '幫我找清大的資料庫課程', schoolId: 'pu', origin: 'web' as const };
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('public course transport', () => {
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
    () => new Response('{broken'),
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
