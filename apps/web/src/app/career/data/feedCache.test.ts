// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createCareerFeedCache } from './feedCache';
import { emptyCareerFeed } from '@campus/shared/src/career';
import { getText, CAREER_SOURCE_LIMIT } from './adapters';
describe('career upstream protection', () => {
  it('coalesces concurrent requests, caches by supported school and expires after 30 seconds', async () => {
    let now = 100000;
    const load = vi.fn(async () => emptyCareerFeed());
    const read = createCareerFeedCache(load, () => now);
    await Promise.all([read('pu'), read('pu'), read('pu')]);
    expect(load).toHaveBeenCalledTimes(1);
    await read('pu');
    await read('unknown');
    expect(load).toHaveBeenCalledTimes(1);
    now += 30001;
    await read('pu');
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('bounds failed upstream attempts per minute; allows retry in next window', async () => {
    let now = 100000;
    const load = vi.fn(async () => {
      throw Error('offline');
    });
    const read = createCareerFeedCache(load, () => now);
    for (let i = 0; i < 10; i++) await expect(read('pu')).rejects.toThrow('offline');
    await read('pu');
    expect(load).toHaveBeenCalledTimes(10);
    now += 60001;
    await expect(read('pu')).rejects.toThrow();
    expect(load).toHaveBeenCalledTimes(11);
  });
  it('counts streamed bytes, aborts and cancels without draining an oversized source', async () => {
    let pulls = 0;
    const cancel = vi.fn();
    let signal: AbortSignal | undefined;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      signal = options?.signal as AbortSignal;
      return new Response(
        new ReadableStream({
          pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array(CAREER_SOURCE_LIMIT / 2 + 1));
          },
          cancel,
        }),
      );
    });
    try {
      await expect(getText('https://cdif.pu.edu.tw/')).rejects.toThrow('oversized');
      expect(signal?.aborted).toBe(true);
      expect(cancel).toHaveBeenCalled();
      expect(pulls).toBeLessThanOrEqual(3);
    } finally {
      fetcher.mockRestore();
    }
  });
  it('decodes multibyte characters across chunks', async () => {
    const bytes = new TextEncoder().encode('實習');
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(bytes.slice(0, 2));
            c.enqueue(bytes.slice(2));
            c.close();
          },
        }),
      ),
    );
    try {
      expect(await getText('https://cdif.pu.edu.tw/')).toBe('實習');
    } finally {
      fetcher.mockRestore();
    }
  });
});
