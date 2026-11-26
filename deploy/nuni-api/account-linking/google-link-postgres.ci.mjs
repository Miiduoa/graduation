// Explicit CI-only integration. No production connection, no production migrations.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createGoogleLinkService } from "./google-link-service.mjs";
import { registerGoogleLinkRoutes } from "./google-link-routes.mjs";

const url=process.env.GOOGLE_LINK_TEST_DATABASE_URL;
const deps=process.env.GOOGLE_LINK_TEST_DEPS;
if(url!=="postgresql://cafeteria_test:cafeteria_test_only@127.0.0.1:5432/cafeteria_test"||!deps)
  throw Error("Use only the explicitly configured isolated CI PostgreSQL service");
const require=createRequire(import.meta.url);
const {Pool}=require(join(deps,"pg"));
const Fastify=require(join(deps,"fastify"));
const hash=x=>createHash("sha256").update(x).digest("hex");
const issuer="https://accounts.google.com";
const idToken="synthetic-verified-token-for-db-contract-only";
// Execute complete, byte-pinned source migrations instead of hand-maintained
// platform table subsets. Only the two campus FK parent keys are synthetic.
// This remains an isolated selected-schema fixture, not a reconstructed API.
const fixtureManifest=JSON.parse(await readFile(new URL("./test-fixtures/source.json",import.meta.url),"utf8"));
assert.equal(fixtureManifest.schema,"campus.google-link-postgres-fixture/v1");
const platformMigrations=await Promise.all(fixtureManifest.migrations.map(async entry=>{
  assert.match(entry.file,/^[0-9]{3}_[a-z_]+\.sql$/u);
  const bytes=await readFile(new URL("./test-fixtures/"+entry.file,import.meta.url));
  assert.equal(hash(bytes),entry.sha256,entry.file+" SHA-256 drift");
  const blob=createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
  assert.equal(blob,entry.gitBlobSha1,entry.file+" source Git blob drift");
  return bytes.toString("utf8");
}));
const baseSchema=`
CREATE TABLE tenants(id text PRIMARY KEY);
CREATE TABLE identity_subjects(tenant_id text NOT NULL REFERENCES tenants(id),id text NOT NULL,PRIMARY KEY(tenant_id,id));
${platformMigrations.join("\n")}
INSERT INTO platform_identity_providers(kind,issuer,client_id,jwks_uri,authorization_endpoint,token_endpoint,state)
VALUES('google-consumer','https://accounts.google.com',
 'test.apps.googleusercontent.com','https://www.googleapis.com/oauth2/v3/certs',
 'https://accounts.google.com/o/oauth2/v2/auth','https://oauth2.googleapis.com/token','enabled');
`;

test("Google link candidate PostgreSQL and Fastify contract",{timeout:60000},async t=>{
  const schema="google_link_test_"+randomUUID().replaceAll("-","");
  const pool=new Pool({connectionString:url,max:8,connectionTimeoutMillis:5000,statement_timeout:10000});
  let created=false;
  t.after(async()=>{try{if(created)await pool.query("DROP SCHEMA "+schema+" CASCADE");}finally{await pool.end();}});
  await pool.query("CREATE SCHEMA "+schema);created=true;
  const db={transaction:async run=>{
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path TO "+schema+", pg_catalog");
      const value=await run(client);
      await client.query("COMMIT");return value;
    }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  }};
  await db.transaction(async tx=>{
    await tx.query(baseSchema);
    await tx.query(await readFile(new URL("./schema.candidate.sql",import.meta.url),"utf8"));
  });
  async function makeActor(){
    const platformAccountId="pa_"+randomUUID(),credentialId="pac_"+randomUUID();
    const handle="ps_"+randomBytes(32).toString("base64url"),sessionHash=hash(handle);
    await db.transaction(async tx=>{
      await tx.query("INSERT INTO platform_accounts(id,display_name) VALUES($1,'Synthetic account')",[platformAccountId]);
      await tx.query("INSERT INTO platform_account_credentials(id,platform_account_id,method,provider_issuer,provider_subject,verified_at,last_authenticated_at) VALUES($1,$2,'apple','https://appleid.apple.com',$3,now(),now())",[credentialId,platformAccountId,randomUUID()]);
      await tx.query("INSERT INTO platform_account_sessions(token_sha256,platform_account_id,credential_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[sessionHash,platformAccountId,credentialId]);
    });
    return {platformAccountId,credentialId,sessionHash,authorization:"Platform "+handle};
  }
  async function closeActor(actor){
    // Synthetic closure uses the pinned service's account-first lock order and
    // schema-valid state transitions; this does not invoke the production host.
    await db.transaction(async tx=>{
      await tx.query("SELECT id FROM platform_accounts WHERE id=$1 FOR UPDATE",[actor.platformAccountId]);
      await tx.query("UPDATE platform_accounts SET state='deleted',deleted_at=clock_timestamp(),suspended_at=NULL,updated_at=clock_timestamp() WHERE id=$1",[actor.platformAccountId]);
      await tx.query("UPDATE platform_account_credentials SET state='revoked',revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE platform_account_id=$1 AND state='active'",[actor.platformAccountId]);
      await tx.query("DELETE FROM platform_account_sessions WHERE platform_account_id=$1",[actor.platformAccountId]);
    });
  }
  const verified=subject=>({method:"google",providerIssuer:issuer,providerSubject:subject,email:"fixture@example.test",emailVerified:true});
  const verifier=subject=>({verify:async()=>verified(subject)});
  const begin=async(service,actor)=>{const x=await service.start(actor);return {transactionId:x.transactionId,nonce:x.nonce,idToken};};
  const cancelInput=({transactionId,nonce})=>({transactionId,nonce});
  const credentials=subject=>db.transaction(async tx=>(await tx.query("SELECT platform_account_id,state FROM platform_account_credentials WHERE provider_issuer=$1 AND provider_subject=$2",[issuer,subject])).rows);
  await t.test("platform constraints reject invalid fixture states and proofs",async constraints=>{
    const actor=await makeActor();
    await db.transaction(tx=>tx.query("INSERT INTO platform_operator_assignments(platform_account_id,role_key,state) VALUES($1,'platform-operator','active')",[actor.platformAccountId]));
    const cases=[
      ["unknown account state","UPDATE platform_accounts SET state='closed' WHERE id=$1",[actor.platformAccountId]],
      ["deleted account without timestamp","UPDATE platform_accounts SET state='deleted' WHERE id=$1",[actor.platformAccountId]],
      ["suspended account without timestamp","UPDATE platform_accounts SET state='suspended' WHERE id=$1",[actor.platformAccountId]],
      ["revoked credential without timestamp","UPDATE platform_account_credentials SET state='revoked' WHERE id=$1",[actor.credentialId]],
      ["empty provider subject","UPDATE platform_account_credentials SET provider_subject='' WHERE id=$1",[actor.credentialId]],
      ["unsupported credential method","UPDATE platform_account_credentials SET method='unsupported' WHERE id=$1",[actor.credentialId]],
      ["nonpositive session lifetime","UPDATE platform_account_sessions SET expires_at=created_at WHERE token_sha256=$1",[actor.sessionHash]],
      ["untrusted Google provider endpoint","UPDATE platform_identity_providers SET jwks_uri='https://untrusted.example/keys' WHERE kind='google-consumer'",[]],
      ["unsupported operator role","UPDATE platform_operator_assignments SET role_key='unsupported' WHERE platform_account_id=$1",[actor.platformAccountId]],
      ["revoked operator without timestamp","UPDATE platform_operator_assignments SET state='revoked' WHERE platform_account_id=$1",[actor.platformAccountId]],
    ];
    for(const [name,sql,parameters] of cases)await constraints.test(name,async()=>{
      await assert.rejects(()=>db.transaction(async tx=>{
        await tx.query(sql,parameters);
        // Roll back even if a weakened fixture accidentally accepts this invalid row.
        assert.fail("Platform fixture accepted "+name);
      }),{code:"23514"});
    });
  });
  await t.test("two accounts racing for one Google subject cannot both claim it",async()=>{
    const a=await makeActor(),b=await makeActor(),subject="race-"+randomUUID();
    const one=createGoogleLinkService({db,verifier:verifier(subject)}),two=createGoogleLinkService({db,verifier:verifier(subject)});
    const [x,y]=await Promise.all([begin(one,a),begin(two,b)]);
    const outcomes=await Promise.allSettled([one.complete(a,x),two.complete(b,y)]);
    const success=outcomes.filter(o=>o.status==="fulfilled"),failure=outcomes.filter(o=>o.status==="rejected");
    assert.equal(success.length,1);assert.equal(failure.length,1);assert.equal(failure[0].reason.code,"GOOGLE_LINK_CONFLICT");
    assert.deepEqual(await credentials(subject),[{platform_account_id:success[0].value.platformAccountId,state:"active"}]);
    await assert.rejects(()=>one.complete(a,x),{code:"GOOGLE_LINK_INVALID"});
    await assert.rejects(()=>two.complete(b,y),{code:"GOOGLE_LINK_INVALID"});
  });
  await t.test("duplicate callbacks commit exactly once",async()=>{
    const actor=await makeActor(),subject="duplicate-"+randomUUID();
    const service=createGoogleLinkService({db,verifier:verifier(subject)}),input=await begin(service,actor);
    const results=await Promise.allSettled([service.complete(actor,input),service.complete(actor,input)]);
    assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
    assert.equal(results.find(x=>x.status==="rejected").reason.code,"GOOGLE_LINK_INVALID");
    assert.deepEqual(await credentials(subject),[{platform_account_id:actor.platformAccountId,state:"active"}]);
    assert.deepEqual(await service.cancel(actor,cancelInput(input)),{status:"not-pending"});
  });
  await t.test("cancelling, logging out or closing the account during verification prevents linking",async()=>{
    for(const mode of ["cancel","logout","close"]){
      const actor=await makeActor(),subject=mode+"-"+randomUUID();
      let enter,release;
      const entered=new Promise(r=>{enter=r;});
      const gate=new Promise(r=>{release=r;});
      const service=createGoogleLinkService({db,verifier:{verify:async()=>{enter();await gate;return verified(subject);}}});
      const input=await begin(service,actor);
      const completion=service.complete(actor,input);
      // Observe both success and failure immediately while verification is in flight.
      const outcome=completion.then(value=>({value}),error=>({error}));
      try{
        const ready=await Promise.race([entered.then(()=>true),outcome.then(()=>false)]);
        assert.equal(ready,true);
        if(mode==="cancel")assert.deepEqual(await service.cancel(actor,cancelInput(input)),{status:"cancelled"});
        else if(mode==="close")await closeActor(actor);
        else await db.transaction(tx=>tx.query("DELETE FROM platform_account_sessions WHERE token_sha256=$1",[actor.sessionHash]));
      }finally{release();}
      assert.equal((await outcome).error?.code,mode==="logout"?"GOOGLE_LINK_REAUTH_REQUIRED":"GOOGLE_LINK_INVALID");
      assert.deepEqual(await credentials(subject),[]);
    }
  });
  await t.test("inventory reads the authenticated account without changing pending link state",async()=>{
    const actor=await makeActor(),other=await makeActor(),subject="inventory-"+randomUUID();
    let verificationCount=0;
    const service=createGoogleLinkService({db,verifier:{verify:async()=>{verificationCount++;return verified(subject);}}});
    const expected={platformAccountId:actor.platformAccountId,currentMethod:"apple",methods:["apple"],googleLink:"available"};
    const transactions=()=>db.transaction(async tx=>(await tx.query("SELECT * FROM platform_google_link_transactions WHERE platform_account_id=$1",[actor.platformAccountId])).rows);
    assert.deepEqual(await service.status(actor),expected);
    assert.deepEqual(await transactions(),[]);
    const input=await begin(service,actor),pending=await transactions();
    assert.equal(pending.length,1);
    assert.deepEqual(await service.status(actor),expected);
    assert.deepEqual(await transactions(),pending);
    assert.equal(verificationCount,0);
    await assert.rejects(()=>service.status({...actor,sessionHash:other.sessionHash}),{code:"GOOGLE_LINK_REAUTH_REQUIRED"});
    await assert.rejects(()=>service.status({...actor,platformAccountId:other.platformAccountId}),{code:"GOOGLE_LINK_INVALID"});
    assert.deepEqual(await service.status(other),{...expected,platformAccountId:other.platformAccountId});
    await service.complete(actor,input);
    assert.deepEqual(await service.status(actor),{...expected,methods:["google","apple"],googleLink:"linked"});
    // A read from the second account does not disclose the first account's new credential.
    assert.deepEqual(await service.status(other),{...expected,platformAccountId:other.platformAccountId});
    assert.equal(verificationCount,1);
  });
  await t.test("inventory reports step-up, revoked credentials and logout from real database state",async()=>{
    const actor=await makeActor(),subject="inventory-revocation-"+randomUUID();
    const service=createGoogleLinkService({db,verifier:verifier(subject)});
    await db.transaction(tx=>tx.query("UPDATE platform_account_sessions SET created_at=clock_timestamp()-interval '10 minutes' WHERE token_sha256=$1",[actor.sessionHash]));
    assert.equal((await service.status(actor)).googleLink,"reauth-required");
    await assert.rejects(()=>service.start(actor),{code:"GOOGLE_LINK_REAUTH_REQUIRED"});
    await db.transaction(tx=>tx.query("UPDATE platform_account_sessions SET created_at=clock_timestamp() WHERE token_sha256=$1",[actor.sessionHash]));
    const input=await begin(service,actor);await service.complete(actor,input);
    await db.transaction(tx=>tx.query("UPDATE platform_account_credentials SET state='revoked',revoked_at=clock_timestamp() WHERE platform_account_id=$1 AND method='google'",[actor.platformAccountId]));
    assert.deepEqual(await service.status(actor),{platformAccountId:actor.platformAccountId,currentMethod:"apple",methods:["apple"],googleLink:"unavailable"});
    await db.transaction(tx=>tx.query("UPDATE platform_account_credentials SET state='revoked',revoked_at=clock_timestamp() WHERE id=$1",[actor.credentialId]));
    await assert.rejects(()=>service.status(actor),{code:"GOOGLE_LINK_INVALID"});
    const loggedOut=await makeActor();await db.transaction(tx=>tx.query("DELETE FROM platform_account_sessions WHERE token_sha256=$1",[loggedOut.sessionHash]));
    await assert.rejects(()=>service.status(loggedOut),{code:"GOOGLE_LINK_REAUTH_REQUIRED"});
    const closed=await makeActor();await closeActor(closed);
    await assert.rejects(()=>service.status(closed),{code:"GOOGLE_LINK_INVALID"});
  });
  await t.test("writes reject malformed current proof and future sessions without changing pending work",async()=>{
    for(const mode of ["issuer","subject","future"]){
      const actor=await makeActor(),subject="write-proof-"+randomUUID();
      let verificationCount=0;
      const service=createGoogleLinkService({db,verifier:{verify:async()=>{verificationCount++;return verified(subject);}}});
      const input=await begin(service,actor);
      const transactions=()=>db.transaction(async tx=>(await tx.query("SELECT * FROM platform_google_link_transactions WHERE platform_account_id=$1",[actor.platformAccountId])).rows);
      const pending=await transactions();
      await db.transaction(tx=>mode==="issuer"?
        tx.query("UPDATE platform_account_credentials SET provider_issuer='https://untrusted.example' WHERE id=$1",[actor.credentialId]):
        mode==="subject"?tx.query("UPDATE platform_account_credentials SET provider_subject=' padded-subject ' WHERE id=$1",[actor.credentialId]):
        tx.query("UPDATE platform_account_sessions SET created_at=clock_timestamp()+interval '1 minute' WHERE token_sha256=$1",[actor.sessionHash]));
      const code=mode==="future"?"GOOGLE_LINK_REAUTH_REQUIRED":"GOOGLE_LINK_INVALID";
      await assert.rejects(()=>service.status(actor),{code});
      await assert.rejects(()=>service.start(actor),{code});
      await assert.rejects(()=>service.complete(actor,input),{code});
      await assert.rejects(()=>service.cancel(actor,cancelInput(input)),{code});
      assert.equal(verificationCount,0);assert.deepEqual(await transactions(),pending);assert.deepEqual(await credentials(subject),[]);
    }
  });
  await t.test("writes recheck current proof and future session time after provider verification",async()=>{
    for(const mode of ["issuer","future"]){
      const actor=await makeActor(),subject="write-proof-race-"+randomUUID();
      const service=createGoogleLinkService({db,verifier:{verify:async()=>{
        await db.transaction(tx=>mode==="issuer"?
          tx.query("UPDATE platform_account_credentials SET provider_issuer='https://untrusted.example' WHERE id=$1",[actor.credentialId]):
          tx.query("UPDATE platform_account_sessions SET created_at=clock_timestamp()+interval '1 minute' WHERE token_sha256=$1",[actor.sessionHash]));
        return verified(subject);
      }}});
      const input=await begin(service,actor);
      const transactions=()=>db.transaction(async tx=>(await tx.query("SELECT * FROM platform_google_link_transactions WHERE platform_account_id=$1",[actor.platformAccountId])).rows);
      const pending=await transactions();
      await assert.rejects(()=>service.complete(actor,input),{code:mode==="issuer"?"GOOGLE_LINK_INVALID":"GOOGLE_LINK_REAUTH_REQUIRED"});
      assert.deepEqual(await transactions(),pending);assert.deepEqual(await credentials(subject),[]);
    }
  });
  await t.test("actual HTTP status-only rollout leaves every link write route absent",async()=>{
    const actor=await makeActor(),service=createGoogleLinkService({db,verifier:verifier("read-only-fact-"+randomUUID())});
    let sessionReads=0;
    const accounts={resolveSession:async authorization=>{
      sessionReads+=1;assert.equal(authorization,actor.authorization);
      return {platformAccountId:actor.platformAccountId,credentialId:actor.credentialId};
    }};
    const app=Fastify({logger:false});
    try{
      assert.equal(registerGoogleLinkRoutes(app,{enabled:true,accounts,service:{status:service.status}}),true);
      const prefix="/v1/auth/platform/account-links/google/";
      const read=await app.inject({method:"GET",url:prefix+"status",headers:{authorization:actor.authorization}});
      assert.equal(read.statusCode,200);
      assert.deepEqual(read.json(),{platformAccountId:actor.platformAccountId,currentMethod:"apple",methods:["apple"],googleLink:"unavailable"});
      assert.match(read.headers["cache-control"],/no-store/u);
      for(const action of ["start","complete","cancel"]){
        const response=await app.inject({method:"POST",url:prefix+action,headers:{authorization:actor.authorization},payload:{}});
        assert.equal(response.statusCode,404);
      }
      assert.equal(sessionReads,1);
      const rows=await db.transaction(async tx=>({
        pending:(await tx.query("SELECT count(*)::integer AS count FROM platform_google_link_transactions WHERE platform_account_id=$1",[actor.platformAccountId])).rows[0].count,
        credentials:(await tx.query("SELECT count(*)::integer AS count FROM platform_account_credentials WHERE platform_account_id=$1",[actor.platformAccountId])).rows[0].count
      }));
      assert.deepEqual(rows,{pending:0,credentials:1});
      // Seed a completed link through the service fixture; the read-only adapter still reports that fact.
      await service.complete(actor,await begin(service,actor));
      const linked=await app.inject({method:"GET",url:prefix+"status",headers:{authorization:actor.authorization}});
      assert.equal(linked.statusCode,200);
      assert.deepEqual(linked.json(),{platformAccountId:actor.platformAccountId,currentMethod:"apple",methods:["google","apple"],googleLink:"linked"});
    }finally{await app.close();}
  });
  await t.test("actual HTTP route binds to current session instead of request JSON",async()=>{
    const actor=await makeActor(),subject="http-"+randomUUID();
    const service=createGoogleLinkService({db,verifier:verifier(subject)});
    const accounts={resolveSession:async authorization=>{
      if(authorization!==actor.authorization)throw Object.assign(new Error("fixture auth"),{code:"PLATFORM_SESSION_INVALID"});
      return {platformAccountId:actor.platformAccountId,credentialId:actor.credentialId};
    }};
    const app=Fastify({logger:false});
    try{
      assert.equal(registerGoogleLinkRoutes(app,{enabled:true,writesEnabled:true,accounts,service}),true);
      const prefix="/v1/auth/platform/account-links/google/";
      const request=(path,payload,authorization=actor.authorization)=>app.inject({method:"POST",url:prefix+path,headers:{authorization},payload});
      const status=(options={})=>app.inject({method:"GET",url:prefix+"status",headers:{authorization:actor.authorization},...options});
      const initialStatus=await status();assert.equal(initialStatus.statusCode,200);
      assert.deepEqual(initialStatus.json(),{platformAccountId:actor.platformAccountId,currentMethod:"apple",methods:["apple"],googleLink:"available"});
      assert.match(initialStatus.headers["cache-control"],/no-store/u);
      assert.equal(initialStatus.headers["referrer-policy"],"no-referrer");
      assert.equal((await status({url:prefix+"status?account=other"})).statusCode,422);
      assert.equal((await status({payload:{platformAccountId:"other"}})).statusCode,422);
      assert.equal((await status({headers:{authorization:"Platform ps_"+"z".repeat(43)}})).statusCode,401);
      assert.equal((await status({method:"HEAD"})).statusCode,404);
      assert.equal((await request("status",{})).statusCode,404);
      assert.equal((await request("start",{},"Platform ps_"+"z".repeat(43))).statusCode,401);
      assert.equal((await request("start",{platformAccountId:"other"})).statusCode,422);
      const start=await request("start",{});assert.equal(start.statusCode,200);
      assert.match(start.headers["cache-control"],/no-store/u);
      const {transactionId,nonce}=start.json();
      const complete=await request("complete",{transactionId,nonce,idToken});
      assert.equal(complete.statusCode,200);
      assert.deepEqual(complete.json(),{status:"linked",platformAccountId:actor.platformAccountId});
      assert.deepEqual(await credentials(subject),[{platform_account_id:actor.platformAccountId,state:"active"}]);
      const linkedStatus=await status();assert.equal(linkedStatus.statusCode,200);
      assert.deepEqual(linkedStatus.json(),{platformAccountId:actor.platformAccountId,currentMethod:"apple",methods:["google","apple"],googleLink:"linked"});
      await db.transaction(tx=>tx.query("DELETE FROM platform_account_sessions WHERE token_sha256=$1",[actor.sessionHash]));
      const loggedOutStatus=await status();assert.equal(loggedOutStatus.statusCode,401);
      assert.equal(loggedOutStatus.json().platformAccountId,undefined);
      assert.match(loggedOutStatus.headers["cache-control"],/no-store/u);
    }finally{await app.close();}
  });
});
