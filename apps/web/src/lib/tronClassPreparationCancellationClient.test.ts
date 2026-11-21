import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTronClassClient, parseTronClassResult } from './tronClassIntegrationClient';

const input = { operationId: 'operation_123456789', courseId: 12, homeworkId: 51, revision: 'a'.repeat(32) };
const cancelled = { status: 'cancelled', operationId: input.operationId, courseId: 12, homeworkId: 51 };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});

afterEach(() => vi.unstubAllGlobals());

describe('TronClass preparation cancellation client', () => {
  it.each(['cancelled', 'unknown'])('preserves the distinct %s result and authenticates the exact scope', async status => {
    const value = { ...cancelled, status };
    const fetch = vi.fn(async () => json(value));
    vi.stubGlobal('fetch', fetch);
    const client = createTronClassClient({ kind: 'platform', context: 'context-a' });
    expect(await client.cancelPreparation(input)).toEqual(value);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/tronclass');
    expect(JSON.parse(String(init.body))).toEqual({ ...input, action: 'cancel-preparation' });
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
    expect(new Headers(init.headers).get('X-Campus-Session')).toBe('context-a');
    expect(init.signal).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(() => parseTronClassResult('submit', value, input)).toThrow();
    expect(() => parseTronClassResult('reconcile', value, input)).toThrow();
  });

  it.each([
    {}, null, [], { ...cancelled, status: ['cancelled'] }, { ...cancelled, status: 'submitted' },
    { ...cancelled, status: 'unknown', receipt: null }, { ...cancelled, courseId: 13 },
    { ...cancelled, homeworkId: 52 }, { ...cancelled, operationId: 'another_operation_1234' },
    { ...cancelled, courseId: '12' }, { ...cancelled, confirmation: {} },
  ])('rejects malformed, mismatched or receipt-shaped responses: %j', async value => {
    vi.stubGlobal('fetch', vi.fn(async () => json(value)));
    const client = createTronClassClient({ kind: 'platform', context: 'context-a' });
    await expect(client.cancelPreparation(input)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([
    { courseId: 0 }, { homeworkId: '51' }, { operationId: ['operation_123456789'] },
    { revision: 'invalid' }, { studentId: 10 }, { href: 'https://example.test/' },
  ])('does not request authentication or send invalid input: %j', async change => {
    const getIdToken = vi.fn(async () => 'token');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const client = createTronClassClient({ kind: 'firebase', getIdToken });
    await expect(client.cancelPreparation({ ...input, ...change } as typeof input))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(getIdToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('captures the input before waiting for a token and uses it to validate the late response', async () => {
    let resolve!: (value: string) => void;
    const token = new Promise<string>(done => { resolve = done; });
    let response!: (value: Response) => void;
    const pending = new Promise<Response>(done => { response = done; });
    const fetch = vi.fn(async () => pending);
    vi.stubGlobal('fetch', fetch);
    const client = createTronClassClient({ kind: 'firebase', getIdToken: () => token });
    const mutable = { ...input };
    const result = client.cancelPreparation(mutable);
    mutable.courseId = 99;
    mutable.homeworkId = 100;
    mutable.operationId = 'another_operation_1234';
    mutable.revision = 'b'.repeat(32);
    resolve('token-a');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ ...input, action: 'cancel-preparation' });
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-a');
    response(json(cancelled));
    await expect(result).resolves.toEqual(cancelled);
  });

  it('does not retry or reinterpret a binding error as successful cancellation', async () => {
    const fetch = vi.fn(async () => json({ error: 'TRONCLASS_BINDING_CHANGED', message: '連接已變更。' }, 409));
    vi.stubGlobal('fetch', fetch);
    const client = createTronClassClient({ kind: 'platform', context: 'context-a' });
    await expect(client.cancelPreparation(input)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
