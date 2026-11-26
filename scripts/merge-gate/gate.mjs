import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { assertNoBypass, validateApproval } from './ruleset-proof.mjs';

const REPO = 'Miiduoa/graduation';
const REPO_ID = 1190179363;
const OWNER_ID = 107848266;
const APP_ID = 5504170;
const PREFIX = '/repos/' + REPO;
const policy = JSON.parse(readFileSync(new URL('./policy.json', import.meta.url), 'utf8'));
function must(value,message){if(!value)throw new Error(message);}

function parseCommand(body){const match=/^\/nuni-gate (check|approve) ([0-9a-f]{40}) ([0-9a-f]{40}) ([1-9][0-9]{0,15})$/.exec(body);must(match,"Invalid gate command");const reviewId=Number(match[4]);must(Number.isSafeInteger(reviewId),"Invalid review ID");return {mode:match[1],head:match[2],base:match[3],reviewId};}

function expectedWorkflows(files,policy){must(files.length>0&&files.length<=policy.pilotFiles.length,"Not a supported pilot diff");const names=new Set();for(const f of files){must(policy.pilotFiles.includes(f.filename)&&["added","modified"].includes(f.status)&&!f.previous_filename&&!names.has(f.filename),"Outside reviewed pilot scope; use existing manual gate");names.add(f.filename);}const paths=["ci.yml","codeql.yml","course-access-review.yml"];if([...names].some(n=>n.startsWith("apps/mobile/")||n==="packages/shared/src/wakeAwareRequest.ts"))paths.push("maestro-e2e.yml","mobile-agent-regression.yml");if([...names].some(n=>n.startsWith("apps/web/src/app/map/")))paths.push("campus-spatial-browser.yml");return paths.map(p=>".github/workflows/"+p);}

function verifiedRuns(runs,expected,cmd,number){const relevant=runs.filter(r=>r.event==="pull_request"&&r.head_sha===cmd.head&&r.repository?.id===1190179363&&r.head_repository?.id===1190179363&&r.pull_requests?.some(p=>p.number===number&&p.head?.sha===cmd.head&&p.base?.sha===cmd.base&&p.base?.ref==="main"));const latest=new Map();for(const r of relevant){must(Number.isSafeInteger(r.id)&&Number.isSafeInteger(r.run_attempt)&&r.run_attempt>0&&/^\.github\/workflows\/[^/@]+\.ya?ml$/.test(r.path),"Invalid workflow run metadata");const old=latest.get(r.path);if(!old||r.id>old.id||(r.id===old.id&&r.run_attempt>old.run_attempt))latest.set(r.path,r);}for(const path of expected)must(latest.has(path),"Missing exact PR workflow: "+path);for(const [path,r] of latest){const optional=path===".github/workflows/preview-deploy.yml";must(r.status==="completed"&&(r.conclusion==="success"||(optional&&r.conclusion==="skipped")),"Workflow not successful: "+path);}return [...latest.values()].filter(r=>r.conclusion==="success");}

function verifiedJob(job,checks,head){const check=checks.find(c=>c.id===job.id);return job.head_sha===head&&job.status==="completed"&&job.conclusion==="success"&&check?.head_sha===head&&check?.app?.id===15368&&check?.status==="completed"&&check?.conclusion==="success";}

function validateReview(review,cmd,owner,comment){const first="nuni-gate-review v1 head="+cmd.head+" base="+cmd.base+" outcome=pass";const body=typeof review.body==="string"?review.body:"";must(review.id===cmd.reviewId&&review.user?.id===owner&&review.author_association==="OWNER"&&["COMMENTED","APPROVED"].includes(review.state)&&review.commit_id===cmd.head&&body.startsWith(first+"\n")&&body.slice(first.length).trim().length>=120&&Number.isFinite(Date.parse(review.submitted_at))&&Date.parse(review.submitted_at)<=Date.parse(comment.created_at),"Missing exact owner-delegated review attestation");}

const CONDITIONAL_VERDICTS = {
  '.github/workflows/maestro-e2e.yml': 'Maestro PR result',
  '.github/workflows/mobile-agent-regression.yml': 'Mobile agent PR result',
  '.github/workflows/campus-spatial-browser.yml': 'Spatial browser PR result',
};
const PREVIEW = '.github/workflows/preview-deploy.yml';
const NATIVE_CHECKS = [
  ...['CI Summary', 'Analyze (javascript-typescript)', 'policy-and-postgres', 'EAS Update (Preview)',
    ...Object.values(CONDITIONAL_VERDICTS)].map(context => ({ context, integration_id: 15368 })),
  { context: 'CodeQL', integration_id: 57789 },
  { context: '審查通過', integration_id: APP_ID },
];

// These conditions must remain enforceable by GitHub after an App success is posted.
function validateNativeRules(rule) {
  const targets = rule.conditions?.ref_name;
  must(rule.id === 26004626 && rule.enforcement === 'active' && rule.target === 'branch' &&
    targets?.include?.includes('~DEFAULT_BRANCH') && Array.isArray(targets.exclude) && targets.exclude.length === 0,
    'Active main ruleset missing');
  must(rule.rules?.some(r => r.type === 'pull_request' && r.parameters?.required_review_thread_resolution === true),
    'GitHub must require resolved review threads');
  const statusRules = rule.rules.filter(r => r.type === 'required_status_checks');
  for (const expected of NATIVE_CHECKS) {
    must(statusRules.some(({ parameters }) => parameters?.strict_required_status_checks_policy === true &&
      parameters.required_status_checks?.some(c => c.context === expected.context && c.integration_id === expected.integration_id)),
      'Missing strict GitHub merge protection: ' + expected.context);
  }
}

function validateRule(rule) {
  assertNoBypass(rule);
  validateNativeRules(rule);
}

function validatePr(pr,main,cmd,number){must(pr.number===number&&pr.state==="open"&&pr.draft===false&&pr.mergeable===true&&pr.head?.repo?.id===1190179363&&pr.base?.repo?.id===1190179363&&pr.base?.ref==="main"&&pr.head?.sha===cmd.head&&pr.base?.sha===cmd.base&&main.commit?.sha===cmd.base,"PR/head/base moved, draft, conflict or foreign repo");}
export { parseCommand, expectedWorkflows, verifiedRuns, verifiedJob, validateReview, validateRule, validatePr, validateNativeRules, NATIVE_CHECKS, policy };


async function api(token, path, method = 'GET', body) {
  must(token && path.startsWith('/') && !path.startsWith('//'), 'Missing API credential or invalid path');
  const res = await fetch('https://api.github.com' + path, {
    method, redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'nuni-merge-gate-v1',
      ...(body === undefined ? {} : {'Content-Type': 'application/json'}) },
    ...(body === undefined ? {} : {body: JSON.stringify(body)})
  });
  must(res.ok, 'GitHub API refused ' + method + ' ' + path + ' (' + res.status + ')');
  return res.status === 204 ? null : res.json();
}
function complete(result, key) {
  must(Array.isArray(result[key]) && result.total_count === result[key].length &&
    result.total_count <= 100, 'Incomplete API result: ' + key);
  return result[key];
}
const CORE = ['Security Gates','Lint & Type Check','Web Tests','Mobile Tests','Functions Tests',
  'Firestore Rules Tests','Assistant Integration Tests','Build Web','Build Mobile','CI Summary'];
const REQUIRED_JOBS = {
  '.github/workflows/ci.yml': CORE,
  '.github/workflows/codeql.yml': ['Analyze (javascript-typescript)'],
  '.github/workflows/maestro-e2e.yml': ['Maestro E2E Tests (ios, iPhone 15)'],
  '.github/workflows/mobile-agent-regression.yml': ['Mobile Agent Checks'],
  '.github/workflows/course-access-review.yml': ['policy-and-postgres'],
  '.github/workflows/campus-spatial-browser.yml': ['Spatial explorer browser checks'],
};
export const SELF = ['.github/workflows/nuni-merge-gate.yml','.github/workflows/nuni-merge-gate-tests.yml',
  '.github/workflows/nuni-merge-gate-revalidate.yml','.github/workflows/nuni-merge-gate-review-events.yml'];
function liveComment(comment, event, number, observedAt = Date.now()) {
  must(comment.id === event.comment.id && comment.user?.id === OWNER_ID &&
    comment.author_association === 'OWNER' && comment.body === event.comment.body &&
    comment.created_at === event.comment.created_at && comment.updated_at === comment.created_at &&
    comment.issue_url === 'https://api.github.com' + PREFIX + '/issues/' + number &&
    Number.isFinite(observedAt) && observedAt <= Date.now() &&
    observedAt - Date.parse(comment.created_at) >= 0 &&
    observedAt - Date.parse(comment.created_at) <= 60*60*1000, 'Command expired, edited or unauthorized');
}
async function verify(token, event, cmd, number, publishedAt) {
  const get = p => api(token, PREFIX + p);
  const [pr, main, comment, reviews, rule, files, compare, workflows, scripts] = await Promise.all([
    get('/pulls/' + number), get('/branches/main'), get('/issues/comments/' + event.comment.id),
    get('/pulls/' + number + '/reviews?per_page=100'), get('/rulesets/26004626'),
    get('/pulls/' + number + '/files?per_page=100'), get('/compare/' + cmd.base + '...' + cmd.head),
    get('/contents/.github/workflows?ref=' + cmd.base), get('/contents/scripts/merge-gate?ref=' + cmd.base)
  ]);
  validatePr(pr, main, cmd, number);
  must(compare.merge_base_commit?.sha === cmd.base && compare.behind_by === 0 &&
    compare.ahead_by > 0, 'Head does not contain the current main');
  liveComment(comment, event, number, publishedAt);
  must(Array.isArray(reviews) && reviews.length < 100, 'Review pagination requires manual gate');
  const review = reviews.find(r=>r.id===cmd.reviewId);
  must(review, 'Referenced review missing');
  validateReview(review, cmd, OWNER_ID, comment);
  const reviewStates = new Map();
  for (const r of reviews) if (['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(r.state))
    reviewStates.set(r.user?.id, r.state);
  must(![...reviewStates.values()].includes('CHANGES_REQUESTED'), 'Review changes requested');
  const gql = await api(token, '/graphql', 'POST', {
    query: 'query($n:Int!){repository(owner:"Miiduoa",name:"graduation"){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved}pageInfo{hasNextPage}}}}}',
    variables: {n:number}
  });
  const threads = gql.data?.repository?.pullRequest?.reviewThreads;
  must(!gql.errors?.length && threads && !threads.pageInfo.hasNextPage &&
    threads.nodes.every(t=>t.isResolved===true), 'Unresolved or unknown review threads');
  validateNativeRules(rule);
  // Metadata-only reads can omit the list. Such reads may prepare a request for
  // environment review; only an explicit list or fresh administrator evidence can establish zero bypass.
  if (Object.hasOwn(rule, 'bypass_actors')) assertNoBypass(rule);
  must(Array.isArray(files) && files.length===pr.changed_files, 'Incomplete changed-file listing');
  const expected = expectedWorkflows(files, policy);
  must(Array.isArray(workflows), 'Workflow directory unavailable');
  const actual = Object.fromEntries(workflows.filter(f=>!SELF.includes(f.path)).map(f=>[f.path,f.sha]));
  must(Object.keys(actual).length===Object.keys(policy.workflowBlobs).length &&
    Object.entries(policy.workflowBlobs).every(([p,sha])=>actual[p]===sha) &&
    SELF.every(p=>workflows.some(f=>f.path===p)), 'Trusted CI workflow set changed: manual gate and policy review required');
  must(Array.isArray(scripts) && Object.entries(policy.evidenceScriptBlobs).every(([path, sha]) =>
    scripts.some(f => f.path === path && f.sha === sha && f.type === 'file')),
    'Trusted scope or evidence script changed');
  const [runsResult, checksResult] = await Promise.all([
    get('/actions/runs?event=pull_request&head_sha='+cmd.head+'&per_page=100'),
    get('/commits/'+cmd.head+'/check-runs?filter=latest&per_page=100')
  ]);
  const workflowsRequiredOnEveryPR = [...new Set([...expected, ...Object.keys(CONDITIONAL_VERDICTS), PREVIEW])];
  const runs = verifiedRuns(complete(runsResult,'workflow_runs'),workflowsRequiredOnEveryPR,cmd,number);
  const checks = complete(checksResult,'check_runs');
  must(checks.some(c=>c.name==='CodeQL'&&c.app?.id===57789&&c.head_sha===cmd.head&&
    c.status==='completed'&&c.conclusion==='success'), 'Missing successful CodeQL App check');
  for (const run of runs) {
    const jobs = complete(await get('/actions/runs/'+run.id+'/attempts/'+run.run_attempt+'/jobs?per_page=100'),'jobs');
    // A new workflow must identify a native merge check before its results can authorize publication.
    must(Object.hasOwn(REQUIRED_JOBS, run.path) || run.path === PREVIEW, 'Unmapped PR workflow: ' + run.path);
    const required = expected.includes(run.path) ? [...REQUIRED_JOBS[run.path]] : [];
    if (CONDITIONAL_VERDICTS[run.path]) required.push(CONDITIONAL_VERDICTS[run.path]);
    if (run.path === PREVIEW) required.push('EAS Update (Preview)');
    must(jobs.length>0&&jobs.some(j=>verifiedJob(j,checks,cmd.head)), 'No verified job: '+run.path);
    for (const name of required) {
      const matches=jobs.filter(j=>j.name===name);
      must(matches.length===1&&verifiedJob(matches[0],checks,cmd.head), 'Required job failed or missing: '+name);
      if (run.path.endsWith('/maestro-e2e.yml') && name === REQUIRED_JOBS[run.path][0]) {
        for (const step of ['Build iOS Test App','Run Smoke Tests','Run Full Test Suite','Verify full Maestro reports','Upload Test Results','Publish Test Results'])
          must(matches[0].steps?.some(s=>s.name===step&&s.conclusion==='success'), 'Maestro step failed or skipped: '+step);
      }
    }
    must(jobs.every(j=>j.status==='completed'&&
      (verifiedJob(j,checks,cmd.head)||j.conclusion==='skipped')), 'Unverified or unsuccessful workflow job: '+run.path);
  }
  return {rule,runs,review,files};
}
function appJwt(key) {
  const now = Math.floor(Date.now()/1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = encode({alg:'RS256',typ:'JWT'})+'.'+encode({iat:now-60,exp:now+540,iss:String(APP_ID)});
  return unsigned+'.'+createSign('RSA-SHA256').update(unsigned).end().sign(key).toString('base64url');
}
const GATE_CHECK_NAME = '審查通過';
const RUN_URL = new RegExp('^https://github\\.com/' + REPO + '/actions/runs/([1-9][0-9]*)$');

function matchesPublishedCheck(check, head, externalId) {
  return check?.name === GATE_CHECK_NAME && check.app?.id === APP_ID && check.head_sha === head &&
    check.status === 'completed' && check.conclusion === 'success' && check.external_id === externalId;
}
function requirePublicationEnabled() {
  must(policy.publicationEnabled === true, 'Publication disabled: merge-time enforcement requires separate verified activation');
}

function gateExternalId(number, cmd, commentId) {
  return ['nuni-gate','v2',number,cmd.head,cmd.base,cmd.reviewId,commentId].join(':');
}
function canonicalRunUrl(url) {
  const match = typeof url === 'string' ? RUN_URL.exec(url) : null;
  return Boolean(match) && Number.isSafeInteger(Number(match[1]));
}
// GitHub stores checks on commits. Only this exact command on this workflow run is idempotent.
function existingGateDecision(checks, cmd, number, commentId, detailsUrl) {
  must(Array.isArray(checks) && canonicalRunUrl(detailsUrl), 'Missing check history or invalid run URL');
  const ours = checks.filter(c => c.name === GATE_CHECK_NAME && c.app?.id === APP_ID);
  if (ours.length === 0) return 'publish';
  must(ours.length === 1, 'Multiple genuine App checks; use the existing operator procedure');
  verifyPublishedCheck(ours[0], cmd, gateExternalId(number, cmd, commentId), detailsUrl);
  return 'reuse';
}
// Confirm the check returned by the POST is the exact one we asked GitHub to create.
function verifyPublishedCheck(result, cmd, externalId, detailsUrl) {
  must(canonicalRunUrl(detailsUrl) && result && Number.isSafeInteger(result.id) && result.id > 0 &&
    matchesPublishedCheck(result, cmd.head, externalId) && result.details_url === detailsUrl,
    'GitHub did not confirm the required App check');
}
export { gateExternalId, existingGateDecision, verifyPublishedCheck, requirePublicationEnabled, matchesPublishedCheck };

function runBinding(event, cmd, number) {
  const runId = Number(process.env.GITHUB_RUN_ID);
  const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  must([runId, runAttempt].every(id => Number.isSafeInteger(id) && id > 0), 'Missing trusted run identity');
  return { runId, runAttempt, number, head: cmd.head, base: cmd.base, reviewId: cmd.reviewId, commentId: event.comment.id };
}

async function verifiedPublication(readToken, event, cmd, number) {
  const binding = runBinding(event, cmd, number);
  const details = 'https://github.com/' + REPO + '/actions/runs/' + binding.runId;
  const proof = await verify(readToken, event, cmd, number);
  const [reviews, history, latestRule] = await Promise.all([
    api(readToken, PREFIX + '/actions/runs/' + binding.runId + '/approvals'),
    api(readToken, PREFIX + '/commits/' + cmd.head + '/check-runs?filter=all&per_page=100&check_name=' + encodeURIComponent(GATE_CHECK_NAME)),
    api(readToken, PREFIX + '/rulesets/26004626'),
  ]);
  validateNativeRules(latestRule);
  if (Object.hasOwn(latestRule, 'bypass_actors')) assertNoBypass(latestRule);
  validateApproval(reviews, latestRule, binding);
  const decision = existingGateDecision(complete(history, 'check_runs'), cmd, number, event.comment.id, details);
  return { ...proof, decision, details };
}
async function withAppToken(operation) {
  const key = process.env.NUNI_GATE_PRIVATE_KEY;
  delete process.env.NUNI_GATE_PRIVATE_KEY;
  must(key, 'Protected environment App key is not configured');
  const jwt = appJwt(key);
  const app = await api(jwt,'/app');
  must(app.id===APP_ID&&app.slug==='nuni-merge-gate'&&app.owner?.id===OWNER_ID&&
    app.permissions?.checks==='write', 'Wrong GitHub App identity or permissions');
  const install = await api(jwt,PREFIX+'/installation');
  must(install.app_id===APP_ID&&install.account?.id===OWNER_ID&&!install.suspended_at&&
    Number.isSafeInteger(install.id), 'Wrong or suspended App installation');
  const grant = await api(jwt,'/app/installations/'+install.id+'/access_tokens','POST',
    {repository_ids:[REPO_ID],permissions:{checks:'write'}});
  const token = grant.token;
  must(typeof token==='string'&&token.length>0, 'App token missing');
  try {
    must(grant.permissions?.checks==='write'&&Object.entries(grant.permissions).every(([p,v])=>
      (p==='checks'&&v==='write')||(p==='metadata'&&v==='read'))&&
      (!grant.repositories||grant.repositories.length===1&&grant.repositories[0].id===REPO_ID),
      'App token has unexpected scope');
    return await operation(token);
  } finally {
    try { await api(token,'/installation/token','DELETE'); }
    catch { console.warn('Short-lived token revocation failed; token expires automatically.'); }
  }
}
export { api, complete, verify, withAppToken };

async function publish(readToken, event, cmd, number) {
  requirePublicationEnabled();
  return withAppToken(async token => {
    // Fresh complete verification after acquiring the token, immediately before publication.
    const proof = await verifiedPublication(readToken, event, cmd, number);
    const externalId = gateExternalId(number, cmd, event.comment.id);
    if (proof.decision === 'reuse') {
      console.log('This exact command already published its verified App check.');
      return;
    }
    const details = proof.details;
    const summary=[
      'Owner-delegated review attestation (not independent human approval): https://github.com/'+REPO+'/pull/'+number+'#pullrequestreview-'+cmd.reviewId,
      'Command: https://github.com/'+REPO+'/pull/'+number+'#issuecomment-'+event.comment.id,
      'Head: '+cmd.head, 'Base: '+cmd.base,
      'Pilot changed files: '+proof.files.length,
      'Verified pull_request runs (skipped optional preview excluded):',
      ...proof.runs.map(r=>r.path+': https://github.com/'+REPO+'/actions/runs/'+r.id+'/attempts/'+r.run_attempt),
      'No deployment or physical-device verification asserted by this check.'
    ].join('\n');
    const result=await api(token,PREFIX+'/check-runs','POST',{
      name:'審查通過',head_sha:cmd.head,status:'completed',conclusion:'success',
      external_id:externalId,details_url:details,
      output:{title:'審查通過：精確版本與委託審查驗證',summary}
    });
    verifyPublishedCheck(result,cmd,externalId,details);
    console.log('Genuine App check published: '+result.id);
  });
}
async function main() {
  const stage=process.argv[2];
  must(['preflight','publish'].includes(stage),'Invalid gate stage');
  must(process.env.GITHUB_EVENT_NAME==='issue_comment'&&process.env.GITHUB_REF==='refs/heads/main'&&
    process.env.GITHUB_REPOSITORY===REPO&&process.env.GITHUB_REPOSITORY_ID===String(REPO_ID)&&
    process.env.GITHUB_ACTOR_ID===String(OWNER_ID)&&process.env.NUNI_TRIGGERING_ACTOR==='Miiduoa',
    'Only owner-created commands on the trusted default branch are permitted');
  const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  must(event.action==='created'&&event.repository?.id===REPO_ID&&event.issue?.pull_request&&
    event.comment?.user?.id===OWNER_ID&&event.comment.author_association==='OWNER'&&
    Number.isSafeInteger(event.comment.id),'Unauthorized or non-PR event');
  const number=event.issue.number;
  must(Number.isSafeInteger(number)&&number>0,'Invalid PR number');
  const cmd=parseCommand(event.comment.body);
  must(process.env.GITHUB_SHA===cmd.base,'Command base must be the trusted workflow revision');
  if (cmd.mode === 'approve' || stage === 'publish') requirePublicationEnabled();
  const token=process.env.GH_READ_TOKEN;
  if(stage==='publish') {
    must(cmd.mode==='approve','Read-only command cannot publish');
    const proof = await verifiedPublication(token, event, cmd, number);
    if (proof.decision === 'reuse') {
      console.log('Verified existing App check for this command.');
      return;
    }
    await publish(token,event,cmd,number);
  } else {
    const proof = await verify(token,event,cmd,number);
    if (cmd.mode === 'check') validateRule(proof.rule);
    console.log(JSON.stringify({pr:number,head:cmd.head,base:cmd.base,verifiedRuns:proof.runs.map(r=>r.id),
      mode:cmd.mode, publicationAllowed:false, requiresProtectedEnvironmentApproval:cmd.mode==='approve'}));
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(e=>{ console.error('Gate denied: '+e.message); process.exitCode=1; });
}
