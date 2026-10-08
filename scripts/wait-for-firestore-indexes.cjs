const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');

const CLOUD_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function loadDeployment(configPath) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!config.firestore || Array.isArray(config.firestore) || !config.firestore.indexes) {
    throw new Error('Expected one Firestore database with an indexes file in Firebase config.');
  }
  const database = config.firestore.database || '(default)';
  if (!/^(\(default\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$/.test(database)) {
    throw new Error('Invalid Firestore database ID.');
  }
  const spec = JSON.parse(
    fs.readFileSync(path.resolve(path.dirname(configPath), config.firestore.indexes), 'utf8'),
  );
  if (!Array.isArray(spec.indexes)) throw new Error('Expected a Firestore indexes array.');
  const fieldOverrides = spec.fieldOverrides ?? [];
  fieldRequirements(fieldOverrides);
  return { database, indexes: spec.indexes, fieldOverrides };
}

function indexKey(index, collectionGroup = index.collectionGroup, appendName = false) {
  if (!collectionGroup || !['COLLECTION', 'COLLECTION_GROUP'].includes(index.queryScope)) {
    throw new Error('Invalid Firestore index collection or query scope.');
  }
  if (!Array.isArray(index.fields) || !index.fields.length) {
    throw new Error('Invalid Firestore index fields.');
  }
  const fields = index.fields.map((field) => {
    const ordered = ['ASCENDING', 'DESCENDING'].includes(field.order);
    const array = field.arrayConfig === 'CONTAINS';
    if (!field.fieldPath || ordered === array || field.vectorConfig) {
      throw new Error('Unsupported Firestore index field configuration.');
    }
    return ordered
      ? { fieldPath: field.fieldPath, order: field.order }
      : { fieldPath: field.fieldPath, arrayConfig: field.arrayConfig };
  });
  // Standard-edition Firestore appends __name__ in the last ordered field's direction.
  if (appendName && fields.at(-1).fieldPath !== '__name__') {
    const lastOrdered = fields.findLast((field) => field.order);
    fields.push({ fieldPath: '__name__', order: lastOrdered?.order || 'ASCENDING' });
  }
  return JSON.stringify({
    collectionGroup,
    queryScope: index.queryScope,
    apiScope: index.apiScope || 'ANY_API',
    density: index.density || 'SPARSE_ALL',
    multikey: index.multikey ?? false,
    unique: index.unique ?? false,
    fields,
  });
}

function validPathPart(value) {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length > 0 &&
    !['.', '..'].includes(value) &&
    ![...value].some((character) => character.charCodeAt(0) < 32)
  );
}

function fieldRequirements(overrides) {
  if (!Array.isArray(overrides)) throw new Error('Expected a Firestore fieldOverrides array.');
  const seen = new Set();
  return overrides.map((field) => {
    if (
      !field ||
      !validPathPart(field.collectionGroup) ||
      field.collectionGroup.includes('/') ||
      field.collectionGroup === '-' ||
      !validPathPart(field.fieldPath) ||
      !Array.isArray(field.indexes) ||
      Object.keys(field).some((key) => !['collectionGroup', 'fieldPath', 'indexes'].includes(key))
    ) {
      throw new Error('Invalid or unsupported Firestore field override.');
    }
    const key = JSON.stringify([field.collectionGroup, field.fieldPath]);
    if (seen.has(key)) throw new Error('Duplicate Firestore field override.');
    seen.add(key);
    const keys = field.indexes.map((index) => {
      if (
        !index ||
        Object.keys(index).some(
          (key) =>
            ![
              'order',
              'arrayConfig',
              'queryScope',
              'apiScope',
              'density',
              'multikey',
              'unique',
            ].includes(key),
        )
      ) {
        throw new Error('Invalid or unsupported Firestore field index.');
      }
      return indexKey(
        {
          ...index,
          fields: [
            { fieldPath: field.fieldPath, order: index.order, arrayConfig: index.arrayConfig },
          ],
        },
        field.collectionGroup,
      );
    });
    if (new Set(keys).size !== keys.length) throw new Error('Duplicate Firestore field index.');
    return { ...field, keys, label: `${field.collectionGroup}.${field.fieldPath}` };
  });
}

function parseFieldName(name, parent) {
  if (typeof name !== 'string' || !name.startsWith(parent))
    throw new Error('Firestore returned a field outside the requested project/database.');
  const match = /^([^/]+)\/fields\/(.+)$/.exec(name.slice(parent.length));
  if (!match || !validPathPart(match[1]) || match[1] === '-' || !validPathPart(match[2]))
    throw new Error('Firestore returned an invalid field resource name.');
  return { collectionGroup: match[1], fieldPath: match[2] };
}

async function listFields({ project, database, accessToken, fetchImpl, signal }) {
  const parent = `projects/${project}/databases/${database}/collectionGroups/`;
  const url = new URL(`https://firestore.googleapis.com/v1/${parent}-/fields`);
  // ListFields only supports explicit index overrides or TTL configurations.
  url.searchParams.set('filter', 'indexConfig.usesAncestorConfig=false OR ttlConfig:*');
  url.searchParams.set('pageSize', '1000');
  const fields = new Map();
  const seenPages = new Set();
  while (true) {
    const page = await requestJson(
      fetchImpl,
      url,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal },
      'Firestore field listing',
    );
    if (
      !page ||
      typeof page !== 'object' ||
      Array.isArray(page) ||
      (page.fields !== undefined && !Array.isArray(page.fields))
    )
      throw new Error('Firestore field listing returned an invalid field list.');
    for (const field of page.fields || []) {
      parseFieldName(field?.name, parent);
      if (fields.has(field.name)) throw new Error('Firestore returned a duplicate field resource.');
      fields.set(field.name, field);
    }
    if (!page.nextPageToken) return fields;
    if (typeof page.nextPageToken !== 'string' || seenPages.has(page.nextPageToken))
      throw new Error('Firestore returned an invalid or repeated field pagination token.');
    seenPages.add(page.nextPageToken);
    url.searchParams.set('pageToken', page.nextPageToken);
  }
}

async function fieldIndexStates({
  expected,
  fields,
  project,
  database,
  accessToken,
  fetchImpl,
  signal,
}) {
  const parent = `projects/${project}/databases/${database}/collectionGroups/`;
  const originalName = `${parent}${expected.collectionGroup}/fields/${expected.fieldPath}`;
  const visited = new Set();
  let name = originalName;
  while (true) {
    if (visited.has(name) || visited.size >= 16)
      throw new Error('Invalid Firestore field index inheritance chain.');
    visited.add(name);
    const identity = parseFieldName(name, parent);
    let field = fields.get(name);
    if (!field) {
      // Inherited fields are absent from ListFields and must be resolved explicitly.
      const url = `https://firestore.googleapis.com/v1/${parent}${encodeURIComponent(identity.collectionGroup)}/fields/${encodeURIComponent(identity.fieldPath)}`;
      field = await requestJson(
        fetchImpl,
        url,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal },
        'Firestore field lookup',
      );
      if (field?.name !== name)
        throw new Error('Firestore field lookup returned a different resource.');
      fields.set(name, field);
    }
    const config = field.indexConfig;
    if (
      !config ||
      typeof config !== 'object' ||
      Array.isArray(config) ||
      (config.indexes !== undefined && !Array.isArray(config.indexes)) ||
      ['usesAncestorConfig', 'reverting'].some(
        (key) => config[key] !== undefined && typeof config[key] !== 'boolean',
      )
    )
      throw new Error('Firestore returned an invalid field index configuration.');
    if (config.reverting) return [`REVERTING: ${expected.label}`];
    if (config.usesAncestorConfig) {
      if (!config.ancestorField)
        throw new Error('Firestore field index inheritance is missing its ancestor.');
      parseFieldName(config.ancestorField, parent);
      // A declared empty override must be explicitly disabled, not merely inherit today's defaults.
      if (!expected.keys.length) return [`MISSING explicit disabled override: ${expected.label}`];
      // Prefer states returned for this field; an ancestor's READY must never hide its CREATING.
      if (!config.indexes?.length) {
        name = config.ancestorField;
        continue;
      }
    }
    const actual = new Map();
    for (const index of config.indexes || []) {
      if (
        !index ||
        !Array.isArray(index.fields) ||
        index.fields.length !== 1 ||
        !index.fields[0] ||
        (index.fields[0].fieldPath !== undefined &&
          index.fields[0].fieldPath !== '' &&
          index.fields[0].fieldPath !== identity.fieldPath)
      )
        throw new Error('Firestore returned an invalid single-field index.');
      // Single-field indexes have one field (possibly omitted in REST); no implicit __name__.
      const key = indexKey(
        { ...index, fields: [{ ...index.fields[0], fieldPath: expected.fieldPath }] },
        expected.collectionGroup,
      );
      if (actual.has(key)) throw new Error('Firestore returned a duplicate single-field index.');
      actual.set(key, index.state || 'STATE_UNSPECIFIED');
    }
    if (!expected.keys.length)
      return actual.size ? [`MISSING disabled override: ${expected.label}`] : [];
    return expected.keys.flatMap((key) => {
      const state = actual.get(key) || 'MISSING';
      if (state === 'READY') return [];
      if (!['CREATING', 'MISSING'].includes(state))
        throw new Error(`Required Firestore field index is ${state}: ${expected.label}.`);
      const shape = JSON.parse(key);
      return [
        `${state}: ${expected.label} (${shape.queryScope}, ${shape.fields[0].order || shape.fields[0].arrayConfig})`,
      ];
    });
  }
}

async function requestJson(fetchImpl, url, options, label) {
  let response;
  try {
    response = await fetchImpl(url, { ...options, redirect: 'error' });
  } catch {
    throw new Error(`${label} request failed or timed out.`);
  }
  // Response bodies and request errors may contain credentials; never include them in logs.
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

function firebaseOAuthClient() {
  const { clientId, clientSecret } = require('firebase-tools/lib/api');
  return { clientId: clientId(), clientSecret: clientSecret() };
}

async function getAccessToken({ firebaseToken, oauthClient, fetchImpl, signal }) {
  const client = oauthClient();
  const body = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: firebaseToken,
    grant_type: 'refresh_token',
    scope: CLOUD_SCOPE,
  });
  const token = await requestJson(
    fetchImpl,
    TOKEN_URL,
    { method: 'POST', body, signal },
    'Firebase credential exchange',
  );
  if (typeof token.access_token !== 'string' || !token.access_token.trim()) {
    throw new Error('Firebase credential exchange did not return an access token.');
  }
  return token.access_token;
}

async function listIndexes({ project, database, accessToken, fetchImpl, signal }) {
  const parent = `projects/${project}/databases/${database}/collectionGroups/`;
  const url = new URL(`https://firestore.googleapis.com/v1/${parent}-/indexes`);
  url.searchParams.set('pageSize', '1000');
  const indexes = [];
  const seenPages = new Set();
  while (true) {
    const page = await requestJson(
      fetchImpl,
      url,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal },
      'Firestore index listing',
    );
    if (
      !page ||
      typeof page !== 'object' ||
      Array.isArray(page) ||
      (page.indexes !== undefined && !Array.isArray(page.indexes))
    ) {
      throw new Error('Firestore index listing returned an invalid index list.');
    }
    for (const index of page.indexes || []) {
      if (typeof index.name !== 'string' || !index.name.startsWith(parent)) {
        throw new Error('Firestore returned an index outside the requested project/database.');
      }
      const suffix = index.name.slice(parent.length).split('/');
      if (suffix.length !== 3 || suffix[1] !== 'indexes' || !suffix[0] || !suffix[2]) {
        throw new Error('Firestore returned an invalid index resource name.');
      }
      indexes.push({ ...index, collectionGroup: suffix[0] });
    }
    if (!page.nextPageToken) return indexes;
    if (typeof page.nextPageToken !== 'string' || seenPages.has(page.nextPageToken)) {
      throw new Error('Firestore returned an invalid or repeated pagination token.');
    }
    seenPages.add(page.nextPageToken);
    url.searchParams.set('pageToken', page.nextPageToken);
  }
}

async function waitForIndexes({
  project,
  database = '(default)',
  indexes,
  fieldOverrides = [],
  firebaseToken,
  timeoutMs = 1_200_000,
  pollMs = 10_000,
  fetchImpl = fetch,
  oauthClient = firebaseOAuthClient,
  log = console.log,
}) {
  if (
    typeof project !== 'string' ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) ||
    project === 'default'
  ) {
    throw new Error('An explicit Firebase project ID is required.');
  }
  if (typeof firebaseToken !== 'string' || !firebaseToken.trim()) {
    throw new Error('FIREBASE_TOKEN from firebase login:ci is required.');
  }
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 3_600_000 ||
    !Number.isSafeInteger(pollMs) ||
    pollMs < 1
  ) {
    throw new Error('Invalid index readiness timeout or polling interval.');
  }
  const required = indexes.map((index) => ({
    key: indexKey(index, index.collectionGroup, true),
    label: `${index.collectionGroup} (${index.fields.map((field) => field.fieldPath).join(', ')})`,
  }));
  const requiredFields = fieldRequirements(fieldOverrides);
  if (!required.length && !requiredFields.length)
    throw new Error('No required Firestore indexes found.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = controller.signal;
  let pending = [];
  let lastStatus = '';
  try {
    const accessToken = await getAccessToken({ firebaseToken, oauthClient, fetchImpl, signal });
    while (true) {
      const request = { project, database, accessToken, fetchImpl, signal };
      const [remote, fields] = await Promise.all([
        required.length ? listIndexes(request) : [],
        requiredFields.length ? listFields(request) : new Map(),
      ]);
      const byKey = new Map();
      for (const index of remote) {
        try {
          byKey.set(indexKey(index), index);
        } catch {
          // Vector and other unrelated index shapes cannot satisfy the checked-in specifications.
          // Their readiness must not block deployment of the required composite indexes.
        }
      }
      pending = [];
      for (const expected of required) {
        const actual = byKey.get(expected.key);
        const state = actual?.state || (actual ? 'STATE_UNSPECIFIED' : 'MISSING');
        if (state === 'READY') continue;
        if (state !== 'CREATING' && state !== 'MISSING') {
          throw new Error(`Required Firestore index is ${state}: ${expected.label}.`);
        }
        pending.push(`${state}: ${expected.label}`);
      }
      for (const expected of requiredFields)
        pending.push(...(await fieldIndexStates({ ...request, expected, fields })));
      if (signal.aborted) throw new Error('Index readiness deadline exceeded.');
      if (!pending.length) {
        log(
          `Firestore indexes READY: ${required.length} required indexes and ${requiredFields.length} field configurations in ${project}/${database}.`,
        );
        return;
      }
      const status = pending.join('; ');
      if (status !== lastStatus) log(`Waiting for Firestore indexes: ${status}.`);
      lastStatus = status;
      await delay(pollMs, undefined, { signal });
    }
  } catch (error) {
    if (signal.aborted) {
      throw new Error(
        `Firestore index readiness timed out after ${timeoutMs / 1000}s${pending.length ? `; ${pending.join('; ')}` : ''}.`,
      );
    }
    throw error;
  } finally {
    controller.abort();
    clearTimeout(timeout);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      config: { type: 'string', default: 'firebase.json' },
      'timeout-seconds': { type: 'string', default: '1200' },
    },
  });
  await waitForIndexes({
    project: values.project,
    ...loadDeployment(path.resolve(values.config)),
    firebaseToken: process.env.FIREBASE_TOKEN,
    timeoutMs: Number(values['timeout-seconds']) * 1000,
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Firestore readiness gate failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { indexKey, fieldRequirements, loadDeployment, waitForIndexes };
