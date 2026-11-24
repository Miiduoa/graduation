import test from "node:test";
import assert from "node:assert/strict";
import { createGoogleLinkService } from "./google-link-service.mjs";
// This suite uses a transactional SQL fixture, not PostgreSQL or real Google.
function makeFixture(createService, crypto) {
  const actor={platformAccountId:"pa_00000000-0000-4000-8000-000000000001",credentialId:"pac_00000000-0000-4000-8000-000000000001",sessionHash:"a".repeat(64)};
  const googleIssuer="https://accounts.google.com";
  const state={
    active:true,fresh:true,operator:false,enabled:true,sessionActive:true,credentialActive:true,sessionFuture:false,
    currentCredential:{id:actor.credentialId,account:actor.platformAccountId,method:"apple",provider_issuer:"https://appleid.apple.com",provider_subject:"apple-subject",state:"active",verified_at:"2026-01-01T00:00:00Z"},
    provider:{issuer:googleIssuer,client_id:"test.apps.googleusercontent.com",jwks_uri:"https://www.googleapis.com/oauth2/v3/certs",authorization_endpoint:"https://accounts.google.com/o/oauth2/v2/auth",token_endpoint:"https://oauth2.googleapis.com/token"},
    transactions:[],credentials:[],identity:{method:"google",providerIssuer:googleIssuer,providerSubject:"google-subject",email:"same@example.test",emailVerified:true},
    verifyCalls:0,beforeVerify:null,queries:[]
  };
  const db={transaction:async run=>{
    const tx={query:async (sql,args=[])=>{
      const tag=sql.match(/\/\* link:([a-z-]+) \*\//u)?.[1];
      state.queries.push(tag);
      const one=(v)=>({rows:v?[v]:[]});
      if(tag==="account")return one(state.active&&args[0]===actor.platformAccountId?{id:args[0]}:null);
      if(tag==="credential")return one(state.credentialActive&&args[0]===actor.credentialId&&args[1]===actor.platformAccountId?{...state.currentCredential}:null);
      if(tag==="session")return one(state.sessionActive&&state.fresh&&!state.sessionFuture&&args[0]===actor.sessionHash&&args[1]===actor.platformAccountId&&args[2]===actor.credentialId?{token_sha256:args[0]}:null);
      if(tag==="status-account")return one(state.active&&args[0]===actor.platformAccountId?{id:args[0]}:null);
      if(tag==="status-credential")return one(state.credentialActive&&args[0]===actor.credentialId&&args[1]===actor.platformAccountId?{...state.currentCredential}:null);
      if(tag==="status-session")return one(state.sessionActive&&!state.sessionFuture&&args[0]===actor.sessionHash&&args[1]===actor.platformAccountId&&args[2]===actor.credentialId?{fresh:state.fresh}:null);
      if(tag==="status-methods")return {rows:[state.currentCredential,...state.credentials].filter(x=>x.account===args[0]&&["google","apple"].includes(x.method)).slice(0,17)};
      if(tag==="operator")return one(state.operator?{one:1}:null);
      if(tag==="provider")return one(state.enabled?{...state.provider}:null);
      if(tag==="replace"){state.transactions=[];return one(null);}
      if(tag==="create"){state.transactions.push({args:[...args],consumed:false,expired:false});return one(null);}
      if(tag==="cancel"){
        const index=state.transactions.findIndex(x=>!x.consumed&&!x.expired&&args.every((v,i)=>v===x.args[i]));
        if(index<0)return one(null);
        state.transactions.splice(index,1);
        return one({token_sha256:args[0]});
      }
      if(tag==="pending"||tag==="consume"){
        const row=state.transactions.find(x=>!x.consumed&&!x.expired&&x.args.every((v,i)=>v===args[i]));
        if(row&&tag==="consume")row.consumed=true;
        return one(row?{token_sha256:args[0]}:null);
      }
      if(tag==="own-google")return {rows:state.credentials.filter(x=>x.account===args[0]&&x.method==="google")};
      if(tag==="insert"){
        if(state.credentials.some(x=>x.provider_issuer===args[2]&&x.provider_subject===args[3]))return one(null);
        state.credentials.push({id:args[0],account:args[1],method:"google",provider_issuer:args[2],provider_subject:args[3],state:"active",email:args[4],verified_at:"2026-01-01T00:00:00Z"});
        return one({id:args[0]});
      }
      throw Error("unexpected SQL "+tag);
    }};
    // Roll back fixture writes on a thrown transaction, like the production transaction contract.
    const snapshot=JSON.stringify({transactions:state.transactions,credentials:state.credentials});
    try{return await run(tx);}catch(e){Object.assign(state,JSON.parse(snapshot));throw e;}
  }};
  const verifier={verify:async input=>{state.verifyCalls++;if(input.kind!=="google-consumer"||input.issuer!==googleIssuer||!input.expectedNonce)throw Error("wrong verifier request");if(state.beforeVerify)await state.beforeVerify();return {...state.identity};}};
  const service=createService({db,verifier,...(crypto?{crypto}:{})});
  const begin=async()=>{const x=await service.start(actor);return {transactionId:x.transactionId,nonce:x.nonce,idToken:"fixture-signed-token-not-a-real-jwt".repeat(2)};};
  return {actor,state,service,begin};
}
async function exercise(createService, crypto) {
  const results=[];
  const equal=(a,b)=>{if(a!==b)throw Error("expected "+JSON.stringify(b)+" got "+JSON.stringify(a));};
  const rejects=async(fn,code)=>{try{await fn();}catch(e){equal(e.code,code);return;}throw Error("expected rejection "+code);};
  const add=(s,account,subject,state="active")=>s.credentials.push({account,method:"google",provider_issuer:"https://accounts.google.com",provider_subject:subject,state,email:"same@example.test"});
  async function run(name,fn){await fn(makeFixture(createService,crypto));results.push(name);}
  await run("links verified Google to existing account without creating a new account",async({actor,state,service,begin})=>{
    const input=await begin();const result=await service.complete(actor,input);equal(result.status,"linked");equal(result.platformAccountId,actor.platformAccountId);equal(state.credentials.length,1);equal(state.credentials[0].account,actor.platformAccountId);
    await rejects(()=>service.complete(actor,input),"GOOGLE_LINK_INVALID");equal(state.verifyCalls,1);
  });
  await run("same subject and same account is idempotent with a new transaction",async({actor,state,service,begin})=>{
    add(state,actor.platformAccountId,"google-subject");equal((await service.complete(actor,await begin())).status,"already-linked");equal(state.credentials.length,1);
  });
  await run("other account subject conflict is consumed and does not merge",async({actor,state,service,begin})=>{
    add(state,"other-account","google-subject");const input=await begin();await rejects(()=>service.complete(actor,input),"GOOGLE_LINK_CONFLICT");equal(state.credentials.length,1);equal(state.credentials[0].account,"other-account");await rejects(()=>service.complete(actor,input),"GOOGLE_LINK_INVALID");
  });
  await run("matching email is not identity",async({actor,state,service,begin})=>{
    add(state,"other-account","different-subject");equal((await service.complete(actor,await begin())).status,"linked");equal(state.credentials.length,2);equal(state.credentials[0].account,"other-account");
  });
  await run("different or revoked Google credential cannot be replaced",async({actor,state,service,begin})=>{
    add(state,actor.platformAccountId,"different-subject");await rejects(async()=>service.complete(actor,await begin()),"GOOGLE_LINK_CONFLICT");state.credentials=[];add(state,actor.platformAccountId,"google-subject","revoked");await rejects(async()=>service.complete(actor,await begin()),"GOOGLE_LINK_CONFLICT");
  });
  await run("wrong nonce and switched session fail before verifier",async({actor,state,service,begin})=>{
    const input=await begin();await rejects(()=>service.complete(actor,{...input,nonce:"z".repeat(43)}),"GOOGLE_LINK_INVALID");await rejects(()=>service.complete({...actor,sessionHash:"b".repeat(64)},input),"GOOGLE_LINK_REAUTH_REQUIRED");equal(state.verifyCalls,0);
  });
  await run("starting a new request invalidates the old request",async({actor,service,begin})=>{
    const old=await begin();const newer=await begin();await rejects(()=>service.complete(actor,old),"GOOGLE_LINK_INVALID");equal((await service.complete(actor,newer)).status,"linked");
  });
  await run("expired request and non-fresh session rejected",async({actor,state,service,begin})=>{
    const input=await begin();state.transactions[0].expired=true;await rejects(()=>service.complete(actor,input),"GOOGLE_LINK_INVALID");state.fresh=false;await rejects(()=>service.start(actor),"GOOGLE_LINK_REAUTH_REQUIRED");
  });
  await run("account closure or session revocation during verifier cannot link",async({actor,state,service,begin})=>{
    const input=await begin();state.beforeVerify=()=>{state.active=false;};await rejects(()=>service.complete(actor,input),"GOOGLE_LINK_INVALID");equal(state.credentials.length,0);
  });
  await run("changed provider or disabled provider fails closed",async({actor,state,service,begin})=>{
    const input=await begin();state.beforeVerify=()=>{state.provider.client_id="changed.apps.googleusercontent.com";};await rejects(()=>service.complete(actor,input),"GOOGLE_LINK_INVALID");equal(state.credentials.length,0);state.enabled=false;await rejects(()=>service.start(actor),"GOOGLE_LINK_UNAVAILABLE");
  });
  await run("operator and untrusted issuer rejected",async({actor,state,service,begin})=>{
    state.operator=true;await rejects(()=>service.start(actor),"GOOGLE_LINK_UNAVAILABLE");state.operator=false;const input=await begin();state.identity.providerIssuer="https://evil.example";await rejects(()=>service.complete(actor,input),"GOOGLE_LINK_INVALID");equal(state.credentials.length,0);
  });
  await run("raw input cannot select a target account and unverified email is not stored",async({actor,state,service,begin})=>{
    const input=await begin();await rejects(()=>service.complete(actor,{...input,platformAccountId:"other"}),"GOOGLE_LINK_INVALID");state.identity.emailVerified=false;equal((await service.complete(actor,input)).status,"linked");equal(state.credentials[0].email,null);
  });
  await run("cancel only the current pending transaction, even if Google is disabled",async({actor,state,service,begin})=>{
    const old=await begin(),current=await begin();
    const body=x=>({transactionId:x.transactionId,nonce:x.nonce});
    equal((await service.cancel(actor,body(old))).status,"not-pending");
    state.enabled=false;equal((await service.cancel(actor,body(current))).status,"cancelled");
    state.enabled=true;await rejects(()=>service.complete(actor,current),"GOOGLE_LINK_INVALID");equal(state.credentials.length,0);
  });
  await run("cancel during verification cannot link",async({actor,state,service,begin})=>{
    const input=await begin();
    state.beforeVerify=async()=>{equal((await service.cancel(actor,{transactionId:input.transactionId,nonce:input.nonce})).status,"cancelled");};
    await rejects(()=>service.complete(actor,input),"GOOGLE_LINK_INVALID");equal(state.credentials.length,0);
  });
  await run("cancel after completion never unlinks the credential",async({actor,state,service,begin})=>{
    const input=await begin();await service.complete(actor,input);
    equal((await service.cancel(actor,{transactionId:input.transactionId,nonce:input.nonce})).status,"not-pending");
    equal(state.credentials.length,1);
  });
  return results;
}
test("Google link candidate behavioral contract", async t => {
  const passed = await exercise(createGoogleLinkService);
  for (const name of passed) t.diagnostic(name);
  if (passed.length !== 15) throw Error("missing checks");
});

test("link writes require the same trusted current proof as status", async t => {
  await t.test("malformed current credential cannot start, complete or cancel pending work",async()=>{
    for(const change of [{method:"school"},{provider_issuer:"https://untrusted.example"},{verified_at:null},
      {state:"revoked"},{provider_subject:""},{provider_subject:" padded "},
      {provider_subject:"bad\u0000subject"},{provider_subject:"s".repeat(256)}]){
      const {actor,state,service,begin}=makeFixture(createGoogleLinkService);
      const input=await begin(),pending=structuredClone(state.transactions);
      Object.assign(state.currentCredential,change);
      await assert.rejects(()=>service.start(actor),{code:"GOOGLE_LINK_INVALID"});
      await assert.rejects(()=>service.complete(actor,input),{code:"GOOGLE_LINK_INVALID"});
      await assert.rejects(()=>service.cancel(actor,{transactionId:input.transactionId,nonce:input.nonce}),{code:"GOOGLE_LINK_INVALID"});
      assert.equal(state.verifyCalls,0);assert.deepEqual(state.transactions,pending);assert.deepEqual(state.credentials,[]);
    }
  });
  await t.test("a future-dated session cannot satisfy freshness for any operation",async()=>{
    const {actor,state,service,begin}=makeFixture(createGoogleLinkService);
    const input=await begin(),pending=structuredClone(state.transactions);state.sessionFuture=true;
    await assert.rejects(()=>service.status(actor),{code:"GOOGLE_LINK_REAUTH_REQUIRED"});
    await assert.rejects(()=>service.start(actor),{code:"GOOGLE_LINK_REAUTH_REQUIRED"});
    await assert.rejects(()=>service.complete(actor,input),{code:"GOOGLE_LINK_REAUTH_REQUIRED"});
    await assert.rejects(()=>service.cancel(actor,{transactionId:input.transactionId,nonce:input.nonce}),{code:"GOOGLE_LINK_REAUTH_REQUIRED"});
    assert.equal(state.verifyCalls,0);assert.deepEqual(state.transactions,pending);assert.deepEqual(state.credentials,[]);
  });
  await t.test("current proof and session time are checked again after remote verification",async()=>{
    for(const mode of ["credential","session"]){
      const {actor,state,service,begin}=makeFixture(createGoogleLinkService);
      const input=await begin(),pending=structuredClone(state.transactions);
      state.beforeVerify=()=>{if(mode==="credential")state.currentCredential.provider_issuer="https://untrusted.example";else state.sessionFuture=true;};
      await assert.rejects(()=>service.complete(actor,input),{code:mode==="credential"?"GOOGLE_LINK_INVALID":"GOOGLE_LINK_REAUTH_REQUIRED"});
      assert.equal(state.verifyCalls,1);assert.deepEqual(state.transactions,pending);assert.deepEqual(state.credentials,[]);
    }
  });
});

test("authenticated login-method inventory", async t => {
  const fixture=()=>makeFixture(createGoogleLinkService);
  const google=(f,overrides={})=>({id:"pac_00000000-0000-4000-8000-000000000002",account:f.actor.platformAccountId,
    method:"google",provider_issuer:"https://accounts.google.com",provider_subject:"private-google-subject",
    state:"active",verified_at:"2026-01-01T00:00:00Z",email:"private@example.test",...overrides});
  await t.test("reads only this account's verified active methods without changing pending work",async()=>{
    const f=fixture(),{actor,state,service,begin}=f;
    state.credentials.push(google(f,{account:"other-account"}));
    const beforeStart=await service.status(actor);
    assert.deepEqual(beforeStart,{platformAccountId:actor.platformAccountId,currentMethod:"apple",methods:["apple"],googleLink:"available"});
    assert.deepEqual(state.transactions,[]);
    const input=await begin(),pending=structuredClone(state.transactions);
    state.queries=[];
    assert.deepEqual(await service.status(actor),beforeStart);
    assert.deepEqual(state.transactions,pending);
    assert.equal(state.verifyCalls,0);
    assert.deepEqual(state.queries,["status-account","status-credential","status-session","status-methods","operator","provider"]);
    state.credentials=[];
    assert.equal((await service.complete(actor,input)).status,"linked");
    const linked=await service.status(actor);
    assert.deepEqual(linked,{platformAccountId:actor.platformAccountId,currentMethod:"apple",methods:["google","apple"],googleLink:"linked"});
    assert.equal(JSON.stringify(linked).includes("private"),false);
    assert.equal(Object.hasOwn(linked,"credentialId"),false);
  });
  await t.test("an older active session can read but must reauthenticate before linking",async()=>{
    const {actor,state,service}=fixture();state.fresh=false;
    assert.equal((await service.status(actor)).googleLink,"reauth-required");
    assert.deepEqual(state.transactions,[]);
    await assert.rejects(()=>service.start(actor),{code:"GOOGLE_LINK_REAUTH_REQUIRED"});
  });
  await t.test("linked status survives old sessions and provider unavailability",async()=>{
    const f=fixture();f.state.credentials.push(google(f));f.state.fresh=false;f.state.enabled=false;
    assert.equal((await f.service.status(f.actor)).googleLink,"linked");
  });
  await t.test("the current Google method is reported from its verified credential",async()=>{
    const f=fixture();f.state.currentCredential=google(f,{id:f.actor.credentialId});
    assert.deepEqual(await f.service.status(f.actor),{platformAccountId:f.actor.platformAccountId,currentMethod:"google",methods:["google"],googleLink:"linked"});
  });
  await t.test("operator restriction and provider failures never advertise a new link",async()=>{
    const {actor,state,service}=fixture();state.operator=true;
    assert.equal((await service.status(actor)).googleLink,"restricted");
    state.operator=false;state.enabled=false;
    assert.equal((await service.status(actor)).googleLink,"unavailable");
    state.enabled=true;state.provider.issuer="https://untrusted.example";
    assert.equal((await service.status(actor)).googleLink,"unavailable");
  });
  await t.test("revoked, unverified, malformed, conflicting or duplicate Google history cannot be replaced",async()=>{
    for(const rows of [[{state:"revoked"}],[{verified_at:null}],[{provider_issuer:"https://untrusted.example"}],
      [{provider_subject:" "}],[{}, {provider_subject:"another-google"}],[{}, {state:"revoked",provider_subject:"old-google"}]]){
      const f=fixture();f.state.credentials.push(...rows.map(row=>google(f,row)));
      assert.equal((await f.service.status(f.actor)).googleLink,"unavailable");
      assert.deepEqual(f.state.transactions,[]);
    }
  });
  await t.test("cross-account and cross-session substitutions cannot query another account",async()=>{
    const {actor,service}=fixture();
    await assert.rejects(()=>service.status({...actor,platformAccountId:"pa_00000000-0000-4000-8000-000000000009"}),{code:"GOOGLE_LINK_INVALID"});
    await assert.rejects(()=>service.status({...actor,credentialId:"pac_00000000-0000-4000-8000-000000000009"}),{code:"GOOGLE_LINK_INVALID"});
    await assert.rejects(()=>service.status({...actor,sessionHash:"b".repeat(64)}),{code:"GOOGLE_LINK_REAUTH_REQUIRED"});
  });
  await t.test("closed accounts and revoked sessions or credentials immediately lose the read",async()=>{
    for(const field of ["active","credentialActive","sessionActive"]){
      const {actor,state,service}=fixture();state[field]=false;
      await assert.rejects(()=>service.status(actor),{code:field==="sessionActive"?"GOOGLE_LINK_REAUTH_REQUIRED":"GOOGLE_LINK_INVALID"});
    }
  });
  await t.test("untrusted current proof is rejected even if the resolver supplied an account",async()=>{
    for(const change of [{method:"school"},{provider_issuer:"https://other.example"},{verified_at:null},{state:"revoked"}]){
      const {actor,state,service}=fixture();Object.assign(state.currentCredential,change);
      await assert.rejects(()=>service.status(actor),{code:"GOOGLE_LINK_INVALID"});
    }
  });
  await t.test("excessive inventory fails without returning a partial linked-method list",async()=>{
    const f=fixture();f.state.credentials=Array.from({length:16},(_,i)=>google(f,{provider_subject:"subject-"+i}));
    await assert.rejects(()=>f.service.status(f.actor),{code:"GOOGLE_LINK_UNAVAILABLE"});
  });
});

