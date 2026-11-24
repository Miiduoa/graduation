// Isolated adapter; do not register in production until the release gates are met.
import { createHash } from "node:crypto";
const nodeHash=value=>createHash("sha256").update(value).digest("hex");
export function isGoogleLinkRoute(method,path){
  return method==="POST"&&["start","complete","cancel"].some(action=>path==="/v1/auth/platform/account-links/google/"+action);
}
export function registerGoogleLinkRoutes(app,{enabled,accounts,service,hash=nodeHash}={}){
  if(enabled!==true)return false;
  if(typeof accounts?.resolveSession!=="function"||["start","complete","cancel"].some(x=>typeof service?.[x]!=="function")||typeof hash!=="function")
    throw Error("Google link candidate dependencies missing");
  const prefix="/v1/auth/platform/account-links/google/";
  const exactKeys=(body,keys)=>{
    if(!body||typeof body!=="object"||Array.isArray(body))return false;
    const proto=Object.getPrototypeOf(body);
    if(proto!==Object.prototype&&proto!==null)return false;
    const names=Reflect.ownKeys(body);
    return names.length===keys.length&&keys.every(k=>names.includes(k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(body,k),"value"));
  };
  const error=(reply,status,code,message)=>reply.code(status).send({error:{code,message}});
  const invalid=reply=>error(reply,422,"GOOGLE_LINK_INPUT_INVALID","綁定資料不完整，請重新開始。");
  const unauthorized=reply=>error(reply,401,"GOOGLE_LINK_REAUTH_REQUIRED","請重新驗證目前帳號，再綁定 Google。");
  const unavailable=reply=>error(reply,503,"GOOGLE_LINK_UNAVAILABLE","目前無法完成帳號綁定，請稍後再試。");
  const noStore=reply=>{reply.header("Cache-Control","private, no-store");reply.header("Referrer-Policy","no-referrer");};
  for(const [action,keys,limit] of [["start",[],4096],["complete",["transactionId","nonce","idToken"],20000],["cancel",["transactionId","nonce"],4096]]){
    const path=prefix+action;
    app.post(path,{
      bodyLimit:limit,config:{rateLimit:{max:10,timeWindow:"1 minute"}},
      onRequest:async(_request,reply)=>{noStore(reply);}
    },async(request,reply)=>{
      noStore(reply);
      if(request.url!==path)return invalid(reply);
      const authorization=request.headers.authorization;
      if(typeof authorization!=="string"||!/^Platform ps_[A-Za-z0-9_-]{43}$/u.test(authorization))return unauthorized(reply);
      try{
        const resolved=await accounts.resolveSession(authorization);
        if(!resolved||typeof resolved.platformAccountId!=="string"||typeof resolved.credentialId!=="string")return unauthorized(reply);
        // Both the resolver and the hash use the exact same bearer material.
        const actor={platformAccountId:resolved.platformAccountId,credentialId:resolved.credentialId,sessionHash:hash(authorization.slice("Platform ".length))};
        if(!exactKeys(request.body,keys))return invalid(reply);
        return action==="start"?await service.start(actor):await service[action](actor,request.body);
      }catch(e){
        const code=e&&typeof e==="object"?e.code:undefined;
        if(["PLATFORM_SESSION_INVALID","GOOGLE_LINK_REAUTH_REQUIRED","GOOGLE_LINK_INVALID","PLATFORM_IDENTITY_INVALID"].includes(code))return unauthorized(reply);
        if(code==="GOOGLE_LINK_CONFLICT")return error(reply,409,"GOOGLE_LINK_CONFLICT","這個登入方式無法綁定。請使用原本的登入方式或進行帳號復原。");
        if(code==="GOOGLE_LINK_UNAVAILABLE"&&e.statusCode===403)return error(reply,403,"GOOGLE_LINK_UNAVAILABLE","此帳號目前不能使用這個綁定方式。");
        if(["23505","40001","40P01"].includes(code))return error(reply,409,"GOOGLE_LINK_RETRY","帳號狀態已變更，請重新確認再試。");
        // Do not pass raw token, verifier, or SQL errors to the host error logger.
        return unavailable(reply);
      }
    });
  }
  return true;
}
