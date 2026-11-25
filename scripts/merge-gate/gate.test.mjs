import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCommand,expectedWorkflows,verifiedRuns,verifiedJob,validateReview,validateRule,validateNativeRules,NATIVE_CHECKS,validatePr,policy,requirePublicationEnabled,gateExternalId,existingGateDecision,verifyPublishedCheck} from './gate.mjs';

const head='a'.repeat(40), base='b'.repeat(40);
const cmd=parseCommand('/nuni-gate approve '+head+' '+base+' 123');
const ci='.github/workflows/ci.yml';
const run=(id=1,overrides={})=>({id,path:ci,event:'pull_request',head_sha:head,
  repository:{id:1190179363},head_repository:{id:1190179363},run_attempt:1,status:'completed',conclusion:'success',
  pull_requests:[{number:1,head:{sha:head},base:{sha:base,ref:'main'}}],...overrides});
test('parse exact authorized command',()=>assert.deepEqual(cmd,{mode:'approve',head,base,reviewId:123}));
test('reject extra lines, abbreviated SHA, overflow and shell input',()=>{
  for(const c of ['/nuni-gate approve '+head+' '+base+' 123\nextra','/nuni-gate approve aaa '+base+' 123',
    '/nuni-gate approve '+head+' '+base+' 9999999999999999','/nuni-gate check '+head+' '+base+' 12;echo x'])
    assert.throws(()=>parseCommand(c));
});
test('mobile and map require their specific workflows',()=>{
  const paths=expectedWorkflows([{filename:policy.pilotFiles[5],status:'modified'},{filename:policy.pilotFiles[8],status:'modified'}],policy);
  for(const p of ['ci','codeql','course-access-review','maestro-e2e','mobile-agent-regression','campus-spatial-browser'])
    assert(paths.includes('.github/workflows/'+p+'.yml'));
});
test('reject workflow, auth, rename, deletion, or duplicate changes',()=>{
  for(const files of [[{filename:'.github/workflows/ci.yml',status:'modified'}],
    [{filename:'apps/web/src/app/auth/account/page.tsx',status:'modified'}],
    [{filename:policy.pilotFiles[0],status:'renamed',previous_filename:'.github/workflows/ci.yml'}],
    [{filename:policy.pilotFiles[0],status:'removed'}],
    [{filename:policy.pilotFiles[0],status:'added'},{filename:policy.pilotFiles[0],status:'modified'}]])
    assert.throws(()=>expectedWorkflows(files,policy));
});
test('exact latest successful run; missing, stale, fork, failed and skipped denied',()=>{
  assert.equal(verifiedRuns([run()],[ci],cmd,1).length,1);
  for(const runs of [[],[run(1,{head_sha:base})],[run(1,{head_repository:{id:999}})],
    [run(1,{pull_requests:[{number:1,head:{sha:head},base:{sha:head,ref:'main'}}]})],
    [run(1,{conclusion:'skipped'})],[run(),run(2,{conclusion:'failure'})],
    [run(),run(1,{run_attempt:2,status:'in_progress',conclusion:null})]])
    assert.throws(()=>verifiedRuns(runs,[ci],cmd,1));
});
test('only optional skipped preview is excluded, never counted as pass',()=>{
  assert.equal(verifiedRuns([run(),run(2,{path:'.github/workflows/preview-deploy.yml',conclusion:'skipped'})],[ci],cmd,1).length,1);
  assert.throws(()=>verifiedRuns([run(),run(2,{path:'.github/workflows/preview-deploy.yml',conclusion:'failure'})],[ci],cmd,1));
});
test('job check must match exact ID, head and GitHub Actions app',()=>{
  const job={id:5,head_sha:head,status:'completed',conclusion:'success'};
  const check={id:5,head_sha:head,status:'completed',conclusion:'success',app:{id:15368}};
  assert(verifiedJob(job,[check],head));
  for(const bad of [{...check,id:6},{...check,head_sha:base},{...check,app:{id:5504170}},{...check,conclusion:'skipped'}])
    assert(!verifiedJob(job,[bad],head));
});
test('review attestation must be exact owner, SHA, base, fresh command and detailed body',()=>{
  const comment={created_at:'2026-11-25T08:00:00Z'};
  const review={id:123,user:{id:107848266},author_association:'OWNER',state:'COMMENTED',commit_id:head,
    submitted_at:'2026-11-25T07:00:00Z',body:'nuni-gate-review v1 head='+head+' base='+base+' outcome=pass\n'+'Review scope, concrete findings, tests and residual risks. '.repeat(4)};
  assert.doesNotThrow(()=>validateReview(review,cmd,107848266,comment));
  for(const bad of [{...review,user:{id:1}},{...review,commit_id:base},{...review,state:'DISMISSED'},
    {...review,body:'pass'},{...review,submitted_at:'2026-11-25T09:00:00Z'}])
    assert.throws(()=>validateReview(bad,cmd,107848266,comment));
});
function protectedRule() {
  return {id:26004626,enforcement:'active',target:'branch',conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},
    bypass_actors:[],rules:[
      {type:'pull_request',parameters:{required_review_thread_resolution:true}},
      {type:'required_status_checks', parameters:{strict_required_status_checks_policy:true,required_status_checks:structuredClone(NATIVE_CHECKS)}},
    ]};
}
test('only explicit no-bypass, thread resolution and strict source-bound native checks authorize the pilot',()=>{
  assert.doesNotThrow(()=>validateRule(protectedRule()));
  for (const bypass_actors of [undefined,null,{},false,[{actor_id:1}]]) {
    assert.throws(()=>validateRule({...protectedRule(),bypass_actors}));
  }
  const incomplete=protectedRule();delete incomplete.bypass_actors;
  assert.throws(()=>validateRule(incomplete));
  assert.doesNotThrow(()=>validateNativeRules(incomplete)); // preparation only
  for (const change of [r=>r.enforcement='disabled',r=>r.conditions.ref_name.exclude=['refs/heads/main'],
    r=>r.rules[0].parameters.required_review_thread_resolution=false,
    r=>r.rules[1].parameters.strict_required_status_checks_policy=false]) {
    const rule=protectedRule();change(rule);assert.throws(()=>validateRule(rule));
  }
  for (const {context} of NATIVE_CHECKS) {
    const missing=protectedRule();
    const checks=missing.rules[1].parameters.required_status_checks;
    checks.splice(checks.findIndex(c=>c.context===context),1);
    assert.throws(()=>validateRule(missing));
    const wrong=protectedRule();
    wrong.rules[1].parameters.required_status_checks.find(c=>c.context===context).integration_id=42;
    assert.throws(()=>validateRule(wrong));
  }
});
test('PR must remain open, ready, conflict-free, same repository and exact base/head',()=>{
  const pr={number:1,state:'open',draft:false,mergeable:true,head:{sha:head,repo:{id:1190179363}},base:{sha:base,ref:'main',repo:{id:1190179363}}};
  const main={commit:{sha:base}};
  assert.doesNotThrow(()=>validatePr(pr,main,cmd,1));
  for(const bad of [{...pr,draft:true},{...pr,mergeable:false},{...pr,state:'closed'},
    {...pr,head:{sha:head,repo:{id:1}}},{...pr,base:{...pr.base,sha:head}}])
    assert.throws(()=>validatePr(bad,main,cmd,1));
  assert.throws(()=>validatePr(pr,{commit:{sha:head}},cmd,1));
});

const commentId=777, prNumber=1, runUrl=id=>'https://github.com/Miiduoa/graduation/actions/runs/'+id;
const extId=gateExternalId(prNumber,cmd,commentId);
const gateCheck=(overrides={})=>({id:9,name:'審查通過',app:{id:5504170},head_sha:head,status:'completed',
  conclusion:'success',external_id:extId,details_url:runUrl(100),...overrides});
const decide=checks=>existingGateDecision(checks,cmd,prNumber,commentId,runUrl(100));
test('retry of the same workflow run and command reuses the exact App check',()=>{
  assert.equal(decide([gateCheck()]),'reuse');
  assert.throws(()=>decide([gateCheck({details_url:runUrl(1)})]));
});
test('only absence of a genuine App check permits creation',()=>{
  assert.equal(decide([]),'publish');
  assert.equal(decide([gateCheck({app:{id:15368}})]),'publish');
  assert.equal(decide([gateCheck({app:undefined})]),'publish');
  assert.throws(()=>decide([gateCheck({conclusion:'failure'})]));
  assert.equal(decide([gateCheck({name:'other'})]),'publish');
});
test('existing App success with wrong PR, base, review, command or run URL is rejected',()=>{
  const other=(n,h,b,r,c)=>['nuni-gate','v2',n,h,b,r,c].join(':');
  for(const bad of [other(2,head,base,123,commentId),other(1,head,head,123,commentId),
    other(1,head,base,124,commentId),other(1,head,base,123,778),other(1,base,base,123,commentId),
    extId.replace('v2','v1'),extId+':x',undefined,''])
    assert.throws(()=>decide([gateCheck({external_id:bad})]));
  for(const url of [undefined,'',runUrl('0'),runUrl('01'),runUrl('-1'),runUrl('1.5'),runUrl('1')+'/',runUrl('1')+'?x=1',
    runUrl('1')+'/attempts/1',runUrl('9'.repeat(20)),'http://github.com/Miiduoa/graduation/actions/runs/1',
    'https://github.com/Other/graduation/actions/runs/1','https://github.com/miiduoa/graduation/actions/runs/1',
    'https://api.github.com/repos/Miiduoa/graduation/actions/runs/1'])
    assert.throws(()=>decide([gateCheck({details_url:url})]));
});
test('existing App success with missing or wrong status, head or id is rejected',()=>{
  for(const bad of [{head_sha:base},{head_sha:undefined},{status:'in_progress'},{status:undefined},{id:0},{id:undefined}])
    assert.throws(()=>decide([gateCheck(bad)]));
});
test('ambiguous or mixed existing App checks are rejected',()=>{
  assert.throws(()=>decide([gateCheck(),gateCheck({id:10})]));
  assert.throws(()=>decide([gateCheck(),gateCheck({id:10,external_id:'other'})]));
  assert.throws(()=>decide([gateCheck(),gateCheck({id:10,conclusion:'failure'})]));
  assert.throws(()=>decide([gateCheck(),gateCheck({id:10,status:'in_progress',conclusion:null})]));
  assert.throws(()=>decide(undefined));
  assert.equal(decide([gateCheck(),gateCheck({id:10,app:{id:15368},external_id:'x'})]),'reuse');
});
test('POST response must be the exact completed success App check',()=>{
  const details=runUrl(200), result={id:11,name:'審查通過',app:{id:5504170},head_sha:head,status:'completed',
    conclusion:'success',external_id:extId,details_url:details};
  assert.doesNotThrow(()=>verifyPublishedCheck(result,cmd,extId,details));
  for(const bad of [{app:{id:15368}},{app:undefined},{head_sha:base},{status:'queued'},{conclusion:'failure'},
    {name:'x'},{external_id:'x'},{details_url:runUrl(201)},{details_url:undefined},{id:undefined},{id:0}])
    assert.throws(()=>verifyPublishedCheck({...result,...bad},cmd,extId,details));
  assert.throws(()=>verifyPublishedCheck(null,cmd,extId,details));
  assert.throws(()=>verifyPublishedCheck(result,cmd,extId,runUrl('0')));
});

test('the committed pilot remains on hold pending independent live acceptance', () => {
  assert.equal(policy.publicationEnabled, false);
  assert.throws(requirePublicationEnabled, /Publication disabled/);
});
