import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCommand,expectedWorkflows,verifiedRuns,verifiedJob,validateReview,validateRule,validatePr,policy} from './gate.mjs';

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
test('ruleset must retain exact App; strict false cannot publish',()=>{
  const rule={id:26004626,enforcement:'active',target:'branch',conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},
    bypass_actors:[],rules:[{type:'pull_request'},{type:'required_status_checks',parameters:{strict_required_status_checks_policy:true,required_status_checks:[{context:'審查通過',integration_id:5504170}]}}]};
  assert.equal(validateRule(rule),true);
  const loose=structuredClone(rule);loose.rules[1].parameters.strict_required_status_checks_policy=false;
  assert.equal(validateRule(loose),false);
  const wrong=structuredClone(rule);wrong.rules[1].parameters.required_status_checks[0].integration_id=15368;
  assert.throws(()=>validateRule(wrong));assert.throws(()=>validateRule({...rule,enforcement:'disabled'}));
  assert.throws(()=>validateRule({...rule,bypass_actors:[{actor_id:1}]}));
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
