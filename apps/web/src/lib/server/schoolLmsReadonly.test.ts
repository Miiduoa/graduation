// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { dispatchFnRequest, type FnRuntime } from './fnDispatch';
import { createTronClassLmsHandler } from './tronClassLmsHandler';
import type { AcademicFirestore } from './academicRecordsHandlers';
import type { LmsReadonlySource } from './tronClassLmsSource';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each([undefined, '', 'false', 'TRUE', '1', ' true '])('blocks dispatch and direct handler before any dependency with value %s', async (value) => {
  vi.stubEnv('SCHOOL_LMS_READONLY_ENABLED', value);
  const fetch = vi.fn(() => { throw new Error('unexpected upstream'); });
  vi.stubGlobal('fetch', fetch);
  const touch = vi.fn(() => { throw new Error('unexpected dependency'); });
  const db = new Proxy({}, { get: touch });
  const source = new Proxy({}, { get: touch }) as LmsReadonlySource;
  const runtime = { db, verifyIdToken: touch, lmsReadonlySource: source } as unknown as FnRuntime;
  for (const supplied of [runtime, undefined, null]) {
    const response = await dispatchFnRequest('getMyTronClassLms', new Request('https://nuni.tw/api/fn/getMyTronClassLms', { method: 'POST' }), supplied);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { status: 'NOT_FOUND' } });
  }
  const handler = createTronClassLmsHandler({ db: db as AcademicFirestore, source });
  await expect(handler({ data: {}, auth: { uid: 'one', token: { schoolId: 'pu' } } })).rejects.toMatchObject({ code: 'not-found' });
  expect(touch).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
