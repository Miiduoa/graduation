import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createObservation, gateIdentity as gate } from './ruleset-proof.mjs';

const binding = {
  number: 42, head: 'a'.repeat(40), base: 'b'.repeat(40),
  reviewId: 11, commentId: 12, runId: 13, runAttempt: 1,
};
const jobsByWorkflow = {
  ci: ['Security Gates', 'Lint & Type Check', 'Web Tests', 'Mobile Tests', 'Functions Tests',
    'Firestore Rules Tests', 'Assistant Integration Tests', 'Build Web', 'Build Mobile', 'CI Summary'],
  codeql: ['Analyze (javascript-typescript)'],
  'course-access-review': ['policy-and-postgres'],
  'maestro-e2e': ['Maestro PR result'],
  'mobile-agent-regression': ['Mobile agent PR result'],
  'campus-spatial-browser': ['Spatial browser PR result'],
  'preview-deploy': ['EAS Update (Preview)'],
};
const eventPath = '/fixture/event.json';
const readToken = 'local-read-fixture';
const gateScript = fileURLToPath(new URL('./gate.mjs', import.meta.url));

function installFixture(scenario) {
  const { number, head, base, reviewId, commentId, runId } = binding;
  const now = Date.now();
  const date = new Date(now - 1000).toISOString();
  const path = '/repos/' + gate.repo;
  const repo = { id: gate.repositoryId };
  const owner = { id: gate.ownerId, type: 'User' };
  const comment = {
    id: commentId, user: owner, author_association: 'OWNER', created_at: date, updated_at: date,
    body: `/nuni-gate approve ${head} ${base} ${reviewId}`,
    issue_url: 'https://api.github.com' + path + '/issues/' + number,
  };
  const event = { action: 'created', repository: repo, issue: { number, pull_request: {} }, comment };
  const readFile = fs.readFileSync;
  // Exercise the prospective enabled policy only in this isolated child. Also test the committed hold.
  fs.readFileSync = (source, ...args) => {
    if (source === eventPath) return JSON.stringify(event);
    const value = readFile(source, ...args);
    if (scenario !== 'publication-hold' && source instanceof URL && source.href === new URL('./policy.json', import.meta.url).href) {
      return JSON.stringify({...JSON.parse(value), publicationEnabled:true});
    }
    return value;
  };
  const forbidden = operation => {
    // Keep a record even if the gate eventually catches or suppresses the error.
    process.stderr.write('UNEXPECTED PRIVILEGED OPERATION: ' + operation + '\n');
    throw new Error('Forbidden fixture operation');
  };
  crypto.createSign = () => forbidden('JWT signing');
  syncBuiltinESMExports();

  const metadata = JSON.parse(readFile(new URL('./policy.json', import.meta.url), 'utf8'));
  const workflowFiles = Object.entries(metadata.workflowBlobs).map(([path, sha]) => ({path, sha}));
  for (const name of ['nuni-merge-gate', 'nuni-merge-gate-tests']) workflowFiles.push({ path: '.github/workflows/' + name + '.yml' });
  const pr = { number, state: 'open', draft: false, mergeable: true, changed_files: 1,
    head: {sha: head, repo}, base: {sha: base, ref: 'main', repo} };
  const review = { id: reviewId, user: owner, author_association: 'OWNER', submitted_at: date,
    state: 'COMMENTED', commit_id: head, body: `nuni-gate-review v1 head=${head} base=${base} outcome=pass\n` +
      'Local fixture representing an exact-version review. '.repeat(3) };
  const protectedChecks = Object.values(jobsByWorkflow).map(jobs => ({ context: jobs.at(-1), integration_id: 15368 }));
  protectedChecks.push({context: 'CodeQL', integration_id: 57789}, {context: '審查通過', integration_id: gate.appId});
  const rule = {
    id: gate.rulesetId, name: 'fixture rule', source: gate.repo, source_type: 'Repository',
    enforcement: 'active', target: 'branch', updated_at: date, conditions: {ref_name: {include: ['~DEFAULT_BRANCH'], exclude: []}},
    rules: [
      {type: 'pull_request', parameters: {required_review_thread_resolution: true}},
      {type: 'required_status_checks', parameters: {strict_required_status_checks_policy: true, required_status_checks: protectedChecks}},
    ],
  }; // The ordinary read token gets no bypass_actors field.
  const adminRule = {...rule, bypass_actors: []};
  const snapshot = {version_id: 1, updated_at: date, state: adminRule};
  const proof = createObservation(adminRule, snapshot, snapshot, snapshot, binding, now);
  if (scenario === 'wrong-approval-binding') proof.runAttempt += 1;
  const approvals = scenario === 'missing-approval' ? [] : [{
    state: 'approved', user: owner, environments: [{id: gate.environmentId, name: gate.environment}], comment: JSON.stringify(proof),
  }];

  const responses = new Map();
  const page = (key, values) => ({total_count: values.length, [key]: values});
  const success = {head_sha: head, status: 'completed', conclusion: 'success'};
  const runs = [], checks = [{...success, name: 'CodeQL', app: {id: 57789}}];
  for (const [workflow, names] of Object.entries(jobsByWorkflow)) {
    const id = 100 + runs.length;
    const run = {...success, id, repository: repo, head_repository: repo, event: 'pull_request', run_attempt: 1,
      path: '.github/workflows/' + workflow + '.yml', pull_requests: [pr]};
    runs.push(run);
    const jobs = names.map((name, index) => ({...success, name, id: id * 100 + index}));
    checks.push(...jobs.map(job => ({...job, app: {id: 15368}})));
    responses.set(path + '/actions/runs/' + id + '/attempts/1/jobs', page('jobs', jobs));
  }
  if (scenario === 'ci-failure') runs[0].conclusion = 'failure';
  if (scenario === 'ci-rerun') runs.push({...runs[0], run_attempt: 2, status: 'in_progress', conclusion: null});
  const previous = {...success, id: 777, name: '審查通過', app: {id: gate.appId},
    external_id: ['nuni-gate', 'v2', number, head, base, reviewId, commentId].join(':'),
    details_url: 'https://github.com/' + gate.repo + '/actions/runs/' + runId};
  if (scenario === 'wrong-existing-check') previous.external_id += ':another-command';
  const threads = {nodes: [{isResolved: scenario !== 'unresolved-thread'}], pageInfo: {hasNextPage: false}};

  const views = {
    ['/pulls/' + number]: pr,
    '/branches/main': {commit: {sha: base}},
    ['/issues/comments/' + commentId]: comment,
    ['/pulls/' + number + '/reviews']: [review],
    ['/pulls/' + number + '/files']: [{filename: 'apps/web/src/lib/wakeAwareRequest.test.ts', status: 'modified'}],
    ['/rulesets/' + gate.rulesetId]: rule,
    ['/compare/' + base + '...' + head]: {merge_base_commit: {sha: base}, behind_by: 0, ahead_by: 1},
    '/contents/.github/workflows': workflowFiles,
    '/contents/scripts/merge-gate': Object.entries(metadata.evidenceScriptBlobs).map(([path, sha]) => ({path, sha, type:'file'})),
    '/actions/runs': page('workflow_runs', runs),
    ['/actions/runs/' + runId + '/approvals']: approvals,
  };
  for (const [route, value] of Object.entries(views)) responses.set(path + route, value);
  globalThis.fetch = async (url, options) => {
    const {origin, pathname, searchParams} = new URL(url);
    if (origin !== 'https://api.github.com' || options.headers.Authorization !== 'Bearer ' + readToken)
      forbidden('unexpected destination or credential');
    if (pathname === '/graphql' && options.method === 'POST') {
      const {query, variables} = JSON.parse(options.body);
      assert.match(query, /^query\(/);
      assert.equal(variables.n, number);
      return Response.json({data: {repository: {pullRequest: {reviewThreads: threads}}}});
    }
    if (options.method !== 'GET' || pathname === '/app' || pathname.endsWith('/installation'))
      forbidden(options.method + ' ' + pathname);
    if (pathname === path + '/commits/' + head + '/check-runs') {
      const history = searchParams.get('check_name') === previous.name;
      return Response.json(page('check_runs', history ? [previous] : checks));
    }
    assert(responses.has(pathname), 'Unhandled fixture read ' + pathname);
    return Response.json(responses.get(pathname));
  };
}

// Preload the transport only inside a child running the unmodified workflow command.
if (process.argv[1] === gateScript && process.env.PUBLISH_DENIAL_CASE) {
  installFixture(process.env.PUBLISH_DENIAL_CASE);
} else {
  const cases = [
    ['publication-hold', 'Publication disabled:'],
    ['missing-approval', 'Expected exactly one gate environment review'],
    ['wrong-approval-binding', 'Approval applies to a different operation'],
    ['ci-failure', 'Workflow not successful: .github/workflows/ci.yml'],
    ['ci-rerun', 'Workflow not successful: .github/workflows/ci.yml'],
    ['unresolved-thread', 'Unresolved or unknown review threads'],
    ['wrong-existing-check', 'GitHub did not confirm the required App check'],
    ['valid-reuse', null],
  ];
  for (const [scenario, denial] of cases) {
    test('publish with existing same-head success: ' + scenario, () => {
      const result = spawnSync(process.execPath, ['--import', import.meta.url, gateScript, 'publish'], {
        encoding: 'utf8', timeout: 10000,
        env: {
          PUBLISH_DENIAL_CASE: scenario, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: 'issue_comment',
          GITHUB_REPOSITORY: gate.repo, GITHUB_REPOSITORY_ID: String(gate.repositoryId), GITHUB_ACTOR_ID: String(gate.ownerId),
          NUNI_TRIGGERING_ACTOR: 'Miiduoa', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: binding.base,
          GITHUB_RUN_ID: String(binding.runId), GITHUB_RUN_ATTEMPT: String(binding.runAttempt), GH_READ_TOKEN: readToken,
        },
      });
      assert.ifError(result.error);
      assert.equal(result.status, denial ? 1 : 0, result.stderr);
      assert.doesNotMatch(result.stderr, /UNEXPECTED PRIVILEGED OPERATION/);
      if (denial) assert(result.stderr.includes('Gate denied: ' + denial), result.stderr);
      else assert.match(result.stdout, /Verified existing App check for this command/);
    });
  }
}
