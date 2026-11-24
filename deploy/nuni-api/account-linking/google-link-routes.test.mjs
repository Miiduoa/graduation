import test from "node:test";
import { createHash } from "node:crypto";
import { registerGoogleLinkRoutes,isGoogleLinkRoute } from "./google-link-routes.mjs";
async function routeChecks(register,classify,hash){
  const passed=[],check=(x,msg)=>{if(!x)throw Error(msg);};
  const routes=new Map(),calls=[],app={post:(p,o,f)=>routes.set(p,{o,f})};
  const prefix="/v1/auth/platform/account-links/google/",auth="Platform ps_"+"a".repeat(43);
  let failure;
  const accounts={resolveSession:async a=>{calls.push(["auth",a]);return {platformAccountId:"server-account",credentialId:"server-credential",sessionHash:"ignored"};}};
  const act=name=>async(actor,body)=>{calls.push([name,actor,body]);if(failure)throw failure;return {status:name};};
  const service={start:act("start"),complete:act("complete"),cancel:act("cancel")};
  check(register(app,{enabled:false})===false&&routes.size===0,"disabled");passed.push("disabled by default");
  check(register(app,{enabled:true,accounts,service,hash})===true&&routes.size===3,"registration");passed.push("only three dedicated routes");
  check(classify("POST",prefix+"complete")&&!classify("GET",prefix+"complete")&&!classify("POST",prefix+"complete/")&&!classify("POST",prefix+"complete?x=y"),"classification");passed.push("exact route classification");
  async function invoke(name,authorization,body,url=prefix+name){
    const r=routes.get(prefix+name),headers={};
    const reply={status:200,header(k,v){headers[k]=v;return this;},code(n){this.status=n;return this;},send(v){this.value=v;return this;}};
    const request={url,headers:{authorization},body};
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
  return passed;
}
test("isolated Google link route handlers",async t=>{
  const passed=await routeChecks(registerGoogleLinkRoutes,isGoogleLinkRoute,v=>createHash("sha256").update(v).digest("hex"));
  for(const name of passed)t.diagnostic(name);
  if(passed.length!==10)throw Error("missing checks");
});
