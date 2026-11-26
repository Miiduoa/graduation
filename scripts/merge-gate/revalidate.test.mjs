import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { policy, NATIVE_CHECKS, withAppToken } from './gate.mjs';
import { gateIdentity as gate } from './ruleset-proof.mjs';
import { affectedHeads, checkBinding, invalidPublishedChecks, isPublishedPilotCheck,
  publishedEvidenceIsValid, revokeIfStillInvalid, validateRuntime } from './revalidate.mjs';

const head = 'a'.repeat(40), base = 'b'.repeat(40), number = 42, reviewId = 11, commentId = 12;
const prefix = '/repos/' + gate.repo;
const readToken = 'read-fixture', appToken = 'app-fixture';
const jobsByWorkflow = {
  ci: ['Security Gates', 'Lint & Type Check', 'Web Tests', 'Mobile Tests', 'Functions Tests',
    'Firestore Rules Tests', 'Assistant Integration Tests', 'Build Web', 'Build Mobile', 'CI Summary'],
  codeql: ['Analyze (javascript-typescript)'], 'course-access-review': ['policy-and-postgres'],
  'maestro-e2e': ['Maestro PR result'], 'mobile-agent-regression': ['Mobile agent PR result'],
  'campus-spatial-browser': ['Spatial browser PR result'], 'preview-deploy': ['EAS Update (Preview)'],
};

function fixture(t) {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  // Existing approvals remain valid after an hour if the evidence is unchanged.
  const created = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const completed = new Date(Date.parse(created) + 1000).toISOString();
  const repo = { id: gate.repositoryId }, user = { id: gate.ownerId };
  const pr = { number, state: 'open', draft: false, mergeable: true, changed_files: 1,
    head: { sha: head, repo }, base: { sha: base, repo, ref: 'main' } };
  const comment = { id: commentId, user, author_association: 'OWNER', created_at: created, updated_at: created,
    body: `/nuni-gate approve ${head} ${base} ${reviewId}`, issue_url: 'https://api.github.com' + prefix + '/issues/' + number };
  const review = { id: reviewId, user, author_association: 'OWNER', state: 'COMMENTED', commit_id: head,
    submitted_at: created, body: `nuni-gate-review v1 head=${head} base=${base} outcome=pass\n` +
      'Fixture review of exact code, test evidence and residual limitations. '.repeat(3) };
  const rule = { id: gate.rulesetId, enforcement: 'active', target: 'branch', bypass_actors: [],
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } }, rules: [
      { type: 'pull_request', parameters: { required_review_thread_resolution: true } },
      { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true,
        required_status_checks: structuredClone(NATIVE_CHECKS) } },
    ] };
  const workflowFiles = Object.entries(policy.workflowBlobs).map(([path, sha]) => ({ path, sha }));
  for (const name of ['nuni-merge-gate', 'nuni-merge-gate-tests', 'nuni-merge-gate-revalidate', 'nuni-merge-gate-review-events'])
    workflowFiles.push({ path: '.github/workflows/' + name + '.yml' });
  const success = { head_sha: head, status: 'completed', conclusion: 'success' };
  const check = { ...success, id: 777, name: '審查通過', app: { id: gate.appId }, completed_at: completed,
    external_id: `nuni-gate:v2:${number}:${head}:${base}:${reviewId}:${commentId}`,
    details_url: 'https://github.com/' + gate.repo + '/actions/runs/13' };
  const page = (key, values) => ({ total_count: values.length, [key]: values });
  const runs = [], checks = [{ ...success, name: 'CodeQL', app: { id: 57789 } }], routes = new Map();
  for (const [workflow, names] of Object.entries(jobsByWorkflow)) {
    const id = 100 + runs.length;
    runs.push({ ...success, id, repository: repo, head_repository: repo, event: 'pull_request', run_attempt: 1,
      path: '.github/workflows/' + workflow + '.yml', pull_requests: [pr] });
    const jobs = names.map((name, index) => ({ ...success, name, id: id * 100 + index }));
    checks.push(...jobs.map(job => ({ ...job, app: { id: 15368 } })));
    routes.set(prefix + '/actions/runs/' + id + '/attempts/1/jobs', page('jobs', jobs));
  }
  const state = { pr, comment, review, rule, check, runs, checks,
    threads: { nodes: [{ isResolved: true }], pageInfo: { hasNextPage: false } },
    history: [check], writes: [], unavailable: null };
  const views = {
    ['/pulls/' + number]: pr, '/pulls': [pr], '/branches/main': { commit: { sha: base } },
    ['/issues/comments/' + commentId]: comment, ['/pulls/' + number + '/reviews']: [review],
    ['/pulls/' + number + '/files']: [{ filename: 'apps/web/src/lib/wakeAwareRequest.test.ts', status: 'modified' }],
    ['/rulesets/' + gate.rulesetId]: rule,
    ['/compare/' + base + '...' + head]: { merge_base_commit: { sha: base }, behind_by: 0, ahead_by: 1 },
    '/contents/.github/workflows': workflowFiles,
    '/contents/scripts/merge-gate': Object.entries(policy.evidenceScriptBlobs).map(([path, sha]) => ({ path, sha, type: 'file' })),
  };
  for (const [path, value] of Object.entries(views)) routes.set(prefix + path, value);
  globalThis.fetch = async (url, options) => {
    const { origin, pathname, searchParams } = new URL(url);
    assert.equal(origin, 'https://api.github.com');
    if (options.method === 'PATCH') {
      assert.equal(options.headers.Authorization, 'Bearer ' + appToken);
      assert.equal(pathname, prefix + '/check-runs/' + check.id);
      const body = JSON.parse(options.body);
      assert.equal(body.conclusion, 'failure');
      assert.equal(body.status, 'completed');
      assert.deepEqual(Object.keys(body).sort(), ['conclusion', 'output', 'status']);
      state.writes.push({ pathname, body });
      return Response.json({ ...check, ...body });
    }
    assert.equal(options.headers.Authorization, 'Bearer ' + readToken);
    if (state.unavailable === pathname) return new Response('Unavailable', { status: 503 });
    if (pathname === '/graphql' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      assert.match(body.query, /^query\(/);
      assert.equal(body.variables.n, number);
      return Response.json({ data: { repository: { pullRequest: { reviewThreads: state.threads } } } });
    }
    assert.equal(options.method, 'GET', 'Only the exact failure PATCH may write');
    if (pathname === prefix + '/check-runs/' + check.id) return Response.json(state.check);
    if (pathname === prefix + '/commits/' + head + '/check-runs')
      return Response.json(page('check_runs', searchParams.has('check_name') ? state.history : checks));
    if (pathname === prefix + '/actions/runs') return Response.json(page('workflow_runs', runs));
    assert(routes.has(pathname), 'Unhandled fixture request ' + pathname);
    return Response.json(routes.get(pathname));
  };
  return state;
}

test('unchanged earlier approval remains valid without a new key or check write', async t => {
  const state = fixture(t);
  assert.equal(await publishedEvidenceIsValid(readToken, state.check), true);
  assert.deepEqual(await invalidPublishedChecks(readToken, [head]), []);
  assert.equal(await revokeIfStillInvalid(readToken, appToken, structuredClone(state.check)), false);
  assert.equal(state.writes.length, 0);
});

for (const [reason, invalidate] of [
  ['failed CI rerun', state => state.runs.push({ ...state.runs[0], run_attempt: 2, conclusion: 'failure' })],
  ['running CI rerun', state => state.runs.push({ ...state.runs[0], run_attempt: 2, status: 'in_progress', conclusion: null })],
  ['new unresolved discussion', state => { state.threads.nodes[0].isResolved = false; }],
  ['dismissed review', state => { state.review.state = 'DISMISSED'; }],
  ['edited initiating comment', state => { state.comment.updated_at = new Date().toISOString(); }],
  ['changed base', state => { state.pr.base.sha = 'c'.repeat(40); }],
  ['disabled native conversation protection', state => { state.rule.rules[0].parameters.required_review_thread_resolution = false; }],
  ['unavailable current evidence', state => { state.unavailable = '/graphql'; }],
]) {
  test(reason + ' withdraws the existing same-head App verdict', async t => {
    const state = fixture(t);
    assert.equal(await publishedEvidenceIsValid(readToken, state.check), true);
    invalidate(state);
    const invalid = await invalidPublishedChecks(readToken, [head]);
    assert.deepEqual(invalid.map(check => check.id), [777]);
    assert.equal(await revokeIfStillInvalid(readToken, appToken, invalid[0]), true);
    assert.equal(state.writes.length, 1);
    assert.equal(state.writes[0].pathname, prefix + '/check-runs/777');
    assert.equal(state.writes[0].body.conclusion, 'failure');
  });
}

test('evidence is read again after protected-environment waiting', async t => {
  const state = fixture(t);
  state.threads.nodes[0].isResolved = false;
  const [candidate] = await invalidPublishedChecks(readToken, [head]);
  state.threads.nodes[0].isResolved = true;
  assert.equal(await revokeIfStillInvalid(readToken, appToken, candidate), false);
  assert.equal(state.writes.length, 0);
});

test('changed audit identity cannot be overwritten by an older revocation plan', async t => {
  const state = fixture(t);
  state.threads.nodes[0].isResolved = false;
  const [candidate] = await invalidPublishedChecks(readToken, [head]);
  state.check = { ...state.check, external_id: state.check.external_id.replace(':12', ':14') };
  assert.equal(await revokeIfStillInvalid(readToken, appToken, candidate), false);
  assert.equal(state.writes.length, 0);
});

test('foreign Apps, manual approvals, other heads and already failed checks are untouched', async t => {
  const state = fixture(t);
  state.history = [
    { ...state.check, app: { id: 15368 } }, { ...state.check, external_id: 'operator-issued-check' },
    { ...state.check, head_sha: base }, { ...state.check, conclusion: 'failure' },
  ];
  assert.deepEqual(await invalidPublishedChecks(readToken, [head]), []);
  for (const check of state.history.filter(check => check.head_sha === head)) assert.equal(isPublishedPilotCheck(check), false);
  assert.equal(state.writes.length, 0);
});

test('audit binding rejects another head, unsafe IDs and malformed publication times', async t => {
  const { check } = fixture(t);
  assert.equal(checkBinding(check).head, head);
  for (const override of [{ head_sha: base }, { external_id: check.external_id + ':suffix' },
    { external_id: check.external_id.replace(':42:', ':99999999999999999:') }, { completed_at: 'invalid' }])
    assert.equal(await publishedEvidenceIsValid(readToken, { ...check, ...override }), false);
});

const env = { GITHUB_REF: 'refs/heads/main', GITHUB_SHA: base, GITHUB_REPOSITORY: gate.repo,
  GITHUB_REPOSITORY_ID: String(gate.repositoryId), GITHUB_EVENT_NAME: 'workflow_run' };
const event = { action: 'in_progress', repository: { id: gate.repositoryId }, workflow_run: {
  name: 'CI', repository: { id: gate.repositoryId }, head_repository: { id: gate.repositoryId },
  head_sha: head, pull_requests: [{ head: { sha: head }, base: { ref: 'main' } }],
} };

test('runtime accepts trusted default-branch reruns and rejects fork/PR execution', () => {
  assert.doesNotThrow(() => validateRuntime(env, event));
  for (const override of [{ GITHUB_REF: 'refs/pull/42/merge' }, { GITHUB_REPOSITORY_ID: '1' },
    { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_EVENT_NAME: 'workflow_dispatch' }])
    assert.throws(() => validateRuntime({ ...env, ...override }, event));
  assert.throws(() => validateRuntime(env, { ...event, workflow_run: { ...event.workflow_run, head_repository: { id: 1 } } }));
  assert.throws(() => validateRuntime(env, { ...event, workflow_run: { ...event.workflow_run, name: 'unknown' } }));
});

test('trusted events limit revalidation to actual heads; schedule scans current open PRs', async t => {
  fixture(t);
  assert.deepEqual(await affectedHeads(readToken, env, event), [head]);
  assert.deepEqual(await affectedHeads(readToken, { ...env, GITHUB_EVENT_NAME: 'schedule' },
    { repository: event.repository, schedule: '7,22,37,52 * * * *' }), [head]);
});

test('the review relay has no source or credentials and withdrawal retains the protected publisher lock', () => {
  const relay = readFileSync(new URL('../../.github/workflows/nuni-merge-gate-review-events.yml', import.meta.url), 'utf8');
  assert.match(relay, /permissions: \{\}/);
  assert.doesNotMatch(relay, /uses:|secrets\.|github\.token|checkout --|git fetch/);
  const withdrawal = readFileSync(new URL('../../.github/workflows/nuni-merge-gate-revalidate.yml', import.meta.url), 'utf8');
  assert.match(withdrawal, /types: \[requested, in_progress, completed\]/);
  assert.match(withdrawal, /environment: nuni-merge-gate/);
  assert.match(withdrawal, /group: nuni-merge-gate-publisher/);
  assert.doesNotMatch(withdrawal, /github\.event\.workflow_run\.head_sha/);
  assert.equal(policy.publicationEnabled, false);
});

for (const rejectOperation of [false, true]) {
  test('withdrawal token is repository-scoped and revoked after ' + (rejectOperation ? 'failure' : 'success'), async t => {
    const originalFetch = globalThis.fetch, originalKey = process.env.NUNI_GATE_PRIVATE_KEY;
    t.after(() => {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.NUNI_GATE_PRIVATE_KEY;
      else process.env.NUNI_GATE_PRIVATE_KEY = originalKey;
    });
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.NUNI_GATE_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const operations = [];
    globalThis.fetch = async (url, options) => {
      const { origin, pathname } = new URL(url);
      assert.equal(origin, 'https://api.github.com');
      operations.push(options.method + ' ' + pathname);
      if (pathname === '/app') return Response.json({ id: gate.appId, slug: 'nuni-merge-gate',
        owner: { id: gate.ownerId }, permissions: { checks: 'write' } });
      if (pathname === prefix + '/installation') return Response.json({ id: 25, app_id: gate.appId,
        account: { id: gate.ownerId }, suspended_at: null });
      if (pathname === '/app/installations/25/access_tokens') {
        assert.equal(options.method, 'POST');
        assert.deepEqual(JSON.parse(options.body), { repository_ids: [gate.repositoryId], permissions: { checks: 'write' } });
        return Response.json({ token: appToken, permissions: { checks: 'write', metadata: 'read' },
          repositories: [{ id: gate.repositoryId }] });
      }
      assert.equal(pathname, '/installation/token');
      assert.equal(options.method, 'DELETE');
      assert.equal(options.headers.Authorization, 'Bearer ' + appToken);
      return new Response(null, { status: 204 });
    };
    const operation = withAppToken(async token => {
      assert.equal(token, appToken);
      assert.equal(process.env.NUNI_GATE_PRIVATE_KEY, undefined);
      if (rejectOperation) throw new Error('Synthetic withdrawal failure');
    });
    if (rejectOperation) await assert.rejects(operation, /Synthetic withdrawal failure/);
    else await operation;
    assert.deepEqual(operations, ['GET /app', 'GET ' + prefix + '/installation',
      'POST /app/installations/25/access_tokens', 'DELETE /installation/token']);
  });
}
