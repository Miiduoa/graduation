// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdapter } from './adapter';
import { readCampusMap } from './campusMapAdapter';
import { publicCampusFirestore } from '../../server/publicCampusFirestore';
import { withOperationSignal } from './operation';

const anonymous = vi.hoisted(() => ({ mode: 'anonymous-public-map' }));
vi.mock('../../server/publicCampusFirestore', () => ({ publicCampusFirestore: vi.fn(() => anonymous) }));
vi.mock('./campusMapAdapter', () => ({ readCampusMap: vi.fn() }));
const now = Date.parse('2026-11-17T01:00:00.000Z');
const session = { sessionHandle: 'ps_' + 'a'.repeat(43), expiresAt: now + 3600000 };

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.mocked(publicCampusFirestore).mockReturnValue(anonymous as never);
  vi.stubGlobal('fetch', vi.fn(async input => {
    if (!String(input).endsWith('/sessions/current')) throw new Error('No other platform request is expected');
    return Response.json({ authenticated: true, platformAccountId: 'pa_11111111-1111-4111-8111-111111111111', isPlatformOperator: false });
  }));
  vi.mocked(readCampusMap).mockImplementation(async ({ guard }) => {
    guard.beforeRead(); guard.afterRead();
    return { read: true } as never;
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('fixed-school anonymous map adapter', () => {
  it('requires a verified platform session and passes only public scope and bounded query to the reader', async () => {
    const source = createAdapter(session, 'pu', new AbortController().signal);
    await expect(source.adapter.campusMap!({ query: '任垣樓', limit: 5 })).rejects.toMatchObject({ status: 401 });
    expect(readCampusMap).not.toHaveBeenCalled();
    await source.principal();
    await source.adapter.campusMap!({ query: '任垣樓', limit: 5 });
    expect(readCampusMap).toHaveBeenCalledWith({ schoolId: 'pu', args: { query: '任垣樓', limit: 5 },
      guard: { db: anonymous, beforeRead: expect.any(Function), afterRead: expect.any(Function) } });
    expect(JSON.stringify(vi.mocked(readCampusMap).mock.calls)).not.toMatch(/ps_|pa_|sessionHandle|Platform /);
    expect(source.apiCalls()).toBe(2);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('counts map source reads against the existing total API budget', async () => {
    const source = createAdapter(session, 'pu', new AbortController().signal);
    await source.principal();
    for (let index = 0; index < 11; index++) await source.adapter.campusMap!({ query: '任垣樓', limit: 5 });
    expect(source.adapter.remainingApiCalls!()).toBe(0);
    await expect(source.adapter.campusMap!({ query: '任垣樓', limit: 5 })).rejects.toMatchObject({ code: 'API_BUDGET_EXCEEDED' });
  });

  it('rejects unknown scope fields and invalid bounds before loading the public source', async () => {
    const source = createAdapter(session, 'pu', new AbortController().signal);
    await source.principal();
    await expect(source.adapter.campusMap!({ query: '任垣樓', limit: 6 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(source.adapter.campusMap!({ query: '任垣樓', limit: 5, schoolId: 'nthu' } as never))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(publicCampusFirestore).not.toHaveBeenCalled();
    expect(readCampusMap).not.toHaveBeenCalled();
  });

  it('passes missing anonymous configuration to the source-aware reader without using a signed-in Firebase app', async () => {
    const source = createAdapter(session, 'pu', new AbortController().signal);
    await source.principal();
    vi.mocked(publicCampusFirestore).mockImplementation(() => { throw new Error('Missing public configuration'); });
    vi.mocked(readCampusMap).mockImplementation(async ({ guard }) => {
      expect(guard.db).toBeUndefined(); guard.afterRead();
      return { bundled: true, partial: true } as never;
    });
    await expect(source.adapter.campusMap!({ query: '任垣樓', limit: 5 })).resolves.toMatchObject({ partial: true });
    expect(source.apiCalls()).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('stops both request cancellation and per-operation cancellation before source access', async () => {
    const request = new AbortController();
    const source = createAdapter(session, 'pu', request.signal);
    await source.principal(); request.abort();
    await expect(source.adapter.campusMap!({ query: '任垣樓', limit: 5 })).rejects.toThrow();
    const active = createAdapter(session, 'pu', new AbortController().signal);
    await active.principal();
    const operation = new AbortController(); operation.abort();
    await expect(withOperationSignal(operation.signal, () => active.adapter.campusMap!({ query: '任垣樓', limit: 5 })))
      .rejects.toThrow();
    expect(readCampusMap).not.toHaveBeenCalled();
  });
});
