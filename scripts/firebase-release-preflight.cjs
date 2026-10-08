const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { parseArgs } = require('node:util');

// Gen 2 HTTPS/Firestore functions and scheduled functions are all used by this repo.
const REQUIRED_APIS = Object.freeze([
  'cloudfunctions.googleapis.com',
  'cloudbuild.googleapis.com',
  'artifactregistry.googleapis.com',
  'run.googleapis.com',
  'eventarc.googleapis.com',
  'cloudscheduler.googleapis.com',
  'pubsub.googleapis.com',
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'firebaserules.googleapis.com',
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
]);

class PreflightError extends Error {}

function validateTarget({ project, database, storageBucket, authDomain, databaseLocation }) {
  if (
    typeof project !== 'string' ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) ||
    project === 'default'
  ) {
    throw new PreflightError('Pass an explicit Firebase project ID with --project.');
  }
  if (!/^(\(default\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$/.test(database)) {
    throw new PreflightError('Pass a valid Firestore database ID.');
  }
  if (
    typeof storageBucket !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(storageBucket) ||
    storageBucket.includes('..')
  ) {
    throw new PreflightError('Pass the actual Firebase Storage bucket with --storage-bucket.');
  }
  if (
    authDomain !== undefined &&
    (typeof authDomain !== 'string' ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(authDomain))
  ) {
    throw new PreflightError('Pass a bare authorized hostname with --auth-domain.');
  }
  if (
    databaseLocation !== undefined &&
    (typeof databaseLocation !== 'string' || !/^[a-z][a-z0-9-]{1,39}$/.test(databaseLocation))
  ) {
    throw new PreflightError('Pass a valid Firestore location with --database-location.');
  }
}

function firebaseOAuthClient() {
  const api = require('firebase-tools/lib/api');
  return { clientId: api.clientId(), clientSecret: api.clientSecret() };
}

function localRefreshToken(projectDir) {
  try {
    return require('firebase-tools/lib/auth').getProjectDefaultAccount(projectDir)?.tokens
      ?.refresh_token;
  } catch {
    throw new PreflightError(
      'Unable to read local Firebase login. Use firebase login or supply FIREBASE_TOKEN.',
    );
  }
}

async function readJson(fetchImpl, url, options) {
  let response;
  try {
    response = await fetchImpl(url, { ...options, redirect: 'error' });
  } catch {
    return { ok: false, failure: 'request failed or timed out' };
  }
  if (!response.ok) {
    const status =
      Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
        ? response.status
        : 'unknown';
    // Neither service error bodies nor raw exceptions enter a receipt or log.
    return { ok: false, failure: `HTTP ${status}` };
  }
  try {
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return { ok: true, data };
  } catch {
    return { ok: false, failure: 'invalid JSON response' };
  }
}

async function accessToken({
  firebaseToken,
  oauthClient,
  fetchImpl,
  signal,
  localCredentials,
  projectDir,
}) {
  let token = firebaseToken;
  // Explicit but empty CI credentials must not silently use a developer's account.
  if (token === undefined) token = localCredentials(projectDir);
  if (typeof token !== 'string' || !token.trim()) {
    throw new PreflightError(
      'Firebase login is missing. Use firebase login or supply a login:ci refresh token in FIREBASE_TOKEN.',
    );
  }
  let client;
  try {
    client = oauthClient();
  } catch {
    throw new PreflightError(
      'Unable to load Firebase CLI OAuth configuration. Install locked dependencies.',
    );
  }
  const result = await readJson(fetchImpl, 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    signal,
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: token,
      grant_type: 'refresh_token',
      scope: 'https://www.googleapis.com/auth/cloud-platform',
    }),
  });
  if (
    !result.ok ||
    typeof result.data.access_token !== 'string' ||
    !result.data.access_token.trim()
  ) {
    throw new PreflightError(
      `Firebase credential exchange failed${result.failure ? ` (${result.failure})` : ''}. Refresh the local login or CI credential.`,
    );
  }
  return result.data.access_token;
}

function check(id, ready, action) {
  return { id, status: ready ? 'ready' : 'blocked', ...(ready ? {} : { action }) };
}

function evaluatePrerequisites(target, observations) {
  const { project, database, storageBucket, authDomain, databaseLocation } = target;
  const { projectNumber, billing, services, auth, firestore, storage } = observations;
  const checks = [];
  const verify = (id, observation, evaluate, action) => {
    if (!observation?.ok) {
      checks.push(
        check(
          id,
          false,
          `${action} Read failed (${observation?.failure || 'not checked'}); verify access and retry.`,
        ),
      );
    } else checks.push(check(id, evaluate(observation.data), action));
  };
  checks.push(
    check(
      'project',
      /^\d+$/.test(projectNumber || ''),
      'Verify access to the selected Google Cloud project.',
    ),
  );
  verify(
    'billing',
    billing,
    (d) => d.projectId === project && d.billingEnabled === true,
    'Link an active billing account and enable Blaze for the selected Firebase project.',
  );
  for (const api of REQUIRED_APIS) {
    verify(
      `api:${api}`,
      services,
      (d) => d.enabled.includes(api),
      `Enable ${api} in the selected project after billing is ready.`,
    );
  }
  verify(
    'auth',
    auth,
    (d) => [project, projectNumber].some((id) => id && d.name === `projects/${id}/config`),
    'Initialize Firebase Authentication in the selected project.',
  );
  if (authDomain) {
    verify(
      'auth-domain',
      auth,
      (d) => Array.isArray(d.authorizedDomains) && d.authorizedDomains.includes(authDomain),
      `Add ${authDomain} to Firebase Authentication authorized domains.`,
    );
  }
  verify(
    'firestore',
    firestore,
    (d) =>
      d.name === `projects/${project}/databases/${database}` &&
      d.type === 'FIRESTORE_NATIVE' &&
      typeof d.locationId === 'string' &&
      /^[a-z][a-z0-9-]{1,39}$/.test(d.locationId) &&
      (!databaseLocation || d.locationId === databaseLocation),
    `Verify the selected Firestore database exists in native mode${databaseLocation ? ` in ${databaseLocation}` : ''}. Do not replace an existing database to change its location.`,
  );
  verify(
    'storage',
    storage,
    (d) =>
      d.name === storageBucket &&
      /^\d+$/.test(projectNumber || '') &&
      String(d.projectNumber) === projectNumber,
    'Initialize the configured Firebase Storage bucket and verify it belongs to the selected project.',
  );
  return checks;
}

async function preflight({
  project,
  database = '(default)',
  storageBucket,
  authDomain,
  databaseLocation,
  firebaseToken,
  projectDir = process.cwd(),
  fetchImpl = fetch,
  oauthClient = firebaseOAuthClient,
  localCredentials = localRefreshToken,
  sourceCommit = null,
  workingTreeDirty = null,
  timeoutMs = 60_000,
}) {
  const target = { project, database, storageBucket, authDomain, databaseLocation };
  validateTarget(target);
  if (
    sourceCommit !== null &&
    (typeof sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(sourceCommit))
  ) {
    throw new PreflightError('Source commit must be a full Git SHA.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new PreflightError('Preflight timeout must be between 1 and 120000 milliseconds.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const token = await accessToken({
      firebaseToken,
      oauthClient,
      fetchImpl,
      signal: controller.signal,
      localCredentials,
      projectDir,
    });
    const get = (url) =>
      readJson(fetchImpl, url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    const projectResult = await get(
      `https://cloudresourcemanager.googleapis.com/v1/projects/${project}`,
    );
    const projectData = projectResult.data;
    const projectNumber =
      projectResult.ok &&
      projectData.projectId === project &&
      projectData.lifecycleState === 'ACTIVE' &&
      /^\d+$/.test(String(projectData.projectNumber))
        ? String(projectData.projectNumber)
        : null;
    const listServices = async () => {
      if (!projectNumber) return { ok: false, failure: 'project identity not verified' };
      const url = new URL(
        `https://serviceusage.googleapis.com/v1/projects/${projectNumber}/services`,
      );
      url.searchParams.set('filter', 'state:ENABLED');
      url.searchParams.set('pageSize', '200');
      const seen = new Set();
      const enabled = new Set();
      for (let pageCount = 0; pageCount < 100; pageCount += 1) {
        const result = await get(url);
        if (!result.ok) return result;
        const page = result.data;
        if (page.services !== undefined && !Array.isArray(page.services))
          return { ok: false, failure: 'invalid service list' };
        for (const service of page.services || []) {
          if (
            !service?.config?.name ||
            service.name !== `projects/${projectNumber}/services/${service.config.name}` ||
            service.state !== 'ENABLED'
          )
            return { ok: false, failure: 'invalid service identity or state' };
          enabled.add(service.config.name);
        }
        if (page.nextPageToken === undefined || page.nextPageToken === '')
          return { ok: true, data: { enabled: [...enabled] } };
        if (typeof page.nextPageToken !== 'string' || seen.has(page.nextPageToken))
          return { ok: false, failure: 'invalid or repeated service page token' };
        seen.add(page.nextPageToken);
        url.searchParams.set('pageToken', page.nextPageToken);
      }
      return { ok: false, failure: 'service page limit exceeded' };
    };
    const [billing, services, auth, firestore, storage] = await Promise.all([
      get(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`),
      listServices(),
      get(`https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`),
      get(`https://firestore.googleapis.com/v1/projects/${project}/databases/${database}`),
      get(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(storageBucket)}`),
    ]);
    const checks = evaluatePrerequisites(target, {
      projectNumber,
      billing,
      services,
      auth,
      firestore,
      storage,
    });
    if (controller.signal.aborted)
      checks.push(
        check('deadline', false, 'The preflight deadline elapsed. Verify connectivity and retry.'),
      );
    const firestoreReady = checks.find((entry) => entry.id === 'firestore').status === 'ready';
    return {
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      sourceCommit,
      workingTreeDirty: typeof workingTreeDirty === 'boolean' ? workingTreeDirty : null,
      target: {
        ...target,
        projectNumber,
        databaseLocation: firestoreReady ? firestore.data.locationId : databaseLocation || null,
      },
      ready: checks.every((entry) => entry.status === 'ready'),
      scope:
        'Infrastructure prerequisites only. Index readiness, rules, deployment, sign-in providers and application flows require separate verification.',
      checks,
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      database: { type: 'string', default: '(default)' },
      'storage-bucket': { type: 'string' },
      'auth-domain': { type: 'string' },
      'database-location': { type: 'string' },
      output: { type: 'string' },
    },
  });
  let sourceCommit = null;
  let workingTreeDirty = null;
  try {
    sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    workingTreeDirty = Boolean(
      execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
  } catch {
    /* A receipt outside a checkout explicitly has no source version. */
  }
  const receipt = await preflight({
    project: values.project,
    database: values.database,
    storageBucket: values['storage-bucket'],
    authDomain: values['auth-domain'],
    databaseLocation: values['database-location'],
    firebaseToken: process.env.FIREBASE_TOKEN,
    sourceCommit,
    workingTreeDirty,
  });
  const json = `${JSON.stringify(receipt, null, 2)}\n`;
  if (values.output) fs.writeFileSync(values.output, json, { mode: 0o600 });
  process.stdout.write(json);
  if (!receipt.ready) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      error instanceof PreflightError
        ? error.message
        : 'Firebase preflight failed. Verify arguments, dependencies, local access and the output path; no service response was logged.',
    );
    process.exitCode = 1;
  });
}

module.exports = { REQUIRED_APIS, validateTarget, evaluatePrerequisites, preflight };
