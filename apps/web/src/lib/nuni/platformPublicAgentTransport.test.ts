// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createPlatformPublicAgentTransport } from './platformPublicAgentTransport';
import { projectPlatformPublicAgent } from './platformPublicAgentProjector';
import {
  createPlatformPublicAgentGateway,
  type PublicAgentAction,
} from './platformPublicAgentGateway';
import { SESSION_COOKIE, sealCookie, sessionContext } from './server';

const session = { sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3600_000 };
const op = `pago_${'1'.repeat(8)}-${'1'.repeat(4)}-${'1'.repeat(4)}-${'1'.repeat(4)}-${'1'.repeat(12)}`;
const confirmationId = op.replace('pago_', 'pagc_');
const fingerprint = 'f'.repeat(64),
  schoolId = 'pu',
  query = '從甲樓到乙館',
  requestId = 'request_0001';
const task = 'public-campus-navigation';
const request = {
  task,
  data: {
    task,
    phase: 'execute',
    schoolId,
    query,
    requestId,
    consent: { version: 1, provider: 'deterministic', schoolId, query, fingerprint },
  },
};
const from = {
  id: 'a',
  name: '甲樓',
  lat: 24,
  lng: 120,
  sourceUrl: 'https://www.openstreetmap.org/way/1',
};
const to = {
  id: 'b',
  name: '乙館',
  lat: 24.1,
  lng: 120.1,
  sourceUrl: 'https://www.openstreetmap.org/way/2',
};
const url =
  'https://www.google.com/maps/dir/?api=1&origin=24%2C120&destination=24.1%2C120.1&travelmode=walking';
const receipt = {
  kind: 'walking-route',
  from,
  to,
  url,
  sourceDate: '2026-10-19',
  sourceLabel: 'OSM',
  mode: 'deterministic',
};
const result = { task, schoolId, sourceFingerprint: fingerprint, checkedAt: 123, receipt };
const complete = { status: 'completed', operationId: op, expiresAt: 456, result };
const preview = {
  request,
  receipt,
  checkedAt: 123,
  dataScope: ['所選校園', '起點與終點', '公開地點目錄'],
  execution: 'deterministic',
};
const fetcher = vi.fn();
const signal = () => new AbortController().signal;
const transport = () => createPlatformPublicAgentTransport(100);
const body = { confirmationId, request };
beforeEach(() => {
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.example.test');
  vi.stubEnv('BFF_SESSION_SECRET', 'synthetic-test-session-secret-over-32-characters');
  vi.stubGlobal('fetch', fetcher.mockReset());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('single-attempt candidate platform transport', () => {
  it.each([
    'capability',
    'preview',
    'prepareGroq',
    'confirm',
    'execute',
    'route',
    'read',
    'status',
    'reconcile',
    'ack',
  ] as PublicAgentAction[])(
    'uses only the fixed %s endpoint with server session',
    async (action) => {
      fetcher.mockResolvedValue(json({ ok: true }));
      await transport()({ action, session, body: {}, signal: signal() });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]?.[0]).toBe(
        `https://api.example.test/v1/auth/platform/public-agent/${action}`,
      );
      const init = fetcher.mock.calls[0]?.[1];
      expect(init).toMatchObject({
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        headers: { Authorization: `Platform ${session.sessionHandle}` },
      });
    },
  );
  it('refuses absent or unsafe configured origin, stale session, unknown actions and oversized payload', async () => {
    vi.stubEnv('NUNI_API_BASE_URL', '');
    await expect(
      transport()({ action: 'execute', session, body, signal: signal() }),
    ).rejects.toMatchObject({ code: 'PUBLIC_AGENT_NOT_CONFIGURED' });
    vi.stubEnv('NUNI_API_BASE_URL', 'https://bad.example.test/path');
    await expect(
      transport()({ action: 'execute', session, body, signal: signal() }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_REQUIRED' });
    vi.stubEnv('NUNI_API_BASE_URL', 'https://api.example.test');
    await expect(
      transport()({
        action: 'execute',
        session: { ...session, expiresAt: 1 },
        body,
        signal: signal(),
      }),
    ).rejects.toMatchObject({ code: 'PUBLIC_AGENT_SESSION_INVALID' });
    await expect(
      transport()({ action: '../admin' as PublicAgentAction, session, body, signal: signal() }),
    ).rejects.toMatchObject({ code: 'PUBLIC_AGENT_NOT_CONFIGURED' });
    await expect(
      transport()({
        action: 'execute',
        session,
        body: { payload: 'x'.repeat(9000) },
        signal: signal(),
      }),
    ).rejects.toMatchObject({ code: 'BODY_TOO_LARGE' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not retry network failures, malformed responses, quota or timeout', async () => {
    fetcher.mockRejectedValueOnce(new TypeError('network'));
    await expect(
      transport()({ action: 'execute', session, body, signal: signal() }),
    ).rejects.toMatchObject({ code: 'PUBLIC_AGENT_OUTCOME_UNKNOWN' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(json({ code: 'PUBLIC_AGENT_FREE_QUOTA_UNAVAILABLE' }, 429));
    await expect(
      transport()({ action: 'execute', session, body, signal: signal() }),
    ).rejects.toMatchObject({ code: 'PUBLIC_AGENT_FREE_QUOTA_UNAVAILABLE', status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValueOnce(json({ code: 'PUBLIC_AGENT_FREE_QUOTA_UNAVAILABLE' }, 500));
    await expect(
      transport()({ action: 'execute', session, body, signal: signal() }),
    ).rejects.toMatchObject({ code: 'PUBLIC_AGENT_OUTCOME_UNKNOWN' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher.mockResolvedValueOnce(
      new Response('x'.repeat(17000), { headers: { 'content-type': 'application/json' } }),
    );
    await expect(
      transport()({ action: 'execute', session, body, signal: signal() }),
    ).rejects.toMatchObject({ code: 'PUBLIC_AGENT_OUTCOME_UNKNOWN' });
    expect(fetcher).toHaveBeenCalledTimes(4);
    fetcher.mockImplementationOnce(() => new Promise(() => {}));
    await expect(
      createPlatformPublicAgentTransport(20)({
        action: 'execute',
        session,
        body,
        signal: signal(),
      }),
    ).rejects.toMatchObject({ code: 'PUBLIC_AGENT_OUTCOME_UNKNOWN' });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it('preserves unknown outcomes for both reconciliation conflicts and transport failures', async () => {
    for (const status of [409, 503]) {
      fetcher.mockResolvedValueOnce(json({ code: 'PUBLIC_AGENT_OUTCOME_UNKNOWN' }, status));
      await expect(
        transport()({ action: 'reconcile', session, body, signal: signal() }),
      ).rejects.toMatchObject({ code: 'PUBLIC_AGENT_OUTCOME_UNKNOWN', status });
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('keeps an exact validation error through the registered-in-tests BFF seam', async () => {
    fetcher.mockResolvedValueOnce(json({ code: 'PUBLIC_AGENT_DESTINATION_UNCLEAR' }, 422));
    const handle = createPlatformPublicAgentGateway({
      enabled: true,
      transport: transport(),
      project: projectPlatformPublicAgent,
    });
    const req = new NextRequest('https://nuni.tw/api/nuni/public-agent/preview', {
      method: 'POST',
      headers: {
        Origin: 'https://nuni.tw',
        'Content-Type': 'application/json',
        'X-Campus-Session': sessionContext(session),
        Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
      },
      body: JSON.stringify({ schoolId, query, requestId }),
    });
    const response = await handle(req, 'preview');
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'PUBLIC_AGENT_DESTINATION_UNCLEAR' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('preserves unavailable source as a retryable failure instead of reporting unsupported', async () => {
    fetcher.mockResolvedValueOnce(json({ code: 'PUBLIC_AGENT_SOURCE_UNAVAILABLE' }, 503));
    const handle = createPlatformPublicAgentGateway({
      enabled: true,
      transport: transport(),
      project: projectPlatformPublicAgent,
    });
    const req = new NextRequest('https://nuni.tw/api/nuni/public-agent/capability', {
      method: 'POST',
      headers: {
        Origin: 'https://nuni.tw',
        'Content-Type': 'application/json',
        'X-Campus-Session': sessionContext(session),
        Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
      },
      body: JSON.stringify({ schoolId }),
    });
    const response = await handle(req, 'capability');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'PUBLIC_AGENT_SOURCE_UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('projects only the requested school through the actual gateway and fixed transport', async () => {
    const handle = createPlatformPublicAgentGateway({
      enabled: true,
      transport: transport(),
      project: projectPlatformPublicAgent,
    });
    const call = () =>
      handle(
        new NextRequest('https://nuni.tw/api/nuni/public-agent/capability', {
          method: 'POST',
          headers: {
            Origin: 'https://nuni.tw',
            'Content-Type': 'application/json',
            'X-Campus-Session': sessionContext(session),
            Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
          },
          body: JSON.stringify({ schoolId }),
        }),
        'capability',
      );
    const source = { date: '2026-10-19', label: 'OSM' };
    fetcher.mockResolvedValueOnce(json({ schoolId, modes: ['deterministic'], source }));
    let response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ schoolId, modes: ['deterministic'], source });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.example.test/v1/auth/platform/public-agent/capability',
    );
    fetcher.mockResolvedValueOnce(json({ schoolId: 'other', modes: ['deterministic'], source }));
    response = await call();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'PUBLIC_AGENT_INVALID_RESPONSE' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('aborts and does not fetch if caller signal was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      transport()({ action: 'execute', session, body, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'PUBLIC_AGENT_OUTCOME_UNKNOWN' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe('strict response projection', () => {
  it('accepts each exact response shape and binds preview and receipt to input', () => {
    expect(projectPlatformPublicAgent('preview', preview, { schoolId, query, requestId })).toEqual(
      preview,
    );
    expect(
      projectPlatformPublicAgent(
        'confirm',
        { confirmationId, expiresAt: 123 },
        { approved: true, request },
      ),
    ).toEqual({ confirmationId, expiresAt: 123 });
    expect(projectPlatformPublicAgent('execute', complete, body)).toEqual(complete);
    expect(projectPlatformPublicAgent('read', complete, request)).toEqual(complete);
    expect(projectPlatformPublicAgent('read', null, request)).toBe(null);
    expect(
      projectPlatformPublicAgent(
        'status',
        { status: 'unknown', operationId: op },
        { task, schoolId },
      ),
    ).toEqual({ status: 'unknown', operationId: op });
    expect(
      projectPlatformPublicAgent(
        'ack',
        { status: 'acknowledged', operationId: op },
        { task, schoolId, operationId: op, approved: true },
      ),
    ).toEqual({ status: 'acknowledged', operationId: op });
  });
  it('rejects unscoped source/result, token leak, arbitrary response and dangerous route links', () => {
    for (const value of [
      { ...complete, executionToken: 'secret' },
      { ...complete, result: { ...result, schoolId: 'other' } },
      { ...complete, result: { ...result, sourceFingerprint: 'e'.repeat(64) } },
      {
        ...complete,
        result: {
          ...result,
          receipt: { ...receipt, url: 'https://www.google.com.attacker.test/maps/dir/' },
        },
      },
      {
        ...complete,
        result: {
          ...result,
          receipt: {
            ...receipt,
            from: { ...from, sourceUrl: 'https://www.openstreetmap.org.attacker.test/way/1' },
          },
        },
      },
      { ...complete, result: { ...result, receipt: { ...receipt, url: 'javascript:alert(1)' } } },
      { ...complete, result: { ...result, receipt: { ...receipt, to: { ...to, lat: 24.2 } } } },
    ])
      expect(() => projectPlatformPublicAgent('execute', value, body)).toThrow();
    expect(() =>
      projectPlatformPublicAgent('preview', preview, { schoolId: 'other', query, requestId }),
    ).toThrow();
    expect(() =>
      projectPlatformPublicAgent(
        'status',
        { status: 'unknown', operationId: op, query },
        { task, schoolId },
      ),
    ).toThrow();
    expect(() =>
      projectPlatformPublicAgent(
        'ack',
        { status: 'acknowledged', operationId: op },
        { task, schoolId, operationId: 'other', approved: true },
      ),
    ).toThrow();
  });
  it('runs disabled by default and, when assembled with mock fetch, preserves session isolation and strips no unreviewed data', async () => {
    const options = { transport: transport(), project: projectPlatformPublicAgent };
    const make = () =>
      new NextRequest('https://nuni.tw/api/nuni/public-agent/execute', {
        method: 'POST',
        headers: {
          Origin: 'https://nuni.tw',
          'Content-Type': 'application/json',
          'X-Campus-Session': sessionContext(session),
          Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
        },
        body: JSON.stringify(body),
      });
    expect((await createPlatformPublicAgentGateway(options)(make(), 'execute')).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(json(complete));
    const response = await createPlatformPublicAgentGateway({ ...options, enabled: true })(
      make(),
      'execute',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(complete);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(json({ ...complete, executionToken: 'must-not-escape' }));
    const bad = await createPlatformPublicAgentGateway({ ...options, enabled: true })(
      make(),
      'execute',
    );
    expect(bad.status).toBe(502);
    expect(JSON.stringify(await bad.json())).not.toContain('must-not-escape');
  });
});

it('rejects array values that stringify to valid status or failure code', () => {
  expect(() =>
    projectPlatformPublicAgent(
      'status',
      { status: ['completed'], operationId: op },
      { task, schoolId },
    ),
  ).toThrow();
  expect(() =>
    projectPlatformPublicAgent(
      'execute',
      { status: 'failed', operationId: op, expiresAt: 456, failureCode: ['SOURCE_CHANGED'] },
      body,
    ),
  ).toThrow();
});
it('preserves exact upstream session expiry once, without assuming an already-sent operation failed', async () => {
  fetcher.mockResolvedValueOnce(json({ code: 'PUBLIC_AGENT_SESSION_EXPIRED' }, 401));
  const make = () =>
    new NextRequest('https://nuni.tw/api/nuni/public-agent/execute', {
      method: 'POST',
      headers: {
        Origin: 'https://nuni.tw',
        'Content-Type': 'application/json',
        'X-Campus-Session': sessionContext(session),
        Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
      },
      body: JSON.stringify(body),
    });
  const response = await createPlatformPublicAgentGateway({
    enabled: true,
    transport: transport(),
    project: projectPlatformPublicAgent,
  })(make(), 'execute');
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: 'PUBLIC_AGENT_SESSION_EXPIRED' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
