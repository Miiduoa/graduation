// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import {
  createTronClassBoundedMediaFetch, createTronClassDownloadFetch,
  type TronClassDownloadFetch,
} from './tronClassDownloadTransport';

const schoolUrl = 'https://tronclass.pu.edu.tw/api/uploads/501/blob';
// Synthetic values in the independently observed public media URL shape.
const mediaUrl = `https://media.pu.edu.tw/download/file/${'a'.repeat(40)}?timestamp=1795000000&token=${'b'.repeat(32)}&name=${encodeURIComponent('課堂報告.pdf')}`;
const bytes = Buffer.from('%PDF-synthetic');
const fileResponse = () => new Response(bytes, { headers: {
  'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length),
} });
function fixture(location = mediaUrl) {
  const schoolFetch = vi.fn<TronClassDownloadFetch>(async () => new Response(null, { status: 302, headers: { Location: location } }));
  const mediaFetch = vi.fn<TronClassDownloadFetch>(async () => fileResponse());
  const check = vi.fn(async () => {});
  const fetch = createTronClassDownloadFetch({ schoolFetch, mediaFetch });
  return { schoolFetch, mediaFetch, check, fetch };
}

describe('one authorized school-to-media download', () => {
  it('returns direct school files without a second request', async () => {
    const f = fixture();
    const response = fileResponse();
    f.schoolFetch.mockResolvedValue(response);
    expect(await f.fetch(schoolUrl)).toBe(response);
    expect(f.mediaFetch).not.toHaveBeenCalled();
  });

  it('downloads the signed PU media file with the same signal and no school or platform credentials', async () => {
    const f = fixture();
    const signal = new AbortController().signal;
    const response = await f.fetch(schoolUrl, {
      headers: { Cookie: 'session=private', Authorization: 'Bearer private', 'X-XSRF-TOKEN': 'private',
        'X-Campus-Session': 'private', Referer: 'https://tronclass.pu.edu.tw/course/101' },
      signal,
    }, f.check);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(f.schoolFetch).toHaveBeenCalledExactlyOnceWith(schoolUrl, expect.objectContaining({
      method: 'GET', redirect: 'manual', signal,
      headers: expect.objectContaining({ Cookie: 'session=private' }),
    }));
    expect(f.mediaFetch).toHaveBeenCalledExactlyOnceWith(mediaUrl, {
      method: 'GET', redirect: 'manual', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal,
      headers: { Accept: 'application/octet-stream, */*', 'Accept-Encoding': 'identity' },
    });
    expect(f.check).toHaveBeenCalledOnce();
    expect(f.check.mock.invocationCallOrder[0]).toBeGreaterThan(f.schoolFetch.mock.invocationCallOrder[0]);
    expect(f.check.mock.invocationCallOrder[0]).toBeLessThan(f.mediaFetch.mock.invocationCallOrder[0]);
    expect(JSON.stringify(f.mediaFetch.mock.calls)).not.toContain('private');
  });

  it('stops before the media request if the owner or binding changed', async () => {
    const f = fixture();
    f.check.mockRejectedValue(new NuniError(409, 'TRONCLASS_BINDING_CHANGED'));
    await expect(f.fetch(schoolUrl, {}, f.check)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    expect(f.mediaFetch).not.toHaveBeenCalled();
  });

  it('shares cancellation across the redirect instead of starting a new deadline', async () => {
    const f = fixture();
    const controller = new AbortController();
    f.check.mockImplementation(async () => { controller.abort(); });
    await expect(f.fetch(schoolUrl, { signal: controller.signal }, f.check)).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_TIMEOUT' });
    expect(f.mediaFetch).not.toHaveBeenCalled();
  });

  it('cancels a late media response after the caller stops the operation', async () => {
    const f = fixture();
    const controller = new AbortController();
    const cancel = vi.fn();
    f.mediaFetch.mockImplementation(async () => {
      controller.abort();
      return new Response(new ReadableStream({ cancel }));
    });
    await expect(f.fetch(schoolUrl, { signal: controller.signal })).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_TIMEOUT' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([301, 302, 303, 307, 308])('does not follow a second %s redirect', async status => {
    const f = fixture();
    const cancel = vi.fn();
    f.mediaFetch.mockResolvedValue(new Response(new ReadableStream({ cancel }), { status, headers: { Location: mediaUrl } }));
    await expect(f.fetch(schoolUrl)).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_REDIRECT_UNSUPPORTED' });
    expect(f.schoolFetch).toHaveBeenCalledOnce();
    expect(f.mediaFetch).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([401, 403])('treats media %s as an unavailable file, preserving the school connection', async status => {
    const f = fixture();
    f.mediaFetch.mockResolvedValue(new Response(null, { status }));
    await expect(f.fetch(schoolUrl)).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_UNAVAILABLE', status: 503 });
  });

  it.each([
    mediaUrl.replace('https:', 'http:'),
    mediaUrl.replace('media.pu.edu.tw', 'media.pu.edu.tw.attacker.test'),
    mediaUrl.replace('media.pu.edu.tw', 'other.pu.edu.tw'),
    mediaUrl.replace('media.pu.edu.tw', '127.0.0.1'),
    mediaUrl.replace('media.pu.edu.tw', 'user:password@media.pu.edu.tw'),
    mediaUrl.replace('media.pu.edu.tw', 'media.pu.edu.tw:443'),
    mediaUrl.replace('/download/file/', '/download/other/'),
    mediaUrl.replace('a'.repeat(40), 'a'.repeat(39)),
    mediaUrl.replace('/download/file/', '/private/../download/file/'),
    `${mediaUrl}&url=https%3A%2F%2Fother.test`,
    `${mediaUrl}&token=${'c'.repeat(32)}`,
    mediaUrl.replace('&token=' + 'b'.repeat(32), ''),
    mediaUrl.replace('timestamp=1795000000', 'timestamp=1e9'),
    mediaUrl.replace('b'.repeat(32), 'b'.repeat(31)),
    `${mediaUrl}#fragment`,
    mediaUrl.replace(/name=.*/, 'name=notes%0D%0A.pdf'),
  ])('rejects an unverified destination before sending anything to it: %s', async location => {
    const f = fixture(location);
    const result = f.fetch(schoolUrl);
    await expect(result).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_REDIRECT_UNSUPPORTED' });
    await expect(result).rejects.not.toHaveProperty('message', expect.stringContaining('token='));
    expect(f.mediaFetch).not.toHaveBeenCalled();
  });

  it('does not use the school fetch as an arbitrary initial origin', async () => {
    const f = fixture();
    await expect(f.fetch(mediaUrl)).rejects.toMatchObject({ code: 'TRONCLASS_INVALID_INPUT' });
    expect(f.schoolFetch).not.toHaveBeenCalled();
    expect(f.mediaFetch).not.toHaveBeenCalled();
  });
});

type RequestFn = NonNullable<Parameters<typeof createTronClassBoundedMediaFetch>[0]>;
function transport(status = 200, headers: IncomingHttpHeaders = {}, maximum = 32) {
  let callback: ((response: IncomingMessage) => void) | undefined;
  const req = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
  const upstream = Object.assign(new EventEmitter(), { statusCode: status, headers });
  const request = vi.fn<RequestFn>((_options, handler) => { callback = handler; return req as unknown as ReturnType<RequestFn>; });
  return { request, req, upstream, fetch: createTronClassBoundedMediaFetch(request, maximum),
    sendHeaders: () => callback?.(upstream as unknown as IncomingMessage) };
}

describe('bounded media bytes', () => {
  it('preserves the signed path and query, strips credentials and omits response cookies', async () => {
    const f = transport(200, { 'content-type': 'application/pdf', 'content-length': String(bytes.length), 'set-cookie': ['private=source'] });
    const pending = f.fetch(mediaUrl, { headers: { Cookie: 'private', Authorization: 'private', Referer: 'private', 'X-XSRF-TOKEN': 'private' } });
    f.sendHeaders();
    f.upstream.emit('data', bytes);
    f.upstream.emit('end');
    const response = await pending;
    const expected = new URL(mediaUrl);
    expect(f.request).toHaveBeenCalledWith(expect.objectContaining({ hostname: 'media.pu.edu.tw', family: 4,
      path: expected.pathname + expected.search, headers: { accept: 'application/octet-stream, */*', 'accept-encoding': 'identity' },
    }), expect.any(Function));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it('does not buffer excessive media bytes or continue after cancellation', async () => {
    const oversized = transport(200, { 'content-length': '33' });
    const rejected = expect(oversized.fetch(mediaUrl)).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_TOO_LARGE' });
    oversized.sendHeaders();
    await rejected;
    expect(oversized.req.destroy).toHaveBeenCalledOnce();
    const cancelled = transport();
    const controller = new AbortController();
    const pending = expect(cancelled.fetch(mediaUrl, { signal: controller.signal })).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_TIMEOUT' });
    cancelled.sendHeaders();
    controller.abort();
    cancelled.upstream.emit('data', bytes);
    cancelled.upstream.emit('end');
    await pending;
    expect(cancelled.req.destroy).toHaveBeenCalledOnce();
  });
});
