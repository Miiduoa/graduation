const assert = require('node:assert/strict');
const { test } = require('node:test');
const { REQUIRED_APIS, preflight } = require('./firebase-release-preflight.cjs');

const project = 'campus-release-test';
const number = '123456789012';
const bucket = `${project}.firebasestorage.app`;
const sha = 'a'.repeat(40);
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const service = (name) => ({
  name: `projects/${number}/services/${name}`,
  config: { name },
  state: 'ENABLED',
});

function fixture(overrides = {}) {
  const calls = [];
  const replies = {
    'oauth2.googleapis.com': { access_token: 'private-access' },
    'cloudresourcemanager.googleapis.com': {
      projectId: project,
      projectNumber: number,
      lifecycleState: 'ACTIVE',
    },
    'cloudbilling.googleapis.com': {
      projectId: project,
      billingEnabled: true,
      billingAccountName: 'private-account',
    },
    'serviceusage.googleapis.com': { services: REQUIRED_APIS.map(service) },
    'identitytoolkit.googleapis.com': {
      name: `projects/${number}/config`,
      authorizedDomains: ['nuni.tw'],
      privateField: 'private-auth-config',
    },
    'firestore.googleapis.com': {
      name: `projects/${project}/databases/(default)`,
      type: 'FIRESTORE_NATIVE',
      locationId: 'nam5',
    },
    'storage.googleapis.com': {
      name: bucket,
      projectNumber: number,
      privateField: 'private-storage-config',
    },
    ...overrides,
  };
  return {
    calls,
    options: {
      project,
      storageBucket: bucket,
      authDomain: 'nuni.tw',
      databaseLocation: 'nam5',
      firebaseToken: 'private-refresh',
      sourceCommit: sha,
      workingTreeDirty: false,
      oauthClient: () => ({ clientId: 'private-client-id', clientSecret: 'private-client-secret' }),
      localCredentials: () => {
        throw new Error('CI must not load a local account');
      },
      fetchImpl: async (url, options) => {
        const parsed = new URL(url);
        calls.push({ url: parsed, options });
        assert.equal(options.redirect, 'error');
        if (parsed.hostname !== 'oauth2.googleapis.com') {
          assert.equal(options.method, 'GET', 'Infrastructure reads must never mutate a service.');
          assert.equal(options.headers.Authorization, 'Bearer private-access');
        }
        const data = replies[parsed.hostname];
        assert.notEqual(data, undefined, 'Unexpected host');
        return typeof data === 'function' ? data(parsed, options) : response(data);
      },
    },
  };
}

test('validates every prerequisite with refresh-token auth and produces a version-bound, secret-free receipt', async () => {
  const f = fixture();
  const result = await preflight(f.options);
  assert.equal(result.ready, true);
  assert.equal(result.sourceCommit, sha);
  assert.equal(result.workingTreeDirty, false);
  assert.equal(result.target.projectNumber, number);
  assert.equal(result.target.databaseLocation, 'nam5');
  assert.equal(result.checks.length, REQUIRED_APIS.length + 6);
  assert.doesNotMatch(JSON.stringify(result), /private-/);
  const tokenRequest = f.calls[0].options;
  assert.equal(tokenRequest.method, 'POST');
  assert.equal(tokenRequest.body.get('grant_type'), 'refresh_token');
  assert.equal(tokenRequest.body.get('refresh_token'), 'private-refresh');
  assert.equal(tokenRequest.body.get('scope'), 'https://www.googleapis.com/auth/cloud-platform');
  assert.equal(f.calls.filter((call) => call.options.method !== 'GET').length, 1);
});

test('reports all missing prerequisites together instead of stopping at the first one', async () => {
  const f = fixture({
    'cloudbilling.googleapis.com': { projectId: project, billingEnabled: false },
    'serviceusage.googleapis.com': {},
    'identitytoolkit.googleapis.com': () => response({ error: 'private-auth' }, 404),
    'storage.googleapis.com': () => response({ error: 'private-storage' }, 404),
  });
  const result = await preflight(f.options);
  assert.equal(result.ready, false);
  assert.equal(result.checks.find((x) => x.id === 'billing').status, 'blocked');
  assert.match(result.checks.find((x) => x.id === 'billing').action, /Blaze/);
  assert.equal(
    result.checks.filter((x) => x.id.startsWith('api:') && x.status === 'blocked').length,
    REQUIRED_APIS.length,
  );
  assert.equal(result.checks.find((x) => x.id === 'auth').status, 'blocked');
  assert.equal(result.checks.find((x) => x.id === 'storage').status, 'blocked');
  assert.equal(result.checks.find((x) => x.id === 'firestore').status, 'ready');
  assert.doesNotMatch(JSON.stringify(result), /private-/);
});

test('uses the project-scoped local Firebase login only when CI credentials are absent', async () => {
  const f = fixture();
  let localReads = 0;
  f.options.firebaseToken = undefined;
  f.options.projectDir = '/explicit/checkout';
  f.options.localCredentials = (dir) => {
    assert.equal(dir, '/explicit/checkout');
    localReads += 1;
    return 'private-local-refresh';
  };
  assert.equal((await preflight(f.options)).ready, true);
  assert.equal(localReads, 1);
  assert.equal(f.calls[0].options.body.get('refresh_token'), 'private-local-refresh');
  f.options.firebaseToken = '';
  await assert.rejects(preflight(f.options), /Firebase login is missing/);
  assert.equal(localReads, 1, 'Empty explicit credentials must not fall back to a local user.');
});

test('consumes all enabled-service pages and checks their project identity', async () => {
  const f = fixture({
    'serviceusage.googleapis.com': (url) =>
      url.searchParams.has('pageToken')
        ? response({ services: REQUIRED_APIS.slice(3).map(service) })
        : response({
            services: REQUIRED_APIS.slice(0, 3).map(service),
            nextPageToken: 'private-next-page',
          }),
  });
  const result = await preflight(f.options);
  assert.equal(result.ready, true);
  assert.equal(f.calls.filter((x) => x.url.hostname === 'serviceusage.googleapis.com').length, 2);
  assert.doesNotMatch(JSON.stringify(result), /private-/);
});

for (const [label, body] of [
  ['repeated page token', { services: [], nextPageToken: 'private-loop' }],
  ['malformed service list', { services: {} }],
  [
    'wrong project',
    {
      services: [
        { ...service(REQUIRED_APIS[0]), name: `projects/999/services/${REQUIRED_APIS[0]}` },
      ],
    },
  ],
  ['disabled service', { services: [{ ...service(REQUIRED_APIS[0]), state: 'DISABLED' }] }],
  ['non-string page token', { services: [], nextPageToken: 7 }],
]) {
  test(`blocks incomplete API evidence: ${label}`, async () => {
    const f = fixture({ 'serviceusage.googleapis.com': body });
    const result = await preflight(f.options);
    assert.equal(result.ready, false);
    assert.equal(
      result.checks.filter((x) => x.id.startsWith('api:') && x.status === 'blocked').length,
      REQUIRED_APIS.length,
    );
    assert.doesNotMatch(JSON.stringify(result), /private-/);
  });
}

for (const [host, body, expected] of [
  [
    'cloudresourcemanager.googleapis.com',
    { projectId: 'another-project', projectNumber: number, lifecycleState: 'ACTIVE' },
    'project',
  ],
  [
    'cloudresourcemanager.googleapis.com',
    { projectId: project, projectNumber: number, lifecycleState: 'DELETE_REQUESTED' },
    'project',
  ],
  [
    'cloudbilling.googleapis.com',
    { projectId: 'another-project', billingEnabled: true },
    'billing',
  ],
  [
    'identitytoolkit.googleapis.com',
    { name: 'projects/999/config', authorizedDomains: ['nuni.tw'] },
    'auth',
  ],
  [
    'identitytoolkit.googleapis.com',
    { name: `projects/${project}/config`, authorizedDomains: ['www.nuni.tw'] },
    'auth-domain',
  ],
  [
    'firestore.googleapis.com',
    { name: `projects/${project}/databases/other`, type: 'FIRESTORE_NATIVE', locationId: 'nam5' },
    'firestore',
  ],
  [
    'firestore.googleapis.com',
    { name: `projects/${project}/databases/(default)`, type: 'DATASTORE_MODE', locationId: 'nam5' },
    'firestore',
  ],
  [
    'firestore.googleapis.com',
    {
      name: `projects/${project}/databases/(default)`,
      type: 'FIRESTORE_NATIVE',
      locationId: 'asia-east1',
    },
    'firestore',
  ],
  ['storage.googleapis.com', { name: bucket, projectNumber: '999' }, 'storage'],
  ['storage.googleapis.com', { name: 'another-bucket', projectNumber: number }, 'storage'],
]) {
  test(`rejects an incorrect or mismatched prerequisite: ${expected} ${JSON.stringify(body)}`, async () => {
    const result = await preflight(fixture({ [host]: body }).options);
    assert.equal(result.ready, false);
    assert.equal(result.checks.find((x) => x.id === expected).status, 'blocked');
  });
}

test('service HTTP errors, malformed JSON and network exceptions never disclose response bodies or credentials', async () => {
  for (const failure of [
    () => response({ error: 'private-service-response' }, 403),
    () => new Response('private-malformed-json'),
    () => {
      throw new Error('private-network-error');
    },
  ]) {
    const result = await preflight(fixture({ 'cloudbilling.googleapis.com': failure }).options);
    assert.equal(result.ready, false);
    assert.doesNotMatch(JSON.stringify(result), /private-/);
    assert.match(result.checks.find((x) => x.id === 'billing').action, /verify access and retry/);
  }
});

test('credential exchange failures stop service calls and redact error bodies', async () => {
  for (const reply of [
    () => response({ error: 'private-token' }, 401),
    () => response({}),
    () => {
      throw new Error('private-network');
    },
  ]) {
    const f = fixture({ 'oauth2.googleapis.com': reply });
    await assert.rejects(preflight(f.options), (error) => {
      assert.match(error.message, /Firebase credential exchange failed/);
      assert.doesNotMatch(error.message, /private-/);
      return true;
    });
    assert.equal(f.calls.length, 1);
  }
});

test('an aborted service read produces a blocked receipt at the bounded deadline', async () => {
  const f = fixture({
    'storage.googleapis.com': (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('private-timeout')), {
          once: true,
        });
      }),
  });
  const result = await preflight({ ...f.options, timeoutMs: 15 });
  assert.equal(result.ready, false);
  assert.equal(result.checks.find((x) => x.id === 'deadline').status, 'blocked');
  assert.doesNotMatch(JSON.stringify(result), /private-/);
});

test('validates target identifiers before reading credentials or issuing requests', async () => {
  for (const invalid of [
    { project: 'default' },
    { project: '../other' },
    { storageBucket: undefined },
    { storageBucket: 'bucket/path' },
    { authDomain: 'https://nuni.tw' },
    { database: '../other' },
    { sourceCommit: 'private-short-sha' },
    { timeoutMs: 0 },
  ]) {
    const f = fixture();
    await assert.rejects(preflight({ ...f.options, ...invalid }));
    assert.equal(f.calls.length, 0);
  }
});
