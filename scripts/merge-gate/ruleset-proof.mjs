import { createHash } from 'node:crypto';

export const gateIdentity = Object.freeze({
  repo: 'Miiduoa/graduation', repositoryId: 1190179363, ownerId: 107848266,
  rulesetId: 26004626, appId: 5504170, environmentId: 28496869500, environment: 'nuni-merge-gate',
});
const format = 'nuni-environment-ruleset-v1';
const maxAgeMs = 5 * 60 * 1000;
const visibleFields = ['id', 'source', 'source_type', 'target', 'name', 'enforcement', 'conditions', 'rules'];
const bindingNumbers = ['runId', 'runAttempt', 'number', 'reviewId', 'commentId'];
const bindingFields = [...bindingNumbers, 'head', 'base'];

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
function positiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}
function timestamp(value) {
  requireThat(typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value)), 'Invalid GitHub timestamp');
  return new Date(value).toISOString();
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
}
function ruleDigest(rule) {
  const valid = rule?.id === gateIdentity.rulesetId && rule.source === gateIdentity.repo &&
    rule.source_type === 'Repository' && rule.target === 'branch' && rule.enforcement === 'active' &&
    typeof rule.name === 'string' && rule.name.length > 0 && Array.isArray(rule.rules) &&
    rule.conditions?.ref_name?.include?.length === 1 && rule.conditions.ref_name.include[0] === '~DEFAULT_BRANCH' &&
    Array.isArray(rule.conditions.ref_name.exclude) && rule.conditions.ref_name.exclude.length === 0 &&
    rule.rules.some(r => r.type === 'pull_request') && rule.rules.some(r => r.type === 'required_status_checks' &&
      r.parameters?.strict_required_status_checks_policy === true && r.parameters.required_status_checks?.some(c =>
        c.context === '審查通過' && c.integration_id === gateIdentity.appId));
  requireThat(valid, 'Unexpected live ruleset identity, conditions or protected checks');
  const projection = Object.fromEntries(visibleFields.map(k => [k, rule[k]]));
  return createHash('sha256').update(JSON.stringify(canonical(projection))).digest('hex');
}
export function assertNoBypass(rule) {
  requireThat(rule && Object.hasOwn(rule, 'bypass_actors') &&
    Array.isArray(rule.bypass_actors) && rule.bypass_actors.length === 0, 'Missing or nonempty bypass actor list');
}
function validateBinding(binding) {
  requireThat(binding && bindingNumbers.every(field => positiveId(binding[field])) &&
    [binding.head, binding.base].every(sha => typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha)),
  'Invalid environment approval binding');
}

// Called only by the independent administrator using the full ruleset and its historical state.
export function createObservation(current, version, first, last, binding, startedAtMs) {
  validateBinding(binding);
  requireThat(positiveId(version?.version_id) && first?.version_id === version.version_id &&
    last?.version_id === version.version_id && timestamp(first.updated_at) === timestamp(version.updated_at) &&
    timestamp(last.updated_at) === timestamp(version.updated_at), 'Ruleset history changed during observation');
  assertNoBypass(current);
  assertNoBypass(version.state);
  const digest = ruleDigest(current);
  requireThat(ruleDigest(version.state) === digest, 'Latest ruleset snapshot differs from live configuration');
  return {
    format, repositoryId: gateIdentity.repositoryId, rulesetId: gateIdentity.rulesetId,
    ...Object.fromEntries(bindingFields.map(k => [k, binding[k]])),
    observedAt: new Date(startedAtMs).toISOString(), versionId: version.version_id,
    ruleUpdatedAt: timestamp(current.updated_at), currentBypassActors: [], snapshotBypassActors: [], digest,
  };
}

// The ordinary Actions token can read deployment review history but cannot see the ruleset bypass list.
export function validateApproval(approvals, liveRule, binding, nowMs = Date.now()) {
  validateBinding(binding);
  requireThat(Array.isArray(approvals) && approvals.every(r => Array.isArray(r?.environments)),
    'Malformed GitHub environment review history');
  const matching = approvals.filter(r => r.environments.some(e =>
    e?.id === gateIdentity.environmentId || e?.name === gateIdentity.environment));
  requireThat(matching.length === 1, 'Expected exactly one gate environment review; use a fresh command for retries');
  const [review] = matching;
  requireThat(review.state === 'approved' && review.user?.id === gateIdentity.ownerId &&
    review.user.type === 'User' && review.environments.length === 1 &&
    review.environments[0].id === gateIdentity.environmentId && review.environments[0].name === gateIdentity.environment,
  'Wrong environment, decision or approving account');
  requireThat(typeof review.comment === 'string' && review.comment.length <= 4096, 'Invalid approval evidence');
  let proof;
  try { proof = JSON.parse(review.comment); } catch { throw new Error('Unreadable environment approval evidence'); }
  requireThat(proof?.format === format && proof.repositoryId === gateIdentity.repositoryId &&
    proof.rulesetId === gateIdentity.rulesetId && positiveId(proof.versionId) &&
    bindingFields.every(k => proof[k] === binding[k]), 'Approval applies to a different operation');
  const age = nowMs - Date.parse(timestamp(proof.observedAt));
  requireThat(Number.isFinite(age) && age >= 0 && age < maxAgeMs, 'Administrator ruleset observation expired');
  assertNoBypass({bypass_actors: proof.currentBypassActors});
  assertNoBypass({bypass_actors: proof.snapshotBypassActors});
  if (liveRule && Object.hasOwn(liveRule, 'bypass_actors')) assertNoBypass(liveRule);
  requireThat(proof.digest === ruleDigest(liveRule) && timestamp(proof.ruleUpdatedAt) === timestamp(liveRule.updated_at),
    'Live ruleset changed since administrator observation');
  return proof;
}
