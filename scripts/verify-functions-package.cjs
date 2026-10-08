const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  prepareFunctionsUpload,
} = require('firebase-tools/lib/deploy/functions/prepareFunctionsUpload');

const root = path.resolve(__dirname, '..');

async function main() {
  execFileSync(process.execPath, [path.join(__dirname, 'build-functions-shared.cjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  const config = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
  const functionsConfig = config.functions.find((entry) => entry.source === 'backend/functions');
  assert(functionsConfig, 'Missing backend/functions deployment source.');

  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-functions-package-'));
  let archivePath;
  try {
    // Use the Firebase CLI packer so this also checks the actual deployment ignore rules.
    const archive = await prepareFunctionsUpload(
      root,
      path.join(root, functionsConfig.source),
      structuredClone(functionsConfig),
      [],
    );
    archivePath = archive.pathToSource;
    execFileSync('unzip', ['-q', archivePath, '-d', isolated]);
    assert(fs.existsSync(path.join(isolated, 'generated/shared/postLoginRoles.js')));
    assert(!fs.existsSync(path.join(isolated, 'node_modules')));

    const env = { ...process.env, NODE_PATH: '', NODE_ENV: 'production' };
    delete env.NODE_OPTIONS;
    delete env.GOOGLE_APPLICATION_CREDENTIALS;
    execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts'], {
      cwd: isolated,
      env,
      stdio: 'inherit',
      timeout: 300_000,
    });
    execFileSync(
      process.execPath,
      [
        '-e',
        `
          const assert = require('node:assert/strict');
          const path = require('node:path');
          const deployed = require('./index.js');
          for (const name of ['createOrder', 'getMyAcademicRecords', 'executeAgentWrite']) {
            assert.equal(typeof deployed[name], 'function', 'Missing export: ' + name);
          }
          for (const name of [
            'postLogin/finalizePostLogin',
            'companion/aggregateCompanionSignals',
            'agent/tools/computeGradebook',
            'agent/tools/draftQuizFromBank',
            'agent/tools/upsertQuestionBank',
            'agent/tools/computeCompanionState',
            'agent/tools/verifyAttendanceClaim',
            'agent/tools/submitQuizAttempt',
          ]) require('./' + name);
          const boundary = process.cwd() + path.sep;
          for (const file of Object.keys(require.cache)) {
            assert(file.startsWith(boundary), 'Module escaped deployment source: ' + file);
          }
          console.log('Isolated Functions package loaded ' + Object.keys(deployed).length + ' exports.');
          process.exit(0);
        `,
      ],
      {
        cwd: isolated,
        env: {
          ...env,
          GCLOUD_PROJECT: 'demo-campus-package-check',
          GOOGLE_CLOUD_PROJECT: 'demo-campus-package-check',
          FIREBASE_CONFIG: JSON.stringify({
            projectId: 'demo-campus-package-check',
            storageBucket: 'demo-campus-package-check.appspot.com',
            databaseURL: 'http://127.0.0.1:1?ns=demo-campus-package-check',
          }),
          FIRESTORE_EMULATOR_HOST: '127.0.0.1:1',
          FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:1',
          FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:1',
          FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:1',
          STORAGE_EMULATOR_HOST: 'http://127.0.0.1:1',
        },
        stdio: 'inherit',
        timeout: 30_000,
      },
    );
  } finally {
    fs.rmSync(isolated, { recursive: true, force: true });
    if (archivePath) fs.rmSync(archivePath, { force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
