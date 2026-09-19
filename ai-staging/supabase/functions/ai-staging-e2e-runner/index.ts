import { finalizeEvent, generateSecretKey, getPublicKey } from 'npm:nostr-tools@2.17.0';
const BASE='https://vbqitqjhobzpdlaraglc.supabase.co/functions/v1';
const API=BASE+'/ai-staging-boyaki-api';
const THREAD=BASE+'/ai-staging-boyaki-thread-api';
type Id={sk:Uint8Array;pk:string;kind:'account'|'legacy_browser'};
Deno.serve(async(request)=>{
const cors={'Access-Control-Allow-Origin':'https://camembert1001.github.io','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'content-type'};
if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
if(request.method!=='POST')return new Response(JSON.stringify({ok:true,environment:'ai-staging',service:'ai-staging-e2e-runner',method:'POST'}),{headers:{'content-type':'application/json',...cors}});

const results:any[]=[], responses:any[]=[];
const pass=(name:string,detail:any='')=>results.push({name,status:'PASS',detail});
function fail(msg:string):never{throw new Error(msg)} function yes(v:any,m:string){if(!v)fail(m)} function eq(a:any,b:any,m:string){if(a!==b)fail(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`)}
async function sha(s:string){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function identity(sk=generateSecretKey(),kind:'account'|'legacy_browser'='account'):Id{return{sk,pk:getPublicKey(sk),kind}}
async function auth(i:Id,url:string,method:string,raw=''){const tags:any[]=[['u',url],['method',method.toUpperCase()],['nonce',crypto.randomUUID()]];if(raw)tags.push(['payload',await sha(raw)]);const ev=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:'',tags},i.sk);return{'Content-Type':'application/json','Authorization':`Nostr ${btoa(JSON.stringify(ev))}`}}
async function req(base:string,path:string,opt:any={}){const method=opt.method||'GET',body=opt.body??null,i=opt.id??null,expected=opt.expected||[200],url=base+(path.startsWith('/')?path:`/${path}`),raw=body===null?'':JSON.stringify(body),headers=i?await auth(i,url,method,raw):{'Content-Type':'application/json'};const r=await fetch(url,{method,headers,body:raw||undefined});const responseBody=await r.text();let p:any={};try{p=JSON.parse(responseBody)}catch{p={body:responseBody}};responses.push({method,url,status:r.status,body:p,request_id:r.headers.get('sb-request-id')});if(!expected.includes(r.status))fail(`${method} ${path} -> ${r.status}: ${JSON.stringify(p)}`);return{status:r.status,p}}
let cleanupAccount:Id|null=null,cleanupPost='',cleanupMessage='',cleanupRoomMessage='';
async function run(){
 const h=(await req(API,'/health')).p;eq(h.ok,true,'api health');eq(h.environment,'AI-STAGING','api environment');pass('api-health',h);
 const th=(await req(THREAD,'/health')).p;eq(th.ok,true,'thread health');eq(th.environment,'AI-STAGING','thread environment');pass('thread-health',th);
 const a=identity(), b:Id={sk:a.sk,pk:a.pk,kind:'account'}, attacker=identity();
 cleanupAccount=a;
 const profile={displayName:'AI E2E Account',interest:'both',about:'Isolated automated fixture'};
 const saved=(await req(API,'/me/account',{method:'POST',id:a,body:{profile}})).p;eq(saved.account.profile.displayName,profile.displayName,'profile save');pass('account-register-ai');
 const restored=(await req(API,'/me/account',{id:b})).p;eq(restored.account.account_pubkey,a.pk,'account restore');eq(restored.account.profile.displayName,profile.displayName,'profile restore');pass('account-cross-device-profile');
 const device=identity(undefined,'legacy_browser'),tags=[['environment','ai-staging'],['account',a.pk],['legacy',device.pk]];
 const proof=(id:Id)=>finalizeEvent({kind:30078,created_at:Math.floor(Date.now()/1000),content:'',tags},id.sk);
 const linked=await req(API,'/identity-links/verify',{method:'POST',body:{legacy_claim:proof(device),account_acceptance:proof(a)}});eq(linked.p.account_pubkey,a.pk,'link');pass('identity-link-ai');
 const text=`AI-STAGING E2E ${Date.now()}`;
 const created=(await req(API,'/posts',{method:'POST',id:a,expected:[201],body:{content:text,identity_kind:'account'}})).p.post;cleanupPost=created?.id||'';yes(created?.id,'create id');pass('post-create',created.id);
 const feed=(await req(API,'/posts?limit=100')).p.posts||[];yes(feed.some((x:any)=>x.id===created.id),'feed missing');pass('post-feed-read');
 const mine=(await req(API,'/me/posts',{id:b})).p.posts||[];yes(mine.some((x:any)=>x.id===created.id),'cross-device mine missing');pass('account-cross-device-read');
 const denied=await req(API,`/posts/${created.id}`,{method:'DELETE',id:attacker,expected:[403]});eq(denied.p.error,'not_post_owner','non-owner delete');pass('non-owner-delete-denied');
 const msg=(await req(THREAD,`/posts/${created.id}/thread`,{method:'POST',id:a,expected:[201],body:{event_type:'message',content:'AI-STAGING E2E room message',identity_kind:'account',participant_role:'maker',display_name:'E2E Maker'}})).p.event;cleanupMessage=msg?.id||'';yes(msg?.id,'thread id');pass('thread-message-create',msg.id);
 const thread=(await req(THREAD,`/posts/${created.id}/thread`)).p.events||[];yes(thread.some((x:any)=>x.id===msg.id),'thread read missing');pass('thread-message-read');
 const access=(await req(THREAD,`/posts/${created.id}/thread/access`,{id:b})).p;eq(access.current_role,'maker','thread role');yes((access.deletable_event_ids||[]).includes(msg.id),'deletable missing');pass('thread-cross-device-access');
 const profileAfter=(await req(API,'/me/account',{id:b})).p;eq(profileAfter.account.profile.displayName,profile.displayName,'profile preserved after post/thread/link');pass('profile-preserved');
 const roomCreated=(await req(THREAD,'/solution-rooms/1/messages',{method:'POST',id:a,expected:[201],body:{content:'AI-STAGING E2E Solution Room message'}})).p.message;cleanupRoomMessage=roomCreated?.id||'';yes(roomCreated?.id,'solution room message id');pass('solution-room-message-create',roomCreated.id);
 const roomMessages=(await req(THREAD,'/solution-rooms/1/messages')).p.messages||[];yes(roomMessages.some((x:any)=>x.id===roomCreated.id&&x.content==='AI-STAGING E2E Solution Room message'),'solution room read missing');pass('solution-room-message-read');
 const roomDenied=await req(THREAD,`/solution-room-messages/${roomCreated.id}`,{method:'DELETE',id:attacker,expected:[403]});eq(roomDenied.p.error,'not_room_message_owner','solution room non-owner delete');pass('solution-room-non-owner-delete-denied');
 await req(THREAD,`/solution-room-messages/${roomCreated.id}`,{method:'DELETE',id:b});cleanupRoomMessage='';pass('solution-room-message-delete');
 const roomAfter=(await req(THREAD,'/solution-rooms/1/messages')).p.messages||[];yes(!roomAfter.some((x:any)=>x.id===roomCreated.id),'deleted solution room message still visible');pass('solution-room-deleted-hidden');
 await req(THREAD,`/thread/${msg.id}`,{method:'DELETE',id:b});pass('thread-delete');
 await req(API,`/posts/${created.id}`,{method:'DELETE',id:b});pass('post-delete');
 const after=(await req(API,'/me/posts',{id:a})).p.posts||[],row=after.find((x:any)=>x.id===created.id);eq(row?.status,'deleted','post status');eq(row?.content,null,'post purge');pass('post-delete-purge');
 const feed2=(await req(API,'/posts?limit=100')).p.posts||[];yes(!feed2.some((x:any)=>x.id===created.id),'deleted still feed');pass('deleted-hidden-from-feed');
 return{ok:true,environment:'ai-staging',results,responses};
}
try{return new Response(JSON.stringify(await run()),{headers:{'content-type':'application/json',...cors}})}catch(e){results.push({name:'execution',status:'FAIL',detail:String((e as any)?.message||e)});for(const [base,path] of [[THREAD,cleanupRoomMessage?`/solution-room-messages/${cleanupRoomMessage}`:''],[THREAD,cleanupMessage?`/thread/${cleanupMessage}`:''],[API,cleanupPost?`/posts/${cleanupPost}`:'']]){if(path&&cleanupAccount)try{await req(base,path,{method:'DELETE',id:cleanupAccount})}catch{}}return new Response(JSON.stringify({ok:false,error:String((e as any)?.message||e),results,responses}),{status:500,headers:{'content-type':'application/json',...cors}})}});