// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { IncomingMessage, IncomingHttpHeaders } from 'node:http';
import { expect, it, vi } from 'vitest';
import { createIpv4PinnedFetch, type Ipv4RequestFn } from './campusIpv4Fetch';

function pendingResponse(status = 200, headers: IncomingHttpHeaders = {}) {
  let callback: ((response: IncomingMessage) => void) | undefined;
  const req = Object.assign(new EventEmitter(), {
    write: vi.fn(), end: vi.fn(),
    destroy: vi.fn((error?: Error) => { if (error) req.emit('error', error); }),
  });
  const response = Object.assign(new EventEmitter(), {
    statusCode: status, statusMessage: '', headers,
  });
  const request = vi.fn<Ipv4RequestFn>((_options, handler) => {
    callback = handler;
    return req as unknown as ReturnType<Ipv4RequestFn>;
  });
  return {
    fetch: createIpv4PinnedFetch(request), request, req, response,
    sendHeaders: () => callback?.(response as unknown as IncomingMessage),
  };
}

it.each([204, 205, 304])('accepts status %s with a null body, not an empty Buffer', async (status) => {
  const h = pendingResponse(status);
  const result = h.fetch('https://school.example/');
  h.sendHeaders();
  expect(() => h.response.emit('end')).not.toThrow();
  const response = await result;
  expect(response.status).toBe(status);
  expect(response.body).toBeNull();
  expect(await response.text()).toBe('');
});

it('never supplies a body for HEAD responses', async () => {
  const h = pendingResponse();
  const result = h.fetch('https://school.example/', { method: 'HEAD' });
  h.sendHeaders();
  h.response.emit('data', Buffer.from('unexpected body'));
  h.response.emit('end');
  expect((await result).body).toBeNull();
});

it.each([0, 199, 600])('rejects invalid status %s through the Promise, not the response event', async (status) => {
  const h = pendingResponse(status);
  const result = h.fetch('https://school.example/');
  const rejected = expect(result).rejects.toBeInstanceOf(RangeError);
  h.sendHeaders();
  expect(() => h.response.emit('end')).not.toThrow();
  await rejected;
});

it('turns malformed response headers into a catchable failure', async () => {
  const h = pendingResponse(200, { 'bad header': 'value' });
  const result = h.fetch('https://school.example/');
  const rejected = expect(result).rejects.toBeInstanceOf(TypeError);
  h.sendHeaders();
  expect(() => h.response.emit('end')).not.toThrow();
  await rejected;
});

it('rejects a stream closed before completion and ignores a later end event', async () => {
  const h = pendingResponse();
  const result = h.fetch('https://school.example/');
  const rejected = expect(result).rejects.toMatchObject({ code: 'ECONNRESET' });
  h.sendHeaders();
  h.response.emit('data', Buffer.from('partial'));
  h.response.emit('close');
  await rejected;
  expect(() => h.response.emit('end')).not.toThrow();
});

it('does not create or send a request that was already cancelled', async () => {
  const h = pendingResponse();
  await expect(h.fetch('https://school.example/', { signal: AbortSignal.abort() }))
    .rejects.toMatchObject({ name: 'AbortError' });
  expect(h.request).not.toHaveBeenCalled();
  expect(h.req.write).not.toHaveBeenCalled();
  expect(h.req.end).not.toHaveBeenCalled();
});

it('rejects an in-flight cancellation once and ignores a late successful body', async () => {
  const h = pendingResponse();
  const controller = new AbortController();
  const result = h.fetch('https://school.example/', { signal: controller.signal });
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  h.sendHeaders();
  controller.abort();
  h.response.emit('data', Buffer.from('stale response'));
  h.response.emit('end');
  await rejected;
  expect(h.req.destroy).toHaveBeenCalledTimes(1);
});

it('removes the abort listener after completion and does not destroy a settled request', async () => {
  const h = pendingResponse();
  const controller = new AbortController();
  const removed = vi.spyOn(controller.signal, 'removeEventListener');
  const result = h.fetch('https://school.example/', { signal: controller.signal });
  h.sendHeaders();
  h.response.emit('end');
  await result;
  expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
  controller.abort();
  expect(h.req.destroy).not.toHaveBeenCalled();
  removed.mockRestore();
});

it('retains the actual transport error code for the existing error classifier', async () => {
  const h = pendingResponse();
  const result = h.fetch('https://school.example/');
  const rejected = expect(result).rejects.toMatchObject({ code: 'ENOTFOUND' });
  h.req.emit('error', Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' }));
  await rejected;
});
