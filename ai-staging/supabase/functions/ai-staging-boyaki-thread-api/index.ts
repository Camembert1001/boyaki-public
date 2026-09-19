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
  const byPost=new Map(posts.map((x:any)=>[x.id,x]));
  return json(req,200,{rooms:(rooms||[]).map((room:any)=>({...room,post:byPost.get(room.post_id)||null})),environment:'AI-STAGING'});
}
async function getSolutionRoom(req:Request,id:string){
  const {data:room,error}=await db.from(T('boyaki_solution_rooms'))
    .select('id,post_id,created_by_pubkey,status,created_at,updated_at').eq('id',id).maybeSingle();
  if(error)throw Error(error.message);
  if(!room||room.status!=='active')return json(req,404,{error:'solution_room_not_found'});
  const {data:post,error:postError}=await db.from(T('boyaki_posts'))
    .select('id,author_pubkey,owner_account_pubkey,content,status,created_at').eq('id',room.post_id).maybeSingle();
  if(postError)throw Error(postError.message);
  return json(req,200,{room:{...room,post:post||null},environment:'AI-STAGING'});
}
async function ensureSolutionRoom(req:Request,postId:string){
  const event=await auth(req,'',false);await consume(event,req);
  await own(event.pubkey,'account');
  const {data:post,error:postError}=await db.from(T('boyaki_posts'))
    .select('id,status').eq('id',postId).maybeSingle();
  if(postError)throw Error(postError.message);
  if(!post||post.status!=='active')return json(req,404,{error:'post_not_found'});
  const existing=await db.from(T('boyaki_solution_rooms'))
    .select('id,post_id,created_by_pubkey,status,created_at,updated_at').eq('post_id',postId).maybeSingle();
  if(existing.error)throw Error(existing.error.message);
  if(existing.data)return json(req,200,{room:existing.data,created:false,environment:'AI-STAGING'});
  const {data,error}=await db.from(T('boyaki_solution_rooms'))
    .insert({post_id:postId,created_by_pubkey:event.pubkey,status:'active'})
    .select('id,post_id,created_by_pubkey,status,created_at,updated_at').single();
  if(error){
    if((error as any).code==='23505'){
      const retry=await db.from(T('boyaki_solution_rooms')).select('id,post_id,created_by_pubkey,status,created_at,updated_at').eq('post_id',postId).single();
      if(retry.error)throw Error(retry.error.message);
      return json(req,200,{room:retry.data,created:false,environment:'AI-STAGING'});
    }
    throw Error(error.message);
  }
  return json(req,201,{room:data,created:true,environment:'AI-STAGING'});
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
  const {data:room,error:roomError}=await db.from(T('boyaki_solution_rooms')).select('id,status').eq('id',id).maybeSingle();
  if(roomError)throw Error(roomError.message);
  if(!room||room.status!=='active')return json(req,404,{error:'solution_room_not_found'});
  await own(event.pubkey,'account');
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
  return json(req,201,{message:data,environment:'AI-STAGING'});
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
  const {data:roomRow,error:roomError}=await db.from(T('boyaki_solution_rooms')).select('id,status').eq('id',room).maybeSingle();
  if(roomError)throw Error(roomError.message);
  if(!roomRow||roomRow.status!=='active')return json(req,404,{error:'solution_room_not_found'});
  await own(event.pubkey,'account');
  const body=JSON.parse(raw||'{}');
  const title=typeof body.title==='string'?body.title.trim():'';
  const contribution=typeof body.contribution==='string'?body.contribution.trim():'';
  if(!title||title.length>100||!contribution||contribution.length>800)return json(req,400,{error:'invalid_solution_case'});
  const {data,error}=await db.from(T('boyaki_solution_cases')).insert({
    room_id:room,maker_account_pubkey:event.pubkey,title,contribution,status:'active'
  }).select('id,room_id,maker_account_pubkey,title,contribution,status,created_at,updated_at').single();
  if(error)throw Error(error.message);
  await db.from(T('boyaki_solution_rooms')).update({updated_at:new Date().toISOString()}).eq('id',room);
  return json(req,201,{case:data,environment:'AI-STAGING'});
}
async function listMySolutionCases(req:Request){
  const event=await auth(req);
  const {data:cases,error}=await db.from(T('boyaki_solution_cases'))
    .select('id,room_id,maker_account_pubkey,title,contribution,status,created_at,updated_at')
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
  const postMap=new Map(posts.map((x:any)=>[x.id,x]));
  const enriched=(cases||[]).map((item:any)=>{
    const room=roomMap.get(item.room_id)||null;
    return {...item,room:room?{...room,post:postMap.get(room.post_id)||null}:null};
  });
  return json(req,200,{cases:enriched,environment:'AI-STAGING'});
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
      post_bound_solution_rooms:true,solution_cases:true,environment:'AI-STAGING',version:'ai-staging-solution-flow-v3'
    });

    const threadMatch=/^\/posts\/([0-9a-f-]+)\/thread$/i.exec(path);
    const accessMatch=/^\/posts\/([0-9a-f-]+)\/thread\/access$/i.exec(path);
    const ensureRoomMatch=/^\/posts\/([0-9a-f-]+)\/solution-room$/i.exec(path);
    const roomMatch=/^\/solution-rooms\/([0-9a-f-]{36})$/i.exec(path);
    const roomMessageMatch=/^\/solution-rooms\/([0-9a-f-]{36})\/messages$/i.exec(path);
    const roomCaseMatch=/^\/solution-rooms\/([0-9a-f-]{36})\/cases$/i.exec(path);
    const roomMessageDeleteMatch=/^\/solution-room-messages\/([0-9a-f-]+)$/i.exec(path);
    const caseDeleteMatch=/^\/solution-cases\/([0-9a-f-]+)$/i.exec(path);

    if(req.method==='GET'&&path==='/solution-rooms')return listSolutionRooms(req);
    if(req.method==='GET'&&roomMatch&&roomId(roomMatch[1]))return getSolutionRoom(req,roomMatch[1]);
    if(req.method==='GET'&&roomMessageMatch&&roomId(roomMessageMatch[1]))return listRoomMessages(req,roomMessageMatch[1]);
    if(req.method==='GET'&&path==='/me/solution-cases')return listMySolutionCases(req);

    if(req.method==='GET'&&threadMatch&&uuid(threadMatch[1])){
      const {data:post}=await db.from(T('boyaki_posts')).select('id,author_pubkey,owner_account_pubkey,status').eq('id',threadMatch[1]).maybeSingle();
      if(!post||post.status!=='active')return json(req,404,{error:'post_not_found'});
      const {data,error}=await db.from(T('boyaki_thread_events'))
        .select('id,post_id,author_pubkey,owner_account_pubkey,event_type,parent_event_id,participant_role,display_name,content,status,created_at')
        .eq('post_id',threadMatch[1]).eq('status','active').order('created_at',{ascending:true});
      if(error)throw Error(error.message);
      return json(req,200,{post,events:data||[]});
    }

    if(req.method==='GET'&&accessMatch&&uuid(accessMatch[1])){
      const event=await auth(req);
      const {data:post}=await db.from(T('boyaki_posts')).select('author_pubkey,owner_account_pubkey,status').eq('id',accessMatch[1]).maybeSingle();
      if(!post||post.status!=='active')return json(req,404,{error:'post_not_found'});
      const {data}=await db.from(T('boyaki_thread_events')).select('id,participant_role,display_name,created_at')
        .eq('post_id',accessMatch[1]).eq('status','active')
        .or(`author_pubkey.eq.${event.pubkey},owner_account_pubkey.eq.${event.pubkey}`).order('created_at',{ascending:false});
      const rows=data||[],role=rows.find((x:any)=>x.participant_role==='voice'||x.participant_role==='maker'),named=rows.find((x:any)=>x.display_name);
      const existingRoom=await db.from(T('boyaki_solution_rooms')).select('id').eq('post_id',accessMatch[1]).eq('status','active').maybeSingle();
      return json(req,200,{
        can_post_as_poster:post.author_pubkey===event.pubkey||post.owner_account_pubkey===event.pubkey,
        actor_pubkey:event.pubkey,current_role:role?.participant_role||null,current_display_name:named?.display_name||null,
        deletable_event_ids:rows.map((x:any)=>x.id),solution_room_id:existingRoom.data?.id||null
      });
    }

    const raw=await req.text();

    if(req.method==='POST'&&ensureRoomMatch&&uuid(ensureRoomMatch[1]))return ensureSolutionRoom(req,ensureRoomMatch[1]);
    if(req.method==='POST'&&roomMessageMatch&&roomId(roomMessageMatch[1]))return createRoomMessage(req,roomMessageMatch[1],raw);
    if(req.method==='POST'&&roomCaseMatch&&roomId(roomCaseMatch[1]))return createSolutionCase(req,roomCaseMatch[1],raw);

    if(req.method==='POST'&&threadMatch&&uuid(threadMatch[1])){
      const event=await auth(req,raw,true);await consume(event,req);
      const {data:post}=await db.from(T('boyaki_posts')).select('author_pubkey,owner_account_pubkey,status').eq('id',threadMatch[1]).maybeSingle();
      if(!post||post.status!=='active')return json(req,404,{error:'post_not_found'});
      const body=JSON.parse(raw||'{}'),content=typeof body.content==='string'?body.content.trim():'';
      if(!['clarify','proposal','poster_response','message'].includes(body.event_type)||!content||content.length>240)return json(req,400,{error:'invalid_thread_event'});
      if(body.event_type==='poster_response'&&post.author_pubkey!==event.pubkey&&post.owner_account_pubkey!==event.pubkey)return json(req,403,{error:'poster_response_requires_post_owner'});
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