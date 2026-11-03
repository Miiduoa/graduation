// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import {
  createPlatformPublicAgentGateway,
  type PublicAgentTransport,
} from './platformPublicAgentGateway';
import { SESSION_COOKIE, sealCookie, sessionContext } from './server';

const account = { sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3_600_000 };
const other = { sessionHandle: `ps_${'b'.repeat(43)}`, expiresAt: Date.now() + 3_600_000 };
const transport = vi.fn<PublicAgentTransport>();
const project = vi.fn((_action: string, value: unknown) => value);
const payload = { confirmationId: 'pagc_test', request: { task: 'public-campus-navigation' } };
function request({
  body = payload,
  origin = 'https://nuni.tw',
  cookie = account,
  context = sessionContext(account),
  method = 'POST',
  search = '',
}: {
  body?: unknown;
  origin?: string;
  cookie?: typeof account | null;
  context?: string;
  method?: string;
  search?: string;
} = {}) {
  return new NextRequest(`https://nuni.tw/api/nuni/public-agent/execute${search}`, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-Campus-Session': context,
      ...(cookie ? { Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, cookie)}` } : {}),
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(() => {
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('BFF_SESSION_SECRET', 'synthetic-test-session-secret-over-32-characters');
  transport.mockReset();
  project.mockReset().mockImplementation((_action, value) => value);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe('unregistered platform public Agent gateway', () => {
  it('is disabled unless explicitly assembled and invokes no transport', async () => {
    const handle = createPlatformPublicAgentGateway({ transport, project });
    expect((await handle(request(), 'execute')).status).toBe(404);
    expect(transport).not.toHaveBeenCalled();
  });
  it('passes only the server-resolved session to exactly one transport call', async () => {
    transport.mockResolvedValue({ status: 'pending', operationId: 'synthetic' });
    const handle = createPlatformPublicAgentGateway({ enabled: true, transport, project });
    const response = await handle(request(), 'execute');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'pending', operationId: 'synthetic' });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toMatchObject({
      action: 'execute',
      session: account,
      body: payload,
    });
  });
  it('rejects missing identity, stale account context and cross-origin before transport', async () => {
    const handle = createPlatformPublicAgentGateway({ enabled: true, transport, project });
    expect((await handle(request({ cookie: null }), 'execute')).status).toBe(401);
    expect((await handle(request({ cookie: other }), 'execute')).status).toBe(409);
    expect((await handle(request({ origin: 'https://other.invalid' }), 'execute')).status).toBe(
      403,
    );
    expect(transport).not.toHaveBeenCalled();
  });
  it('rejects unknown operations, non-POST, queries, extras and unapproved confirmation', async () => {
    const handle = createPlatformPublicAgentGateway({ enabled: true, transport, project });
    expect((await handle(request(), 'admin')).status).toBe(404);
    expect((await handle(request({ method: 'GET' }), 'execute')).status).toBe(405);
    expect((await handle(request({ search: '?school=other' }), 'execute')).status).toBe(400);
    expect(
      (await handle(request({ body: { ...payload, platformAccountId: 'other' } }), 'execute'))
        .status,
    ).toBe(422);
    expect(
      (await handle(request({ body: { approved: false, request: {} } }), 'confirm')).status,
    ).toBe(409);
    expect(transport).not.toHaveBeenCalled();
  });
  it('limits request size before any transport', async () => {
    const handle = createPlatformPublicAgentGateway({ enabled: true, transport, project });
    expect(
      (await handle(request({ body: { ...payload, request: 'x'.repeat(9000) } }), 'execute'))
        .status,
    ).toBe(413);
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(['execute', 'confirm'] as const)(
    'never retries a failed %s transport and reports unknown',
    async (action) => {
      transport.mockRejectedValue(new TypeError('synthetic network failure'));
      const handle = createPlatformPublicAgentGateway({ enabled: true, transport, project });
      const response = await handle(
        request({ body: action === 'confirm' ? { approved: true, request: {} } : payload }),
        action,
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'PUBLIC_AGENT_OUTCOME_UNKNOWN' });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it('retains an explicit quota refusal without retrying', async () => {
    transport.mockRejectedValue(new NuniError(429, 'PUBLIC_AGENT_FREE_QUOTA_UNAVAILABLE'));
    const handle = createPlatformPublicAgentGateway({ enabled: true, transport, project });
    const response = await handle(request(), 'execute');
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'PUBLIC_AGENT_FREE_QUOTA_UNAVAILABLE' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('aborts a timed-out request, returns unknown and ignores late completion', async () => {
    let signal: AbortSignal | undefined, finish!: (value: unknown) => void;
    transport.mockImplementation(({ signal: value }) => {
      signal = value;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const handle = createPlatformPublicAgentGateway({
      enabled: true,
      transport,
      project,
      timeoutMs: 20,
    });
    const response = await handle(request(), 'execute');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'PUBLIC_AGENT_OUTCOME_UNKNOWN' });
    expect(signal?.aborted).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
    finish({ status: 'completed' });
    await Promise.resolve();
    expect(project).not.toHaveBeenCalled();
  });
  it('refuses unprojectable upstream values without exposing the raw response', async () => {
    transport.mockResolvedValue({ privateField: 'synthetic private value' });
    project.mockImplementation(() => {
      throw Error('bad');
    });
    const handle = createPlatformPublicAgentGateway({ enabled: true, transport, project });
    const response = await handle(request(), 'execute');
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'PUBLIC_AGENT_INVALID_RESPONSE' });
  });
  it('checks recovery request boundaries and preserves the explicit open-operation refusal', async () => {
    const handle = createPlatformPublicAgentGateway({ enabled: true, transport, project });
    const scope = { task: 'public-campus-navigation', schoolId: 'pu' };
    expect((await handle(request({ body: { ...scope, owner: 'other' } }), 'status')).status).toBe(
      422,
    );
    expect(
      (
        await handle(
          request({ body: { ...scope, operationId: 'pago_test', approved: false } }),
          'ack',
        )
      ).status,
    ).toBe(409);
    expect(transport).not.toHaveBeenCalled();
    transport.mockRejectedValue(new NuniError(409, 'PUBLIC_AGENT_OPEN_OPERATION'));
    const response = await handle(request(), 'execute');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'PUBLIC_AGENT_OPEN_OPERATION' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('allows only server-evidence reconciliation scope and preserves unknown outcome', async () => {
    const handle = createPlatformPublicAgentGateway({ enabled: true, transport, project });
    const scope = {
      task: 'public-campus-navigation',
      schoolId: 'pu',
      operationId: 'pago_synthetic',
    };
    expect(
      (await handle(request({ body: { ...scope, notDispatched: true } }), 'reconcile')).status,
    ).toBe(422);
    expect(transport).not.toHaveBeenCalled();
    transport.mockRejectedValue(new NuniError(409, 'PUBLIC_AGENT_OUTCOME_UNKNOWN'));
    const response = await handle(request({ body: scope }), 'reconcile');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'PUBLIC_AGENT_OUTCOME_UNKNOWN' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('requires the second route approval and forwards only the bound route shape', async () => {
    const handle = createPlatformPublicAgentGateway({ enabled: true, transport, project });
    const body = {
      approved: false,
      operationId: 'pago_synthetic',
      request: {},
      fromId: 'a',
      toId: 'b',
    };
    expect((await handle(request({ body }), 'route')).status).toBe(409);
    expect(transport).not.toHaveBeenCalled();
    transport.mockResolvedValue({ accepted: true });
    expect((await handle(request({ body: { ...body, approved: true } }), 'route')).status).toBe(
      200,
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('allows only the scoped reconciliation shape', async () => {
    const handle = createPlatformPublicAgentGateway({ enabled: true, transport, project });
    const body = {
      task: 'public-campus-navigation',
      schoolId: 'pu',
      operationId: 'pago_11111111-1111-1111-1111-111111111111',
    };
    expect(
      (await handle(request({ body: { ...body, accountId: 'other' } }), 'reconcile')).status,
    ).toBe(422);
    expect(transport).not.toHaveBeenCalled();
    transport.mockResolvedValue({ accepted: true });
    expect((await handle(request({ body }), 'reconcile')).status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
