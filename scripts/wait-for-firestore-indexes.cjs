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
  if (!Array.isArray(spec.indexes) || (spec.fieldOverrides || []).length) {
    throw new Error(
      'Expected composite indexes without field overrides; extend the gate before adding overrides.',
    );
  }
  return { database, indexes: spec.indexes };
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
  if (!required.length) throw new Error('No required Firestore indexes found.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = controller.signal;
  let pending = [];
  let lastStatus = '';
  try {
    const accessToken = await getAccessToken({ firebaseToken, oauthClient, fetchImpl, signal });
    while (true) {
      const remote = await listIndexes({ project, database, accessToken, fetchImpl, signal });
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
      if (signal.aborted) throw new Error('Index readiness deadline exceeded.');
      if (!pending.length) {
        log(
          `Firestore indexes READY: ${required.length} required indexes in ${project}/${database}.`,
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

module.exports = { indexKey, loadDeployment, waitForIndexes };
