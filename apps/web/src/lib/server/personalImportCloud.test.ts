// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import { SESSION_COOKIE, sealCookie, sessionContext } from '../nuni/server';
import { handlePersonalImportCloud, PERSONAL_IMPORT_CLOUD_ACCOUNT_MINUTE_LIMIT, PERSONAL_IMPORT_CLOUD_DAILY_LIMIT, PERSONAL_IMPORT_CLOUD_GLOBAL_DAILY_LIMIT, reservePersonalImportCloudQuota, type PersonalImportCloudDependencies } from './personalImportCloud';

const session = { sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3600_000 };
const principal = { authenticated: true, platformAccountId: 'pa_12345678-1234-1234-1234-123456789abc', isPlatformOperator: false };
const config = { accountId: 'test-account', token: 'test-token' };
const dailyLimits = { globalDaily: PERSONAL_IMPORT_CLOUD_GLOBAL_DAILY_LIMIT, accountMinute: PERSONAL_IMPORT_CLOUD_DAILY_LIMIT };

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
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ success: true, result: { response: { complete: true, rows: [] } } }));
  const verifySession = vi.fn().mockResolvedValue(principal);
  const getQuotaStore = vi.fn().mockResolvedValue(store.db);
  return { store, fetcher, verifySession, getQuotaStore, dependencies: { config, fetcher, verifySession, getQuotaStore } satisfies PersonalImportCloudDependencies };
}

beforeEach(() => {
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('BFF_SESSION_SECRET', 'personal-import-test-cookie-material-only');
  vi.stubEnv('PERSONAL_IMPORT_CLOUD_GLOBAL_DAILY_LIMIT', '');
  vi.stubEnv('PERSONAL_IMPORT_CLOUD_ACCOUNT_MINUTE_LIMIT', '');
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
    expect([...store.values.values()]).toEqual([expect.objectContaining({ count: 1 }), expect.objectContaining({ count: 1 })]);
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

  it.each([
    ['姓名：\n王小明\n微積分 3 85', '王小明'],
    ['student_id,課程名稱,學分,成績\nS123456,微積分,3,85\n微積分 3 85', 'S123456'],
    ['學 號,課程名稱,學分,成績\n123456,微積分,3,85\n微積分 3 85', '123456'],
    ['學生名字,課程名稱,學分,成績\n王小明,微積分,3,85\n微積分 3 85', '王小明'],
    ['教師：\n林小美\n微積分 3 85', '林小美'],
    ['聯絡信箱：student@example.edu.tw\n微積分 3 85', 'student@example.edu.tw'],
    ['電話：0912-345-678\n微積分 3 85', '0912-345-678'],
    ['電話：02-2345-6789\n微積分 3 85', '02-2345-6789'],
  ])('never forwards OCR personal data from direct API input: %s', async (text, sensitive) => {
    const { dependencies, fetcher } = setup();
    const result = await handlePersonalImportCloud(request({ text, kind: 'grades' }), dependencies);
    expect(result.status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1].body).not.toContain(sensitive);
    expect(fetcher.mock.calls[0][1].body).toContain('微積分 3 85');
    expect(JSON.stringify(await result.json())).not.toContain(sensitive);
  });

  it.each(['姓\n名\n王小明', '學\n號\n123456', '姓·名：王小明', '學．號：１２３４５６',
    '姓·名\n王小明', '學．號\n123456', '姓\r\n、名：王小明', '學\t‧\n號：123456',
    '姓「」名：王小明', '學\u0001號：123456'])('rejects unknown private labels at the server boundary: %s', async (head) => {
    for (const body of [
      { text: `${head}\n課程名稱,學分,成績\n微積分,3,85`, kind: 'grades' },
      { text: '微積分,3,85', columnContext: head, kind: 'grades' },
    ]) {
      const { dependencies, fetcher, getQuotaStore } = setup();
      expect((await handlePersonalImportCloud(request(body), dependencies)).status).toBe(422);
      expect(fetcher).not.toHaveBeenCalled();
      expect(getQuotaStore).not.toHaveBeenCalled();
    }
  });

  it.each(['課程名稱,學分,成績\n微積分,3,85', '星期一 第三節 程式設計 教室 A101'])('forwards ordinary academic text: %s', async (text) => {
    const { dependencies, fetcher } = setup();
    expect((await handlePersonalImportCloud(request({ text, kind: 'grades' }), dependencies)).status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(fetcher.mock.calls[0][1].body).messages[0].content).toContain(`SOURCE_DATA=${JSON.stringify(text)}`);
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
    for (let index = 0; index < PERSONAL_IMPORT_CLOUD_DAILY_LIMIT; index++) await reservePersonalImportCloudQuota(store.db, principal.platformAccountId, Date.now(), dailyLimits);
    expect((await handlePersonalImportCloud(request(), dependencies)).status).toBe(429);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('enforces the configured service daily budget across different accounts', async () => {
    vi.stubEnv('PERSONAL_IMPORT_CLOUD_GLOBAL_DAILY_LIMIT', '2');
    const { dependencies, store, fetcher, verifySession } = setup();
    for (let index = 0; index < 2; index++) {
      verifySession.mockResolvedValue({ ...principal, platformAccountId: `pa_12345678-1234-1234-1234-123456789ab${index}` });
      expect((await handlePersonalImportCloud(request(), dependencies)).status).toBe(200);
    }
    const before = structuredClone([...store.values]);
    verifySession.mockResolvedValue({ ...principal, platformAccountId: 'pa_12345678-1234-1234-1234-123456789abd' });
    const result = await handlePersonalImportCloud(request(), dependencies);
    expect(result.status).toBe(429);
    expect(await result.json()).toMatchObject({ code: 'quota' });
    expect(result.headers.get('Retry-After')).toBe('60');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect([...store.values]).toEqual(before);
  });

  it('enforces the configured rolling account rate and allows local fallback', async () => {
    vi.stubEnv('PERSONAL_IMPORT_CLOUD_ACCOUNT_MINUTE_LIMIT', '2');
    const { dependencies, store, fetcher } = setup();
    const now = Date.parse('2026-10-30T01:00:00Z');
    for (let index = 0; index < 2; index++) expect((await handlePersonalImportCloud(request(), { ...dependencies, now: () => now })).status).toBe(200);
    const before = structuredClone([...store.values]);
    const result = await handlePersonalImportCloud(request(), { ...dependencies, now: () => now + 59_999 });
    expect(result.status).toBe(429);
    expect(await result.json()).toMatchObject({ code: 'quota' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect([...store.values]).toEqual(before);
    expect((await handlePersonalImportCloud(request(), { ...dependencies, now: () => now + 60_000 })).status).toBe(200);
  });

  it.each(['PERSONAL_IMPORT_CLOUD_GLOBAL_DAILY_LIMIT', 'PERSONAL_IMPORT_CLOUD_ACCOUNT_MINUTE_LIMIT'])('allows %s=0 to stop cloud use without spending quota', async (name) => {
    vi.stubEnv(name, '0');
    const { dependencies, store, fetcher } = setup();
    expect((await handlePersonalImportCloud(request(), dependencies)).status).toBe(429);
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.values.size).toBe(0);
  });

  it.each(['-1', 'NaN', 'Infinity', '1.5', '9007199254740992'])('uses conservative defaults for invalid limit %s', async (value) => {
    vi.stubEnv('PERSONAL_IMPORT_CLOUD_GLOBAL_DAILY_LIMIT', value);
    vi.stubEnv('PERSONAL_IMPORT_CLOUD_ACCOUNT_MINUTE_LIMIT', value);
    const { dependencies, store, fetcher } = setup();
    const now = Date.parse('2026-10-30T01:00:00Z');
    store.values.set('_personalImportAiUsage/_global', { day: '2026-10-30', count: PERSONAL_IMPORT_CLOUD_GLOBAL_DAILY_LIMIT });
    expect((await handlePersonalImportCloud(request(), { ...dependencies, now: () => now })).status).toBe(429);
    store.values.clear();
    for (let index = 0; index < PERSONAL_IMPORT_CLOUD_ACCOUNT_MINUTE_LIMIT; index++) expect((await handlePersonalImportCloud(request(), { ...dependencies, now: () => now })).status).toBe(200);
    expect((await handlePersonalImportCloud(request(), { ...dependencies, now: () => now })).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(PERSONAL_IMPORT_CLOUD_ACCOUNT_MINUTE_LIMIT);
  });

  it('does not contact the provider when the quota transaction fails', async () => {
    const { dependencies, store, fetcher } = setup();
    vi.spyOn(store.db, 'runTransaction').mockRejectedValue(new Error('quota store unavailable'));
    expect((await handlePersonalImportCloud(request(), dependencies)).status).toBe(503);
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
    const results = await Promise.all(Array.from({ length: 90 }, () => reservePersonalImportCloudQuota(db, principal.platformAccountId, Date.parse('2026-10-30T01:00:00Z'), dailyLimits)));
    expect(results.filter(Boolean)).toHaveLength(PERSONAL_IMPORT_CLOUD_DAILY_LIMIT);
  });

  it('separates accounts and resets at midnight in Taiwan', async () => {
    const { db } = quotaStore();
    const before = Date.parse('2026-10-30T15:59:59Z');
    for (let index = 0; index < PERSONAL_IMPORT_CLOUD_DAILY_LIMIT; index++) await reservePersonalImportCloudQuota(db, principal.platformAccountId, before, dailyLimits);
    expect(await reservePersonalImportCloudQuota(db, principal.platformAccountId, before)).toBe(false);
    expect(await reservePersonalImportCloudQuota(db, 'another-account', before)).toBe(true);
    expect(await reservePersonalImportCloudQuota(db, principal.platformAccountId, before + 60_000)).toBe(true);
  });

  it('does not let a delayed pre-midnight transaction overwrite the next day', async () => {
    const { db, values } = quotaStore();
    const before = Date.parse('2026-10-30T15:59:59Z');
    expect(await reservePersonalImportCloudQuota(db, principal.platformAccountId, before + 1000)).toBe(true);
    expect(await reservePersonalImportCloudQuota(db, principal.platformAccountId, before)).toBe(false);
    expect(await reservePersonalImportCloudQuota(db, principal.platformAccountId, before + 1000)).toBe(true);
    expect([...values.values()]).toEqual([expect.objectContaining({ day: '2026-10-31', count: 2 }), { day: '2026-10-31', count: 2 }]);
  });

  it('reserves all budgets atomically for concurrent requests from many accounts', async () => {
    const { db, values } = quotaStore();
    const now = Date.parse('2026-10-30T01:00:00Z');
    const results = await Promise.all(Array.from({ length: 90 }, (_, index) => reservePersonalImportCloudQuota(db, `account-${index}`, now, { ...dailyLimits, globalDaily: 20 })));
    expect(results.filter(Boolean)).toHaveLength(20);
    expect(values.get('_personalImportAiUsage/_global')).toEqual({ day: '2026-10-30', count: 20 });
    expect(values.size).toBe(21);
    expect([...values.entries()].filter(([path]) => path !== '_personalImportAiUsage/_global').every(([, data]) => data.count === 1)).toBe(true);
  });

  it('enforces the rolling window for concurrent requests and across midnight', async () => {
    const { db, values } = quotaStore();
    const now = Date.parse('2026-10-30T15:59:59Z');
    const results = await Promise.all(Array.from({ length: 90 }, () => reservePersonalImportCloudQuota(db, principal.platformAccountId, now)));
    expect(results.filter(Boolean)).toHaveLength(PERSONAL_IMPORT_CLOUD_ACCOUNT_MINUTE_LIMIT);
    const before = structuredClone([...values]);
    expect(await reservePersonalImportCloudQuota(db, principal.platformAccountId, now + 1000)).toBe(false);
    expect([...values]).toEqual(before);
    expect(await reservePersonalImportCloudQuota(db, 'another-account', now + 1000)).toBe(true);
    expect(await reservePersonalImportCloudQuota(db, principal.platformAccountId, now + 60_000)).toBe(true);
    expect(values.get('_personalImportAiUsage/_global')).toEqual({ day: '2026-10-31', count: 2 });
  });

  it('shares persisted budgets with a new store wrapper and rejects stale requests from other accounts', async () => {
    const { db, values } = quotaStore();
    const now = Date.parse('2026-10-30T16:00:00Z');
    expect(await reservePersonalImportCloudQuota(db, 'first-account', now, { ...dailyLimits, globalDaily: 1 })).toBe(true);
    const before = structuredClone([...values]);
    expect(await reservePersonalImportCloudQuota({ ...db }, 'second-account', now, { ...dailyLimits, globalDaily: 1 })).toBe(false);
    expect(await reservePersonalImportCloudQuota({ ...db }, 'second-account', now - 1)).toBe(false);
    expect([...values]).toEqual(before);
    expect(await reservePersonalImportCloudQuota({ ...db }, 'second-account', now + 86_400_000, { ...dailyLimits, globalDaily: 1 })).toBe(true);
  });

  it.each([-1, '1', NaN, 1.5])('fails closed on a corrupt global counter: %s', async (count) => {
    const { db, values } = quotaStore();
    values.set('_personalImportAiUsage/_global', { day: '2026-10-30', count });
    expect(await reservePersonalImportCloudQuota(db, principal.platformAccountId, Date.parse('2026-10-30T01:00:00Z'))).toBe(false);
    expect(values.size).toBe(1);
  });

  it.each([null, 'broken', [-1], ['1'], [NaN], [Date.parse('2026-10-30T01:00:01Z')]])('fails closed on corrupt or future rate timestamps: %s', async (timestamps) => {
    const { db, values } = quotaStore();
    const now = Date.parse('2026-10-30T01:00:00Z');
    await reservePersonalImportCloudQuota(db, principal.platformAccountId, now);
    const accountPath = [...values.keys()].find((path) => !path.endsWith('/_global'))!;
    values.set(accountPath, { day: '2026-10-30', count: 1, timestamps });
    const before = structuredClone([...values]);
    expect(await reservePersonalImportCloudQuota(db, principal.platformAccountId, now)).toBe(false);
    expect([...values]).toEqual(before);
  });
});

it.each(['姓名', '教師'])('rejects ambiguous space separated %s columns before quota and upstream', async (label) => {
  const { dependencies, fetcher, getQuotaStore } = setup();
  for (const body of [
    { text: `${label} 課程名稱 學分 成績\n王小明 微積分 3 85`, kind: 'grades' },
    { text: '王小明 微積分 3 85', columnContext: `${label} 課程名稱 學分 成績`, kind: 'grades' },
  ]) expect((await handlePersonalImportCloud(request(body), dependencies)).status).toBe(422);
  expect(fetcher).not.toHaveBeenCalled();
  expect(getQuotaStore).not.toHaveBeenCalled();
});

it.each([';', '；', '，', '、', '/', '::', '•'])('rejects unreliable private tables separated by %s before quota and upstream', async (delimiter) => {
  const { dependencies, fetcher, getQuotaStore } = setup();
  for (const label of ['姓名', '教師', '學生', '學號']) {
    const header = `${label}${delimiter}課程名稱${delimiter}學分${delimiter}成績`;
    const text = `王小明${delimiter}微積分${delimiter}3`;
    for (const input of [{ text: `${header}\n${text}` }, { text, columnContext: header }]) {
      expect((await handlePersonalImportCloud(request({ ...input, kind: 'grades' }), dependencies)).status).toBe(422);
    }
  }
  expect(fetcher).not.toHaveBeenCalled();
  expect(getQuotaStore).not.toHaveBeenCalled();
});

it.each(['李小華／陳小美', '李小華,陳小美', '李小華\t陳小美'])('rejects ambiguous inline private continuations before upstream: %s', async (continuation) => {
  const { dependencies, fetcher, getQuotaStore } = setup();
  for (const input of [
    { text: `教師：王小明\n${continuation}\n課程名稱,學分,成績\n微積分,3,85` },
    { columnContext: '教師：王小明', text: `${continuation}\n課程名稱,學分,成績\n微積分,3,85` },
  ]) expect((await handlePersonalImportCloud(request({ ...input, kind: 'grades' }), dependencies)).status).toBe(422);
  expect(fetcher).not.toHaveBeenCalled();
  expect(getQuotaStore).not.toHaveBeenCalled();
});

it('masks inline private continuations again on the server and preserves course rows', async () => {
  const { dependencies, fetcher } = setup();
  const response = await handlePersonalImportCloud(request({ text: '教師：王小明\n李小華\n課程名稱,學分,成績\n微積分,3,85', kind: 'grades' }), dependencies);
  expect(response.status).toBe(200);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(String(fetcher.mock.calls[0][1].body)).not.toMatch(/王小明|李小華/);
  expect((await response.json()).sourceText).toContain('課程名稱,學分,成績\n微積分,3,85');
});
