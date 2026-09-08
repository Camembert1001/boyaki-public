import { finalizeEvent, getPublicKey } from 'https://esm.sh/nostr-tools@2.17.0';

const DEFAULT_API_BASE='https://uvjyponltgoytjzwkfrh.supabase.co/functions/v1/boyaki-api';
const fromHex=hex=>new Uint8Array((hex.match(/.{1,2}/g)||[]).map(b=>parseInt(b,16)));
const unix=()=>Math.floor(Date.now()/1000);

function apiBase(){
  const meta=document.querySelector('meta[name="boyaki-api-base"]')?.content?.trim();
  return (window.BOYAKI_CANONICAL_API_BASE||meta||localStorage.getItem('boyaki-canonical-api-base')||DEFAULT_API_BASE).replace(/\/$/,'');
}

function identity(){
  const accountHex=localStorage.getItem('boyaki-account-sk')||sessionStorage.getItem('boyaki-account-sk');
  if(accountHex){
    const sk=fromHex(accountHex);
    return {sk,pk:getPublicKey(sk),kind:'account'};
  }
  const legacyHex=localStorage.getItem('boyaki-device-sk');
  if(!legacyHex)return null;
  const sk=fromHex(legacyHex);
  return {sk,pk:getPublicKey(sk),kind:'legacy_browser'};
}

async function sha256Hex(text){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

function b64Utf8(text){
  const bytes=new TextEncoder().encode(text);
  let binary='';
  for(const b of bytes)binary+=String.fromCharCode(b);
  return btoa(binary);
}

async function signedHeaders(url,method,rawBody=''){
  const id=identity();
  if(!id)throw new Error('boyaki_identity_missing');
  const tags=[['u',url],['method',method.toUpperCase()]];
  if(rawBody)tags.push(['payload',await sha256Hex(rawBody)]);
  const ev=finalizeEvent({kind:27235,created_at:unix(),content:'',tags},id.sk);
  return {
    Authorization:`Nostr ${b64Utf8(JSON.stringify(ev))}`,
    'Content-Type':'application/json',
  };
}

async function request(path,{method='GET',body=null,signed=false}={}){
  const base=apiBase();
  if(!base)throw new Error('boyaki_canonical_api_unconfigured');
  const url=`${base}${path.startsWith('/')?path:`/${path}`}`;
  const rawBody=body===null?'':JSON.stringify(body);
  const headers=signed?await signedHeaders(url,method,rawBody):{'Content-Type':'application/json'};
  const response=await fetch(url,{method,headers,body:rawBody||undefined,cache:'no-store'});
  let payload={};
  try{payload=await response.json()}catch{}
  if(!response.ok)throw new Error(payload?.error||`canonical_api_${response.status}`);
  return payload;
}

async function health(){return request('/health')}
async function listPosts(limit=100){return request(`/posts?limit=${Math.max(1,Math.min(Number(limit)||100,100))}`)}
async function listMine(){return request('/me/posts',{signed:true})}
async function createPost(content){
  const id=identity();
  if(!id)throw new Error('boyaki_identity_missing');
  return request('/posts',{method:'POST',signed:true,body:{content,identity_kind:id.kind}});
}
async function deletePost(id){return request(`/posts/${encodeURIComponent(id)}`,{method:'DELETE',signed:true})}
async function verifyIdentityLink(legacyClaim,accountAcceptance){return request('/identity-links/verify',{method:'POST',body:{legacy_claim:legacyClaim,account_acceptance:accountAcceptance}})}
async function registerLegacyControl(nostrEvent){return request('/legacy-controls/register',{method:'POST',signed:true,body:{nostr_event:nostrEvent}})}
async function deleteLegacy(eventId){return request(`/legacy/${encodeURIComponent(eventId)}`,{method:'DELETE',signed:true})}
async function legacyControls(ids=[]){const q=ids.filter(Boolean).slice(0,200).join(',');return q?request(`/legacy-controls?ids=${encodeURIComponent(q)}`):{controls:[]}}
async function report(targetType,targetId,reasonCode='other',detail=''){return request('/reports',{method:'POST',signed:true,body:{target_type:targetType,target_id:targetId,reason_code:reasonCode,detail}})}

async function initialize(){
  window.BOYAKI_CANONICAL_BACKEND_READY=false;
  try{
    const state=await health();
    const ready=state?.ok===true&&state?.canonical_storage===true;
    window.BOYAKI_CANONICAL_BACKEND_READY=ready;
    return ready;
  }catch(err){
    console.warn('canonical backend unavailable',err);
    window.BOYAKI_CANONICAL_BACKEND_READY=false;
    return false;
  }
}

window.BOYAKI_CANONICAL={
  apiBase,identity,health,listPosts,listMine,createPost,deletePost,verifyIdentityLink,
  registerLegacyControl,deleteLegacy,legacyControls,report,initialize
};
initialize();
