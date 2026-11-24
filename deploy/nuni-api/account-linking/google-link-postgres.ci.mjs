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
// Minimal fixture mirroring the relevant migration 146 uniqueness/FK contracts.
// NOT a reconstructed production schema or an authorization grant receipt.
const baseSchema=`
CREATE TABLE platform_accounts(id text PRIMARY KEY,state text NOT NULL DEFAULT 'active');
CREATE TABLE platform_account_credentials(
 id text PRIMARY KEY,platform_account_id text NOT NULL REFERENCES platform_accounts(id),
 method text NOT NULL,provider_issuer text NOT NULL,provider_subject text NOT NULL,
 email_at_registration text,email_verified boolean NOT NULL DEFAULT false,
 state text NOT NULL DEFAULT 'active',verified_at timestamptz NOT NULL,last_authenticated_at timestamptz NOT NULL,
 UNIQUE(provider_issuer,provider_subject),UNIQUE(id,platform_account_id)
);
CREATE TABLE platform_account_sessions(
 token_sha256 text PRIMARY KEY,platform_account_id text NOT NULL REFERENCES platform_accounts(id),
 credential_id text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(credential_id,platform_account_id) REFERENCES platform_account_credentials(id,platform_account_id)
);
CREATE TABLE platform_operator_assignments(platform_account_id text PRIMARY KEY REFERENCES platform_accounts(id),state text NOT NULL,role_key text NOT NULL);
CREATE TABLE platform_identity_providers(kind text PRIMARY KEY,issuer text NOT NULL,client_id text NOT NULL,
 jwks_uri text NOT NULL,authorization_endpoint text NOT NULL,token_endpoint text NOT NULL,state text NOT NULL);
INSERT INTO platform_identity_providers VALUES('google-consumer','https://accounts.google.com',
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
      await tx.query("INSERT INTO platform_accounts(id) VALUES($1)",[platformAccountId]);
      await tx.query("INSERT INTO platform_account_credentials(id,platform_account_id,method,provider_issuer,provider_subject,verified_at,last_authenticated_at) VALUES($1,$2,'apple','https://appleid.apple.com',$3,now(),now())",[credentialId,platformAccountId,randomUUID()]);
      await tx.query("INSERT INTO platform_account_sessions(token_sha256,platform_account_id,credential_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[sessionHash,platformAccountId,credentialId]);
    });
    return {platformAccountId,credentialId,sessionHash,authorization:"Platform "+handle};
  }
  const verified=subject=>({method:"google",providerIssuer:issuer,providerSubject:subject,email:"fixture@example.test",emailVerified:true});
  const verifier=subject=>({verify:async()=>verified(subject)});
  const begin=async(service,actor)=>{const x=await service.start(actor);return {transactionId:x.transactionId,nonce:x.nonce,idToken};};
  const cancelInput=({transactionId,nonce})=>({transactionId,nonce});
  const credentials=subject=>db.transaction(async tx=>(await tx.query("SELECT platform_account_id,state FROM platform_account_credentials WHERE provider_issuer=$1 AND provider_subject=$2",[issuer,subject])).rows);
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
  await t.test("cancelling or logging out during provider verification prevents linking",async()=>{
    for(const mode of ["cancel","logout"]){
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
        else await db.transaction(tx=>tx.query("DELETE FROM platform_account_sessions WHERE token_sha256=$1",[actor.sessionHash]));
      }finally{release();}
      assert.equal((await outcome).error?.code,mode==="cancel"?"GOOGLE_LINK_INVALID":"GOOGLE_LINK_REAUTH_REQUIRED");
      assert.deepEqual(await credentials(subject),[]);
    }
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
      assert.equal(registerGoogleLinkRoutes(app,{enabled:true,accounts,service}),true);
      const prefix="/v1/auth/platform/account-links/google/";
      const request=(path,payload,authorization=actor.authorization)=>app.inject({method:"POST",url:prefix+path,headers:{authorization},payload});
      assert.equal((await request("start",{},"Platform ps_"+"z".repeat(43))).statusCode,401);
      assert.equal((await request("start",{platformAccountId:"other"})).statusCode,422);
      const start=await request("start",{});assert.equal(start.statusCode,200);
      assert.match(start.headers["cache-control"],/no-store/u);
      const {transactionId,nonce}=start.json();
      const complete=await request("complete",{transactionId,nonce,idToken});
      assert.equal(complete.statusCode,200);
      assert.deepEqual(complete.json(),{status:"linked",platformAccountId:actor.platformAccountId});
      assert.deepEqual(await credentials(subject),[{platform_account_id:actor.platformAccountId,state:"active"}]);
    }finally{await app.close();}
  });
});
