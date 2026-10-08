const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const {
  indexKey,
  fieldRequirements,
  loadDeployment,
  waitForIndexes,
} = require('./wait-for-firestore-indexes.cjs');

const project = 'campus-index-test';
const spec = {
  collectionGroup: '_puSessions',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'ownerUid', order: 'ASCENDING' },
    { fieldPath: 'expiresAt', order: 'DESCENDING' },
  ],
};

function remote(state = 'READY', overrides = {}) {
  return {
    ...spec,
    name: `projects/${project}/databases/(default)/collectionGroups/_puSessions/indexes/session-index`,
    fields: [...spec.fields, { fieldPath: '__name__', order: 'DESCENDING' }],
    state,
    ...overrides,
  };
}

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function fixture(listResponses) {
  let reads = 0;
  const logs = [];
  const requests = [];
  const fetchImpl = async (url, options) => {
    const request = { url: new URL(url), options };
    requests.push(request);
    if (request.url.hostname === 'oauth2.googleapis.com') {
      return reply({ access_token: 'private-access-token', expires_in: 3600 });
    }
    assert.equal(request.url.hostname, 'firestore.googleapis.com');
    assert.equal(options.headers.Authorization, 'Bearer private-access-token');
    assert.equal(options.redirect, 'error');
    const value = listResponses[Math.min(reads++, listResponses.length - 1)];
    return typeof value === 'function' ? value(request) : reply(value);
  };
  return {
    options: {
      project,
      indexes: [spec],
      firebaseToken: 'private-refresh-token',
      oauthClient: () => ({ clientId: 'cli-client', clientSecret: 'private-client-secret' }),
      fetchImpl,
      timeoutMs: 45,
      pollMs: 2,
      log: (message) => logs.push(message),
    },
    requests,
    logs,
    reads: () => reads,
  };
}

test('uses the Firebase CI refresh token and accepts exact READY index with implicit name ordering', async () => {
  const f = fixture([{ indexes: [remote()] }]);
  await waitForIndexes(f.options);
  const form = f.requests[0].options.body;
  assert.equal(form.get('refresh_token'), 'private-refresh-token');
  assert.equal(form.get('grant_type'), 'refresh_token');
  assert.equal(form.get('client_id'), 'cli-client');
  assert.equal(form.get('scope'), 'https://www.googleapis.com/auth/cloud-platform');
  assert.equal(f.reads(), 1);
  assert.match(f.logs[0], /1 required indexes/);
  assert.doesNotMatch(f.logs.join(' '), /private-/);
  assert.equal(spec.fields.length, 2, 'Matching must not mutate the deployment specification.');
});

test('waits through missing and creating before allowing the dependent deployment', async () => {
  const f = fixture([{}, { indexes: [remote('CREATING')] }, { indexes: [remote()] }]);
  await waitForIndexes(f.options);
  assert.equal(f.reads(), 3);
  assert.match(f.logs[0], /MISSING/);
  assert.match(f.logs[1], /CREATING/);
  assert.match(f.logs[2], /READY/);
});

for (const state of ['MISSING', 'CREATING']) {
  test(`${state} never passes and fails at the bounded deadline`, async () => {
    const f = fixture([state === 'MISSING' ? {} : { indexes: [remote(state)] }]);
    await assert.rejects(waitForIndexes(f.options), new RegExp(`timed out.*${state}`));
    assert.ok(f.reads() > 1);
    assert.equal(f.logs.length, 1, 'Unchanged polling must not flood logs.');
    assert.doesNotMatch(f.logs.join(' '), /indexes READY/);
  });
}

for (const state of ['NEEDS_REPAIR', 'STATE_UNSPECIFIED', 'ERROR', undefined]) {
  test(`rejects terminal or unknown state ${state} immediately`, async () => {
    const f = fixture([{ indexes: [{ ...remote(), state }] }]);
    await assert.rejects(waitForIndexes(f.options), /Required Firestore index is/);
    assert.equal(f.reads(), 1);
  });
}

test('requires every checked-in index, not only the one that is ready', async () => {
  const f = fixture([{ indexes: [remote()] }]);
  f.options.indexes = [spec, { ...spec, collectionGroup: 'notifications' }];
  await assert.rejects(waitForIndexes(f.options), /MISSING: notifications/);
});

test('does not substitute the wrong field order, scope, database, or implicit name direction', async (t) => {
  const cases = [
    { fields: [...spec.fields].reverse() },
    { queryScope: 'COLLECTION_GROUP' },
    { fields: [...spec.fields, { fieldPath: '__name__', order: 'ASCENDING' }] },
    { apiScope: 'MONGODB_COMPATIBLE_API' },
    { density: 'DENSE' },
    { multikey: true },
    { unique: true },
  ];
  for (const overrides of cases) {
    await t.test(JSON.stringify(overrides), async () => {
      const f = fixture([{ indexes: [remote('READY', overrides)] }]);
      await assert.rejects(waitForIndexes(f.options), /MISSING/);
    });
  }
  const f = fixture([
    {
      indexes: [
        remote('READY', {
          name: `projects/${project}/databases/other-db/collectionGroups/_puSessions/indexes/index`,
        }),
      ],
    },
  ]);
  await assert.rejects(waitForIndexes(f.options), /outside the requested project\/database/);
});

test('supports array indexes and an explicit __name__ order', () => {
  const arraySpec = { ...spec, fields: [{ fieldPath: 'members', arrayConfig: 'CONTAINS' }] };
  const expected = JSON.parse(indexKey(arraySpec, arraySpec.collectionGroup, true));
  assert.deepEqual(expected.fields.at(-1), { fieldPath: '__name__', order: 'ASCENDING' });
  const explicit = {
    ...spec,
    fields: [...spec.fields, { fieldPath: '__name__', order: 'ASCENDING' }],
  };
  assert.equal(indexKey(explicit, explicit.collectionGroup, true), indexKey(explicit));
});

test('consumes paginated results before declaring any required index missing', async () => {
  const f = fixture([
    { indexes: [], nextPageToken: 'second-page' },
    (request) => {
      assert.equal(request.url.searchParams.get('pageToken'), 'second-page');
      return reply({ indexes: [remote()] });
    },
  ]);
  await waitForIndexes(f.options);
  assert.equal(f.reads(), 2);
});

test('unrelated vector, new query scope, and failed indexes do not block required READY indexes', async () => {
  const f = fixture([
    {
      indexes: [
        remote('NEEDS_REPAIR', {
          fields: [{ fieldPath: 'embedding', vectorConfig: { dimension: 3, flat: {} } }],
        }),
        remote('CREATING', { queryScope: 'COLLECTION_RECURSIVE' }),
        remote('NEEDS_REPAIR', { fields: [{ fieldPath: 'unrelated', order: 'ASCENDING' }] }),
        remote(),
      ],
    },
  ]);
  await waitForIndexes(f.options);
  assert.equal(f.reads(), 1);
  assert.match(f.logs[0], /indexes READY/);
});

test('rejects repeated pagination tokens', async () => {
  const f = fixture([{ indexes: [], nextPageToken: 'repeated' }]);
  await assert.rejects(waitForIndexes(f.options), /repeated pagination token/);
});

for (const status of [401, 403, 404, 429, 500, 503]) {
  test(`listing HTTP ${status} blocks release without disclosing response content`, async () => {
    const f = fixture([() => reply({ error: 'private-response-body' }, status)]);
    await assert.rejects(waitForIndexes(f.options), (error) => {
      assert.equal(error.message, `Firestore index listing returned HTTP ${status}.`);
      return true;
    });
    assert.equal(f.reads(), 1);
  });
}

test('malformed JSON, malformed index list, and network errors fail closed', async () => {
  for (const response of [
    () => new Response('not-json'),
    () => reply({ indexes: {} }),
    () => {
      throw new Error('private-network-detail');
    },
  ]) {
    const f = fixture([response]);
    await assert.rejects(waitForIndexes(f.options), (error) => {
      assert.match(error.message, /invalid|failed/);
      assert.doesNotMatch(error.message, /private-/);
      return true;
    });
  }
});

test('credential exchange error and malformed success do not issue a Firestore request', async () => {
  for (const response of [reply({ error: 'private-auth-detail' }, 400), reply({})]) {
    const f = fixture([]);
    let calls = 0;
    f.options.fetchImpl = async () => {
      calls += 1;
      return response;
    };
    await assert.rejects(waitForIndexes(f.options), /Firebase credential exchange/);
    assert.equal(calls, 1);
  }
});

test('the deadline aborts a real HTTP request that never returns', async (t) => {
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const f = fixture([]);
  f.options.fetchImpl = (_url, options) =>
    fetch(`http://127.0.0.1:${server.address().port}`, options);
  await assert.rejects(waitForIndexes(f.options), /timed out/);
});

test('validates explicit credentials and project before making requests', async () => {
  for (const overrides of [
    { project: undefined },
    { project: 'default' },
    { project: 'abc/other' },
    { firebaseToken: '' },
    { timeoutMs: 0 },
    { indexes: [] },
  ]) {
    const f = fixture([]);
    await assert.rejects(waitForIndexes({ ...f.options, ...overrides }));
    assert.equal(f.requests.length, 0);
  }
});

test('reads the same database and index file as Firebase deploy', () => {
  const actual = loadDeployment(path.resolve(__dirname, '../firebase.json'));
  assert.equal(actual.database, '(default)');
  assert.ok(actual.indexes.some((index) => index.collectionGroup === '_puSessions'));
  for (const index of actual.indexes) assert.ok(indexKey(index, index.collectionGroup, true));
});

test('rejects unsupported multiple databases and malformed field overrides', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-index-gate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'firebase.json');
  fs.writeFileSync(configPath, JSON.stringify({ firestore: [{ database: 'other' }] }));
  assert.throws(() => loadDeployment(configPath), /one Firestore database/);
  fs.writeFileSync(configPath, JSON.stringify({ firestore: { indexes: 'indexes.json' } }));
  fs.writeFileSync(
    path.join(directory, 'indexes.json'),
    JSON.stringify({ indexes: [spec], fieldOverrides: [{}] }),
  );
  assert.throws(
    () => loadDeployment(configPath),
    /Invalid or unsupported Firestore field override/,
  );
});

test('CLI exits nonzero on missing credentials without leaking environment values', () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(__dirname, 'wait-for-firestore-indexes.cjs'),
      '--project',
      project,
      '--config',
      path.join(__dirname, '../firebase.json'),
    ],
    { encoding: 'utf8', env: { ...process.env, FIREBASE_TOKEN: '' } },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FIREBASE_TOKEN.*required/);
});

const override = {
  collectionGroup: 'registrations',
  fieldPath: 'userId',
  indexes: [
    { queryScope: 'COLLECTION', order: 'ASCENDING' },
    { queryScope: 'COLLECTION', order: 'DESCENDING' },
    { queryScope: 'COLLECTION', arrayConfig: 'CONTAINS' },
    { queryScope: 'COLLECTION_GROUP', order: 'ASCENDING' },
  ],
};
const fieldParent = `projects/${project}/databases/(default)/collectionGroups/`;
const fieldName = `${fieldParent}registrations/fields/userId`;
function remoteField(state = 'READY', config = {}, name = fieldName) {
  return {
    name,
    indexConfig: {
      indexes: override.indexes.map((index) => ({
        queryScope: index.queryScope,
        fields: [{ fieldPath: 'userId', order: index.order, arrayConfig: index.arrayConfig }],
        state,
      })),
      ...config,
    },
  };
}
function fieldFixture(respond) {
  const f = fixture([]);
  const exchange = f.options.fetchImpl;
  const requests = [];
  f.options.fieldOverrides = [override];
  f.options.timeoutMs = 80;
  f.options.fetchImpl = async (url, options) => {
    const request = { url: new URL(url), options };
    if (request.url.hostname === 'oauth2.googleapis.com') return exchange(url, options);
    assert.equal(request.url.hostname, 'firestore.googleapis.com');
    assert.equal(options.headers.Authorization, 'Bearer private-access-token');
    assert.equal(options.redirect, 'error');
    if (request.url.pathname.endsWith('/indexes')) return reply({ indexes: [remote()] });
    requests.push(request);
    return respond(request, requests.length);
  };
  return { ...f, fieldRequests: requests };
}

test('requires all four declared registration single-field indexes, including collection-group scope', async () => {
  const f = fieldFixture((request) => {
    assert.equal(request.url.pathname, `/v1/${fieldParent}-/fields`);
    assert.equal(
      request.url.searchParams.get('filter'),
      'indexConfig.usesAncestorConfig=false OR ttlConfig:*',
    );
    return reply({ fields: [remoteField()] });
  });
  await waitForIndexes(f.options);
  assert.equal(f.fieldRequests.length, 1);
  assert.match(f.logs.at(-1), /1 required indexes and 1 field configurations/);
  assert.doesNotMatch(f.logs.join(' '), /private-/);
});

test('supports field-only deployments and protobuf-omitted single-field paths without appending __name__', async () => {
  const field = remoteField();
  field.indexConfig.indexes.forEach((index) => {
    delete index.fields[0].fieldPath;
  });
  const f = fieldFixture(() => reply({ fields: [field] }));
  f.options.indexes = [];
  await waitForIndexes(f.options);
  assert.match(f.logs.at(-1), /0 required indexes and 1 field configurations/);
});

test('consumes every field page before checking a required field', async () => {
  const f = fieldFixture((request) =>
    request.url.searchParams.get('pageToken') === 'fields-next'
      ? reply({ fields: [remoteField()] })
      : reply({ fields: [], nextPageToken: 'fields-next' }),
  );
  await waitForIndexes(f.options);
  assert.equal(f.fieldRequests.length, 2);
});

test('field readiness polls missing shapes and creating state without treating composite READY as sufficient', async () => {
  const f = fieldFixture((_request, count) => {
    const field = remoteField(count === 2 ? 'CREATING' : 'READY');
    if (count === 1) field.indexConfig.indexes.pop();
    return reply({ fields: [field] });
  });
  await waitForIndexes(f.options);
  assert.equal(f.fieldRequests.length, 3);
  assert.match(f.logs[0], /MISSING.*registrations.userId.*COLLECTION_GROUP/);
  assert.match(f.logs[1], /CREATING/);
});

for (const state of ['CREATING', 'NEEDS_REPAIR', 'STATE_UNSPECIFIED', 'ERROR', undefined]) {
  test(`a required single-field index in ${state} cannot pass`, async () => {
    const field = remoteField();
    field.indexConfig.indexes[3].state = state;
    const f = fieldFixture(() => reply({ fields: [field] }));
    await assert.rejects(
      waitForIndexes(f.options),
      state === 'CREATING' ? /timed out.*CREATING/ : /Required Firestore field index is/,
    );
    assert.doesNotMatch(f.logs.join(' '), /indexes READY/);
  });
}

test('an absent collection-group index cannot be replaced by an unrelated or differently configured READY index', async () => {
  for (const patch of [
    { queryScope: 'COLLECTION' },
    { apiScope: 'MONGODB_COMPATIBLE_API' },
    { density: 'DENSE' },
    { multikey: true },
    { unique: true },
  ]) {
    const field = remoteField();
    if (patch.queryScope) field.indexConfig.indexes = field.indexConfig.indexes.slice(0, 3);
    else Object.assign(field.indexConfig.indexes[3], patch);
    const f = fieldFixture(() => reply({ fields: [field] }));
    await assert.rejects(waitForIndexes(f.options), /timed out.*MISSING/);
  }
});

test('inherited fields omitted by listing resolve their ancestor configuration through authenticated GETs', async () => {
  const ancestor = `${fieldParent}__default__/fields/*`;
  const f = fieldFixture((request) => {
    if (request.url.pathname.endsWith('/-/fields')) return reply({});
    if (request.url.pathname.endsWith('/registrations/fields/userId'))
      return reply(
        remoteField('READY', { indexes: [], usesAncestorConfig: true, ancestorField: ancestor }),
      );
    assert.equal(request.url.pathname, `/v1/${ancestor}`);
    const field = remoteField('READY', {}, ancestor);
    field.indexConfig.indexes.forEach((index) => {
      index.fields[0].fieldPath = '*';
    });
    return reply(field);
  });
  await waitForIndexes(f.options);
  assert.equal(f.fieldRequests.length, 3);
});

test('a field own CREATING or reverting state cannot be hidden by READY inherited defaults', async () => {
  for (const config of [
    { usesAncestorConfig: true, ancestorField: `${fieldParent}__default__/fields/*` },
    { reverting: true },
  ]) {
    const f = fieldFixture(() => reply({ fields: [remoteField('CREATING', config)] }));
    await assert.rejects(waitForIndexes(f.options), /timed out.*(CREATING|REVERTING)/);
    assert.ok(f.fieldRequests.every((request) => request.url.pathname.endsWith('/-/fields')));
  }
});

test('explicit empty indexes are verified as disabled, never silently skipped', async () => {
  const f = fieldFixture(() => reply({ fields: [remoteField('READY', { indexes: [] })] }));
  f.options.fieldOverrides = [{ ...override, indexes: [] }];
  await waitForIndexes(f.options);
  for (const config of [
    undefined,
    { indexes: [], usesAncestorConfig: true, ancestorField: `${fieldParent}__default__/fields/*` },
  ]) {
    const invalid = fieldFixture(() => reply({ fields: [remoteField('READY', config)] }));
    invalid.options.fieldOverrides = [{ ...override, indexes: [] }];
    await assert.rejects(waitForIndexes(invalid.options), /timed out.*MISSING.*disabled override/);
  }
});

test('no indexes on a required field cannot pass its nonempty declaration', async () => {
  for (const config of [{ indexes: [] }, {}]) {
    const f = fieldFixture(() => reply({ fields: [{ name: fieldName, indexConfig: config }] }));
    await assert.rejects(waitForIndexes(f.options), /timed out.*MISSING/);
  }
});

test('field inheritance cannot cross database boundaries or contain cycles', async () => {
  for (const ancestorField of [
    fieldName,
    'projects/other-project/databases/(default)/collectionGroups/registrations/fields/userId',
  ]) {
    const f = fieldFixture(() =>
      reply({
        fields: [remoteField('READY', { indexes: [], usesAncestorConfig: true, ancestorField })],
      }),
    );
    await assert.rejects(
      waitForIndexes(f.options),
      /inheritance chain|outside the requested project/,
    );
    assert.equal(f.fieldRequests.length, 1);
  }
});

test('malformed field metadata and pagination fail closed', async () => {
  for (const body of [
    { fields: {} },
    { fields: [null] },
    { fields: [{ name: fieldName }] },
    { fields: [remoteField(), remoteField()] },
    { fields: [remoteField('READY', { indexes: {} })] },
    { fields: [remoteField('READY', { usesAncestorConfig: 'false' })] },
    { fields: [remoteField('READY', { indexes: [], usesAncestorConfig: true })] },
    {
      fields: [
        remoteField('READY', {
          indexes: [
            {
              queryScope: 'COLLECTION',
              fields: [{ fieldPath: 'other', order: 'ASCENDING' }],
              state: 'READY',
            },
          ],
        }),
      ],
    },
    { fields: [], nextPageToken: 'repeated' },
    { fields: [], nextPageToken: 7 },
  ]) {
    const f = fieldFixture(() => reply(body));
    await assert.rejects(
      waitForIndexes(f.options),
      /invalid|Invalid|duplicate|inheritance|pagination|outside/,
    );
  }
});

for (const status of [401, 403, 404, 429, 500, 503]) {
  test(`field listing and inherited lookup HTTP ${status} block release without exposing response bodies`, async () => {
    for (const lookup of [false, true]) {
      const f = fieldFixture((request) =>
        lookup && request.url.pathname.endsWith('/-/fields')
          ? reply({})
          : reply({ error: 'private-response' }, status),
      );
      await assert.rejects(waitForIndexes(f.options), (error) => {
        assert.match(
          error.message,
          new RegExp(`Firestore field ${lookup ? 'lookup' : 'listing'} returned HTTP ${status}`),
        );
        assert.doesNotMatch(error.message, /private-/);
        return true;
      });
    }
  });
}

test('invalid checked-in overrides fail before network access', async () => {
  for (const fieldOverrides of [
    {},
    [{}],
    [{ ...override, indexes: undefined }],
    [{ ...override, ttl: true }],
    [
      {
        ...override,
        indexes: [{ order: 'ASCENDING', arrayConfig: 'CONTAINS', queryScope: 'COLLECTION' }],
      },
    ],
    [override, override],
  ]) {
    const f = fieldFixture(() => {
      throw new Error('must not request');
    });
    await assert.rejects(waitForIndexes({ ...f.options, fieldOverrides }));
    assert.equal(f.requests.length, 0);
    assert.equal(f.fieldRequests.length, 0);
  }
});

test('the deployed activity deletion override is loaded and validated rather than documentary only', () => {
  const actual = loadDeployment(path.resolve(__dirname, '../firebase.json'));
  assert.deepEqual(
    actual.fieldOverrides.find(
      (field) => field.collectionGroup === 'registrations' && field.fieldPath === 'userId',
    ),
    override,
  );
  assert.equal(fieldRequirements(actual.fieldOverrides)[0].keys.length, 4);
});
