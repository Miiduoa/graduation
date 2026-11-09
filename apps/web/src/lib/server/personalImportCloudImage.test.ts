// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import { handlePersonalImportCloudImage, PERSONAL_IMPORT_VISION_MODEL } from './personalImportCloudImage';

const handle = 'ps_' + 'a'.repeat(43);
const principal = { authenticated: true, platformAccountId: 'pa_12345678-1234-1234-1234-123456789abc', isPlatformOperator: false };
function validPng() {
  const image = Buffer.alloc(68);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(image, 0);
  image.write('IHDR', 12, 'ascii');
  image.writeUInt32BE(440, 16); image.writeUInt32BE(640, 20);
  return image.toString('base64');
}
const sample = { kind: 'timetable', explicitConsent: true, mime: 'image/png', imageBase64: validPng(), academicYear: '115', semester: '1' };
const req = (body: unknown = sample, auth = true) => new NextRequest('https://nuni.tw/api/personal-import/recognize-image', {
  method: 'POST', headers: {
    Origin: 'https://nuni.tw', 'Content-Type': 'application/json',
    ...(auth ? { Authorization: 'Platform ' + handle } : {}),
  },
  body: JSON.stringify(body),
});
function setup() {
  const counter = new Map<string, Record<string, unknown>>();
  const store = {
    doc: (path: string) => ({ path }),
    runTransaction: async <T,>(fn: (tx: {
      get: (ref: { path: string }) => Promise<{ data: () => Record<string, unknown> | undefined }>;
      set: (ref: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<T>) => fn({
      get: async (ref) => ({ data: () => counter.get(ref.path) }),
      set: (ref, data) => { counter.set(ref.path, data); },
    }),
  };
  const fetcher = vi.fn().mockResolvedValue(Response.json({
    success: true, result: { response: { complete: true, rows: [
      { title: '資料庫', dayOfWeek: 3, startPeriod: '2', endPeriod: '3', location: 'A301',
        evidence: '資料庫 星期三 第2到3節 A301', uncertainFields: [] },
    ] } },
  }));
  const verifySession = vi.fn().mockResolvedValue(principal);
  const getQuotaStore = vi.fn().mockResolvedValue(store);
  return { fetcher, verifySession, getQuotaStore,
    dependencies: {
      config: { accountId: 'test', token: 'secret' }, fetcher, verifySession, getQuotaStore,
    },
  };
}
beforeEach(() => { vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw'); });
afterEach(() => { vi.unstubAllEnvs(); });

it('uploads a consented screenshot as real image_url input to a vision model and never returns the image', async () => {
  const { dependencies, fetcher, verifySession } = setup();
  const result = await handlePersonalImportCloudImage(req(), dependencies);
  expect(result.status).toBe(200);
  const sent = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(fetcher.mock.calls[0][0]).toContain(PERSONAL_IMPORT_VISION_MODEL);
  expect(sent.messages[0].content[0].type).toBe('text');
  expect(sent.messages[0].content[1]).toEqual({
    type: 'image_url', image_url: { url: 'data:image/png;base64,' + sample.imageBase64 },
  });
  expect(sent.response_format.type).toBe('json_schema');
  expect(await result.json()).toMatchObject({ provider: 'cloud-vision',
    output: expect.stringContaining('資料庫') });
  expect(result.headers.get('cache-control')).toContain('no-store');
  expect(verifySession).toHaveBeenCalledOnce();
});

it.each([
  [{ ...sample, explicitConsent: false }],
  [{ ...sample, imageBase64: 'aGVsbG8=' }],
  [{ ...sample, mime: 'image/jpeg' }],
  [{ ...sample, imageBase64: 'not base64!' }],
  [{ ...sample, kind: 'grades' }],
  [{ ...sample, unexpected: 'ignored' }],
])('rejects invalid or unapproved image before using quota or model', async (body) => {
  const { dependencies, fetcher, getQuotaStore } = setup();
  const result = await handlePersonalImportCloudImage(req(body), dependencies);
  expect(result.status).toBe(422);
  expect(fetcher).not.toHaveBeenCalled();
  expect(getQuotaStore).not.toHaveBeenCalled();
});

it('does not process an unauthenticated screenshot', async () => {
  const { dependencies, fetcher, verifySession } = setup();
  expect((await handlePersonalImportCloudImage(req(sample, false), dependencies)).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
  expect(verifySession).not.toHaveBeenCalled();
});

it('does not process a revoked account or failed model request', async () => {
  const { dependencies, fetcher, verifySession } = setup();
  verifySession.mockRejectedValueOnce(new NuniError(401, 'SIGN_IN_REQUIRED'));
  expect((await handlePersonalImportCloudImage(req(), dependencies)).status).toBe(401);
  fetcher.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
  expect((await handlePersonalImportCloudImage(req(), dependencies)).status).toBe(503);
});

it('never treats incomplete model JSON as imported lessons', async () => {
  const { dependencies, fetcher } = setup();
  fetcher.mockResolvedValueOnce(Response.json({ success: true, result: { response: { complete: false, rows: [] } } }));
  expect((await handlePersonalImportCloudImage(req(), dependencies)).status).toBe(502);
});
