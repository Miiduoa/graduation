// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import { SESSION_COOKIE, sealCookie, sessionContext } from '../nuni/server';
import { handlePersonalImportCloud, PERSONAL_IMPORT_CLOUD_DAILY_LIMIT, reservePersonalImportCloudQuota, type PersonalImportCloudDependencies } from './personalImportCloud';

const session = { sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3600_000 };
const principal = { authenticated: true, platformAccountId: 'pa_12345678-1234-1234-1234-123456789abc', isPlatformOperator: false };
const config = { accountId: 'test-account', token: 'test-token' };

function quotaStore() {
  const values = new Map<string, Record<string, unknown>>();
  let tail: Promise<unknown> = Promise.resolve();
  const db: NonNullable<Awaited<ReturnType<NonNullable<PersonalImportCloudDependencies['getQuotaStore']>>>> = {
    doc: (path) => ({ path }),
    runTransaction: (fn) => {
      const result = tail.then(() => fn({
        get: async (ref) => ({ data: () => values.get(ref.path) }),
        set: (ref, data) => { values.set(ref.path, data); },
      }));
      tail = result.catch(() => {});
      return result;
    },
  };
  return { db, values };
}

function request(body: unknown = { text: '微積分 3 85', kind: 'grades' }, mode: 'native' | 'web' | 'none' = 'native') {
  return new NextRequest('https://nuni.tw/api/personal-import/recognize', {
    method: 'POST',
    headers: {
      Origin: 'https://nuni.tw', 'Content-Type': 'application/json',
      ...(mode === 'native' ? { Authorization: `Platform ${session.sessionHandle}` } : {}),
      ...(mode === 'web' ? { Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`, 'X-Campus-Session': sessionContext(session) } : {}),
    }, body: JSON.stringify(body),
  });
}

function setup() {
  const store = quotaStore();
  const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true, result: { response: { complete: true, rows: [] } } }));
  const verifySession = vi.fn().mockResolvedValue(principal);
  const getQuotaStore = vi.fn().mockResolvedValue(store.db);
  return { store, fetcher, verifySession, getQuotaStore, dependencies: { config, fetcher, verifySession, getQuotaStore } satisfies PersonalImportCloudDependencies };
}

beforeEach(() => {
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('BFF_SESSION_SECRET', 'personal-import-test-cookie-material-only');
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('personal import cloud endpoint', () => {
  it.each(['native', 'web'] as const)('reuses the %s platform session and verifies its current principal', async (mode) => {
    const { dependencies, fetcher, verifySession, store } = setup();
    const result = await handlePersonalImportCloud(request(undefined, mode), dependencies);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ provider: 'cloud', output: '{"complete":true,"rows":[]}', sourceText: '微積分 3 85' });
    expect(verifySession).toHaveBeenCalledWith(expect.objectContaining({ sessionHandle: session.sessionHandle }), expect.any(AbortSignal));
    expect(fetcher).toHaveBeenCalledOnce();
    expect([...store.values.values()]).toEqual([expect.objectContaining({ count: 1 })]);
    expect([...store.values.keys()][0]).not.toContain(principal.platformAccountId);
  });

  it('rejects an unauthenticated browser before accessing quota or Cloudflare', async () => {
    const { dependencies, fetcher, verifySession, getQuotaStore } = setup();
    expect((await handlePersonalImportCloud(request(undefined, 'none'), dependencies)).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    expect(verifySession).not.toHaveBeenCalled();
    expect(getQuotaStore).not.toHaveBeenCalled();
  });

  it('rejects a revoked platform session despite a syntactically valid handle', async () => {
    const { dependencies, fetcher, verifySession, getQuotaStore } = setup();
    verifySession.mockRejectedValue(new NuniError(401, 'SIGN_IN_REQUIRED'));
    expect((await handlePersonalImportCloud(request(), dependencies)).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    expect(getQuotaStore).not.toHaveBeenCalled();
  });

  it('rejects a browser with a mismatched session view or a cross-site origin', async () => {
    const { dependencies, fetcher } = setup();
    const stale = request(undefined, 'web');
    stale.headers.set('X-Campus-Session', 'stale');
    expect((await handlePersonalImportCloud(stale, dependencies)).status).toBe(409);
    const crossSite = request(undefined, 'web');
    crossSite.headers.set('Origin', 'https://other.example');
    expect((await handlePersonalImportCloud(crossSite, dependencies)).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns disabled without reserving quota when cloud configuration is missing', async () => {
    const { dependencies, fetcher, getQuotaStore } = setup();
    const result = await handlePersonalImportCloud(request(), { ...dependencies, config: { accountId: '', token: '' } });
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ code: 'disabled' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(getQuotaStore).not.toHaveBeenCalled();
  });

  it('masks personal data again on the server and uses structured JSON output', async () => {
    const { dependencies, fetcher } = setup();
    const result = await handlePersonalImportCloud(request({ text: '姓名：王小明\n學號：411234567\nA123456789\n微積分 3 85', kind: 'grades', columnContext: '課程名稱 學分 成績' }), dependencies);
    expect(result.status).toBe(200);
    const outbound = JSON.parse(fetcher.mock.calls[0][1].body);
    for (const value of ['王小明', '411234567', 'A123456789']) expect(JSON.stringify(outbound)).not.toContain(value);
    expect(outbound.response_format.type).toBe('json_schema');
    expect(outbound.messages[0].content).toContain('COLUMN_CONTEXT_DATA=');
    expect(outbound.messages[0].content).toContain('微積分 3 85');
    expect(outbound.max_tokens).toBe(4096);
  });

  it('masks a name column using a separate preceding header', async () => {
    const { dependencies, fetcher } = setup();
    await handlePersonalImportCloud(request({ text: '王小明\t微積分\t3\t85', kind: 'grades', columnContext: '姓名\t課程名稱\t學分\t成績' }), dependencies);
    expect(fetcher.mock.calls[0][1].body).not.toContain('王小明');
  });

  it('rejects an ambiguous name column without spending quota or sending the source', async () => {
    const { dependencies, fetcher, getQuotaStore } = setup();
    const result = await handlePersonalImportCloud(request({ text: '課程名稱,姓名,學分\n"未關閉,王小明,3', kind: 'grades' }), dependencies);
    expect(result.status).toBe(422);
    expect(fetcher).not.toHaveBeenCalled();
    expect(getQuotaStore).not.toHaveBeenCalled();
  });

  it('rejects excess input before quota or upstream requests', async () => {
    const { dependencies, fetcher, getQuotaStore } = setup();
    expect((await handlePersonalImportCloud(request({ text: '字'.repeat(8001), kind: 'grades' }), dependencies)).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
    expect(getQuotaStore).not.toHaveBeenCalled();
  });

  it.each([429, 500])('preserves fallback meaning for an upstream %s', async (status) => {
    const { dependencies, fetcher } = setup();
    fetcher.mockResolvedValue(Response.json({ errors: [{ message: 'private provider details' }] }, { status }));
    const result = await handlePersonalImportCloud(request(), dependencies);
    expect(result.status).toBe(status === 429 ? 429 : 503);
    expect(await result.json()).toEqual({ code: status === 429 ? 'quota' : 'unavailable' });
  });

  it('accepts content from Qwen chat completions and never returns reasoning', async () => {
    const { dependencies, fetcher } = setup();
    fetcher.mockResolvedValue(Response.json({ success: true, result: { choices: [{ message: { content: '{"complete":true,"rows":[]}', reasoning_content: 'internal reasoning' } }] } }));
    const result = await handlePersonalImportCloud(request(), dependencies);
    expect(await result.json()).toMatchObject({ output: '{"complete":true,"rows":[]}' });
  });

  it('fails closed if the durable quota store is unavailable', async () => {
    const { dependencies, fetcher, getQuotaStore } = setup();
    getQuotaStore.mockResolvedValue(null);
    expect((await handlePersonalImportCloud(request(), dependencies)).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns 429 without contacting Cloudflare once the per-person daily quota is spent', async () => {
    const { dependencies, store, fetcher } = setup();
    for (let index = 0; index < PERSONAL_IMPORT_CLOUD_DAILY_LIMIT; index++) await reservePersonalImportCloudQuota(store.db, principal.platformAccountId, Date.now());
    expect((await handlePersonalImportCloud(request(), dependencies)).status).toBe(429);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds hung upstream requests and aborts them', async () => {
    vi.useFakeTimers();
    const { dependencies, fetcher } = setup();
    fetcher.mockImplementation(() => new Promise(() => {}));
    const result = handlePersonalImportCloud(request(), { ...dependencies, timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect((await result).status).toBe(504);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('does not start upstream work after session verification has timed out', async () => {
    vi.useFakeTimers();
    const { dependencies, fetcher, verifySession } = setup();
    let finish!: (value: unknown) => void;
    verifySession.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const result = handlePersonalImportCloud(request(), { ...dependencies, timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect((await result).status).toBe(504);
    finish(principal);
    await vi.runAllTimersAsync();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('personal import persistent daily quota', () => {
  it('admits exactly the limit under concurrent reservations', async () => {
    const { db } = quotaStore();
    const results = await Promise.all(Array.from({ length: 90 }, () => reservePersonalImportCloudQuota(db, principal.platformAccountId, Date.parse('2026-10-30T01:00:00Z'))));
    expect(results.filter(Boolean)).toHaveLength(PERSONAL_IMPORT_CLOUD_DAILY_LIMIT);
  });

  it('separates accounts and resets at midnight in Taiwan', async () => {
    const { db } = quotaStore();
    const before = Date.parse('2026-10-30T15:59:59Z');
    for (let index = 0; index < PERSONAL_IMPORT_CLOUD_DAILY_LIMIT; index++) await reservePersonalImportCloudQuota(db, principal.platformAccountId, before);
    expect(await reservePersonalImportCloudQuota(db, principal.platformAccountId, before)).toBe(false);
    expect(await reservePersonalImportCloudQuota(db, 'another-account', before)).toBe(true);
    expect(await reservePersonalImportCloudQuota(db, principal.platformAccountId, before + 1000)).toBe(true);
  });

  it('does not let a delayed pre-midnight transaction overwrite the next day', async () => {
    const { db, values } = quotaStore();
    const before = Date.parse('2026-10-30T15:59:59Z');
    expect(await reservePersonalImportCloudQuota(db, principal.platformAccountId, before + 1000)).toBe(true);
    expect(await reservePersonalImportCloudQuota(db, principal.platformAccountId, before)).toBe(false);
    expect(await reservePersonalImportCloudQuota(db, principal.platformAccountId, before + 1000)).toBe(true);
    expect([...values.values()]).toEqual([{ day: '2026-10-31', count: 2 }]);
  });
});
