import { afterEach, expect, it, vi } from 'vitest';
import { createTronClassClient } from './tronClassIntegrationClient';

const input = { courseId: 101, homeworkId: 202, submissionId: '501', uploadId: 601, revision: 'a'.repeat(32) };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(['platform', 'firebase'] as const)('downloads the exact historical attachment through the fixed authenticated BFF: %s', async kind => {
  const fetch = vi.fn(async () => new Response('%PDF-test', { headers: {
    'Content-Type': 'application/pdf', 'Content-Length': '9',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('報告.pdf')}`,
  } }));
  vi.stubGlobal('fetch', fetch);
  const client = createTronClassClient(kind === 'platform'
    ? { kind, context: 'test-context' } : { kind, getIdToken: async () => 'test-token' });
  const file = await client.downloadSubmissionAttachment(input);
  expect(file.filename).toBe('報告.pdf');
  expect(file.blob.size).toBe(9);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/tronclass/submission-attachment');
  expect(JSON.parse(String(init.body))).toEqual(input);
  expect(init).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
  expect(new Headers(init.headers).get(kind === 'platform' ? 'X-Campus-Session' : 'Authorization'))
    .toBe(kind === 'platform' ? 'test-context' : 'Bearer test-token');
});

it.each([
  { ...input, submissionId: '../501' }, { ...input, submissionId: '01' }, { ...input, submissionId: '1e2' },
  { ...input, uploadId: 0 }, { ...input, uploadId: '601' }, { ...input, courseId: -1 },
  { ...input, url: 'https://other.example' }, { ...input, studentId: 999 }, { ...input, revision: 'old' },
])('rejects caller-controlled targets and invalid version selectors before authentication: %j', async value => {
  const fetch = vi.fn(); const getIdToken = vi.fn(async () => 'test-token');
  vi.stubGlobal('fetch', fetch);
  const client = createTronClassClient({ kind: 'firebase', getIdToken });
  await expect(client.downloadSubmissionAttachment(value as typeof input)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  expect(fetch).not.toHaveBeenCalled(); expect(getIdToken).not.toHaveBeenCalled();
});

it('propagates caller cancellation to an active binary request without retry', async () => {
  let requestSignal: AbortSignal | null | undefined;
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    requestSignal = init?.signal;
    return await new Promise<Response>((_, reject) => requestSignal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  });
  vi.stubGlobal('fetch', fetch);
  const client = createTronClassClient({ kind: 'platform', context: 'test-context' });
  const controller = new AbortController();
  const pending = client.downloadSubmissionAttachment(input, controller.signal);
  const rejected = expect(pending).rejects.toThrow('aborted');
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  controller.abort();
  await rejected;
  expect(requestSignal?.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledOnce();
});

it('does not start a request after the account view was closed during token retrieval', async () => {
  let resolve!: (value: string) => void;
  const token = new Promise<string>(done => { resolve = done; });
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  const client = createTronClassClient({ kind: 'firebase', getIdToken: () => token });
  const pending = client.downloadSubmissionAttachment(input, controller.signal);
  controller.abort(); resolve('test-token');
  await expect(pending).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
  expect(fetch).not.toHaveBeenCalled();
});

it('preserves school permission failures instead of manufacturing a downloadable file', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    error: 'TRONCLASS_SUBMISSION_ATTACHMENT_DENIED', message: '請重新讀取繳交紀錄。',
  }), { status: 403, headers: { 'Content-Type': 'application/json' } })));
  const client = createTronClassClient({ kind: 'platform', context: 'test-context' });
  await expect(client.downloadSubmissionAttachment(input)).rejects.toMatchObject({
    code: 'TRONCLASS_SUBMISSION_ATTACHMENT_DENIED', status: 403, message: '請重新讀取繳交紀錄。',
  });
});
