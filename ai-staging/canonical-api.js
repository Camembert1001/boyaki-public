import { finalizeEvent, getPublicKey, generateSecretKey } from 'https://esm.sh/nostr-tools@2.17.0';
const API='https://vbqitqjhobzpdlaraglc.supabase.co/functions/v1/ai-staging-boyaki-api';
const THREAD='https://vbqitqjhobzpdlaraglc.supabase.co/functions/v1/ai-staging-boyaki-thread-api';
const store=window.BOYAKI_STORAGE;
export const fromHex=h=>new Uint8Array((h.match(/.{1,2}/g)||[]).map(b=>parseInt(b,16)));
export const toHex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
window.BOYAKI_AI_STAGING_CLIENT_VERSION='20260918-ai-v1';
function identity(){
  const h=store.local.getItem('boyaki-account-sk')||store.session.getItem('boyaki-account-sk');
  if(h){const sk=fromHex(h);return{sk,pk:getPublicKey(sk),kind:'account'}}
  let device=store.local.getItem('boyaki-device-sk');if(!device){device=toHex(generateSecretKey());store.local.setItem('boyaki-device-sk',device)}
  const sk=fromHex(device);return{sk,pk:getPublicKey(sk),kind:'legacy_browser'};
}
async function sha(s){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return toHex(new Uint8Array(d))}
async function headers(url,method,raw,signer){
  const i=signer||identity(),tags=[['u',url],['method',method],['nonce',crypto.randomUUID()]];
  if(raw)tags.push(['payload',await sha(raw)]);
  const e=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:'',tags},i.sk);
  return{Authorization:`Nostr ${btoa(JSON.stringify(e))}`,'Content-Type':'application/json'};
}
async function req(base,path,{method='GET',body=null,signed=false,signer=null}={}){
  const url=base+path,raw=body===null?'':JSON.stringify(body),h=signed?await headers(url,method,raw,signer):{'Content-Type':'application/json'};
  const r=await fetch(url,{method,headers:h,body:raw||undefined,cache:'no-store'}),p=await r.json();
  if(!r.ok)throw Error(p?.error||`ai_api_${r.status}`);return p;
}
const main=(p,o)=>req(API,p,o),thread=(p,o)=>req(THREAD,p,o);
async function initialize(){try{const h=await main('/health');return window.BOYAKI_CANONICAL_BACKEND_READY=h.ok===true&&h.environment==='AI-STAGING'}catch(e){window.BOYAKI_AI_STAGING_LAST_INIT_ERROR=String(e.message);return window.BOYAKI_CANONICAL_BACKEND_READY=false}}
async function initializeThreads(){try{const h=await thread('/health');return window.BOYAKI_CANONICAL_THREAD_BACKEND_READY=h.ok===true&&h.environment==='AI-STAGING'}catch(e){window.BOYAKI_AI_STAGING_LAST_THREAD_INIT_ERROR=String(e.message);return window.BOYAKI_CANONICAL_THREAD_BACKEND_READY=false}}
export const client={
  apiBase:()=>API,threadApiBase:()=>THREAD,identity,initialize,initializeThreads,
  health:()=>main('/health'),threadHealth:()=>thread('/health'),
  getAccount:(signer=null)=>main('/me/account',{signed:true,signer}),
  saveAccount:(profile,signer=null)=>main('/me/account',{method:'POST',signed:true,signer,body:{profile}}),
  listPosts:(n=100)=>main(`/posts?limit=${Math.max(1,Math.min(Number(n)||100,100))}`),
  listMine:()=>main('/me/posts',{signed:true}),
  createPost:content=>main('/posts',{method:'POST',signed:true,body:{content,identity_kind:identity().kind}}),
  deletePost:id=>main(`/posts/${encodeURIComponent(id)}`,{method:'DELETE',signed:true}),
  verifyIdentityLink:(legacy_claim,account_acceptance)=>main('/identity-links/verify',{method:'POST',body:{legacy_claim,account_acceptance}}),
  report:(target_type,target_id,reason_code='other',detail='')=>main('/reports',{method:'POST',signed:true,body:{target_type,target_id,reason_code,detail}}),
  listThread:id=>thread(`/posts/${encodeURIComponent(id)}/thread`),
  threadAccess:id=>thread(`/posts/${encodeURIComponent(id)}/thread/access`,{signed:true}),
  createThread:(id,event_type,content,parent_event_id=null,extra={})=>thread(`/posts/${encodeURIComponent(id)}/thread`,{method:'POST',signed:true,body:{...extra,event_type,content,parent_event_id,identity_kind:identity().kind}}),
  deleteThread:id=>thread(`/thread/${encodeURIComponent(id)}`,{method:'DELETE',signed:true})
};
window.BOYAKI_CANONICAL=client;
if(document.querySelector('#feed'))initialize().then(async ok=>{if(ok)await import('./canonical-cutover.js?v=20260918-ai-v1')}).catch(e=>console.error('AI-STAGING initialization failed',e));
