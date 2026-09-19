import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyEvent } from 'npm:nostr-tools@2.17.0';

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')||'';
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const db=createClient(SUPABASE_URL,KEY,{auth:{persistSession:false}});
const T=(name:string)=>`ai_staging_${name}`;

if(new URL(SUPABASE_URL).hostname!=='vbqitqjhobzpdlaraglc.supabase.co')throw Error('wrong_ai_project');

function cors(req:Request){
  const origin=req.headers.get('origin')||'';
  const ok=origin==='https://camembert1001.github.io'||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    ...(ok?{'Access-Control-Allow-Origin':origin}:{}),
    'Access-Control-Allow-Headers':'authorization, content-type',
    'Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS',
    'Vary':'Origin'
  };
}
function json(req:Request,status:number,body:any){
  return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8',...cors(req)}});
}
function tag(event:any,name:string){return event?.tags?.find((x:any[])=>x?.[0]===name)?.[1]}
async function sha(text:string){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function publicUrl(req:Request){
  const source=new URL(req.url),base=new URL(SUPABASE_URL),marker='/ai-staging-boyaki-thread-api',index=source.pathname.indexOf(marker);
  base.pathname=`/functions/v1/ai-staging-boyaki-thread-api${index>=0?source.pathname.slice(index+marker.length):''}`;
  base.search=source.search;
  return base.toString();
}
async function auth(req:Request,raw='',payload=false){
  const match=/^Nostr\s+(.+)$/i.exec(req.headers.get('authorization')||'');
  if(!match)throw Error('missing_nostr_authorization');
  let event:any;
  try{event=JSON.parse(atob(match[1]))}catch{throw Error('invalid_nostr_authorization')}
  if(event.kind!==27235||!verifyEvent(event))throw Error('invalid_nostr_signature');
  if(Math.abs(Math.floor(Date.now()/1000)-event.created_at)>120)throw Error('stale_nostr_authorization');
  const signedUrl=new URL(tag(event,'u')||''),actualUrl=new URL(publicUrl(req));
  if(signedUrl.protocol!==actualUrl.protocol||signedUrl.host!==actualUrl.host||signedUrl.pathname!==actualUrl.pathname||signedUrl.search!==actualUrl.search)throw Error('nostr_authorization_url_mismatch');
  if((tag(event,'method')||'').toUpperCase()!==req.method.toUpperCase())throw Error('nostr_authorization_method_mismatch');
  if(payload&&tag(event,'payload')!==await sha(raw))throw Error('nostr_authorization_payload_mismatch');
  return event;
}
async function consume(event:any,req:Request){
  const {error}=await db.from(T('boyaki_request_receipts')).insert({
    auth_event_id:event.id,actor_pubkey:event.pubkey,method:req.method.toUpperCase(),request_url:req.url
  });
  if(error)throw Error((error as any).code==='23505'?'replayed_signed_request':error.message);
}
async function linked(pubkey:string){
  const {data}=await db.from(T('boyaki_identity_links')).select('account_pubkey').eq('legacy_pubkey',pubkey).eq('status','verified').maybeSingle();
  return data?.account_pubkey||null;
}
async function own(pubkey:string,kind:string){
  if(kind==='account'){
    const {error}=await db.from(T('boyaki_accounts')).upsert({account_pubkey:pubkey},{onConflict:'account_pubkey',ignoreDuplicates:true});
    if(error)throw Error(error.message);
    return pubkey;
  }
  if(kind==='legacy_browser')return linked(pubkey);
  throw Error('invalid_identity_kind');
}
function uuid(value:any){return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)}
function roomId(value:any){return typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value)}
async function problemForPost(postId:string){
  const{data,error}=await db.from(T('boyaki_problem_statements'))
    .select('id,post_id,statement,status,created_at,updated_at')
    .eq('post_id',postId).eq('status','active').maybeSingle();
  if(error)throw Error(error.message);return data||null;
}
async function postShell(postId:string){
  const{data,error}=await db.from(T('boyaki_posts'))
    .select('id,author_pubkey,owner_account_pubkey,content,status,created_at,withdrawn_at')
    .eq('id',postId).maybeSingle();
  if(error)throw Error(error.message);if(!data)return null;
  const problem=await problemForPost(postId);
  const alive=data.status==='active'||(data.status==='withdrawn'&&Boolean(problem));
  return alive?{post:data,problem}:null;
}
function publicPost(post:any,problem:any){
  if(!post)return null;
  const withdrawn=post.status==='withdrawn';
  return {
    id:post.id,
    author_pubkey:withdrawn?null:post.author_pubkey,
    owner_account_pubkey:withdrawn?null:post.owner_account_pubkey,
    content:withdrawn?(problem?.statement||null):post.content,
    status:post.status,
    created_at:post.created_at,
    source_withdrawn:withdrawn,
    shared_problem:Boolean(problem),
    problem_statement:problem?.statement||null
  };
}
async function activeRole(postId:string,pubkey:string,role:'voice'|'maker'){
  const {data,error}=await db.from(T('boyaki_thread_events'))
    .select('id').eq('post_id',postId).eq('owner_account_pubkey',pubkey).eq('participant_role',role).eq('status','active').limit(1);
  if(error)throw Error(error.message);
  return Boolean(data?.length);
}
async function getOrCreateRoom(postId:string,makerPubkey:string){
  const existing=await db.from(T('boyaki_solution_rooms'))
    .select('id,post_id,created_by_pubkey,status,created_at,updated_at').eq('post_id',postId).maybeSingle();
  if(existing.error)throw Error(existing.error.message);
  if(existing.data)return existing.data;
  const {data,error}=await db.from(T('boyaki_solution_rooms'))
    .insert({post_id:postId,created_by_pubkey:makerPubkey,status:'active'})
    .select('id,post_id,created_by_pubkey,status,created_at,updated_at').single();
  if(error){
    if((error as any).code==='23505'){
      const retry=await db.from(T('boyaki_solution_rooms')).select('id,post_id,created_by_pubkey,status,created_at,updated_at').eq('post_id',postId).single();
      if(retry.error)throw Error(retry.error.message);
      return retry.data;
    }
    throw Error(error.message);
  }
  return data;
}
async function roomAccess(room:any,pubkey:string){
  if(room.created_by_pubkey===pubkey)return {can_write:true,role:'maker',invitation:null};
  if(await activeRole(room.post_id,pubkey,'maker'))return {can_write:true,role:'maker',invitation:null};
  const {data:invitation,error}=await db.from(T('boyaki_solution_room_invitations'))
    .select('id,status,room_id,post_id,inviter_maker_pubkey,invitee_account_pubkey,source_thread_event_id,invitee_context,created_at,updated_at,accepted_at')
    .eq('room_id',room.id).eq('invitee_account_pubkey',pubkey).maybeSingle();
  if(error)throw Error(error.message);
  const problem=await problemForPost(room.post_id),accepted=invitation?.status==='accepted'&&Boolean(problem);
  return {can_write:accepted,role:accepted?'voice':null,invitation:invitation||null};
}

function median(values:number[]){if(!values.length)return null;const xs=[...values].sort((a,b)=>a-b),mid=Math.floor(xs.length/2);return xs.length%2?xs[mid]:Math.round((xs[mid-1]+xs[mid])/2)}
async function demandEvidenceForPost(postId:string){
  const{data,error}=await db.from(T('boyaki_demand_signals'))
    .select('signal,amount_yen,condition_text,actor_identity_kind,updated_at')
    .eq('post_id',postId);
  if(error)throw Error(error.message);
  const rows=data||[],same=rows.filter((x:any)=>x.signal==='same_problem'),trying=rows.filter((x:any)=>x.signal==='would_try'),pay=rows.filter((x:any)=>x.signal==='would_pay');
  const amounts=pay.map((x:any)=>Number(x.amount_yen)).filter((x:number)=>Number.isFinite(x)&&x>0);
  return {
    same_problem:{count:same.length,account_count:same.filter((x:any)=>x.actor_identity_kind==='account').length},
    would_try:{count:trying.length,account_count:trying.filter((x:any)=>x.actor_identity_kind==='account').length},
    would_pay:{count:pay.length,account_count:pay.filter((x:any)=>x.actor_identity_kind==='account').length,min_yen:amounts.length?Math.min(...amounts):null,median_yen:median(amounts),max_yen:amounts.length?Math.max(...amounts):null},
    pay_conditions:pay.filter((x:any)=>x.condition_text).sort((a:any,b:any)=>String(b.updated_at).localeCompare(String(a.updated_at))).slice(0,12).map((x:any)=>({amount_yen:x.amount_yen,condition_text:x.condition_text}))
  };
}

async function listSolutionRooms(req:Request){
  const {data:rooms,error}=await db.from(T('boyaki_solution_rooms'))
    .select('id,post_id,created_by_pubkey,status,created_at,updated_at')
    .eq('status','active').order('updated_at',{ascending:false}).limit(200);
  if(error)throw Error(error.message);
  const ids=[...new Set((rooms||[]).map((x:any)=>x.post_id).filter(Boolean))];
  let posts:any[]=[];
  if(ids.length){
    const out=await db.from(T('boyaki_posts'))
      .select('id,author_pubkey,owner_account_pubkey,content,status,created_at')
      .in('id',ids);
    if(out.error)throw Error(out.error.message);
    posts=out.data||[];
  }
  const problemRows=ids.length?await Promise.all(ids.map((id:string)=>problemForPost(id))):[];
  const problemByPost=new Map(problemRows.filter(Boolean).map((x:any)=>[x.post_id,x]));
  const byPost=new Map(posts.map((x:any)=>[x.id,x]));
  return json(req,200,{rooms:(rooms||[]).map((room:any)=>({...room,post:publicPost(byPost.get(room.post_id)||null,problemByPost.get(room.post_id)||null)})),environment:'AI-STAGING'});
}
async function getSolutionRoom(req:Request,id:string){
  const {data:room,error}=await db.from(T('boyaki_solution_rooms'))
    .select('id,post_id,created_by_pubkey,status,created_at,updated_at').eq('id',id).maybeSingle();
  if(error)throw Error(error.message);
  if(!room||room.status!=='active')return json(req,404,{error:'solution_room_not_found'});
  const {data:post,error:postError}=await db.from(T('boyaki_posts'))
    .select('id,author_pubkey,owner_account_pubkey,content,status,created_at').eq('id',room.post_id).maybeSingle();
  if(postError)throw Error(postError.message);
  const problem=await problemForPost(room.post_id);
  const demand_evidence=post?await demandEvidenceForPost(room.post_id):null;
  return json(req,200,{room:{...room,post:publicPost(post,problem),problem_statement:problem,demand_evidence},environment:'AI-STAGING'});
}
async function ensureSolutionRoom(req:Request,postId:string){
  const event=await auth(req,'',false);await consume(event,req);
  await own(event.pubkey,'account');
  const shell=await postShell(postId);
  if(!shell)return json(req,404,{error:'post_not_found'});
  if(!await activeRole(postId,event.pubkey,'maker'))return json(req,403,{error:'maker_role_required'});
  const existing=await db.from(T('boyaki_solution_rooms')).select('id').eq('post_id',postId).maybeSingle();
  if(existing.error)throw Error(existing.error.message);
  const room=await getOrCreateRoom(postId,event.pubkey);
  return json(req,existing.data?200:201,{room,created:!existing.data,environment:'AI-STAGING'});
}
async function listRoomMessages(req:Request,id:string){
  const {data,error}=await db.from(T('boyaki_solution_room_messages'))
    .select('id,room_id,author_pubkey,owner_account_pubkey,display_name,content,status,created_at')
    .eq('room_id',id).eq('status','active').order('created_at',{ascending:true}).limit(1000);
  if(error)throw Error(error.message);
  return json(req,200,{room_id:id,messages:data||[],environment:'AI-STAGING'});
}
async function createRoomMessage(req:Request,id:string,raw:string){
  const event=await auth(req,raw,true);await consume(event,req);
  const {data:room,error:roomError}=await db.from(T('boyaki_solution_rooms')).select('id,post_id,created_by_pubkey,status').eq('id',id).maybeSingle();
  if(roomError)throw Error(roomError.message);
  if(!room||room.status!=='active')return json(req,404,{error:'solution_room_not_found'});
  await own(event.pubkey,'account');
  const access=await roomAccess(room,event.pubkey);
  if(!access.can_write)return json(req,403,{error:'room_invitation_required'});
  const {data:account,error:accountError}=await db.from(T('boyaki_accounts')).select('account_pubkey,profile').eq('account_pubkey',event.pubkey).maybeSingle();
  if(accountError)throw Error(accountError.message);
  const body=JSON.parse(raw||'{}'),content=typeof body.content==='string'?body.content.trim():'';
  if(!content||content.length>500)return json(req,400,{error:'invalid_room_message'});
  const profile=(account?.profile&&typeof account.profile==='object')?account.profile:{};
  const displayName=typeof profile.displayName==='string'?profile.displayName.trim().slice(0,80):null;
  const {data,error}=await db.from(T('boyaki_solution_room_messages')).insert({
    room_id:id,author_pubkey:event.pubkey,owner_account_pubkey:event.pubkey,
    display_name:displayName||null,content,content_commitment:await sha(content),status:'active'
  }).select('id,room_id,author_pubkey,owner_account_pubkey,display_name,content,status,created_at').single();
  if(error)throw Error(error.message);
  await db.from(T('boyaki_solution_rooms')).update({updated_at:new Date().toISOString()}).eq('id',id);
  return json(req,201,{message:data,room_role:access.role,environment:'AI-STAGING'});
}
async function deleteRoomMessage(req:Request,id:string){
  const event=await auth(req);await consume(event,req);
  const {data:message,error:lookupError}=await db.from(T('boyaki_solution_room_messages')).select('author_pubkey,status').eq('id',id).maybeSingle();
  if(lookupError)throw Error(lookupError.message);
  if(!message)return json(req,404,{error:'room_message_not_found'});
  if(message.author_pubkey!==event.pubkey)return json(req,403,{error:'not_room_message_owner'});
  const now=new Date().toISOString();
  const {error}=await db.from(T('boyaki_solution_room_messages')).update({content:null,status:'deleted',deleted_at:now,updated_at:now}).eq('id',id);
  if(error)throw Error(error.message);
  return json(req,200,{ok:true,id,status:'deleted'});
}
async function createSolutionCase(req:Request,room:string,raw:string){
  const event=await auth(req,raw,true);await consume(event,req);
  const {data:roomRow,error:roomError}=await db.from(T('boyaki_solution_rooms')).select('id,post_id,created_by_pubkey,status').eq('id',room).maybeSingle();
  if(roomError)throw Error(roomError.message);
  if(!roomRow||roomRow.status!=='active')return json(req,404,{error:'solution_room_not_found'});
  await own(event.pubkey,'account');
  if(!await activeRole(roomRow.post_id,event.pubkey,'maker'))return json(req,403,{error:'maker_role_required'});
  const sharedProblem=await problemForPost(roomRow.post_id);
  if(!sharedProblem)return json(req,409,{error:'shared_problem_required'});
  const body=JSON.parse(raw||'{}');
  const title=typeof body.title==='string'?body.title.trim():'';
  const contribution=typeof body.contribution==='string'?body.contribution.trim():'';
  if(!title||title.length>100||!contribution||contribution.length>800)return json(req,400,{error:'invalid_solution_case'});
  const evidence_snapshot=await demandEvidenceForPost(roomRow.post_id);
  const {data,error}=await db.from(T('boyaki_solution_cases')).insert({
    room_id:room,maker_account_pubkey:event.pubkey,title,contribution,evidence_snapshot,status:'active'
  }).select('id,room_id,maker_account_pubkey,title,contribution,evidence_snapshot,status,created_at,updated_at').single();
  if(error)throw Error(error.message);
  await db.from(T('boyaki_solution_rooms')).update({updated_at:new Date().toISOString()}).eq('id',room);
  return json(req,201,{case:data,environment:'AI-STAGING'});
}
async function listMySolutionCases(req:Request){
  const event=await auth(req);
  const {data:cases,error}=await db.from(T('boyaki_solution_cases'))
    .select('id,room_id,maker_account_pubkey,title,contribution,evidence_snapshot,status,created_at,updated_at')
    .eq('maker_account_pubkey',event.pubkey).eq('status','active').order('created_at',{ascending:false}).limit(200);
  if(error)throw Error(error.message);
  const roomIds=[...new Set((cases||[]).map((x:any)=>x.room_id).filter(Boolean))];
  let rooms:any[]=[];
  if(roomIds.length){
    const out=await db.from(T('boyaki_solution_rooms')).select('id,post_id,status').in('id',roomIds);
    if(out.error)throw Error(out.error.message);
    rooms=out.data||[];
  }
  const postIds=[...new Set(rooms.map((x:any)=>x.post_id).filter(Boolean))];
  let posts:any[]=[];
  if(postIds.length){
    const out=await db.from(T('boyaki_posts')).select('id,content,status,created_at').in('id',postIds);
    if(out.error)throw Error(out.error.message);
    posts=out.data||[];
  }
  const roomMap=new Map(rooms.map((x:any)=>[x.id,x]));
  const problemRows=postIds.length?await Promise.all(postIds.map((id:string)=>problemForPost(id))):[];
  const problemMapByPost=new Map(problemRows.filter(Boolean).map((x:any)=>[x.post_id,x]));
  const postMap=new Map(posts.map((x:any)=>[x.id,x]));
  const enriched=(cases||[]).map((item:any)=>{
    const room=roomMap.get(item.room_id)||null,post=room?postMap.get(room.post_id)||null:null;
    return {...item,room:room?{...room,post:publicPost(post,problemMapByPost.get(room.post_id)||null)}:null};
  });
  return json(req,200,{cases:enriched,environment:'AI-STAGING'});
}
async function listMyVoiceHistory(req:Request){
  const event=await auth(req),account=(await linked(event.pubkey))||event.pubkey;
  const{data:events,error}=await db.from(T('boyaki_thread_events'))
    .select('id,post_id,event_type,participant_role,display_name,content,status,created_at')
    .eq('owner_account_pubkey',account).eq('participant_role','voice').eq('status','active')
    .order('created_at',{ascending:false}).limit(300);
  if(error)throw Error(error.message);
  const{data:demand,error:demandError}=await db.from(T('boyaki_demand_signals'))
    .select('id,post_id,signal,amount_yen,condition_text,created_at,updated_at')
    .eq('actor_pubkey',account).order('updated_at',{ascending:false}).limit(300);
  if(demandError)throw Error(demandError.message);
  const postIds=[...new Set([...(events||[]).map((x:any)=>x.post_id),...(demand||[]).map((x:any)=>x.post_id)].filter(Boolean))];
  let posts:any[]=[];
  if(postIds.length){
    const out=await db.from(T('boyaki_posts')).select('id,content,status,created_at').in('id',postIds);
    if(out.error)throw Error(out.error.message);posts=out.data||[];
  }
  const problemRows=postIds.length?await Promise.all(postIds.map((id:string)=>problemForPost(id))):[];
  const problemMapByPost=new Map(problemRows.filter(Boolean).map((x:any)=>[x.post_id,x]));
  const postMap=new Map(posts.map((x:any)=>[x.id,x]));
  const source=(postId:string)=>publicPost(postMap.get(postId)||null,problemMapByPost.get(postId)||null);
  return json(req,200,{
    account_pubkey:account,
    thread_contributions:(events||[]).map((x:any)=>({...x,post:source(x.post_id)})),
    demand_signals:(demand||[]).map((x:any)=>({...x,post:source(x.post_id)})),
    environment:'AI-STAGING'
  });
}

async function createRoomInvitation(req:Request,postId:string,raw:string){
  const event=await auth(req,raw,true);await consume(event,req);await own(event.pubkey,'account');
  const shell=await postShell(postId);
  if(!shell)return json(req,404,{error:'post_not_found'});
  if(!await activeRole(postId,event.pubkey,'maker'))return json(req,403,{error:'maker_role_required'});
  const body=JSON.parse(raw||'{}');
  let inviteeAccount:string|null=null,threadEventId:string|null=null,inviteeContext:'source_owner'|'voice_participant'='voice_participant';
  if(body.source_owner===true){
    inviteeAccount=shell.post.owner_account_pubkey||null;
    inviteeContext='source_owner';
    if(!inviteeAccount)return json(req,409,{error:'source_owner_account_required'});
  }else{
    threadEventId=String(body.thread_event_id||'');
    if(!uuid(threadEventId))return json(req,400,{error:'invalid_thread_event_id'});
    const {data:voiceEvent,error:voiceError}=await db.from(T('boyaki_thread_events'))
      .select('id,post_id,owner_account_pubkey,participant_role,status,display_name').eq('id',threadEventId).maybeSingle();
    if(voiceError)throw Error(voiceError.message);
    if(!voiceEvent||voiceEvent.post_id!==postId||voiceEvent.status!=='active'||voiceEvent.participant_role!=='voice')return json(req,400,{error:'voice_thread_event_required'});
    if(!voiceEvent.owner_account_pubkey)return json(req,409,{error:'voice_account_required'});
    inviteeAccount=voiceEvent.owner_account_pubkey;
  }
  if(inviteeAccount===event.pubkey&&inviteeContext!=='source_owner')return json(req,409,{error:'cannot_invite_self'});
  const room=await getOrCreateRoom(postId,event.pubkey),now=new Date().toISOString();
  const {data:existing,error:existingError}=await db.from(T('boyaki_solution_room_invitations'))
    .select('id,status,room_id,post_id,inviter_maker_pubkey,invitee_account_pubkey,source_thread_event_id,invitee_context,created_at,updated_at,accepted_at')
    .eq('room_id',room.id).eq('invitee_account_pubkey',inviteeAccount).maybeSingle();
  if(existingError)throw Error(existingError.message);
  if(existing?.status==='accepted'||existing?.status==='pending')return json(req,200,{room,invitation:existing,idempotent:true,environment:'AI-STAGING'});
  const payload={room_id:room.id,post_id:postId,inviter_maker_pubkey:event.pubkey,invitee_account_pubkey:inviteeAccount,source_thread_event_id:threadEventId,invitee_context:inviteeContext,status:'pending',updated_at:now,accepted_at:null};
  const query=existing
    ?db.from(T('boyaki_solution_room_invitations')).update(payload).eq('id',existing.id)
    :db.from(T('boyaki_solution_room_invitations')).insert(payload);
  const {data,error}=await query.select('id,status,room_id,post_id,inviter_maker_pubkey,invitee_account_pubkey,source_thread_event_id,invitee_context,created_at,updated_at,accepted_at').single();
  if(error)throw Error(error.message);
  return json(req,existing?200:201,{room,invitation:data,idempotent:false,environment:'AI-STAGING'});
}
async function acceptRoomInvitation(req:Request,id:string,raw:string){
  const event=await auth(req,raw,true);await consume(event,req);await own(event.pubkey,'account');
  const {data:invitation,error:lookupError}=await db.from(T('boyaki_solution_room_invitations'))
    .select('id,status,room_id,post_id,inviter_maker_pubkey,invitee_account_pubkey,source_thread_event_id,invitee_context,created_at,updated_at,accepted_at').eq('id',id).maybeSingle();
  if(lookupError)throw Error(lookupError.message);
  if(!invitation)return json(req,404,{error:'invitation_not_found'});
  if(invitation.invitee_account_pubkey!==event.pubkey)return json(req,403,{error:'not_invitation_recipient'});
  let problem=await problemForPost(invitation.post_id);
  if(invitation.status==='accepted')return json(req,200,{invitation,problem_statement:problem,idempotent:true,environment:'AI-STAGING'});
  if(invitation.status!=='pending')return json(req,409,{error:'invitation_not_pending'});
  const shell=await postShell(invitation.post_id);
  if(!shell)return json(req,404,{error:'post_not_found'});
  const body=JSON.parse(raw||'{}');
  let createdProblem=false;
  if(!problem){
    const isSourceOwner=invitation.invitee_context==='source_owner'&&shell.post.owner_account_pubkey===event.pubkey;
    if(!isSourceOwner)return json(req,409,{error:'source_owner_consent_required'});
    const statement=typeof body.problem_statement==='string'?body.problem_statement.trim():'';
    if(body.confirm_shared_problem!==true)return json(req,400,{error:'shared_problem_consent_required'});
    if(statement.length<10||statement.length>300)return json(req,400,{error:'invalid_problem_statement'});
    const {data,error}=await db.from(T('boyaki_problem_statements')).insert({
      post_id:invitation.post_id,statement,created_from_invitation_id:invitation.id,
      created_by_account_pubkey:event.pubkey,boundary_version:'solution_room_v1',status:'active'
    }).select('id,post_id,statement,status,created_at,updated_at').single();
    if(error)throw Error(error.message);problem=data;createdProblem=true;
  }
  const now=new Date().toISOString();
  const {data,error}=await db.from(T('boyaki_solution_room_invitations')).update({status:'accepted',accepted_at:now,updated_at:now})
    .eq('id',id).select('id,status,room_id,post_id,inviter_maker_pubkey,invitee_account_pubkey,source_thread_event_id,invitee_context,created_at,updated_at,accepted_at').single();
  if(error)throw Error(error.message);
  return json(req,200,{invitation:data,problem_statement:problem,shared_problem_created:createdProblem,idempotent:false,environment:'AI-STAGING'});
}
async function getRoomAccess(req:Request,id:string){
  const event=await auth(req);await own(event.pubkey,'account');
  const {data:room,error}=await db.from(T('boyaki_solution_rooms')).select('id,post_id,created_by_pubkey,status').eq('id',id).maybeSingle();
  if(error)throw Error(error.message);
  if(!room||room.status!=='active')return json(req,404,{error:'solution_room_not_found'});
  const access=await roomAccess(room,event.pubkey),problem=await problemForPost(room.post_id);
  return json(req,200,{room_id:id,actor_pubkey:event.pubkey,problem_statement:problem,...access,environment:'AI-STAGING'});
}

async function deleteSolutionCase(req:Request,id:string){
  const event=await auth(req);await consume(event,req);
  const {data:item,error:lookupError}=await db.from(T('boyaki_solution_cases')).select('maker_account_pubkey,status').eq('id',id).maybeSingle();
  if(lookupError)throw Error(lookupError.message);
  if(!item)return json(req,404,{error:'solution_case_not_found'});
  if(item.maker_account_pubkey!==event.pubkey)return json(req,403,{error:'not_solution_case_owner'});
  const now=new Date().toISOString();
  const {error}=await db.from(T('boyaki_solution_cases')).update({status:'deleted',deleted_at:now,updated_at:now}).eq('id',id);
  if(error)throw Error(error.message);
  return json(req,200,{ok:true,id,status:'deleted'});
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(req)});
  const url=new URL(req.url),marker='/ai-staging-boyaki-thread-api',index=url.pathname.indexOf(marker);
  const path=index>=0?(url.pathname.slice(index+marker.length)||'/'):url.pathname;
  try{
    if(req.method==='GET'&&path==='/health')return json(req,200,{
      ok:true,service:'ai-staging-boyaki-thread-api',canonical_threads:true,room_chat:true,
      post_bound_solution_rooms:true,room_invitations:true,shared_problem_transition:true,solution_cases:true,voice_history:true,case_evidence_snapshot:true,environment:'AI-STAGING',version:'ai-staging-problem-transition-v7'
    });

    const threadMatch=/^\/posts\/([0-9a-f-]+)\/thread$/i.exec(path);
    const accessMatch=/^\/posts\/([0-9a-f-]+)\/thread\/access$/i.exec(path);
    const ensureRoomMatch=/^\/posts\/([0-9a-f-]+)\/solution-room$/i.exec(path);
    const roomMatch=/^\/solution-rooms\/([0-9a-f-]{36})$/i.exec(path);
    const roomMessageMatch=/^\/solution-rooms\/([0-9a-f-]{36})\/messages$/i.exec(path);
    const roomCaseMatch=/^\/solution-rooms\/([0-9a-f-]{36})\/cases$/i.exec(path);
    const roomAccessMatch=/^\/solution-rooms\/([0-9a-f-]{36})\/access$/i.exec(path);
    const inviteMatch=/^\/posts\/([0-9a-f-]+)\/solution-room\/invitations$/i.exec(path);
    const inviteAcceptMatch=/^\/solution-room-invitations\/([0-9a-f-]+)\/accept$/i.exec(path);
    const roomMessageDeleteMatch=/^\/solution-room-messages\/([0-9a-f-]+)$/i.exec(path);
    const caseDeleteMatch=/^\/solution-cases\/([0-9a-f-]+)$/i.exec(path);

    if(req.method==='GET'&&path==='/solution-rooms')return listSolutionRooms(req);
    if(req.method==='GET'&&roomMatch&&roomId(roomMatch[1]))return getSolutionRoom(req,roomMatch[1]);
    if(req.method==='GET'&&roomMessageMatch&&roomId(roomMessageMatch[1]))return listRoomMessages(req,roomMessageMatch[1]);
    if(req.method==='GET'&&roomAccessMatch&&roomId(roomAccessMatch[1]))return getRoomAccess(req,roomAccessMatch[1]);
    if(req.method==='GET'&&path==='/me/solution-cases')return listMySolutionCases(req);
    if(req.method==='GET'&&path==='/me/voice-history')return listMyVoiceHistory(req);

    if(req.method==='GET'&&threadMatch&&uuid(threadMatch[1])){
      const shell=await postShell(threadMatch[1]);
      if(!shell)return json(req,404,{error:'post_not_found'});
      const {data,error}=await db.from(T('boyaki_thread_events'))
        .select('id,post_id,author_pubkey,owner_account_pubkey,event_type,parent_event_id,participant_role,display_name,content,status,created_at')
        .eq('post_id',threadMatch[1]).eq('status','active').order('created_at',{ascending:true});
      if(error)throw Error(error.message);
      return json(req,200,{post:publicPost(shell.post,shell.problem),problem_statement:shell.problem,events:data||[]});
    }

    if(req.method==='GET'&&accessMatch&&uuid(accessMatch[1])){
      const event=await auth(req),shell=await postShell(accessMatch[1]);
      if(!shell)return json(req,404,{error:'post_not_found'});
      const post=shell.post;
      const {data}=await db.from(T('boyaki_thread_events')).select('id,owner_account_pubkey,participant_role,display_name,created_at')
        .eq('post_id',accessMatch[1]).eq('status','active')
        .or(`author_pubkey.eq.${event.pubkey},owner_account_pubkey.eq.${event.pubkey}`).order('created_at',{ascending:false});
      const rows=data||[],role=rows.find((x:any)=>x.participant_role==='voice'||x.participant_role==='maker'),named=rows.find((x:any)=>x.display_name);
      const existingRoom=await db.from(T('boyaki_solution_rooms')).select('id').eq('post_id',accessMatch[1]).eq('status','active').maybeSingle();
      let myInvitation:any=null,roomInvitations:any[]=[];
      if(existingRoom.data?.id){
        const mine=await db.from(T('boyaki_solution_room_invitations'))
          .select('id,status,room_id,post_id,inviter_maker_pubkey,invitee_account_pubkey,source_thread_event_id,invitee_context,created_at,updated_at,accepted_at')
          .eq('room_id',existingRoom.data.id).eq('invitee_account_pubkey',event.pubkey).maybeSingle();
        if(mine.error)throw Error(mine.error.message);myInvitation=mine.data||null;
        if(role?.participant_role==='maker'){
          const invites=await db.from(T('boyaki_solution_room_invitations'))
            .select('id,status,room_id,post_id,inviter_maker_pubkey,invitee_account_pubkey,source_thread_event_id,invitee_context,created_at,updated_at,accepted_at')
            .eq('room_id',existingRoom.data.id).order('created_at',{ascending:true});
          if(invites.error)throw Error(invites.error.message);roomInvitations=invites.data||[];
        }
      }
      const isSourceOwner=post.owner_account_pubkey===event.pubkey||post.author_pubkey===event.pubkey;
      return json(req,200,{
        can_post_as_poster:post.status==='active'&&isSourceOwner,
        is_source_owner:isSourceOwner,
        source_owner_has_account:Boolean(post.owner_account_pubkey),
        source_owner_invitable:Boolean(post.owner_account_pubkey),
        source_withdrawn:post.status==='withdrawn',
        problem_statement:shell.problem,
        actor_pubkey:event.pubkey,current_role:role?.participant_role||null,current_display_name:named?.display_name||null,
        deletable_event_ids:rows.map((x:any)=>x.id),solution_room_id:existingRoom.data?.id||null,
        my_invitation:myInvitation,room_invitations:roomInvitations
      });
    }

    const raw=await req.text();

    if(req.method==='POST'&&ensureRoomMatch&&uuid(ensureRoomMatch[1]))return ensureSolutionRoom(req,ensureRoomMatch[1]);
    if(req.method==='POST'&&inviteMatch&&uuid(inviteMatch[1]))return createRoomInvitation(req,inviteMatch[1],raw);
    if(req.method==='POST'&&inviteAcceptMatch&&uuid(inviteAcceptMatch[1]))return acceptRoomInvitation(req,inviteAcceptMatch[1],raw);
    if(req.method==='POST'&&roomMessageMatch&&roomId(roomMessageMatch[1]))return createRoomMessage(req,roomMessageMatch[1],raw);
    if(req.method==='POST'&&roomCaseMatch&&roomId(roomCaseMatch[1]))return createSolutionCase(req,roomCaseMatch[1],raw);

    if(req.method==='POST'&&threadMatch&&uuid(threadMatch[1])){
      const event=await auth(req,raw,true);await consume(event,req);
      const shell=await postShell(threadMatch[1]);
      if(!shell)return json(req,404,{error:'post_not_found'});
      const post=shell.post,body=JSON.parse(raw||'{}'),content=typeof body.content==='string'?body.content.trim():'';
      if(!['clarify','proposal','poster_response','message'].includes(body.event_type)||!content||content.length>240)return json(req,400,{error:'invalid_thread_event'});
      if(body.event_type==='poster_response'&&(post.status!=='active'||(post.author_pubkey!==event.pubkey&&post.owner_account_pubkey!==event.pubkey)))return json(req,403,{error:'poster_response_requires_active_post_owner'});
      if(body.event_type==='message'&&!['voice','maker'].includes(body.participant_role))return json(req,400,{error:'participant_role_required'});
      const owner=await own(event.pubkey,body.identity_kind),name=typeof body.display_name==='string'?body.display_name.trim().slice(0,80):null;
      const {data,error}=await db.from(T('boyaki_thread_events')).insert({
        post_id:threadMatch[1],author_pubkey:event.pubkey,author_identity_kind:body.identity_kind,owner_account_pubkey:owner,
        event_type:body.event_type,parent_event_id:body.parent_event_id||null,
        participant_role:['voice','maker'].includes(body.participant_role)?body.participant_role:null,
        display_name:name,content,content_commitment:await sha(content),status:'active'
      }).select('id,post_id,author_pubkey,owner_account_pubkey,event_type,parent_event_id,participant_role,display_name,content,status,created_at').single();
      if(error)throw Error(error.message);
      return json(req,201,{event:data});
    }

    if(req.method==='DELETE'&&roomMessageDeleteMatch&&uuid(roomMessageDeleteMatch[1]))return deleteRoomMessage(req,roomMessageDeleteMatch[1]);
    if(req.method==='DELETE'&&caseDeleteMatch&&uuid(caseDeleteMatch[1]))return deleteSolutionCase(req,caseDeleteMatch[1]);

    const threadDeleteMatch=/^\/thread\/([0-9a-f-]+)$/i.exec(path);
    if(req.method==='DELETE'&&threadDeleteMatch&&uuid(threadDeleteMatch[1])){
      const event=await auth(req);await consume(event,req);
      const {data:item}=await db.from(T('boyaki_thread_events')).select('author_pubkey,owner_account_pubkey').eq('id',threadDeleteMatch[1]).maybeSingle();
      if(!item)return json(req,404,{error:'thread_event_not_found'});
      if(item.author_pubkey!==event.pubkey&&item.owner_account_pubkey!==event.pubkey)return json(req,403,{error:'not_thread_event_owner'});
      const {error}=await db.from(T('boyaki_thread_events')).update({content:null,status:'deleted',deleted_at:new Date().toISOString()}).eq('id',threadDeleteMatch[1]);
      if(error)throw Error(error.message);
      return json(req,200,{ok:true,id:threadDeleteMatch[1],status:'deleted'});
    }

    return json(req,404,{error:'not_found'});
  }catch(error){
    const code=String((error as any)?.message||error);
    console.error(code);
    return json(req,/authorization|signature|stale|replayed/.test(code)?401:500,{error:code});
  }
});