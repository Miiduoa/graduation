const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const firebaseRequire = createRequire(require.resolve('firebase-tools/package.json'));
const workflow = firebaseRequire('yaml').parse(
  fs.readFileSync(path.join(__dirname, '../.github/workflows/ci.yml'), 'utf8'),
);
const job = workflow.jobs['deploy-functions'];
const deploy = job.steps.find((step) => step.id === 'firebase_deploy');
const record = job.steps.find((step) => step.name === 'Record Firebase deployment outcome');
const upload = job.steps.find((step) => step.name === 'Preserve Firebase release evidence');
const sourceCommit = 'a'.repeat(40);
const credential = 'synthetic-credential-must-not-enter-release-evidence';

function expression(value, github) {
  if (typeof value === 'boolean') return value;
  return vm.runInNewContext(value.replace(/^\$\{\{\s*|\s*\}\}$/g, ''), { github });
}

test('a newer main run cannot cancel production; PR/develop validation remains cancellable', () => {
  for (const event_name of ['push', 'workflow_dispatch']) {
    assert.equal(
      expression(workflow.concurrency['cancel-in-progress'], {
        ref: 'refs/heads/main',
        event_name,
      }),
      false,
    );
  }
  for (const ref of ['refs/pull/30/merge', 'refs/heads/develop']) {
    assert.equal(expression(workflow.concurrency['cancel-in-progress'], { ref }), true);
  }
});

test('only a manual run on main can enter the production deployment job', () => {
  for (const [ref, event_name, allowed] of [
    ['refs/heads/main', 'workflow_dispatch', true],
    ['refs/heads/main', 'push', false],
    ['refs/pull/30/merge', 'pull_request', false],
    ['refs/heads/develop', 'push', false],
  ]) {
    assert.equal(expression(job.if, { ref, event_name }), allowed);
  }
});

function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-firebase-ci-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const bin = path.join(cwd, 'bin');
  fs.mkdirSync(bin);
  // Execute the workflow shell itself, replacing only external deployment commands.
  const stub = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const stage = path.basename(process.argv[1]) === 'node'
  ? (args[0].includes('preflight') ? 'preflight' : 'indexes')
  : (args[args.indexOf('--only') + 1] === 'functions' ? 'functions' : 'rules');
fs.appendFileSync('commands.jsonl', JSON.stringify({stage, args}) + '\\n');
if (stage === 'preflight' && process.env.TEST_FAILURE !== 'credential-exchange') {
  fs.writeFileSync('firebase-preflight.json', JSON.stringify({sourceCommit:process.env.GITHUB_SHA,ready:process.env.TEST_FAILURE !== stage,checks:[{id:'billing',status:process.env.TEST_FAILURE === stage ? 'blocked' : 'ready'}]}));
}
process.exit(process.env.TEST_FAILURE === stage || (stage === 'preflight' && process.env.TEST_FAILURE === 'credential-exchange') ? 1 : 0);
`;
  for (const command of ['node', 'pnpm']) {
    fs.writeFileSync(path.join(bin, command), stub, { mode: 0o755 });
  }
  return { cwd, bin };
}

for (const [failure, stages, hasPreflight] of [
  ['missing-token', [], false],
  ['wrong-project', [], false],
  ['credential-exchange', ['preflight'], false],
  ['preflight', ['preflight'], true],
  ['indexes', ['preflight', 'rules', 'indexes'], true],
  ['functions', ['preflight', 'rules', 'indexes', 'functions'], true],
  ['', ['preflight', 'rules', 'indexes', 'functions'], true],
]) {
  test(`deployment evidence survives ${failure || 'success'} without exposing credentials`, (t) => {
    const { cwd, bin } = fixture(t);
    const env = {
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      FIREBASE_PROJECT_ID: failure === 'wrong-project' ? 'campus-demo-3a869' : 'campus-one-tw',
      FIREBASE_TOKEN: failure === 'missing-token' ? '' : credential,
      GITHUB_SHA: sourceCommit,
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'example/campus',
      GITHUB_RUN_ID: '42',
      GITHUB_RUN_ATTEMPT: '2',
      TEST_FAILURE: failure,
    };
    const result = spawnSync(
      'bash',
      ['--noprofile', '--norc', '-eo', 'pipefail', '-c', deploy.run],
      {
        cwd,
        env,
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, failure ? 1 : 0, result.stderr);
    const commands = fs.existsSync(path.join(cwd, 'commands.jsonl'))
      ? fs.readFileSync(path.join(cwd, 'commands.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
      : [];
    assert.deepEqual(
      commands.map((command) => command.stage),
      stages,
    );
    for (const command of commands) {
      assert.equal(command.args[command.args.indexOf('--project') + 1], 'campus-one-tw');
    }
    if (!failure) {
      assert.ok(commands[1].args.includes('firestore:rules,storage,firestore:indexes'));
    }

    // GHA always() executes this step even when deployment/preflight fails.
    const recorded = spawnSync(
      'bash',
      ['--noprofile', '--norc', '-eo', 'pipefail', '-c', record.run],
      {
        cwd,
        env: {
          ...env,
          PATH: process.env.PATH,
          DEPLOYMENT_OUTCOME: result.status === 0 ? 'success' : 'failure',
        },
        encoding: 'utf8',
      },
    );
    assert.equal(recorded.status, 0, recorded.stderr);
    const evidence = fs.readFileSync(path.join(cwd, 'firebase-deployment-outcome.json'), 'utf8');
    const receipt = JSON.parse(evidence);
    assert.equal(receipt.sourceCommit, sourceCommit);
    assert.equal(receipt.runUrl, 'https://github.com/example/campus/actions/runs/42');
    assert.equal(receipt.runAttempt, '2');
    assert.equal(receipt.deploymentStepOutcome, failure ? 'failure' : 'success');
    assert.equal(receipt.preflightReceiptAvailable, hasPreflight);
    assert.equal(`${result.stdout}${result.stderr}${evidence}`.includes(credential), false);
    if (failure === 'preflight') {
      const preflight = JSON.parse(fs.readFileSync(path.join(cwd, 'firebase-preflight.json')));
      assert.equal(preflight.ready, false);
      assert.equal(preflight.checks[0].status, 'blocked');
    }
  });
}

test('both successful and failed attempts retain versioned reports without weakening the gate', () => {
  assert.equal(record.if, 'always()');
  assert.equal(upload.if, 'always()');
  assert.equal(upload.uses, 'actions/upload-artifact@v4');
  assert.ok(upload.with.path.includes('firebase-preflight.json'));
  assert.ok(upload.with.path.includes('firebase-deployment-outcome.json'));
  assert.ok(upload.with.name.includes('github.sha'));
  assert.ok(upload.with.name.includes('github.run_attempt'));
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.notEqual(deploy['continue-on-error'], true);
  const readiness = workflow.jobs['security-gates'].steps.find(
    (step) => step.name === 'Test deployment readiness gates',
  );
  assert.ok(readiness.run.includes('scripts/firebase-ci-workflow.test.cjs'));
});
