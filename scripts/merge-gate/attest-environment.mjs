import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseCommand, validatePr, validateReview, validateRule } from './gate.mjs';
import { createObservation, gateIdentity as gate } from './ruleset-proof.mjs';

const repoPath = 'repos/' + gate.repo;
const workflowFile = 'nuni-merge-gate.yml';
const workflowPath = '.github/workflows/' + workflowFile;
const environmentPath = '/environments/' + gate.environment;
const rulesetPath = '/rulesets/' + gate.rulesetId;
const usage = 'Usage: node scripts/merge-gate/attest-environment.mjs <run-id> <run-attempt> <pr-number> <command-comment-id> [--approve-environment]';

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
function api(path, data) {
  const args = ['api', '--hostname', 'github.com', '-H', 'X-GitHub-Api-Version: 2022-11-28'];
  if (data !== undefined) args.push('--method', 'POST', '--input', '-');
  args.push(path);
  try {
    const output = execFileSync('gh', args, {
      input: data === undefined ? undefined : JSON.stringify(data), encoding: 'utf8',
      timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(output);
  } catch {
    throw new Error('GitHub did not confirm ' + (data === undefined ? 'GET ' : 'POST ') + path);
  }
}
function onlyOwner(reviewers) {
  return Array.isArray(reviewers) && reviewers.length === 1 && reviewers[0]?.type === 'User' &&
    reviewers[0].reviewer?.id === gate.ownerId;
}
export function validateEnvironment(env, branches, pending) {
  const required = env?.protection_rules?.filter(r => r.type === 'required_reviewers');
  requireThat(env?.id === gate.environmentId && env.name === gate.environment && env.can_admins_bypass === false &&
    env.deployment_branch_policy?.protected_branches === false && env.deployment_branch_policy.custom_branch_policies === true &&
    required?.length === 1 && onlyOwner(required[0].reviewers) && required[0].prevent_self_review === false,
  'Environment must require the sole owner reviewer with administrator bypass disabled');
  const policies = branches?.branch_policies;
  requireThat(branches?.total_count === 1 && Array.isArray(policies) && policies.length === 1 &&
    policies[0]?.type === 'branch' && policies[0].name === 'main', 'Environment is not restricted to exactly the main branch');
  requireThat(Array.isArray(pending) && pending.length === 1 && pending[0]?.environment?.id === gate.environmentId &&
    pending[0].environment.name === gate.environment && pending[0].current_user_can_approve === true &&
    onlyOwner(pending[0].reviewers), 'No matching pending owner-only deployment review');
}
export function validateRun(run, workflow, binding) {
  requireThat(workflow?.path === workflowPath && workflow.state === 'active' && Number.isSafeInteger(workflow.id) &&
    run?.workflow_id === workflow.id && run.path === workflowPath && run.id === binding.runId &&
    run.run_attempt === binding.runAttempt && run.repository?.id === gate.repositoryId &&
    run.head_repository?.id === gate.repositoryId && run.head_branch === 'main' && run.head_sha === binding.base &&
    run.event === 'issue_comment' && run.actor?.id === gate.ownerId && run.triggering_actor?.id === gate.ownerId &&
    run.display_title === 'nuni gate PR ' + binding.number + ' comment ' + binding.commentId &&
    ['queued', 'waiting', 'in_progress', 'pending', 'requested'].includes(run.status),
  'Workflow revision, origin, command, attempt or state does not match');
}
function ownerCommand(comment, request, nowMs) {
  const age = nowMs - Date.parse(comment?.created_at);
  requireThat(comment?.id === request.commentId && comment.user?.id === gate.ownerId &&
    comment.user.type === 'User' && comment.author_association === 'OWNER' &&
    comment.issue_url === 'https://api.github.com/' + repoPath + '/issues/' + request.number &&
    comment.created_at === comment.updated_at && Number.isFinite(age) && age >= 0 && age < 60 * 60 * 1000,
  'Command has moved, expired, or was edited or posted by another account');
  const command = parseCommand(comment.body);
  requireThat(command.mode === 'approve', 'Deployment review requires an approve command');
  return command;
}

export function inspectOperation(request, githubApi = api) {
  const read = endpoint => githubApi(repoPath + endpoint);
  const user = githubApi('user');
  const repo = read('');
  requireThat(user?.id === gate.ownerId && user.type === 'User' && repo.id === gate.repositoryId &&
    repo.default_branch === 'main' && repo.permissions?.admin === true, 'Owner repository administrator access required');
  const {runId, runAttempt, number, commentId} = request;
  const runPath = '/actions/runs/' + runId;
  const comment = read('/issues/comments/' + commentId);
  const command = ownerCommand(comment, request, Date.now());
  const {head, base, reviewId} = command;
  const binding = {runId, runAttempt, number, commentId, head, base, reviewId};
  const review = read('/pulls/' + number + '/reviews/' + reviewId);
  validateReview(review, command, gate.ownerId, comment);
  validatePr(read('/pulls/' + number), read('/branches/main'), command, number);
  validateRun(read(runPath), read('/actions/workflows/' + workflowFile), binding);
  validateEnvironment(read(environmentPath), read(environmentPath + '/deployment-branch-policies?per_page=100'),
    read(runPath + '/pending_deployments'));
  const started = Date.now();
  const latest = () => {
    const history = read(rulesetPath + '/history?per_page=1');
    requireThat(Array.isArray(history) && history.length === 1 && Number.isSafeInteger(history[0].version_id) &&
      history[0].version_id > 0, 'Complete administrator ruleset history unavailable');
    return history[0];
  };
  const first = latest();
  const current = read(rulesetPath);
  validateRule(current);
  const version = read(rulesetPath + '/history/' + first.version_id);
  createObservation(current, version, first, latest(), binding, started);
  // A queued re-run or a new head during administration must not consume this review.
  validateRun(read(runPath), read('/actions/workflows/' + workflowFile), binding);
  validatePr(read('/pulls/' + number), read('/branches/main'), command, number);
  const finalComment = read('/issues/comments/' + commentId);
  ownerCommand(finalComment, request, Date.now());
  requireThat(finalComment.body === comment.body, 'Command changed during verification');
  validateReview(read('/pulls/' + number + '/reviews/' + reviewId), command, gate.ownerId, finalComment);
  validateEnvironment(read(environmentPath), read(environmentPath + '/deployment-branch-policies?per_page=100'),
    read(runPath + '/pending_deployments'));
  const finalRule = read(rulesetPath);
  validateRule(finalRule);
  requireThat(Date.parse(finalRule.updated_at) === Date.parse(current.updated_at),
    'Ruleset changed before final environment review');
  const evidence = createObservation(finalRule, version, first, latest(), binding, started);
  requireThat(Date.now() - started < 5 * 60 * 1000, 'Administrator observation expired before submission');
  return evidence;
}

function main(args) {
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  const submit = args.length === 5 && args[4] === '--approve-environment';
  requireThat(args.length === 4 || submit, usage);
  const values = args.slice(0, 4).map(s => {
    requireThat(/^[1-9][0-9]*$/.test(s) && Number.isSafeInteger(Number(s)), usage);
    return Number(s);
  });
  const [runId, runAttempt, number, commentId] = values;
  requireThat(process.env.GITHUB_ACTIONS !== 'true', 'Run the administrator helper on a trusted operator host');
  const observation = inspectOperation({runId, runAttempt, number, commentId});
  if (!submit) {
    console.log('Verified environment review (dry run): ' + JSON.stringify(observation));
    return;
  }
  api(repoPath + '/actions/runs/' + runId + '/pending_deployments', {
    environment_ids: [gate.environmentId], state: 'approved', comment: JSON.stringify(observation),
  });
  console.log('Owner environment approval submitted for run ' + runId + ', attempt ' + runAttempt + '.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
