import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNoBypass, createObservation, gateIdentity as gate, validateApproval } from './ruleset-proof.mjs';
import { NATIVE_CHECKS } from './gate.mjs';
import { inspectOperation, validateEnvironment, validateRun } from './attest-environment.mjs';

const now = Date.parse('2026-11-25T10:10:00Z');
const binding = {runId: 81, runAttempt: 1, number: 4, reviewId: 9, commentId: 77, head: 'a'.repeat(40), base: 'b'.repeat(40)};
const reviewer = {type: 'User', reviewer: {id: gate.ownerId}};
const environment = {
  id: gate.environmentId, name: gate.environment, can_admins_bypass: false,
  protection_rules: [{type: 'required_reviewers', reviewers: [reviewer], prevent_self_review: false}],
  deployment_branch_policy: {protected_branches: false, custom_branch_policies: true},
};
const branches = {total_count: 1, branch_policies: [{name: 'main', type: 'branch'}]};
const pending = [{environment, reviewers: [reviewer], current_user_can_approve: true}];
const workflow = {id: 66, path: '.github/workflows/nuni-merge-gate.yml', state: 'active'};
const user = {id: gate.ownerId, type: 'User'};
const run = {id: 81, workflow_id: workflow.id, path: workflow.path, run_attempt: 1, event: 'issue_comment',
  repository: {id: gate.repositoryId}, head_repository: {id: gate.repositoryId}, head_sha: binding.base,
  head_branch: 'main', actor: user, triggering_actor: user, status: 'waiting', display_title: 'nuni gate PR 4 comment 77'};
const rule = {
  id: gate.rulesetId, name: 'main', source_type: 'Repository', source: gate.repo, target: 'branch', enforcement: 'active',
  bypass_actors: [], conditions: {ref_name: {include: ['~DEFAULT_BRANCH'], exclude: []}},
  updated_at: '2026-11-25T18:05:53.234+08:00',
  rules: [{type: 'pull_request', parameters: {required_review_thread_resolution: true}}, {type: 'required_status_checks', parameters: {strict_required_status_checks_policy: true,
    required_status_checks: structuredClone(NATIVE_CHECKS)}}],
};
const entry = {version_id: 123, updated_at: '2026-11-25T10:05:53.685Z'};
const snapshot = {...entry, state: {...rule, updated_at: null}};
const {bypass_actors: _hidden, ...publicRule} = rule;
const observation = createObservation(rule, snapshot, entry, entry, binding, now);
const approval = {state: 'approved', user, environments: [{id: gate.environmentId, name: gate.environment}],
  comment: JSON.stringify(observation)};
const reviewWith = updates => [{...approval, comment: JSON.stringify({...observation, ...updates})}];

test('administrator rejects hidden, malformed, inherited and nonempty bypass lists', () => {
  assert.doesNotThrow(() => assertNoBypass(rule));
  for (const value of [null, {}, {bypass_actors: null}, {bypass_actors: ''}, {bypass_actors: {}},
    {bypass_actors: [{}]}, Object.create({bypass_actors: []})]) assert.throws(() => assertNoBypass(value));
});
test('current and historical state must both have explicit empty bypass, same version and matching settings', () => {
  for (const current of [publicRule, {...rule, bypass_actors: [{}]}]) {
    assert.throws(() => createObservation(current, snapshot, entry, entry, binding, now));
  }
  for (const state of [publicRule, {...rule, bypass_actors: [{}]}, {...rule, name: 'different'}]) {
    assert.throws(() => createObservation(rule, {...entry, state}, entry, entry, binding, now));
  }
  for (const bad of [{...entry, version_id: 124}, {...entry, updated_at: '2026-11-25T10:06:00Z'}]) {
    assert.throws(() => createObservation(rule, snapshot, entry, bad, binding, now));
  }
});
test('fresh owner environment approval binds a read-only public view and normalizes offsets', () => {
  assert.equal(validateApproval([approval], {...publicRule, updated_at: '2026-11-25T10:05:53.234Z'}, binding, now).versionId, 123);
  assert.throws(() => validateApproval([approval], {...rule, bypass_actors: [{}]}, binding, now));
  for (const live of [{...rule, name: 'changed'}, {...rule, updated_at: '2026-11-25T10:05:53.235Z'}]) {
    assert.throws(() => validateApproval([approval], live, binding, now));
  }
});
test('wrong, repeated, cross-environment and rejected GitHub approvals are unusable', () => {
  const tag = approval.environments[0];
  for (const records of [[], [approval, approval], [{...approval, user: {id: 5, type: 'User'}}],
    [{...approval, state: 'rejected'}], [{...approval, comment: 'approved'}],
    [{...approval, environments: [tag, {id: 2, name: 'other'}]}],
    [{...approval, environments: [{...tag, id: 1}]}], [{...approval, environments: [{...tag, name: 'other'}]}]]) {
    assert.throws(() => validateApproval(records, publicRule, binding, now));
  }
});
test('every operation field, both bypass observations and sub-five-minute age are enforced', () => {
  const changes = Object.entries(binding).map(([key,value]) => ({[key]: typeof value === 'number' ? value + 1 : 'c'.repeat(40)}));
  for (const mutation of [...changes, {repositoryId: 2}, {rulesetId: 1}, {versionId: 0}, {currentBypassActors: null},
    {snapshotBypassActors: [{}]}, {snapshotBypassActors: undefined}, {digest: ''}, {format: 'different'}]) {
    assert.throws(() => validateApproval(reviewWith(mutation), publicRule, binding, now));
  }
  for (const time of [now - 1, now + 300_000, Infinity]) {
    assert.throws(() => validateApproval([approval], publicRule, binding, time));
  }
});
test('administrator matches actual run, reviewer, main-only policy and pending deployment', () => {
  assert.doesNotThrow(() => validateRun(run, workflow, binding));
  for (const v of [{run_attempt: 2}, {head_branch: 'other'}, {head_sha: binding.head}, {status: 'completed'},
    {event: 'pull_request'}, {workflow_id: 12}, {display_title: 'nuni gate PR 4 comment 78'}, {triggering_actor: {id: 7}}]) {
    assert.throws(() => validateRun({...run, ...v}, workflow, binding));
  }
  assert.doesNotThrow(() => validateEnvironment(environment, branches, pending));
  for (const env of [{...environment, can_admins_bypass: true}, {...environment, protection_rules: []},
    {...environment, protection_rules: [{type: 'required_reviewers', reviewers: [reviewer, reviewer]}]}]) {
    assert.throws(() => validateEnvironment(env, branches, pending));
  }
  assert.throws(() => validateEnvironment(environment, {total_count: 1, branch_policies: [{name: 'main', type:'tag'}]}, pending));
  assert.throws(() => validateEnvironment(environment, branches, [{...pending[0], current_user_can_approve: false}]));
});
test('administrator inspection performs only API reads and rejects a moving ruleset', () => {
  const pr = {state: 'open', draft: false, mergeable: true, number: binding.number,
    head: {sha: binding.head, repo: {id: gate.repositoryId}},
    base: {sha: binding.base, repo: {id: gate.repositoryId}, ref: 'main'}};
  const created = new Date(Date.now() - 15_000).toISOString();
  const prefix = 'repos/' + gate.repo;
  const comments = {id: binding.commentId, user, author_association: 'OWNER',
    body: '/nuni-gate approve ' + binding.head + ' ' + binding.base + ' 9',
    issue_url: 'https://api.github.com/' + prefix + '/issues/4', created_at: created, updated_at: created};
  const review = {id: 9, user, author_association: 'OWNER', state: 'COMMENTED', commit_id: binding.head,
    submitted_at: created, body: 'nuni-gate-review v1 head=' + binding.head + ' base=' + binding.base +
      ' outcome=pass\n' + 'Test evidence and review scope. '.repeat(6)};
  const ruleset = '/rulesets/' + gate.rulesetId;
  const responses = {
    '': {id: gate.repositoryId, default_branch: 'main', permissions: {admin: true}}, '/issues/comments/77': comments,
    '/pulls/4/reviews/9': review, '/pulls/4': pr, '/branches/main': {commit: {sha: binding.base}},
    '/actions/runs/81': run, '/actions/workflows/nuni-merge-gate.yml': workflow,
    '/environments/nuni-merge-gate': environment,
    '/environments/nuni-merge-gate/deployment-branch-policies?per_page=100': branches,
    '/actions/runs/81/pending_deployments': pending,
    [ruleset + '/history?per_page=1']: [entry], [ruleset]: rule, [ruleset + '/history/123']: snapshot,
  };
  const read = (path, data) => {
    assert.equal(data, undefined);
    if (path === 'user') return user;
    assert.ok(path.startsWith(prefix) && Object.hasOwn(responses, path.slice(prefix.length)));
    return structuredClone(responses[path.slice(prefix.length)]);
  };
  const proof = inspectOperation(binding, read);
  assert.equal(proof.versionId, entry.version_id);
  assert.equal(proof.commentId, binding.commentId);
  assert.throws(() => inspectOperation(binding, path => {
    const data = read(path);
    if (path === prefix + ruleset) data.rules[0].parameters.required_review_thread_resolution = false;
    return data;
  }), /resolved review threads/);
  let reads = 0;
  assert.throws(() => inspectOperation(binding, path => {
    if (path.endsWith('/history?per_page=1') && ++reads === 2) return [{...entry, version_id: 124}];
    return read(path);
  }), /history changed/);
});
