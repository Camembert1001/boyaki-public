import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyEvent } from 'npm:nostr-tools@2.17.0';
const SUPABASE_URL=Deno.env.get('SUPABASE_URL')||'', KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
if(new URL(SUPABASE_URL).hostname!=='vbqitqjhobzpdlaraglc.supabase.co')throw Error('wrong_ai_project');
const db=createClient(SUPABASE_URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const T=(n:string)=>`ai_staging_${n}`;
function cors(req:Request){const o=req.headers.get('origin')||'';const ok=o==='https://camembert1001.github.io'||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);return {...(ok?{'Access-Control-Allow-Origin':o}:{}),'Access-Control-Allow-Headers':'authorization, content-type','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS','Vary':'Origin'}}
function json(req:Request,s:number,b:any){return new Response(JSON.stringify(b),{status:s,headers:{'content-type':'application/json; charset=utf-8',...cors(req)}})}
function tag(e:any,n:string){return e?.tags?.find((x:any[])=>x?.[0]===n)?.[1]}
async function sha(s:string){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function pubUrl(req:Request){const u=new URL(req.url),b=new URL(SUPABASE_URL),m='/ai-staging-boyaki-api',i=u.pathname.indexOf(m);b.pathname=`/functions/v1/ai-staging-boyaki-api${i>=0?u.pathname.slice(i+m.length):''}`;b.search=u.search;return b.toString()}
async function auth(req:Request,raw='',payload=false){const h=req.headers.get('authorization')||'',m=/^Nostr\s+(.+)$/i.exec(h);if(!m)throw Error('missing_nostr_authorization');let e:any;try{e=JSON.parse(atob(m[1]))}catch{throw Error('invalid_nostr_authorization')};if(e.kind!==27235||!verifyEvent(e))throw Error('invalid_nostr_signature');if(Math.abs(Math.floor(Date.now()/1000)-e.created_at)>120)throw Error('stale_nostr_authorization');const a=new URL(tag(e,'u')||''),b=new URL(pubUrl(req));if(a.protocol!==b.protocol||a.host!==b.host||a.pathname!==b.pathname||a.search!==b.search)throw Error('nostr_authorization_url_mismatch');if((tag(e,'method')||'').toUpperCase()!==req.method.toUpperCase())throw Error('nostr_authorization_method_mismatch');if(payload&&tag(e,'payload')!==await sha(raw))throw Error('nostr_authorization_payload_mismatch');return e}
async function consume(e:any,req:Request){const {error}=await db.from(T('boyaki_request_receipts')).insert({auth_event_id:e.id,actor_pubkey:e.pubkey,method:req.method.toUpperCase(),request_url:req.url});if(error){if((error as any).code==='23505')throw Error('replayed_signed_request');throw Error(error.message)}}
async function linked(pk:string){const{data}=await db.from(T('boyaki_identity_links')).select('account_pubkey').eq('legacy_pubkey',pk).eq('status','verified').maybeSingle();return data?.account_pubkey||null}
async function owner(pk:string,k:string){if(k==='account'){const{error}=await db.from(T('boyaki_accounts')).upsert({account_pubkey:pk},{onConflict:'account_pubkey',ignoreDuplicates:true});if(error)throw Error(error.message);return pk}if(k==='legacy_browser')return linked(pk);throw Error('invalid_identity_kind')}
function uuid(v:any){return typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v)}

const DEMAND_SIGNALS=new Set(['same_problem','would_try','would_pay']);
function median(values:number[]){if(!values.length)return null;const xs=[...values].sort((a,b)=>a-b),m=Math.floor(xs.length/2);return xs.length%2?xs[m]:Math.round((xs[m-1]+xs[m])/2)}
async function activePost(postId:string){
 const{data,error}=await db.from(T('boyaki_posts')).select('id,author_pubkey,owner_account_pubkey,status').eq('id',postId).maybeSingle();
 if(error)throw Error(error.message);return data?.status==='active'?data:null;
}
async function demandActor(e:any,requestedKind?:string){
 const account=await linked(e.pubkey);
 const actorPubkey=account||e.pubkey;
 const kind=account?'account':requestedKind;
 if(!['account','legacy_browser'].includes(kind||''))throw Error('invalid_identity_kind');
 if(kind==='account'){const{error}=await db.from(T('boyaki_accounts')).upsert({account_pubkey:actorPubkey},{onConflict:'account_pubkey',ignoreDuplicates:true});if(error)throw Error(error.message)}
 return{actorPubkey,kind};
}
async function demandAggregate(req:Request,postId:string){
 const post=await activePost(postId);if(!post)return json(req,404,{error:'post_not_found'});
 const{data,error}=await db.from(T('boyaki_demand_signals')).select('actor_identity_kind,signal,amount_yen,condition_text,updated_at').eq('post_id',postId);
 if(error)throw Error(error.message);const rows=data||[];
 const summary:any={};
 for(const signal of ['same_problem','would_try','would_pay']){
  const matches=rows.filter((x:any)=>x.signal===signal);
  summary[signal]={count:matches.length,account_count:matches.filter((x:any)=>x.actor_identity_kind==='account').length};
  if(signal==='would_pay'){
   const amounts=matches.map((x:any)=>Number(x.amount_yen)).filter((x:number)=>Number.isFinite(x)&&x>0);
   Object.assign(summary[signal],{min_yen:amounts.length?Math.min(...amounts):null,median_yen:median(amounts),max_yen:amounts.length?Math.max(...amounts):null});
  }
 }
 const pay_conditions=rows.filter((x:any)=>x.signal==='would_pay'&&x.condition_text).sort((a:any,b:any)=>String(b.updated_at).localeCompare(String(a.updated_at))).slice(0,12).map((x:any)=>({amount_yen:x.amount_yen,condition_text:x.condition_text}));
 return json(req,200,{post_id:postId,signals:summary,pay_conditions,environment:'AI-STAGING'});
}
async function demandMine(req:Request,postId:string){
 const e=await auth(req);const post=await activePost(postId);if(!post)return json(req,404,{error:'post_not_found'});
 const account=await linked(e.pubkey),actorPubkey=account||e.pubkey;
 const{data,error}=await db.from(T('boyaki_demand_signals')).select('signal,amount_yen,condition_text,created_at,updated_at').eq('post_id',postId).eq('actor_pubkey',actorPubkey);
 if(error)throw Error(error.message);
 return json(req,200,{post_id:postId,signals:data||[],is_source_author:(post.owner_account_pubkey||post.author_pubkey)===actorPubkey,environment:'AI-STAGING'});
}
async function saveDemand(req:Request,postId:string,raw:string){
 const e=await auth(req,raw,true);await consume(e,req);const body=JSON.parse(raw||'{}'),signal=String(body.signal||'');
 if(!DEMAND_SIGNALS.has(signal))return json(req,400,{error:'invalid_demand_signal'});
 const post=await activePost(postId);if(!post)return json(req,404,{error:'post_not_found'});
 const actor=await demandActor(e,body.identity_kind);
 if((post.owner_account_pubkey||post.author_pubkey)===actor.actorPubkey)return json(req,409,{error:'source_author_cannot_signal_demand'});
 let amount_yen:null|number=null,condition_text:null|string=null;
 if(signal==='would_pay'){
  amount_yen=Number(body.amount_yen);
  condition_text=typeof body.condition_text==='string'?body.condition_text.trim():'';
  if(!Number.isInteger(amount_yen)||amount_yen<1||amount_yen>1000000||!condition_text||condition_text.length>160)return json(req,400,{error:'invalid_payment_demand'});
 }
 const now=new Date().toISOString();
 const{data,error}=await db.from(T('boyaki_demand_signals')).upsert({
  post_id:postId,actor_pubkey:actor.actorPubkey,actor_identity_kind:actor.kind,signal,amount_yen,condition_text,updated_at:now
 },{onConflict:'post_id,actor_pubkey,signal'}).select('signal,amount_yen,condition_text,created_at,updated_at').single();
 if(error)throw Error(error.message);
 return json(req,200,{ok:true,signal:data,environment:'AI-STAGING'});
}
async function deleteDemand(req:Request,postId:string,signal:string){
 if(!DEMAND_SIGNALS.has(signal))return json(req,400,{error:'invalid_demand_signal'});
 const e=await auth(req);await consume(e,req);const account=await linked(e.pubkey),actorPubkey=account||e.pubkey;
 const{error}=await db.from(T('boyaki_demand_signals')).delete().eq('post_id',postId).eq('actor_pubkey',actorPubkey).eq('signal',signal);
 if(error)throw Error(error.message);
 return json(req,200,{ok:true,post_id:postId,signal,environment:'AI-STAGING'});
}

Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(req)});const u=new URL(req.url),m='/ai-staging-boyaki-api',i=u.pathname.indexOf(m),p=i>=0?(u.pathname.slice(i+m.length)||'/'):u.pathname;try{
if(req.method==='GET'&&p==='/health')return json(req,200,{ok:true,service:'ai-staging-boyaki-api',canonical_storage:true,demand_evidence:true,environment:'AI-STAGING',parent:'STAGING',version:'ai-staging-demand-evidence-v5'});
const demandMineMatch=/^\/posts\/([0-9a-f-]+)\/demand\/mine$/i.exec(p),demandMatch=/^\/posts\/([0-9a-f-]+)\/demand$/i.exec(p),demandDeleteMatch=/^\/posts\/([0-9a-f-]+)\/demand\/(same_problem|would_try|would_pay)$/i.exec(p);
if(req.method==='GET'&&demandMineMatch&&uuid(demandMineMatch[1]))return demandMine(req,demandMineMatch[1]);
if(req.method==='GET'&&demandMatch&&uuid(demandMatch[1]))return demandAggregate(req,demandMatch[1]);
if(req.method==='GET'&&p==='/posts'){const n=Math.max(1,Math.min(Number(u.searchParams.get('limit')||50)||50,100));const{data,error}=await db.from(T('boyaki_posts')).select('id,author_pubkey,content,created_at,status').eq('status','active').order('created_at',{ascending:false}).limit(n);if(error)throw Error(error.message);return json(req,200,{posts:data||[]})}
if(req.method==='GET'&&p==='/me/posts'){const e=await auth(req),a=(await linked(e.pubkey))||e.pubkey;const{data,error}=await db.from(T('boyaki_posts')).select('id,author_pubkey,owner_account_pubkey,content,status,created_at,withdrawn_at,moderated_at,deleted_at').or(`owner_account_pubkey.eq.${a},author_pubkey.eq.${e.pubkey}`).order('created_at',{ascending:false}).limit(500);if(error)throw Error(error.message);return json(req,200,{account_pubkey:a,posts:data||[]})}
if(req.method==='GET'&&p==='/me/account'){
 const e=await auth(req);
 let{data:account,error}=await db.from(T('boyaki_accounts')).select('account_pubkey,profile,created_at,updated_at').eq('account_pubkey',e.pubkey).maybeSingle();if(error)throw Error(error.message);
 let identitySource='ai-staging';
 if(!account){
  const{data:shared,error:sharedError}=await db.from('boyaki_accounts').select('account_pubkey').eq('account_pubkey',e.pubkey).maybeSingle();if(sharedError)throw Error('shared_identity_lookup_failed:'+sharedError.message);
  if(!shared)return json(req,404,{error:'shared_account_not_found'});
  const{data:created,error:createError}=await db.from(T('boyaki_accounts')).upsert({account_pubkey:e.pubkey},{onConflict:'account_pubkey'}).select('account_pubkey,profile,created_at,updated_at').single();if(createError)throw Error(createError.message);
  account=created;identitySource='staging-shared';
 }
 const{data:links,error:linkError}=await db.from(T('boyaki_identity_links')).select('legacy_pubkey,status').eq('account_pubkey',e.pubkey);if(linkError)throw Error(linkError.message);
 return json(req,200,{account,links:links||[],environment:'AI-STAGING',identity_source:identitySource,activity_scope:'AI-STAGING'});
}
const raw=await req.text();
if(req.method==='POST'&&demandMatch&&uuid(demandMatch[1]))return saveDemand(req,demandMatch[1],raw);
if(req.method==='DELETE'&&demandDeleteMatch&&uuid(demandDeleteMatch[1]))return deleteDemand(req,demandDeleteMatch[1],demandDeleteMatch[2]);

if(req.method==='POST'&&p==='/me/account'){
 const e=await auth(req,raw,true),b=JSON.parse(raw||'{}'),v=b.profile;
 if(!v||typeof v.displayName!=='string'||!v.displayName.trim()||v.displayName.length>40||!['voice','maker','both'].includes(v.interest)||typeof v.about!=='string'||v.about.length>240)return json(req,400,{error:'invalid_profile'});
 await consume(e,req);const profile={displayName:v.displayName.trim(),interest:v.interest,about:v.about.trim()};
 const{data:account,error}=await db.from(T('boyaki_accounts')).upsert({account_pubkey:e.pubkey,profile,updated_at:new Date().toISOString()},{onConflict:'account_pubkey'}).select('account_pubkey,profile,created_at,updated_at').single();if(error)throw Error(error.message);
 return json(req,200,{account,environment:'AI-STAGING'});
}
if(req.method==='POST'&&p==='/posts'){const e=await auth(req,raw,true);await consume(e,req);const b=JSON.parse(raw||'{}'),c=typeof b.content==='string'?b.content.trim():'';if(!c||c.length>2000)return json(req,400,{error:'invalid_content'});const o=await owner(e.pubkey,b.identity_kind);const{data,error}=await db.from(T('boyaki_posts')).insert({author_pubkey:e.pubkey,author_identity_kind:b.identity_kind,owner_account_pubkey:o,content:c,content_commitment:await sha(c),status:'active'}).select('id,author_pubkey,owner_account_pubkey,content,status,created_at').single();if(error)throw Error(error.message);return json(req,201,{post:data})}
if(req.method==='POST'&&p==='/identity-links/verify'){const b=JSON.parse(raw||'{}'),c=b.legacy_claim,a=b.account_acceptance;if(!c||!a||!verifyEvent(c)||!verifyEvent(a))return json(req,400,{error:'invalid_link_signature'});if(tag(c,'environment')!=='ai-staging'||tag(a,'environment')!=='ai-staging')return json(req,400,{error:'wrong_link_environment'});const account=tag(c,'account'),legacy=tag(c,'legacy');if(c.pubkey!==legacy||a.pubkey!==account||tag(a,'account')!==account||tag(a,'legacy')!==legacy)return json(req,400,{error:'link_pair_mismatch'});await db.from(T('boyaki_accounts')).upsert({account_pubkey:account},{onConflict:'account_pubkey',ignoreDuplicates:true});const{error}=await db.from(T('boyaki_identity_links')).upsert({account_pubkey:account,legacy_pubkey:legacy,status:'verified',legacy_claim_event_id:c.id,account_accept_event_id:a.id,verified_at:new Date().toISOString(),revoked_at:null},{onConflict:'account_pubkey,legacy_pubkey'});if(error)throw Error(error.message);await db.from(T('boyaki_posts')).update({owner_account_pubkey:account}).eq('author_pubkey',legacy).is('owner_account_pubkey',null);return json(req,200,{ok:true,account_pubkey:account,legacy_pubkey:legacy})}
if(req.method==='POST'&&p==='/reports'){const e=await auth(req,raw,true);await consume(e,req);const b=JSON.parse(raw||'{}');if(!uuid(b.target_id)||b.target_type!=='post')return json(req,400,{error:'invalid_report_target'});const{data,error}=await db.from(T('boyaki_reports')).insert({post_id:b.target_id,legacy_nostr_event_id:null,reporter_pubkey:e.pubkey,reason_code:String(b.reason_code||'other').slice(0,80),detail:String(b.detail||'').slice(0,1000)||null,status:'open'}).select('id').single();if(error)throw Error(error.message);return json(req,201,{ok:true,report_id:data.id})}
const d=/^\/posts\/([0-9a-f-]+)$/i.exec(p);if(req.method==='DELETE'&&d&&uuid(d[1])){const e=await auth(req);await consume(e,req);const{data:x}=await db.from(T('boyaki_posts')).select('author_pubkey,owner_account_pubkey').eq('id',d[1]).maybeSingle();if(!x)return json(req,404,{error:'post_not_found'});if(x.author_pubkey!==e.pubkey&&x.owner_account_pubkey!==e.pubkey)return json(req,403,{error:'not_post_owner'});const now=new Date().toISOString();const{error:threadError}=await db.from(T('boyaki_thread_events')).update({content:null,status:'deleted',deleted_at:now}).eq('post_id',d[1]);if(threadError)throw Error(threadError.message);const{error}=await db.from(T('boyaki_posts')).update({content:null,status:'deleted',withdrawn_at:now,deleted_at:now}).eq('id',d[1]);if(error)throw Error(error.message);return json(req,200,{ok:true,id:d[1],status:'deleted'})}
return json(req,404,{error:'not_found'});}catch(e){const x=String((e as any)?.message||e);console.error(x);return json(req,/authorization|signature|stale|replayed/.test(x)?401:500,{error:x})}});