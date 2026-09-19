import { finalizeEvent, generateSecretKey, getPublicKey } from 'npm:nostr-tools@2.17.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
const BASE='https://vbqitqjhobzpdlaraglc.supabase.co/functions/v1';
const API=BASE+'/ai-staging-boyaki-api';
const THREAD=BASE+'/ai-staging-boyaki-thread-api';
const db=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false}});
const T=(name:string)=>`ai_staging_${name}`;
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
let cleanupAccount:Id|null=null,cleanupPost='',cleanupMessage='',cleanupRoomMessage='',cleanupCase='';
async function run(){
 const h=(await req(API,'/health')).p;eq(h.ok,true,'api health');eq(h.environment,'AI-STAGING','api environment');pass('api-health',h);
 const th=(await req(THREAD,'/health')).p;eq(th.ok,true,'thread health');eq(th.environment,'AI-STAGING','thread environment');pass('thread-health',th);
 const a=identity(), b:Id={sk:a.sk,pk:a.pk,kind:'account'}, attacker=identity();
 cleanupAccount=a;
 const profile={displayName:'AI E2E Account',interest:'both',about:'Isolated automated fixture'};
 const saved=(await req(API,'/me/account',{method:'POST',id:a,body:{profile}})).p;eq(saved.account.profile.displayName,profile.displayName,'profile save');pass('account-register-ai');
 const restored=(await req(API,'/me/account',{id:b})).p;eq(restored.account.account_pubkey,a.pk,'account restore');eq(restored.account.profile.displayName,profile.displayName,'profile restore');pass('account-cross-device-profile');
 const text=`AI-STAGING E2E ${Date.now()}`;
 const created=(await req(API,'/posts',{method:'POST',id:a,expected:[201],body:{content:text,identity_kind:'account'}})).p.post;cleanupPost=created?.id||'';yes(created?.id,'create id');pass('post-create',created.id);
 const denied=await req(API,`/posts/${created.id}`,{method:'DELETE',id:attacker,expected:[403]});eq(denied.p.error,'not_post_owner','non-owner delete');pass('non-owner-delete-denied');
 const msg=(await req(THREAD,`/posts/${created.id}/thread`,{method:'POST',id:a,expected:[201],body:{event_type:'message',content:'AI-STAGING E2E room message',identity_kind:'account',participant_role:'maker',display_name:'E2E Maker'}})).p.event;cleanupMessage=msg?.id||'';yes(msg?.id,'thread id');pass('thread-message-create',msg.id);
 const thread=(await req(THREAD,`/posts/${created.id}/thread`)).p.events||[];yes(thread.some((x:any)=>x.id===msg.id),'thread read missing');pass('thread-message-read');
 const access=(await req(THREAD,`/posts/${created.id}/thread/access`,{id:b})).p;eq(access.current_role,'maker','thread role');yes((access.deletable_event_ids||[]).includes(msg.id),'deletable missing');pass('thread-cross-device-access');
 const roomResult=(await req(THREAD,`/posts/${created.id}/solution-room`,{method:'POST',id:a,expected:[201]})).p;const roomId=roomResult.room?.id;yes(roomId,'solution room id');eq(roomResult.room.post_id,created.id,'solution room post binding');pass('solution-room-create',roomId);
 const roomDetail=(await req(THREAD,`/solution-rooms/${roomId}`)).p.room;eq(roomDetail.post.id,created.id,'solution room source post');eq(roomDetail.post.content,text,'solution room source content');pass('solution-room-detail');
 const roomCreated=(await req(THREAD,`/solution-rooms/${roomId}/messages`,{method:'POST',id:a,expected:[201],body:{content:'AI-STAGING E2E Solution Room message'}})).p.message;cleanupRoomMessage=roomCreated?.id||'';yes(roomCreated?.id,'solution room message id');pass('solution-room-message-create',roomCreated.id);
 const roomMessages=(await req(THREAD,`/solution-rooms/${roomId}/messages`)).p.messages||[];yes(roomMessages.some((x:any)=>x.id===roomCreated.id&&x.content==='AI-STAGING E2E Solution Room message'),'solution room read missing');pass('solution-room-message-read');
 const roomDenied=await req(THREAD,`/solution-room-messages/${roomCreated.id}`,{method:'DELETE',id:attacker,expected:[403]});eq(roomDenied.p.error,'not_room_message_owner','solution room non-owner delete');pass('solution-room-non-owner-delete-denied');
 const sourceInvite=(await req(THREAD,`/posts/${created.id}/solution-room/invitations`,{method:'POST',id:a,expected:[201],body:{source_owner:true}})).p.invitation;yes(sourceInvite?.id,'source owner invite');eq(sourceInvite.invitee_context,'source_owner','source owner invitation context');pass('source-owner-transition-invite');
 const problemText='AI E2E generalized recurring manual workflow problem';
 const consent=(await req(THREAD,`/solution-room-invitations/${sourceInvite.id}/accept`,{method:'POST',id:b,body:{problem_statement:problemText,confirm_shared_problem:true}})).p;eq(consent.problem_statement.statement,problemText,'shared problem');pass('source-owner-transition-consent');
 const createdCase=(await req(THREAD,`/solution-rooms/${roomId}/cases`,{method:'POST',id:a,expected:[201],body:{title:'E2E Solution Case',contribution:'Connected a real BOYAKI to a persistent Solution Room and Case.'}})).p.case;cleanupCase=createdCase?.id||'';yes(createdCase?.id,'solution case id');eq(createdCase.room_id,roomId,'solution case room binding');pass('solution-case-create',createdCase.id);
 const myCases=(await req(THREAD,'/me/solution-cases',{id:b})).p.cases||[];const restoredCase=myCases.find((x:any)=>x.id===createdCase.id);yes(restoredCase,'solution case cross-device missing');eq(restoredCase.room?.post?.id,created.id,'solution case source post');pass('solution-case-cross-device-history');
 const caseDenied=await req(THREAD,`/solution-cases/${createdCase.id}`,{method:'DELETE',id:attacker,expected:[403]});eq(caseDenied.p.error,'not_solution_case_owner','solution case non-owner delete');pass('solution-case-non-owner-delete-denied');
 await req(THREAD,`/solution-cases/${createdCase.id}`,{method:'DELETE',id:b});cleanupCase='';pass('solution-case-delete');
 await req(THREAD,`/solution-room-messages/${roomCreated.id}`,{method:'DELETE',id:b});cleanupRoomMessage='';pass('solution-room-message-delete');
 await req(THREAD,`/thread/${msg.id}`,{method:'DELETE',id:b});pass('thread-delete');
 const withdrawal=(await req(API,`/posts/${created.id}`,{method:'DELETE',id:b})).p;eq(withdrawal.status,'source_withdrawn','post withdrawal status');eq(withdrawal.thread_preserved,true,'shared thread preserved');pass('post-source-withdrawal');
 const after=(await req(API,'/me/posts',{id:a})).p.posts||[],row=after.find((x:any)=>x.id===created.id);eq(row?.status,'withdrawn','post status');eq(row?.content,null,'original post purge');eq(row?.problem_statement,problemText,'shared problem retained');pass('post-withdrawal-purge');
 const feed2=(await req(API,'/posts?limit=100')).p.posts||[],problemRow=feed2.find((x:any)=>x.id===created.id);yes(problemRow,'shared problem missing from feed');eq(problemRow.content,problemText,'feed shared problem');eq(problemRow.author_pubkey,null,'withdrawn source author hidden');pass('shared-problem-remains-discoverable');
 const roomAfterPostDelete=(await req(THREAD,`/solution-rooms/${roomId}`)).p.room;eq(roomAfterPostDelete.post.status,'withdrawn','source post status after withdrawal');eq(roomAfterPostDelete.post.content,problemText,'room shared problem fallback');pass('post-withdrawal-preserves-solution-room-history');
 const {error:fixtureDeleteError}=await db.from(T('boyaki_posts')).delete().eq('id',created.id);if(fixtureDeleteError)fail('fixture post cleanup: '+fixtureDeleteError.message);
 await db.from(T('boyaki_accounts')).delete().eq('account_pubkey',a.pk);
 cleanupPost='';cleanupMessage='';cleanupRoomMessage='';cleanupCase='';cleanupAccount=null;
 const feed3=(await req(API,'/posts?limit=100')).p.posts||[];yes(!feed3.some((x:any)=>x.id===created.id),'E2E fixture remained after cleanup');pass('fixture-cleanup');
 return{ok:true,environment:'ai-staging',results,responses};
}
try{return new Response(JSON.stringify(await run()),{headers:{'content-type':'application/json',...cors}})}catch(e){results.push({name:'execution',status:'FAIL',detail:String((e as any)?.message||e)});if(cleanupPost)try{await db.from(T('boyaki_posts')).delete().eq('id',cleanupPost)}catch{}if(cleanupAccount)try{await db.from(T('boyaki_accounts')).delete().eq('account_pubkey',cleanupAccount.pk)}catch{}return new Response(JSON.stringify({ok:false,error:String((e as any)?.message||e),results,responses}),{status:500,headers:{'content-type':'application/json',...cors}})}});