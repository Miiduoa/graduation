'use strict';

const {
  createSemanticConsentTask,
  validateSemanticConsent,
  CACHE_MS,
  MAX_ENTRIES,
} = require('./semanticConsentTask');
const { GROQ_MODEL } = require('./freeCloudModel');
const { enforceRateLimit } = require('../securityUtils');
function input(overrides = {}) {
  const schoolId = overrides.schoolId ?? 'pu';
  const utterance = overrides.utterance ?? '明天想讀書再吃飯';
  return {
    schoolId,
    utterance,
    requestId: 'request-0001',
    consent: {
      version: 1,
      purpose: 'campus-service-entry',
      provider: 'groq',
      model: GROQ_MODEL,
      schoolId,
      utterance,
    },
    ...overrides,
  };
}
const success = {
  status: 'understood',
  source: 'model',
  summary: '先找服務',
  destinations: ['/library', '/food'],
  clarifyingQuestion: null,
};
function fixture(overrides = {}) {
  const deps = {
    assertAccount: jest.fn(async () => {}),
    assertMembership: jest.fn(async () => ({})),
    interpret: jest.fn(async () => success),
    enforceLimit: jest.fn(),
    ...overrides,
  };
  return { ...deps, run: createSemanticConsentTask(deps) };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const turn = () => new Promise((resolve) => setImmediate(resolve));

it.each([
  undefined,
  null,
  [],
  {},
  { schoolId: 'pu', utterance: 'x' },
  input({ consent: undefined }),
  input({ consent: { ...input().consent, provider: 'gemini' } }),
  input({ consent: { ...input().consent, model: 'paid-model' } }),
  input({ consent: { ...input().consent, purpose: 'write' } }),
  input({ consent: { ...input().consent, version: 0 } }),
  input({ consent: { ...input().consent, schoolId: 'other' } }),
  input({ consent: { ...input().consent, utterance: '其他文字' } }),
  input({ consent: { ...input().consent, history: [] } }),
  input({ history: ['private'] }),
  input({ requestId: '' }),
  input({ requestId: '../bad-path' }),
  input({ requestId: 'a'.repeat(129) }),
  input({ utterance: 'x\ny' }),
  input({ utterance: ' x' }),
  input({ utterance: 'x'.repeat(401) }),
  input({ schoolId: '' }),
  input({ schoolId: '../school' }),
])('rejects invalid or unconfirmed input %# before any work', async (data) => {
  const f = fixture();
  await expect(f.run('alice', data)).rejects.toBeTruthy();
  expect(f.interpret).not.toHaveBeenCalled();
  expect(f.assertAccount).not.toHaveBeenCalled();
  expect(f.assertMembership).not.toHaveBeenCalled();
  expect(f.enforceLimit).not.toHaveBeenCalled();
});

it('requires consent with the documented error reason', () => {
  expect(() => validateSemanticConsent({ schoolId: 'pu', utterance: 'x' })).toThrow(
    expect.objectContaining({
      code: 'failed-precondition',
      details: { reason: 'cloud-consent-required' },
    }),
  );
});

it('requires a caller identity before any work', async () => {
  const f = fixture();
  await expect(f.run('', input())).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(f.interpret).not.toHaveBeenCalled();
});

it('rechecks account and membership around the only model call and returns a bound receipt without private previews', async () => {
  const f = fixture();
  const data = input();
  const answer = await f.run('alice', data);
  expect(answer).toMatchObject({
    ...success,
    provider: 'groq',
    model: GROQ_MODEL,
    requestId: data.requestId,
    schoolId: 'pu',
    utterance: data.utterance,
    previews: [],
  });
  expect(Number.isFinite(Date.parse(answer.checkedAt))).toBe(true);
  expect(f.assertAccount).toHaveBeenCalledTimes(2);
  expect(f.assertAccount).toHaveBeenNthCalledWith(1, 'alice');
  expect(f.assertMembership).toHaveBeenCalledTimes(2);
  expect(f.assertMembership).toHaveBeenNthCalledWith(1, 'pu', 'alice');
  expect(f.interpret).toHaveBeenCalledWith({
    schoolId: 'pu',
    utterance: data.utterance,
    signal: expect.any(AbortSignal),
  });
  expect(f.enforceLimit).toHaveBeenCalledWith({
    scope: 'understand-campus-request',
    key: 'alice',
    limit: 15,
    windowMs: 300000,
  });
  expect(f.assertAccount.mock.invocationCallOrder[0]).toBeLessThan(
    f.interpret.mock.invocationCallOrder[0],
  );
  expect(f.assertMembership.mock.invocationCallOrder[1]).toBeGreaterThan(
    f.interpret.mock.invocationCallOrder[0],
  );
});

it.each(['account', 'membership'])(
  'does not call the model when initial %s admission fails',
  async (kind) => {
    const f = fixture();
    (kind === 'account' ? f.assertAccount : f.assertMembership).mockRejectedValue(
      new Error('revoked'),
    );
    expect(await f.run('alice', input())).toMatchObject({
      status: 'unavailable',
      reason: kind === 'account' ? 'account_changed' : 'permission_changed',
      previews: [],
    });
    expect(f.interpret).not.toHaveBeenCalled();
  },
);

it.each(['account', 'membership'])(
  'discards model success when %s is revoked during the request',
  async (kind) => {
    const f = fixture();
    (kind === 'account' ? f.assertAccount : f.assertMembership)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('revoked'));
    expect(await f.run('alice', input())).toMatchObject({
      status: 'unavailable',
      reason: kind === 'account' ? 'account_changed' : 'permission_changed',
      destinations: [],
      previews: [],
    });
    expect(f.interpret).toHaveBeenCalledTimes(1);
  },
);

it('joins duplicate concurrent requests and never starts a second provider call', async () => {
  const d = deferred();
  const f = fixture({ interpret: jest.fn(() => d.promise) });
  const a = f.run('alice', input());
  const b = f.run('alice', input());
  await turn();
  expect(f.interpret).toHaveBeenCalledTimes(1);
  expect(f.enforceLimit).toHaveBeenCalledTimes(1);
  d.resolve(success);
  expect(await a).toEqual(await b);
  expect(await f.run('alice', input())).toMatchObject(success);
  expect(f.interpret).toHaveBeenCalledTimes(1);
  expect(f.assertMembership).toHaveBeenCalledTimes(3);
});

it('rejects another payload using the same pending ID without disturbing the original', async () => {
  const d = deferred();
  const f = fixture({ interpret: jest.fn(() => d.promise) });
  const a = f.run('alice', input());
  await expect(f.run('alice', input({ utterance: '別的需求' }))).rejects.toMatchObject({
    code: 'invalid-argument',
  });
  await turn();
  d.resolve(success);
  expect(await a).toMatchObject(success);
  expect(f.interpret).toHaveBeenCalledTimes(1);
});

it('keeps account and campus scopes separate even for the same request ID', async () => {
  const f = fixture();
  await f.run('alice', input());
  await f.run('bob', input());
  await f.run('alice', input({ schoolId: 'other' }));
  expect(f.interpret).toHaveBeenCalledTimes(3);
});

it('checks revoked access again before replaying a cached success', async () => {
  const f = fixture();
  await f.run('alice', input());
  f.assertMembership.mockRejectedValue(new Error('revoked'));
  expect(await f.run('alice', input())).toMatchObject({
    status: 'unavailable',
    reason: 'permission_changed',
    destinations: [],
  });
  expect(f.interpret).toHaveBeenCalledTimes(1);
});

it('keeps failure explicit, performs no automatic retry, and allows an explicit same-ID retry', async () => {
  const f = fixture();
  f.interpret.mockResolvedValueOnce({
    status: 'unavailable',
    source: 'fallback',
    summary: '稍後再試',
    destinations: [],
    clarifyingQuestion: null,
    reason: 'rate_limited',
    retryAfterSeconds: 30,
  });
  expect(await f.run('alice', input())).toMatchObject({
    status: 'unavailable',
    reason: 'rate_limited',
    retryAfterSeconds: 30,
  });
  expect(f.interpret).toHaveBeenCalledTimes(1);
  await expect(f.run('alice', input({ utterance: '換句話' }))).rejects.toMatchObject({
    code: 'invalid-argument',
  });
  expect(await f.run('alice', input())).toMatchObject(success);
  expect(f.interpret).toHaveBeenCalledTimes(2);
});

it('retains the real per-user 15 requests per 5 minutes limit', async () => {
  const f = fixture({ enforceLimit: enforceRateLimit });
  for (let i = 0; i < 15; i++)
    expect(
      await f.run(
        'semantic-fixture-limit-15',
        input({ requestId: 'request-' + i.toString().padStart(4, '0') }),
      ),
    ).toMatchObject(success);
  expect(
    await f.run('semantic-fixture-limit-15', input({ requestId: 'request-0015' })),
  ).toMatchObject({ status: 'unavailable', reason: 'rate_limited' });
  expect(f.interpret).toHaveBeenCalledTimes(15);
});

it('times out ignored or stalled work and never exposes late success', async () => {
  const d = deferred();
  const f = fixture({ deadlineMs: 5, interpret: jest.fn(() => d.promise) });
  const result = await f.run('alice', input());
  expect(result).toMatchObject({ status: 'unavailable', reason: 'timeout' });
  expect(f.interpret.mock.calls[0][0].signal.aborted).toBe(true);
  d.resolve(success);
  await turn();
  expect(result.destinations).toEqual([]);
});

it('times out admission without making a delayed model call', async () => {
  const d = deferred();
  const f = fixture({ deadlineMs: 5, assertAccount: jest.fn(() => d.promise) });
  expect(await f.run('alice', input())).toMatchObject({ reason: 'timeout' });
  d.resolve();
  await turn();
  expect(f.interpret).not.toHaveBeenCalled();
});

it('bounds memory and releases only settled expired entries', async () => {
  let current = 100000;
  const f = fixture({ now: () => current });
  for (let i = 0; i < MAX_ENTRIES; i++)
    await f.run(
      'capacity-fixture-' + i,
      input({ requestId: 'request-' + i.toString().padStart(4, '0') }),
    );
  expect(await f.run('alice', input({ requestId: 'request-full' }))).toMatchObject({
    status: 'unavailable',
    reason: 'rate_limited',
  });
  expect(f.interpret).toHaveBeenCalledTimes(MAX_ENTRIES);
  current += CACHE_MS;
  expect(await f.run('alice', input({ requestId: 'request-new1' }))).toMatchObject(success);
});

it('uses a stable payload binding independent of JSON key order', async () => {
  const f = fixture();
  const original = input();
  await f.run('alice', original);
  const reordered = {
    ...original,
    consent: Object.fromEntries(Object.entries(original.consent).reverse()),
  };
  expect(await f.run('alice', reordered)).toMatchObject(success);
  expect(f.interpret).toHaveBeenCalledTimes(1);
});

it('captures the confirmed strings before asynchronous work begins', async () => {
  const gate = deferred();
  const f = fixture({ assertAccount: jest.fn(() => gate.promise) });
  const data = input();
  const expected = data.utterance;
  const pending = f.run('alice', data);
  data.utterance = '不能被偷換的新文字';
  data.schoolId = 'other';
  data.consent.utterance = data.utterance;
  gate.resolve();
  expect(await pending).toMatchObject({ schoolId: 'pu', utterance: expected });
  expect(f.interpret).toHaveBeenCalledWith({
    schoolId: 'pu',
    utterance: expected,
    signal: expect.any(AbortSignal),
  });
});

it.each([false, null, undefined])(
  'fails closed on missing membership evidence %#',
  async (membership) => {
    const f = fixture({ assertMembership: jest.fn(async () => membership) });
    expect(await f.run('alice', input())).toMatchObject({
      status: 'unavailable',
      reason: 'permission_changed',
    });
    expect(f.interpret).not.toHaveBeenCalled();
  },
);

it('does not let 128 rejected memberships occupy capacity needed by another caller', async () => {
  const f = fixture({
    assertMembership: jest.fn(async (_school, uid) => {
      if (uid === 'rejected-fixture') throw new Error('not a member');
      return {};
    }),
  });
  for (let i = 0; i < 128; i++) {
    expect(
      await f.run(
        'rejected-fixture',
        input({ requestId: 'rejected-' + i.toString().padStart(4, '0') }),
      ),
    ).toMatchObject({ reason: 'permission_changed' });
  }
  expect(await f.run('legitimate-fixture', input())).toMatchObject(success);
  expect(f.interpret).toHaveBeenCalledTimes(1);
  expect(f.enforceLimit).toHaveBeenCalledTimes(1);
});

it('caps one caller at 15 pending bindings while duplicates join and another caller can proceed', async () => {
  const gate = deferred();
  const f = fixture({
    assertMembership: jest.fn((_school, uid) =>
      uid === 'pending-fixture' ? gate.promise : Promise.resolve({}),
    ),
  });
  const requests = Array.from({ length: 15 }, (_, i) =>
    f.run('pending-fixture', input({ requestId: 'pending-' + i.toString().padStart(4, '0') })),
  );
  const duplicate = f.run('pending-fixture', input({ requestId: 'pending-0000' }));
  const extra = f.run('pending-fixture', input({ requestId: 'pending-extra' }));
  const observed = await Promise.race([
    extra,
    new Promise((resolve) => setTimeout(() => resolve({ reason: 'still_pending' }), 20)),
  ]);
  const other = await f.run('other-fixture', input());
  gate.resolve({});
  await Promise.all([...requests, duplicate, extra]);
  expect(observed).toMatchObject({ status: 'unavailable', reason: 'rate_limited' });
  expect(other).toMatchObject(success);
  expect(f.interpret).toHaveBeenCalledTimes(16);
});

it('also releases cached bindings when access is revoked on replay', async () => {
  const f = fixture();
  for (let i = 0; i < 15; i++)
    await f.run('alice', input({ requestId: 'cached-' + i.toString().padStart(4, '0') }));
  f.assertMembership.mockRejectedValueOnce(new Error('revoked'));
  expect(await f.run('alice', input({ requestId: 'cached-0000' }))).toMatchObject({
    reason: 'permission_changed',
  });
  expect(await f.run('alice', input({ requestId: 'cached-new00' }))).toMatchObject(success);
});
