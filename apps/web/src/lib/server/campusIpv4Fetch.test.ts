// @vitest-environment node
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { createIpv4PinnedFetch, type Ipv4RequestFn } from './campusIpv4Fetch';

function mockRequest(onEnd?: (options: { family?: number; hostname?: string | null; method?: string }) => void): Ipv4RequestFn {
  return ((options, callback) => {
    const req = new EventEmitter() as ReturnType<Ipv4RequestFn>;
    Object.assign(req, {
      write: vi.fn(),
      end: vi.fn(() => {
        onEnd?.(options);
        const response = new EventEmitter();
        Object.assign(response, {
          statusCode: 400,
          statusMessage: 'Bad Request',
          headers: { 'set-cookie': ['session=abc; Path=/', 'other=1'] },
        });
        callback?.(response as never);
        response.emit('data', Buffer.from('login_fail'));
        response.emit('end');
      }),
      destroy: vi.fn((error?: Error) => {
        if (error) req.emit('error', error);
      }),
    });
    return req;
  }) as Ipv4RequestFn;
}

it('pins campus requests to IPv4 and keeps Set-Cookie headers', async () => {
  const seen: Array<{ family?: number; hostname?: string | null; method?: string }> = [];
  const fetchLike = createIpv4PinnedFetch(
    mockRequest((options) => {
      seen.push({ family: options.family, hostname: options.hostname, method: options.method });
    }),
  );
  const response = await fetchLike('https://tronclass.pu.edu.tw/api/login', {
    method: 'POST',
    body: '{"user_name":"changyi"}',
  });
  expect(seen).toEqual([{ family: 4, hostname: 'tronclass.pu.edu.tw', method: 'POST' }]);
  expect(response.status).toBe(400);
  expect(await response.text()).toBe('login_fail');
  expect(response.headers.getSetCookie()).toEqual(['session=abc; Path=/', 'other=1']);
});

it('rejects non-https campus URLs', async () => {
  const fetchLike = createIpv4PinnedFetch(mockRequest());
  await expect(fetchLike('http://tronclass.pu.edu.tw/api/login')).rejects.toMatchObject({
    name: 'TypeError',
  });
});

it('maps abort to AbortError without following through', async () => {
  const fetchLike = createIpv4PinnedFetch(mockRequest());
  const signal = AbortSignal.abort();
  await expect(fetchLike('https://tronclass.pu.edu.tw/api/login', { signal })).rejects.toMatchObject({
    name: 'AbortError',
  });
});
