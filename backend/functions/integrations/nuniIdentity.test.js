const {
  createNuniIdentityClient,
  resolveIdentityBinding,
  validateIdentityBindings,
} = require('./nuniIdentity');

const identity = { tenantId: 'school-a', personId: 'person-a' };
const binding = {
  firebaseProjectId: 'campus-test',
  firebaseUid: 'uid-a',
  schoolId: 'campus-school',
  nuniOrigin: 'https://api.nuni.tw',
  ...identity,
  status: 'active',
  evidenceRef: 'synthetic-verification-record',
  verifiedAt: '2026-01-01T00:00:00Z',
};
const document = { version: 1, bindings: [binding] };
const selection = {
  document,
  firebaseProjectId: binding.firebaseProjectId,
  firebaseUid: binding.firebaseUid,
  schoolId: binding.schoolId,
  origin: binding.nuniOrigin,
  identity,
  now: Date.parse('2026-02-01'),
};
const json = (body = identity, options = {}) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...options,
  });

test.each(['Bearer opaque-token', 'Session opaque-server-handle'])(
  'uses the real Nuni identity endpoint with %s without decoding its contents',
  async (authorization) => {
    const fetchImpl = jest.fn().mockResolvedValue(json());
    expect(await createNuniIdentityClient({ fetchImpl }).introspect(authorization)).toEqual(
      identity,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.nuni.tw/v1/auth/session/identity',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        headers: { authorization, accept: 'application/json' },
      }),
    );
  },
);

test.each([
  'http://api.nuni.tw',
  'https://user:pass@api.nuni.tw',
  'https://api.nuni.tw/other',
  'https://api.nuni.tw?target=x',
  'https://api.nuni.tw#secret',
  'https://api.nuni.tw:444',
])('rejects unsafe origin configuration %s', (origin) => {
  expect(() => createNuniIdentityClient({ origin })).toThrow(
    expect.objectContaining({ code: 'invalid_config' }),
  );
});

test('an explicitly configured server origin is pinned to the mapping authority', async () => {
  const origin = 'https://staging.nuni.example';
  const fetchImpl = jest.fn().mockResolvedValue(json());
  await createNuniIdentityClient({ origin, fetchImpl }).introspect('Bearer opaque');
  expect(fetchImpl.mock.calls[0][0]).toBe(`${origin}/v1/auth/session/identity`);
  expect(() => resolveIdentityBinding({ ...selection, origin })).toThrow(
    expect.objectContaining({ code: 'identity_mismatch' }),
  );
});

test.each(['Bearer token\r\nHost: evil.example', 'Platform token', '', 'Bearer a b'])(
  'rejects invalid authorization before network %p',
  async (authorization) => {
    const fetchImpl = jest.fn();
    await expect(
      createNuniIdentityClient({ fetchImpl }).introspect(authorization),
    ).rejects.toMatchObject({ code: 'invalid_config' });
    expect(fetchImpl).not.toHaveBeenCalled();
  },
);

test.each([
  [401, 'invalid_session'],
  [403, 'invalid_session'],
  [302, 'upstream_unavailable'],
  [500, 'upstream_unavailable'],
])('keeps HTTP %s distinct from success without exposing response text', async (status, code) => {
  const fetchImpl = jest.fn().mockResolvedValue(json({ secret: 'opaque-token' }, { status }));
  const error = await createNuniIdentityClient({ fetchImpl })
    .introspect('Bearer opaque-token')
    .catch((value) => value);
  expect(error.code).toBe(code);
  expect(error.message).not.toContain('opaque-token');
});

test.each([
  { tenantId: 'school-a' },
  { ...identity, personId: '' },
  { ...identity, roles: ['admin'] },
  [],
  null,
])('rejects malformed identity response %p', async (body) => {
  await expect(
    createNuniIdentityClient({ fetchImpl: async () => json(body) }).introspect('Bearer token'),
  ).rejects.toMatchObject({ code: 'invalid_response' });
});

test('bounds both declared and streamed response size and rejects non-JSON bodies', async () => {
  for (const response of [
    new Response('x', {
      headers: { 'content-type': 'application/json', 'content-length': '8193' },
    }),
    new Response('x'.repeat(8193), { headers: { 'content-type': 'application/json' } }),
    new Response('{}', { headers: { 'content-type': 'text/html' } }),
    new Response('not-json', { headers: { 'content-type': 'application/json' } }),
  ]) {
    await expect(
      createNuniIdentityClient({ fetchImpl: async () => response }).introspect('Bearer token'),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  }
});

test('deadline covers both headers and a stalled streaming body', async () => {
  const stalledBody = new Response(new ReadableStream({ start() {} }), {
    headers: { 'content-type': 'application/json' },
  });
  for (const fetchImpl of [() => new Promise(() => {}), async () => stalledBody]) {
    await expect(
      createNuniIdentityClient({ timeoutMs: 10, fetchImpl }).introspect('Bearer token'),
    ).rejects.toMatchObject({ code: 'timeout' });
  }
});

test('fetch exceptions cannot leak a credential through the adapter error', async () => {
  const error = await createNuniIdentityClient({
    fetchImpl: async () => {
      throw new Error('secret-Bearer-token');
    },
  })
    .introspect('Bearer token')
    .catch((value) => value);
  expect(error).toMatchObject({ code: 'upstream_unavailable' });
  expect(error.message).not.toContain('secret-Bearer-token');
});

test('resolves only explicit matching identity evidence, never email or names', () => {
  expect(resolveIdentityBinding(selection)).toMatchObject(binding);
  expect(() =>
    resolveIdentityBinding({
      ...selection,
      identity: { tenantId: identity.tenantId, personId: 'other', email: 'same@example.test' },
    }),
  ).toThrow(expect.objectContaining({ code: 'identity_mismatch' }));
});

test.each([
  { firebaseUid: 'other' },
  { firebaseProjectId: 'other' },
  { schoolId: 'other' },
  { document: { version: 1, bindings: [] } },
  { document: { version: 1, bindings: [{ ...binding, status: 'revoked' }] } },
  { document: { version: 1, bindings: [{ ...binding, verifiedAt: '2099-01-01T00:00:00Z' }] } },
])('fails closed for absent/revoked/unverified mapping %p', (patch) => {
  expect(() => resolveIdentityBinding({ ...selection, ...patch })).toThrow(
    expect.objectContaining({ code: 'mapping_unavailable' }),
  );
});

test.each([{ ...binding, firebaseUid: 'other' }, { ...binding, personId: 'other' }, binding])(
  'rejects duplicate local or external identities %p',
  (other) => {
    expect(() => validateIdentityBindings({ version: 1, bindings: [binding, other] })).toThrow(
      expect.objectContaining({ code: 'invalid_mapping' }),
    );
  },
);

test.each(['nuniOrigin', 'evidenceRef', 'verifiedAt'])(
  'requires explicit mapping evidence field %s',
  (key) => {
    const incomplete = { ...binding };
    delete incomplete[key];
    expect(() => validateIdentityBindings({ version: 1, bindings: [incomplete] })).toThrow(
      expect.objectContaining({ code: 'invalid_mapping' }),
    );
  },
);
