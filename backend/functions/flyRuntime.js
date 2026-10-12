'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { createRequestListener } = require('./httpAdapter');
const { classifyFunctions } = require('./functionRegistry');
const { startScheduleRunner } = require('./scheduleRunner');
const { startFirestoreTriggerRunner } = require('./firestoreTriggerRunner');

const OPTIONAL_SECRET_NAMES = [
  'TDX_CLIENT_ID',
  'TDX_CLIENT_SECRET',
  'SSO_CONFIG_ENCRYPTION_KEY',
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  'EXPO_ACCESS_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
];

function applyFirebaseServiceAccount(env = process.env) {
  const raw = String(env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is required');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must be valid JSON');
  }
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing project_id, client_email, or private_key');
  }
  const credPath =
    env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(os.tmpdir(), 'firebase-service-account.json');
  fs.writeFileSync(credPath, `${JSON.stringify(parsed)}\n`, { mode: 0o600 });
  env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
  env.GCLOUD_PROJECT = env.GCLOUD_PROJECT || parsed.project_id;
  env.GOOGLE_CLOUD_PROJECT = env.GOOGLE_CLOUD_PROJECT || parsed.project_id;
  if (!env.FIREBASE_CONFIG) {
    env.FIREBASE_CONFIG = JSON.stringify({
      projectId: parsed.project_id,
      storageBucket: `${parsed.project_id}.appspot.com`,
    });
  }
  return parsed;
}

function loadFunctionExports() {
  return require('./index.js');
}

function buildListener(exportsMap, options = {}) {
  const classified = classifyFunctions(exportsMap);
  const enforceAppCheck =
    String(options.enforceAppCheck ?? process.env.ENFORCE_APP_CHECK ?? '')
      .trim()
      .toLowerCase() === 'true';
  const verifyIdToken =
    options.verifyIdToken ||
    ((token) => getAuth().verifyIdToken(token));

  const listener = createRequestListener({
    callables: classified.callables,
    httpFunctions: classified.httpFunctions,
    schedules: classified.schedules,
    verifyIdToken,
    cronSecret: options.cronSecret,
    enforceAppCheck,
  });

  return { listener, classified };
}

function start(options = {}) {
  applyFirebaseServiceAccount(process.env);
  const exported = options.exports || loadFunctionExports();
  const { listener, classified } = buildListener(exported, options);
  const missingOptional = OPTIONAL_SECRET_NAMES.filter(
    (name) => !String(process.env[name] || '').trim(),
  );
  if (missingOptional.length) {
    console.warn(`[functions-server] optional secrets unset: ${missingOptional.join(', ')}`);
  }

  const enableSchedules =
    options.enableSchedules ??
    String(process.env.ENABLE_IN_PROCESS_SCHEDULES || 'true').toLowerCase() !== 'false';
  const runner = startScheduleRunner(classified.schedules, {
    enabled: enableSchedules && !process.env.JEST_WORKER_ID,
  });

  const enableFirestoreTriggers =
    options.enableFirestoreTriggers ??
    String(process.env.ENABLE_FIRESTORE_TRIGGERS || 'true').toLowerCase() !== 'false';

  const port = Number(options.port || process.env.PORT || 8080);
  const host = options.host || process.env.HOSTNAME || '0.0.0.0';
  const server = http.createServer(listener);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, async () => {
      const names = Object.keys(classified.callables);
      let triggerRunner = { stop() {} };
      try {
        triggerRunner = await startFirestoreTriggerRunner({
          db: options.db || getFirestore(),
          triggers: classified.firestoreTriggers,
          enabled: enableFirestoreTriggers && !process.env.JEST_WORKER_ID,
        });
      } catch (error) {
        console.error('[functions-server] firestore triggers failed to start', error);
      }
      console.log(
        `[functions-server] listening on ${host}:${port}; ${names.length} callables, ${
          Object.keys(classified.httpFunctions).length
        } http, ${Object.keys(classified.schedules).length} schedules, ${
          classified.firestoreTriggers.length
        } firestore triggers: ${
          classified.firestoreTriggers.map((item) => item.name).join(', ') || '(none)'
        }`,
      );
      resolve({
        server,
        classified,
        stop: () => {
          runner.stop();
          triggerRunner.stop();
        },
      });
    });
  });
}

module.exports = {
  OPTIONAL_SECRET_NAMES,
  applyFirebaseServiceAccount,
  buildListener,
  loadFunctionExports,
  start,
};
