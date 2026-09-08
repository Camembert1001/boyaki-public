import { finalizeEvent, getPublicKey } from 'https://esm.sh/nostr-tools@2.17.0';

const STAGING_API_BASE='https://vbqitqjhobzpdlaraglc.supabase.co/functions/v1/boyaki-api';
const STAGING_THREAD_API_BASE='https://vbqitqjhobzpdlaraglc.supabase.co/functions/v1/boyaki-thread-api';
const fromHex=hex=>new Uint8Array((hex.match(/.{1,2}/g)||[]).map(b=>parseInt(b,16)));
const unix=()=>Math.floor(Date.now()/1000);

window.BOYAKI_STAGING=true;
window.BOYAKI_ENVIRONMENT='staging';
window.BOYAKI_STAGING_CLIENT_VERSION='20260909-v7';
const robots=document.querySelector('meta[name="robots"]');
if(robots)robots.setAttribute('content','noindex,nofollow');
if(!document.querySelector('[data-boyaki-staging-banner]')){
  const banner=document.createElement('div');
  banner.dataset.boyakiStagingBanner='1';
  banner.textContent='STAGING / E2E TEST — 本番ではありません';
  banner.style.cssText='position:sticky;top:0;z-index:2147483646;padding:8px 12px;text-align:center;font:700 13px/1.3 system-ui;background:#fff3cd;color:#5c4300;border-bottom:1px solid #e5c35c';
  document.body.prepend(banner);
}

function apiBase(){
  const meta=document.querySelector('meta[name="boyaki-staging-api-base"]')?.content?.trim();
  return (window.BOYAKI_STAGING_API_BASE||meta||STAGING_API_BASE).replace(/\/$/,'');
}
function threadApiBase(){return (window.BOYAKI_STAGING_THREAD_API_BASE||STAGING_THREAD_API_BASE).replace(/\/$/,'')}
function identity(){
  const accountHex=localStorage.getItem('boyaki-account-sk')||sessionStorage.getItem('boyaki-account-sk');
  if(accountHex){const sk=fromHex(accountHex);return{sk,pk:getPublicKey(sk),kind:'account'}}
  const legacyHex=localStorage.getItem('boyaki-device-sk');
  if(!legacyHex)return null;
  const sk=fromHex(legacyHex);return{sk,pk:getPublicKey(sk),kind:'legacy_browser'};
}
async function sha256Hex(text){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function b64Utf8(text){const bytes=new TextEncoder().encode(text);let binary='';for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary)}
async function signedHeaders(url,method,rawBody=''){
  const id=identity();if(!id)throw new Error('boyaki_identity_missing');
  const tags=[['u',url],['method',method.toUpperCase()]];if(rawBody)tags.push(['payload',await sha256Hex(rawBody)]);
  const ev=finalizeEvent({kind:27235,created_at:unix(),content:'',tags},id.sk);
  return{Authorization:`Nostr ${b64Utf8(JSON.stringify(ev))}`,'Content-Type':'application/json'};
}
async function requestAt(base,path,{method='GET',body=null,signed=false}={}){
  if(!base)throw new Error('boyaki_staging_api_unconfigured');
  const url=`${base}${path.startsWith('/')?path:`/${path}`}`,rawBody=body===null?'':JSON.stringify(body);
  const headers=signed?await signedHeaders(url,method,rawBody):{'Content-Type':'application/json'};
  const response=await fetch(url,{method,headers,body:rawBody||undefined,cache:'no-store'});let payload={};try{payload=await response.json()}catch{}
  if(!response.ok)throw new Error(payload?.error||`canonical_api_${response.status}`);return payload;
}
const request=(path,options)=>requestAt(apiBase(),path,options),threadRequest=(path,options)=>requestAt(threadApiBase(),path,options);
async function health(){return request('/health')}
async function listPosts(limit=100){return request(`/posts?limit=${Math.max(1,Math.min(Number(limit)||100,100))}`)}
async function listMine(){return request('/me/posts',{signed:true})}
async function createPost(content){const id=identity();if(!id)throw new Error('boyaki_identity_missing');return request('/posts',{method:'POST',signed:true,body:{content,identity_kind:id.kind}})}
async function deletePost(id){return request(`/posts/${encodeURIComponent(id)}`,{method:'DELETE',signed:true})}
async function verifyIdentityLink(legacyClaim,accountAcceptance){return request('/identity-links/verify',{method:'POST',body:{legacy_claim:legacyClaim,account_acceptance:accountAcceptance}})}
async function registerLegacyControl(nostrEvent){return request('/legacy-controls/register',{method:'POST',signed:true,body:{nostr_event:nostrEvent}})}
async function deleteLegacy(eventId){return request(`/legacy/${encodeURIComponent(eventId)}`,{method:'DELETE',signed:true})}
async function legacyControls(ids=[]){const q=ids.filter(Boolean).slice(0,200).join(',');return q?request(`/legacy-controls?ids=${encodeURIComponent(q)}`):{controls:[]}}
async function report(targetType,targetId,reasonCode='other',detail=''){return request('/reports',{method:'POST',signed:true,body:{target_type:targetType,target_id:targetId,reason_code:reasonCode,detail}})}
async function threadHealth(){return threadRequest('/health')}
async function listThread(postId){return threadRequest(`/posts/${encodeURIComponent(postId)}/thread`)}
async function threadAccess(postId){return threadRequest(`/posts/${encodeURIComponent(postId)}/thread/access`,{signed:true})}
async function createThread(postId,eventType,content,parentEventId=null){const id=identity();if(!id)throw new Error('boyaki_identity_missing');return threadRequest(`/posts/${encodeURIComponent(postId)}/thread`,{method:'POST',signed:true,body:{event_type:eventType,content,parent_event_id:parentEventId||null,identity_kind:id.kind}})}
async function deleteThread(eventId){return threadRequest(`/thread/${encodeURIComponent(eventId)}`,{method:'DELETE',signed:true})}
let initPromise=null;
async function initialize(){
  if(window.BOYAKI_CANONICAL_BACKEND_READY===true)return true;if(initPromise)return initPromise;
  initPromise=(async()=>{window.BOYAKI_STAGING_LAST_INIT_ERROR='';try{const state=await health();const ready=state?.ok===true&&state?.canonical_storage===true;window.BOYAKI_CANONICAL_BACKEND_READY=ready;if(!ready)window.BOYAKI_STAGING_LAST_INIT_ERROR='health_not_ready';return ready}catch(err){const code=String(err?.message||err||'unknown_init_error');window.BOYAKI_STAGING_LAST_INIT_ERROR=code;console.warn('staging canonical backend unavailable',err);window.BOYAKI_CANONICAL_BACKEND_READY=false;return false}finally{initPromise=null}})();
  return initPromise;
}
let threadInitPromise=null;
async function initializeThreads(){
  if(window.BOYAKI_CANONICAL_THREAD_BACKEND_READY===true)return true;if(threadInitPromise)return threadInitPromise;
  threadInitPromise=(async()=>{window.BOYAKI_STAGING_LAST_THREAD_INIT_ERROR='';try{const state=await threadHealth();const ready=state?.ok===true&&state?.canonical_threads===true;window.BOYAKI_CANONICAL_THREAD_BACKEND_READY=ready;if(!ready)window.BOYAKI_STAGING_LAST_THREAD_INIT_ERROR='thread_health_not_ready';return ready}catch(err){const code=String(err?.message||err||'unknown_thread_init_error');window.BOYAKI_STAGING_LAST_THREAD_INIT_ERROR=code;console.warn('staging canonical thread backend unavailable',err);window.BOYAKI_CANONICAL_THREAD_BACKEND_READY=false;return false}finally{threadInitPromise=null}})();
  return threadInitPromise;
}
window.BOYAKI_CANONICAL={apiBase,threadApiBase,identity,health,listPosts,listMine,createPost,deletePost,verifyIdentityLink,registerLegacyControl,deleteLegacy,legacyControls,report,threadHealth,listThread,threadAccess,createThread,deleteThread,initialize,initializeThreads};
initialize().then(async ready=>{if(ready){try{await import('./canonical-cutover.js?v=20260909-staging-cutover-v7')}catch(err){window.BOYAKI_STAGING_LAST_INIT_ERROR=`cutover_import:${String(err?.message||err||'unknown')}`;console.error('staging canonical cutover load failed',err)}}});
