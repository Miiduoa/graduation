// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { createTronClassBoundedBinaryFetch, createTronClassMaterialDownloader, TRONCLASS_DOWNLOAD_MAX_BYTES } from './tronClassMaterialDownload';
import type { LmsReadonlySource } from './tronClassLmsSource';

const input = { courseId: 101, activityId: 202, uploadKey: 'upload-fixture-1', revision: 'a'.repeat(32) };
const owner = 'firebase:download-fixture';
const binding = {
  schoolId: 'pu' as const, revision: input.revision, account: 'student-fixture', userId: 303,
  userName: null, cookies: { session: 'server-only-fixture' }, expiresAt: '2026-11-20T08:00:00.000Z',
};
const material = { id: 202, course_id: 101, type: 'material', title: '課堂講義',
  uploads: [{ key: input.uploadKey, name: '第一週講義.pdf', allow_download: true }] };
const fixtureBytes = Buffer.from('%PDF-test');

function fixture(timeoutMs?: number) {
  const bindings = { requireBinding: vi.fn(async () => binding), assertCurrent: vi.fn(async () => {}) };
  const source: LmsReadonlySource = {
    fetchCourses: vi.fn(async (_cookies, options) => options.status === 'ongoing' ? [{ id: 101 }] : []),
    fetchActivities: vi.fn(async (_cookies, _course, query) => ({ ok: true as const, value: query === '' ? [material] : [] })),
    fetchHomeworkPage: vi.fn(), fetchCourseAnnouncements: vi.fn(), fetchSiteAnnouncements: vi.fn(),
  };
  const fetch = vi.fn(async () => new Response(fixtureBytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(fixtureBytes.length) } }));
  const download = createTronClassMaterialDownloader({ bindings, source, fetch, timeoutMs });
  return { bindings, source, fetch, download };
}

describe('authorized material download', () => {
  it('downloads only the owned material upload with server cookies and returns no session data', async () => {
    const f = fixture();
    const result = await f.download(owner, input);
    expect(result).toEqual({ bytes: fixtureBytes, name: '第一週講義.pdf', contentType: 'application/pdf' });
    expect(f.fetch).toHaveBeenCalledWith('https://tronclass.pu.edu.tw/api/uploads/upload-fixture-1/blob', expect.objectContaining({
      method: 'GET', redirect: 'manual', cache: 'no-store',
      headers: { Cookie: 'session=server-only-fixture', Accept: 'application/octet-stream, */*', 'Accept-Encoding': 'identity' },
    }));
    expect(f.source.fetchCourses).toHaveBeenCalledWith(binding.cookies, { userId: 303, status: 'ongoing' });
    expect(f.source.fetchCourses).toHaveBeenCalledWith(binding.cookies, { userId: 303, status: 'upcoming' });
    expect(JSON.stringify(result)).not.toContain('server-only-fixture');
  });

  it('rejects an unowned course without inspecting activities or downloading bytes', async () => {
    const f = fixture();
    await expect(f.download(owner, { ...input, courseId: 999 })).rejects.toMatchObject({ status: 403, code: 'TRONCLASS_MATERIAL_DOWNLOAD_DENIED' });
    expect(f.source.fetchActivities).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { ...material, course_id: 999 },
    { ...material, type: 'homework' },
    { ...material, hidden: true },
    { ...material, uploads: [{ key: input.uploadKey, name: 'private.pdf' }] },
    { ...material, uploads: [{ key: input.uploadKey, name: 'private.pdf', allow_download: false }] },
    { ...material, uploads: [{ key: 'different-upload', name: 'other.pdf', allow_download: true }] },
    { ...material, uploads: [...material.uploads, ...material.uploads] },
  ])('requires exact activity/course/file identity and explicit download authority: %j', async (row) => {
    const f = fixture();
    vi.mocked(f.source.fetchActivities).mockResolvedValue({ ok: true, value: [row] });
    await expect(f.download(owner, input)).rejects.toMatchObject({ status: 403 });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('tolerates only the optional courseware endpoint being absent', async () => {
    const f = fixture();
    vi.mocked(f.source.fetchActivities).mockResolvedValueOnce({ ok: true, value: [material] }).mockResolvedValueOnce({ ok: false, status: 404 });
    expect((await f.download(owner, input)).bytes).toEqual(fixtureBytes);
    const unavailable = fixture();
    vi.mocked(unavailable.source.fetchActivities).mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(unavailable.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_UNAVAILABLE' });
    expect(unavailable.fetch).not.toHaveBeenCalled();
  });

  it.each(['../other', '..', '.', 'https://other.test/file', 'a/b', 'a?query', 'a\\b', 'a\n'])('rejects a caller-controlled path or URL: %s', async (uploadKey) => {
    const f = fixture();
    await expect(f.download(owner, { ...input, uploadKey })).rejects.toMatchObject({ code: 'TRONCLASS_INVALID_INPUT' });
    expect(f.bindings.requireBinding).not.toHaveBeenCalled();
  });

  it('cancels and discards the binary response if the binding changes while fetching', async () => {
    const f = fixture();
    const cancel = vi.fn();
    f.fetch.mockImplementation(async () => {
      f.bindings.assertCurrent.mockRejectedValue(new NuniError(409, 'TRONCLASS_BINDING_CHANGED'));
      return new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'application/pdf' } });
    });
    await expect(f.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([301, 302, 307, 308])('rejects redirect %s without requesting its location', async (status) => {
    const f = fixture();
    f.fetch.mockResolvedValue(new Response(null, { status, headers: { Location: 'https://other.test/secret' } }));
    await expect(f.download(owner, input)).rejects.toMatchObject({ status: 502, code: 'TRONCLASS_DOWNLOAD_REDIRECT_UNSUPPORTED' });
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['text/html', 'application/json', 'image/svg+xml'])('rejects active or login content %s before reading it', async (type) => {
    const f = fixture();
    const cancel = vi.fn();
    f.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': type } }));
    await expect(f.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_TYPE_UNSUPPORTED' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('recognizes a login page mislabeled as a generic binary file', async () => {
    const f = fixture();
    f.fetch.mockResolvedValue(new Response('<!doctype html><form>sign in</form>', { headers: { 'Content-Type': 'application/octet-stream' } }));
    await expect(f.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
  });

  it('rejects an oversized declaration without reading the body', async () => {
    const f = fixture();
    const cancel = vi.fn();
    f.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel }), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(TRONCLASS_DOWNLOAD_MAX_BYTES + 1) },
    }));
    await expect(f.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_TOO_LARGE' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels an oversized streamed body even without a declared length', async () => {
    const f = fixture();
    const cancel = vi.fn();
    f.fetch.mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(TRONCLASS_DOWNLOAD_MAX_BYTES + 1)); }, cancel,
    }), { headers: { 'Content-Type': 'application/pdf' } }));
    await expect(f.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_TOO_LARGE' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('times out and cancels a stalled body instead of holding a buffered download indefinitely', async () => {
    const f = fixture(20);
    const cancel = vi.fn();
    f.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'application/pdf' } }));
    await expect(f.download(owner, input)).rejects.toMatchObject({ status: 504, code: 'TRONCLASS_DOWNLOAD_TIMEOUT' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('maps expired source authentication to reconnect and never downloads', async () => {
    const f = fixture();
    vi.mocked(f.source.fetchActivities).mockResolvedValue({ ok: false, status: 401 });
    await expect(f.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
    expect(f.fetch).not.toHaveBeenCalled();
  });
});

type RequestFn = NonNullable<Parameters<typeof createTronClassBoundedBinaryFetch>[0]>;
function transport(status = 200, headers: IncomingHttpHeaders = {}, maximum = 10) {
  let callback: ((response: IncomingMessage) => void) | undefined;
  const req = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
  const upstream = Object.assign(new EventEmitter(), { statusCode: status, headers });
  const request = vi.fn<RequestFn>((_options, handler) => { callback = handler; return req as unknown as ReturnType<RequestFn>; });
  return { request, req, upstream, fetch: createTronClassBoundedBinaryFetch(request, maximum),
    sendHeaders: () => callback?.(upstream as unknown as IncomingMessage) };
}
const blobUrl = 'https://tronclass.pu.edu.tw/api/uploads/fixture/blob';

describe('bounded direct binary transport', () => {
  it('pins IPv4 on the fixed school host and never forwards source response cookies', async () => {
    const f = transport(200, { 'content-type': 'application/pdf', 'set-cookie': ['secret=must-not-leak'] });
    const pending = f.fetch(blobUrl);
    f.sendHeaders();
    f.upstream.emit('data', Buffer.from('PDF'));
    f.upstream.emit('end');
    const response = await pending;
    expect(f.request).toHaveBeenCalledWith(expect.objectContaining({ hostname: 'tronclass.pu.edu.tw', family: 4, path: '/api/uploads/fixture/blob' }), expect.any(Function));
    expect(await response.text()).toBe('PDF');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each(['https://other.test/api/uploads/fixture/blob', 'http://tronclass.pu.edu.tw/api/uploads/fixture/blob', `${blobUrl}?url=other`, 'https://tronclass.pu.edu.tw/api/uploads/a%2Fb/blob'])('refuses unsafe targets before opening a socket: %s', async (url) => {
    const f = transport();
    await expect(f.fetch(url)).rejects.toMatchObject({ code: 'TRONCLASS_INVALID_INPUT' });
    expect(f.request).not.toHaveBeenCalled();
  });

  it('destroys a response before buffering an excessive declared length', async () => {
    const f = transport(200, { 'content-length': '11' });
    const pending = expect(f.fetch(blobUrl)).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_TOO_LARGE' });
    f.sendHeaders();
    await pending;
    expect(f.req.destroy).toHaveBeenCalledOnce();
    expect(() => f.upstream.emit('error', new Error('socket destroyed after headers'))).not.toThrow();
  });

  it('destroys an oversized chunked response and ignores late success', async () => {
    const f = transport();
    const pending = expect(f.fetch(blobUrl)).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_TOO_LARGE' });
    f.sendHeaders();
    f.upstream.emit('data', Buffer.alloc(6));
    f.upstream.emit('data', Buffer.alloc(5));
    f.upstream.emit('end');
    await pending;
    expect(f.req.destroy).toHaveBeenCalledOnce();
  });

  it('does not open a socket for an already cancelled request', async () => {
    const f = transport();
    await expect(f.fetch(blobUrl, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_TIMEOUT' });
    expect(f.request).not.toHaveBeenCalled();
  });

  it('destroys a pending download when cancelled and ignores a late body', async () => {
    const f = transport();
    const controller = new AbortController();
    const pending = expect(f.fetch(blobUrl, { signal: controller.signal })).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_TIMEOUT' });
    f.sendHeaders();
    controller.abort();
    f.upstream.emit('data', Buffer.from('late'));
    f.upstream.emit('end');
    await pending;
    expect(f.req.destroy).toHaveBeenCalledOnce();
  });
});
