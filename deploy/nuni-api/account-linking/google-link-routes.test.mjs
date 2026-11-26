import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerGoogleLinkRoutes,isGoogleLinkRoute } from "./google-link-routes.mjs";
async function routeChecks(register,classify,hash){
  const passed=[],check=(x,msg)=>{if(!x)throw Error(msg);};
  const routes=new Map(),calls=[],app={post:(p,o,f)=>routes.set(p,{o,f,method:"POST"}),get:(p,o,f)=>routes.set(p,{o,f,method:"GET"})};
  const prefix="/v1/auth/platform/account-links/google/",auth="Platform ps_"+"a".repeat(43);
  let failure;
  const accounts={resolveSession:async a=>{calls.push(["auth",a]);return {platformAccountId:"server-account",credentialId:"server-credential",sessionHash:"ignored"};}};
  const act=name=>async(actor,body)=>{calls.push([name,actor,body]);if(failure)throw failure;return {status:name};};
  const service={start:act("start"),complete:act("complete"),cancel:act("cancel"),status:act("status")};
  check(register(app,{enabled:false})===false&&routes.size===0,"disabled");passed.push("disabled by default");
  check(register(app,{enabled:true,writesEnabled:true,accounts,service,hash})===true&&routes.size===4,"registration");passed.push("three dedicated writes and one read-only status route");
  check(classify("POST",prefix+"complete")&&!classify("GET",prefix+"complete")&&!classify("POST",prefix+"complete/")&&!classify("POST",prefix+"complete?x=y"),"classification");passed.push("exact route classification");
  async function invoke(name,authorization,body,url=prefix+name,extraHeaders={}){
    const r=routes.get(prefix+name),headers={};
    const reply={status:200,header(k,v){headers[k]=v;return this;},code(n){this.status=n;return this;},send(v){this.value=v;return this;}};
    const request={url,headers:{authorization,...extraHeaders},body};
    await r.o.onRequest(request,reply);const value=await r.f(request,reply);
    return {status:reply.status,body:value===reply?reply.value:value,headers};
  }
  const noAuth=await invoke("start",undefined,{});
  check(noAuth.status===401&&calls.length===0&&noAuth.headers["Cache-Control"]==="private, no-store","auth");passed.push("no session no service call");
  check((await invoke("start",auth,{},prefix+"start?account=other")).status===422&&calls.length===0,"query");
  check((await invoke("start",auth,{platformAccountId:"other"})).status===422&&calls.length===1,"body actor");passed.push("reject query and client actor");
  check((await invoke("start",auth,{})).status===200&&calls.at(-1)[1].sessionHash===hash(auth.slice(9))&&calls.at(-1)[1].platformAccountId==="server-account","actor");passed.push("actor derived from verified session");
  const body={transactionId:"gl_x",nonce:"nonce",idToken:"token"};
  check((await invoke("complete",auth,body)).status===200&&calls.at(-1)[0]==="complete","complete");
  check((await invoke("cancel",auth,{transactionId:"gl_x",nonce:"nonce"})).status===200&&calls.at(-1)[0]==="cancel","cancel");passed.push("separate complete and cancel");
  const before=calls.length;check((await invoke("complete",auth,{...body,subject:"other"})).status===422&&calls.length===before+1,"identity");passed.push("reject untrusted identity");
  failure=Object.assign(new Error("SECRET raw token"),{code:"GOOGLE_LINK_CONFLICT"});
  const conflict=await invoke("complete",auth,body);check(conflict.status===409&&!JSON.stringify(conflict).includes("SECRET"),"conflict");
  failure=new Error("SECRET SQL detail");
  const down=await invoke("complete",auth,body);check(down.status===503&&!JSON.stringify(down).includes("SECRET"),"leak");passed.push("sanitized conflicts and unknown errors");
  failure=Object.assign(new Error("provider detail"),{code:"PLATFORM_IDENTITY_INVALID"});check((await invoke("complete",auth,body)).status===401,"invalid proof");
  failure=Object.assign(new Error("db detail"),{code:"40P01"});check((await invoke("complete",auth,body)).status===409,"contention");passed.push("safe proof and contention failures");
  failure=undefined;
  check(classify("GET",prefix+"status")&&!classify("POST",prefix+"status")&&!classify("HEAD",prefix+"status")&&
    !classify("GET",prefix+"status?account=other")&&!classify("GET",prefix+"status/")&&
    routes.get(prefix+"status").method==="GET"&&routes.get(prefix+"status").o.exposeHeadRoute===false,"status classification");
  passed.push("status is an exact GET without automatic HEAD");
  const beforeStatus=calls.length,status=await invoke("status",auth,undefined);
  check(status.status===200&&calls.length===beforeStatus+2&&calls.at(-1)[0]==="status"&&calls.at(-1)[2]===undefined&&
    calls.at(-1)[1].sessionHash===hash(auth.slice(9))&&status.headers["Cache-Control"]==="private, no-store"&&
    status.headers["Referrer-Policy"]==="no-referrer","status actor");passed.push("status uses verified server actor and private no-store headers");
  const beforeInvalidStatus=calls.length;
  for(const args of [[undefined,prefix+"status?platformAccountId=other",{}],[{},prefix+"status",{}],
    [undefined,prefix+"status",{"content-length":"2"}],[undefined,prefix+"status",{"transfer-encoding":"chunked"}]])
    check((await invoke("status",auth,...args)).status===422,"status input");
  check(calls.length===beforeInvalidStatus,"status input called service");passed.push("status cannot take body query or encoded payload");
  const beforeUnsigned=calls.length;
  check((await invoke("status",undefined,undefined)).status===401&&calls.length===beforeUnsigned,"status auth");
  failure=Object.assign(new Error("session raw secret"),{code:"GOOGLE_LINK_REAUTH_REQUIRED"});
  const revoked=await invoke("status",auth,undefined);
  check(revoked.status===401&&!JSON.stringify(revoked).includes("raw secret"),"status revoked");passed.push("status refuses missing or revoked sessions");
  failure=new Error("SQL secret");const unreadable=await invoke("status",auth,undefined);
  check(unreadable.status===503&&!JSON.stringify(unreadable).includes("SQL secret"),"status unavailable");
  check(routes.get(prefix+"status").o.config.rateLimit.max===10,"status rate limit");passed.push("status limits polling and sanitizes unknown errors");
  return passed;
}
test("isolated Google link route handlers",async t=>{
  const passed=await routeChecks(registerGoogleLinkRoutes,isGoogleLinkRoute,v=>createHash("sha256").update(v).digest("hex"));
  for(const name of passed)t.diagnostic(name);
  if(passed.length!==15)throw Error("missing checks");
});

test("enabling status alone never registers or offers writes and preserves linked facts",async()=>{
  for(const writesEnabled of [undefined,false,"true"]){
    const routes=[];
    let statusHandler,statusSnapshot;
    const app={get:(path,_options,handler)=>{routes.push(["GET",path]);statusHandler=handler;},post:(path)=>routes.push(["POST",path])};
    const options={enabled:true,accounts:{resolveSession:async()=>({platformAccountId:"server-account",credentialId:"server-credential"})},service:{status:async()=>statusSnapshot}};
    if(writesEnabled!==undefined)options.writesEnabled=writesEnabled;
    assert.equal(registerGoogleLinkRoutes(app,options),true);
    assert.deepEqual(routes,[["GET","/v1/auth/platform/account-links/google/status"]]);
    for(const googleLink of ["available","reauth-required","linked","restricted","unavailable"]){
      statusSnapshot={platformAccountId:"server-account",currentMethod:"apple",methods:googleLink==="linked"?["google","apple"]:["apple"],googleLink};
      const request={url:"/v1/auth/platform/account-links/google/status",headers:{authorization:"Platform ps_"+"a".repeat(43)}};
      const reply={header(){return this;},code(){return this;},send(value){return value;}};
      assert.deepEqual(await statusHandler(request,reply),{...statusSnapshot,
        googleLink:["available","reauth-required"].includes(googleLink)?"unavailable":googleLink});
      assert.equal(statusSnapshot.googleLink,googleLink);
    }
  }
  assert.throws(()=>registerGoogleLinkRoutes({},{enabled:true,writesEnabled:true,
    accounts:{resolveSession:async()=>({})},service:{status:async()=>({})}}),/dependencies missing/u);
});
