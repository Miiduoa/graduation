import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { api, complete, parseCommand, verify, verifyPublishedCheck, withAppToken } from './gate.mjs';
import { gateIdentity } from './ruleset-proof.mjs';

const PREFIX = '/repos/' + gateIdentity.repo;
const SHA = /^[0-9a-f]{40}$/;
const CHECK_NAME = '審查通過';
const WORKFLOWS = ['CI', 'CodeQL', 'Course access review', 'E2E Tests (Maestro)',
  'Mobile Agent Regression', 'Campus Spatial Browser', 'Preview Deploy', 'nuni gate review evidence changed'];
function must(value, message) { if (!value) throw new Error(message); }
function positiveId(value) { return Number.isSafeInteger(value) && value > 0; }

// This worker never creates or restores an approval. It touches only this pilot's v2 checks.
export function isPublishedPilotCheck(check) {
  return check?.name === CHECK_NAME && check.app?.id === gateIdentity.appId &&
    check.status === 'completed' && check.conclusion === 'success' &&
    positiveId(check.id) && SHA.test(check.head_sha) &&
    typeof check.external_id === 'string' && check.external_id.startsWith('nuni-gate:v2:');
}

export function checkBinding(check) {
  must(isPublishedPilotCheck(check), 'Not a published pilot check');
  const match = /^nuni-gate:v2:([1-9][0-9]*):([0-9a-f]{40}):([0-9a-f]{40}):([1-9][0-9]*):([1-9][0-9]*)$/.exec(check.external_id);
  must(match, 'Invalid pilot audit binding');
  const [, number, head, base, reviewId, commentId] = match;
  const binding = { number: Number(number), head, base, reviewId: Number(reviewId), commentId: Number(commentId) };
  must([binding.number, binding.reviewId, binding.commentId].every(positiveId), 'Invalid pilot audit IDs');
  verifyPublishedCheck(check, binding, check.external_id, check.details_url);
  return binding;
}

export async function publishedEvidenceIsValid(token, check) {
  try {
    const binding = checkBinding(check);
    const comment = await api(token, PREFIX + '/issues/comments/' + binding.commentId);
    const cmd = parseCommand(comment.body);
    must(cmd.mode === 'approve' && cmd.head === binding.head && cmd.base === binding.base &&
      cmd.reviewId === binding.reviewId, 'Published command changed');
    // Issuance freshness applies at publication; later audits still require an unchanged owner command.
    const publishedAt = Date.parse(check.completed_at);
    must(Number.isFinite(publishedAt), 'Missing check publication time');
    await verify(token, { comment }, cmd, binding.number, publishedAt);
    return true;
  } catch {
    // Missing/deleted evidence, partial results and unavailable reads never preserve a green verdict.
    return false;
  }
}

export function validateRuntime(env, event) {
  must(env.GITHUB_REF === 'refs/heads/main' && SHA.test(env.GITHUB_SHA) &&
    env.GITHUB_REPOSITORY === gateIdentity.repo && env.GITHUB_REPOSITORY_ID === String(gateIdentity.repositoryId) &&
    event.repository?.id === gateIdentity.repositoryId, 'Revalidation requires trusted main');
  if (env.GITHUB_EVENT_NAME === 'workflow_run') {
    const run = event.workflow_run;
    must(['requested', 'in_progress', 'completed'].includes(event.action) && WORKFLOWS.includes(run?.name) &&
      run.repository?.id === gateIdentity.repositoryId && run.head_repository?.id === gateIdentity.repositoryId &&
      SHA.test(run.head_sha), 'Untrusted workflow event');
  } else if (env.GITHUB_EVENT_NAME === 'issue_comment') {
    must(['edited', 'deleted'].includes(event.action) && event.issue?.pull_request && positiveId(event.issue.number),
      'Unexpected comment event');
  } else if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    must(env.GITHUB_ACTOR_ID === String(gateIdentity.ownerId) && env.NUNI_TRIGGERING_ACTOR === 'Miiduoa',
      'Manual revalidation requires owner');
  } else {
    must(env.GITHUB_EVENT_NAME === 'schedule' && event.schedule === '7,22,37,52 * * * *', 'Unexpected revalidation event');
  }
}

export async function affectedHeads(token, env, event) {
  validateRuntime(env, event);
  if (env.GITHUB_EVENT_NAME === 'workflow_run') {
    const run = event.workflow_run;
    const heads = (run.pull_requests ?? []).filter(pr => pr.base?.ref === 'main').map(pr => pr.head?.sha);
    heads.push(run.head_sha);
    return [...new Set(heads.filter(head => SHA.test(head)))];
  }
  if (env.GITHUB_EVENT_NAME === 'issue_comment') {
    const pr = await api(token, PREFIX + '/pulls/' + event.issue.number);
    return pr.state === 'open' && pr.base?.ref === 'main' && pr.head?.repo?.id === gateIdentity.repositoryId &&
      SHA.test(pr.head?.sha) ? [pr.head.sha] : [];
  }
  const heads = new Set();
  for (let page = 1; page <= 10; page++) {
    const prs = await api(token, PREFIX + '/pulls?state=open&base=main&per_page=100&page=' + page);
    must(Array.isArray(prs) && prs.length <= 100, 'Incomplete PR listing');
    for (const pr of prs) if (pr.head?.repo?.id === gateIdentity.repositoryId && SHA.test(pr.head?.sha)) heads.add(pr.head.sha);
    if (prs.length < 100) return [...heads];
  }
  throw new Error('PR listing exceeds revalidation budget');
}

export async function invalidPublishedChecks(token, heads) {
  const invalid = [];
  for (const head of heads) {
    must(SHA.test(head), 'Invalid check head');
    const result = await api(token, PREFIX + '/commits/' + head +
      '/check-runs?filter=all&per_page=100&check_name=' + encodeURIComponent(CHECK_NAME));
    for (const check of complete(result, 'check_runs')) {
      if (check.head_sha === head && isPublishedPilotCheck(check) && !await publishedEvidenceIsValid(token, check)) invalid.push(check);
    }
  }
  return invalid;
}

export async function revokeIfStillInvalid(readToken, appToken, candidate) {
  must(isPublishedPilotCheck(candidate), 'Not an owned pilot check');
  const path = PREFIX + '/check-runs/' + candidate.id;
  const latest = await api(readToken, path);
  // A new check or operator edit must be audited independently, not overwritten from the earlier snapshot.
  if (!isPublishedPilotCheck(latest) || latest.id !== candidate.id || latest.head_sha !== candidate.head_sha ||
    latest.external_id !== candidate.external_id || latest.details_url !== candidate.details_url ||
    latest.completed_at !== candidate.completed_at || await publishedEvidenceIsValid(readToken, latest)) return false;
  const result = await api(appToken, path, 'PATCH', {
    status: 'completed', conclusion: 'failure',
    output: { title: '核准已撤回：證據已變動或無法確認', summary:
      'The original pilot approval is no longer valid. Recheck the current head/base, workflow attempts, review and discussions. ' +
      'This worker can only withdraw approval; a new approval requires the original protected review procedure.' },
  });
  must(result?.id === latest.id && result.name === CHECK_NAME && result.app?.id === gateIdentity.appId &&
    result.head_sha === latest.head_sha && result.external_id === latest.external_id &&
    result.details_url === latest.details_url && result.status === 'completed' && result.conclusion === 'failure',
    'GitHub did not confirm App check revocation');
  return true;
}

async function main() {
  const mode = process.argv[2];
  must(['inspect', 'revoke'].includes(mode), 'Invalid revalidation mode');
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  validateRuntime(process.env, event);
  const token = process.env.GH_READ_TOKEN;
  const heads = await affectedHeads(token, process.env, event);
  const invalid = await invalidPublishedChecks(token, heads);
  if (mode === 'inspect') {
    must(process.env.GITHUB_OUTPUT, 'Missing Actions output');
    appendFileSync(process.env.GITHUB_OUTPUT, 'needs_revocation=' + (invalid.length > 0) + '\n');
  } else if (invalid.length) {
    await withAppToken(async appToken => {
      for (const check of invalid) await revokeIfStillInvalid(token, appToken, check);
    });
  }
  console.log('Inspected ' + heads.length + ' heads; ' + invalid.length + ' pilot checks require withdrawal.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error('Revalidation failed: ' + error.message); process.exitCode = 1; });
}
