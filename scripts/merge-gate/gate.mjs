import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { pathToFileURL } from 'node:url';

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

function validateRule(rule){must(rule.id===26004626&&rule.enforcement==="active"&&rule.target==="branch"&&rule.conditions?.ref_name?.include?.includes("~DEFAULT_BRANCH")&&!rule.conditions?.ref_name?.exclude?.length,"Expected active default-branch ruleset missing");must(Array.isArray(rule.bypass_actors)&&rule.bypass_actors.length===0,"Missing or nonempty ruleset bypass actors");const checks=rule.rules?.filter(r=>r.type==="required_status_checks")??[];must(rule.rules?.some(r=>r.type==="pull_request")&&checks.some(r=>r.parameters?.required_status_checks?.some(c=>c.context==="審查通過"&&c.integration_id===5504170)),"Required App gate changed");return checks.some(r=>r.parameters?.strict_required_status_checks_policy===true&&r.parameters?.required_status_checks?.some(c=>c.context==="審查通過"&&c.integration_id===5504170));}

function validatePr(pr,main,cmd,number){must(pr.number===number&&pr.state==="open"&&pr.draft===false&&pr.mergeable===true&&pr.head?.repo?.id===1190179363&&pr.base?.repo?.id===1190179363&&pr.base?.ref==="main"&&pr.head?.sha===cmd.head&&pr.base?.sha===cmd.base&&main.commit?.sha===cmd.base,"PR/head/base moved, draft, conflict or foreign repo");}
// A previously successful check is not interchangeable with a different review, PR or base.
function matchesPublishedCheck(check,head,externalId){
  return check.name==='審查通過'&&check.app?.id===APP_ID&&check.head_sha===head&&
    check.status==='completed'&&check.conclusion==='success'&&check.external_id===externalId;
}
function requirePublicationEnabled(){
  must(policy.publicationEnabled===true,
    'Publication disabled: independent merge-time CI and review enforcement not yet validated');
}
export { parseCommand, expectedWorkflows, verifiedRuns, verifiedJob, validateReview, validateRule, validatePr, matchesPublishedCheck, requirePublicationEnabled, policy };


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
const SELF = ['.github/workflows/nuni-merge-gate.yml','.github/workflows/nuni-merge-gate-tests.yml'];
function liveComment(comment, event, number) {
  must(comment.id === event.comment.id && comment.user?.id === OWNER_ID &&
    comment.author_association === 'OWNER' && comment.body === event.comment.body &&
    comment.created_at === event.comment.created_at && comment.updated_at === comment.created_at &&
    comment.issue_url === 'https://api.github.com' + PREFIX + '/issues/' + number &&
    Date.now() - Date.parse(comment.created_at) >= 0 &&
    Date.now() - Date.parse(comment.created_at) <= 60*60*1000, 'Command expired, edited or unauthorized');
}
async function verify(token, event, cmd, number) {
  const get = p => api(token, PREFIX + p);
  const [pr, main, comment, reviews, rule, files, compare, workflows] = await Promise.all([
    get('/pulls/' + number), get('/branches/main'), get('/issues/comments/' + event.comment.id),
    get('/pulls/' + number + '/reviews?per_page=100'), get('/rulesets/26004626'),
    get('/pulls/' + number + '/files?per_page=100'), get('/compare/' + cmd.base + '...' + cmd.head),
    get('/contents/.github/workflows?ref=' + cmd.base)
  ]);
  validatePr(pr, main, cmd, number);
  must(compare.merge_base_commit?.sha === cmd.base && compare.behind_by === 0 &&
    compare.ahead_by > 0, 'Head does not contain the current main');
  liveComment(comment, event, number);
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
  const strict = validateRule(rule);
  must(Array.isArray(files) && files.length===pr.changed_files, 'Incomplete changed-file listing');
  const expected = expectedWorkflows(files, policy);
  must(Array.isArray(workflows), 'Workflow directory unavailable');
  const actual = Object.fromEntries(workflows.filter(f=>!SELF.includes(f.path)).map(f=>[f.path,f.sha]));
  must(Object.keys(actual).length===Object.keys(policy.workflowBlobs).length &&
    Object.entries(policy.workflowBlobs).every(([p,sha])=>actual[p]===sha) &&
    SELF.every(p=>workflows.some(f=>f.path===p)), 'Trusted CI workflow set changed: manual gate and policy review required');
  const [runsResult, checksResult] = await Promise.all([
    get('/actions/runs?event=pull_request&head_sha='+cmd.head+'&per_page=100'),
    get('/commits/'+cmd.head+'/check-runs?filter=latest&per_page=100')
  ]);
  const runs = verifiedRuns(complete(runsResult,'workflow_runs'),expected,cmd,number);
  const checks = complete(checksResult,'check_runs');
  must(checks.some(c=>c.name==='CodeQL'&&c.app?.id===57789&&c.head_sha===cmd.head&&
    c.status==='completed'&&c.conclusion==='success'), 'Missing successful CodeQL App check');
  for (const run of runs) {
    const jobs = complete(await get('/actions/runs/'+run.id+'/attempts/'+run.run_attempt+'/jobs?per_page=100'),'jobs');
    const required = REQUIRED_JOBS[run.path] || [];
    must(jobs.length>0&&jobs.some(j=>verifiedJob(j,checks,cmd.head)), 'No verified job: '+run.path);
    for (const name of required) {
      const matches=jobs.filter(j=>j.name===name);
      must(matches.length===1&&verifiedJob(matches[0],checks,cmd.head), 'Required job failed or missing: '+name);
      if (run.path.endsWith('/maestro-e2e.yml')) {
        for (const step of ['Build iOS Test App','Run Smoke Tests','Upload Test Results','Publish Test Results'])
          must(matches[0].steps?.some(s=>s.name===step&&s.conclusion==='success'), 'Maestro step failed or skipped: '+step);
      }
    }
    must(jobs.every(j=>j.status==='completed'&&
      (verifiedJob(j,checks,cmd.head)||j.conclusion==='skipped')), 'Unverified or unsuccessful workflow job: '+run.path);
  }
  return {strict,runs,review,checks,files};
}
function appJwt(key) {
  const now = Math.floor(Date.now()/1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = encode({alg:'RS256',typ:'JWT'})+'.'+encode({iat:now-60,exp:now+540,iss:String(APP_ID)});
  return unsigned+'.'+createSign('RSA-SHA256').update(unsigned).end().sign(key).toString('base64url');
}
async function publish(readToken, event, cmd, number) {
  requirePublicationEnabled();
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
    // Fresh complete verification after acquiring the token, immediately before publication.
    const proof=await verify(readToken,event,cmd,number);
    must(proof.strict,'Enable strict up-to-date status checks; do not disable App gate');
    const externalId=['nuni-gate','v1',number,cmd.head,cmd.base,cmd.reviewId,event.comment.id].join(':');
    const existing=proof.checks.filter(c=>c.name==='審查通過'&&c.app?.id===APP_ID&&
      c.head_sha===cmd.head&&c.status==='completed'&&c.conclusion==='success');
    if (existing.length) {
      must(existing.length===1&&matchesPublishedCheck(existing[0],cmd.head,externalId),
        'Existing successful App check belongs to different or ambiguous evidence; use manual gate');
      console.log('Existing genuine successful App check for this exact attestation; no duplicate published.');
      return;
    }
    const runId = Number(process.env.GITHUB_RUN_ID);
    must(Number.isSafeInteger(runId)&&runId>0,'Missing workflow run ID');
    const details='https://github.com/'+REPO+'/actions/runs/'+runId;
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
    must(result.app?.id===APP_ID&&result.head_sha===cmd.head&&result.conclusion==='success',
      'GitHub did not confirm the required App check');
    console.log('Genuine App check published: '+result.id);
  } finally {
    try { await api(token,'/installation/token','DELETE'); }
    catch { console.warn('Short-lived token revocation failed; token expires automatically.'); }
  }
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
  const token=process.env.GH_READ_TOKEN;
  if(stage==='publish') {
    must(cmd.mode==='approve','Read-only command cannot publish');
    requirePublicationEnabled();
    // Do not even mint a token until the read-only preflight has passed again.
    const proof=await verify(token,event,cmd,number);
    must(proof.strict,'Strict up-to-date ruleset required before publication');
    await publish(token,event,cmd,number);
  } else {
    const proof=await verify(token,event,cmd,number);
    console.log(JSON.stringify({pr:number,head:cmd.head,base:cmd.base,verifiedRuns:proof.runs.map(r=>r.id),
      strict:proof.strict,mode:cmd.mode,publicationAllowed:policy.publicationEnabled===true&&proof.strict&&cmd.mode==='approve'}));
    if(cmd.mode==='approve'){
      requirePublicationEnabled();
      must(proof.strict,'Strict up-to-date ruleset required before publication');
    }
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(e=>{ console.error('Gate denied: '+e.message); process.exitCode=1; });
}
