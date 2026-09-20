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
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
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
  const source=new URL(req.url),base=new URL(SUPABASE_URL),marker='/ai-staging-inbox-api',index=source.pathname.indexOf(marker);
  base.pathname=`/functions/v1/ai-staging-inbox-api${index>=0?source.pathname.slice(index+marker.length):''}`;
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
async function requireAccount(pubkey:string){
  const {data,error}=await db.from(T('boyaki_accounts')).select('account_pubkey').eq('account_pubkey',pubkey).maybeSingle();
  if(error)throw Error(error.message);
  if(!data)throw Error('ai_account_required');
}
function excerpt(value:any,max=110){
  const text=String(value||'').trim().replace(/\s+/g,' ');
  return text.length>max?`${text.slice(0,max)}…`:text;
}
const priorityRank:any={action:0,update:1,ready:2};
type InboxItem={
  key:string;role:'voice'|'maker';kind:string;priority:'action'|'update'|'ready';
  title:string;detail:string;action_label:string;action_url:string;occurred_at:string;
  seen?:boolean;meta?:any;
};
async function fetchProblems(postIds:string[]){
  const map=new Map<string,any>();if(!postIds.length)return map;
  const {data,error}=await db.from(T('boyaki_problem_statements'))
    .select('id,post_id,statement,status,created_at,updated_at').in('post_id',postIds).eq('status','active');
  if(error)throw Error(error.message);
  for(const row of data||[])map.set(row.post_id,row);
  return map;
}
async function fetchPosts(postIds:string[]){
  const map=new Map<string,any>();if(!postIds.length)return map;
  const {data,error}=await db.from(T('boyaki_posts'))
    .select('id,owner_account_pubkey,author_pubkey,content,status,created_at,updated_at').in('id',postIds);
  if(error)throw Error(error.message);
  for(const row of data||[])map.set(row.id,row);
  return map;
}
function problemLabel(post:any,problem:any){
  return excerpt(problem?.statement||post?.content||'BOYAKI');
}

async function buildInbox(account:string){
  const items:InboxItem[]=[];

  const [inviteOut,demandOut,voiceThreadOut,ownedPostOut,caseOut,productOut,ordersOut,salesOut,makerThreadOut] = await Promise.all([
    db.from(T('boyaki_solution_room_invitations'))
      .select('id,room_id,post_id,inviter_maker_pubkey,invitee_account_pubkey,status,invitee_context,created_at,updated_at,accepted_at')
      .eq('invitee_account_pubkey',account).in('status',['pending','accepted']).order('updated_at',{ascending:false}).limit(200),
    db.from(T('boyaki_demand_signals'))
      .select('id,post_id,signal,updated_at,created_at').eq('actor_pubkey',account).limit(500),
    db.from(T('boyaki_thread_events'))
      .select('id,post_id,participant_role,created_at,updated_at').eq('owner_account_pubkey',account).eq('participant_role','voice').eq('status','active').limit(500),
    db.from(T('boyaki_posts'))
      .select('id,owner_account_pubkey,status,created_at,updated_at').eq('owner_account_pubkey',account).in('status',['active','withdrawn']).limit(500),
    db.from(T('boyaki_solution_cases'))
      .select('id,room_id,maker_account_pubkey,title,status,created_at,updated_at').eq('maker_account_pubkey',account).eq('status','active').order('updated_at',{ascending:false}).limit(300),
    db.from(T('boyaki_products'))
      .select('id,solution_case_id,maker_account_pubkey,title,price_yen,status,created_at,updated_at,published_at').eq('maker_account_pubkey',account).eq('status','published').order('updated_at',{ascending:false}).limit(300),
    db.from(T('boyaki_orders'))
      .select('id,product_id,buyer_account_pubkey,seller_account_pubkey,amount_yen,payment_status,created_at,paid_at').eq('buyer_account_pubkey',account).eq('payment_status','paid').order('paid_at',{ascending:false}).limit(200),
    db.from(T('boyaki_orders'))
      .select('id,product_id,buyer_account_pubkey,seller_account_pubkey,amount_yen,payment_status,created_at,paid_at').eq('seller_account_pubkey',account).eq('payment_status','paid').order('paid_at',{ascending:false}).limit(100),
    db.from(T('boyaki_thread_events'))
      .select('id,post_id,participant_role,created_at,updated_at').eq('owner_account_pubkey',account).eq('participant_role','maker').eq('status','active').limit(500)
  ]);
  for(const out of [inviteOut,demandOut,voiceThreadOut,ownedPostOut,caseOut,productOut,ordersOut,salesOut,makerThreadOut])if(out.error)throw Error(out.error.message);

  const invitations=inviteOut.data||[],demands=demandOut.data||[],voiceEvents=voiceThreadOut.data||[],ownedPosts=ownedPostOut.data||[];
  const cases=caseOut.data||[],myProducts=productOut.data||[],purchases=ordersOut.data||[],sales=salesOut.data||[],makerEvents=makerThreadOut.data||[];

  const relevantPostIds=[...new Set([
    ...invitations.map((x:any)=>x.post_id),
    ...demands.map((x:any)=>x.post_id),
    ...voiceEvents.map((x:any)=>x.post_id),
    ...ownedPosts.map((x:any)=>x.id),
    ...makerEvents.map((x:any)=>x.post_id)
  ].filter(Boolean))];
  const [postMap,problemMap]=await Promise.all([fetchPosts(relevantPostIds),fetchProblems(relevantPostIds)]);

  // Voice: pending invitations are the highest-priority return path.
  for(const inv of invitations.filter((x:any)=>x.status==='pending')){
    const post=postMap.get(inv.post_id),problem=problemMap.get(inv.post_id);
    items.push({
      key:`invite:${inv.id}`,role:'voice',kind:'room_invitation',priority:'action',
      title:'一緒に解決への招待',
      detail:inv.invitee_context==='source_owner'
        ?`${problemLabel(post,problem)} — Makerから、個人的なBOYAKIから「みんなで解く困りごと」へ進む招待が届いています。`
        :`${problemLabel(post,problem)} — Makerから一緒に解決を具体化する招待が届いています。`,
      action_label:'招待を確認',action_url:`./?problem=${encodeURIComponent(inv.post_id)}`,
      occurred_at:inv.updated_at||inv.created_at,meta:{post_id:inv.post_id,room_id:inv.room_id,invitation_id:inv.id}
    });
  }

  // Voice: products published back to any Problem the account has touched.
  const touchedPostIds=[...new Set([
    ...demands.map((x:any)=>x.post_id),
    ...voiceEvents.map((x:any)=>x.post_id),
    ...ownedPosts.map((x:any)=>x.id),
    ...invitations.filter((x:any)=>x.status==='accepted').map((x:any)=>x.post_id)
  ].filter(Boolean))];
  if(touchedPostIds.length){
    const publicationOut=await db.from(T('boyaki_product_thread_publications'))
      .select('id,product_id,post_id,status,published_at,updated_at').in('post_id',touchedPostIds).eq('status','active').order('published_at',{ascending:false}).limit(500);
    if(publicationOut.error)throw Error(publicationOut.error.message);
    const publications=publicationOut.data||[],productIds=[...new Set(publications.map((x:any)=>x.product_id))];
    const bought=new Set(purchases.map((x:any)=>x.product_id));
    let productMap=new Map<string,any>();
    if(productIds.length){
      const out=await db.from(T('boyaki_products'))
        .select('id,title,description,price_yen,maker_account_pubkey,status,published_at').in('id',productIds).eq('status','published');
      if(out.error)throw Error(out.error.message);
      productMap=new Map((out.data||[]).map((x:any)=>[x.id,x]));
    }
    for(const pub of publications){
      const product=productMap.get(pub.product_id);if(!product||product.maker_account_pubkey===account||bought.has(product.id))continue;
      const post=postMap.get(pub.post_id),problem=problemMap.get(pub.post_id);
      items.push({
        key:`product-ready:${product.id}`,role:'voice',kind:'product_ready',priority:'update',
        title:'参加していた困りごとにProductができました',
        detail:`${product.title} · ¥${Number(product.price_yen||0).toLocaleString('ja-JP')} — ${problemLabel(post,problem)}`,
        action_label:'Productを見る',action_url:`./product.html?id=${encodeURIComponent(product.id)}`,
        occurred_at:pub.published_at||product.published_at,meta:{product_id:product.id,post_id:pub.post_id}
      });
    }
  }

  // Voice: paid entitlement remains a durable receive action, lower priority than new work.
  if(purchases.length){
    const ids=[...new Set(purchases.map((x:any)=>x.product_id))];
    const [productRows,entitlementRows]=await Promise.all([
      db.from(T('boyaki_products')).select('id,title,status').in('id',ids),
      db.from(T('boyaki_entitlements')).select('id,order_id,product_id,status,granted_at').eq('buyer_account_pubkey',account).eq('status','active').in('product_id',ids)
    ]);
    if(productRows.error)throw Error(productRows.error.message);if(entitlementRows.error)throw Error(entitlementRows.error.message);
    const pm=new Map((productRows.data||[]).map((x:any)=>[x.id,x])),em=new Map((entitlementRows.data||[]).map((x:any)=>[x.product_id,x]));
    for(const order of purchases){
      const product=pm.get(order.product_id),ent=em.get(order.product_id);if(!product||!ent)continue;
      items.push({
        key:`purchase:${order.id}`,role:'voice',kind:'purchase_ready',priority:'ready',
        title:'購入したProductを受け取れます',
        detail:`${product.title} · ¥${Number(order.amount_yen||0).toLocaleString('ja-JP')}`,
        action_label:'受け取る',action_url:`./product.html?id=${encodeURIComponent(product.id)}`,
        occurred_at:ent.granted_at||order.paid_at||order.created_at,meta:{product_id:product.id,order_id:order.id}
      });
    }
  }

  // Maker: participated in a BOYAKI but has not yet asked the source Voice for the durable Problem transition.
  const makerPostIds=[...new Set(makerEvents.map((x:any)=>x.post_id).filter(Boolean))];
  if(makerPostIds.length){
    const [makerPosts,makerProblems,sourceInviteOut]=await Promise.all([
      fetchPosts(makerPostIds),fetchProblems(makerPostIds),
      db.from(T('boyaki_solution_room_invitations'))
        .select('id,post_id,status,invitee_context,created_at,updated_at').in('post_id',makerPostIds).eq('invitee_context','source_owner').in('status',['pending','accepted'])
    ]);
    if(sourceInviteOut.error)throw Error(sourceInviteOut.error.message);
    const sourceInvitePosts=new Set((sourceInviteOut.data||[]).map((x:any)=>x.post_id));
    for(const postId of makerPostIds){
      const post=makerPosts.get(postId),problem=makerProblems.get(postId);
      if(!post||post.status!=='active'||problem||sourceInvitePosts.has(postId)||!post.owner_account_pubkey)continue;
      items.push({
        key:`invite-source:${postId}`,role:'maker',kind:'invite_source_owner',priority:'action',
        title:'元Voiceを「一緒に解決」へ招待',
        detail:`${problemLabel(post,null)} — Productを作る前に、元Voiceの同意で「みんなで解く困りごと」として残します。`,
        action_label:'困りごとを開く',action_url:`./?problem=${encodeURIComponent(postId)}`,
        occurred_at:post.updated_at||post.created_at,meta:{post_id:postId}
      });
    }
  }

  // Maker: Solution Cases without Products.
  const productByCase=new Map(myProducts.map((x:any)=>[x.solution_case_id,x]));
  let caseRoomMap=new Map<string,any>();
  if(cases.length){
    const roomIds=[...new Set(cases.map((x:any)=>x.room_id).filter(Boolean))];
    if(roomIds.length){
      const out=await db.from(T('boyaki_solution_rooms')).select('id,post_id,status,updated_at').in('id',roomIds);
      if(out.error)throw Error(out.error.message);caseRoomMap=new Map((out.data||[]).map((x:any)=>[x.id,x]));
    }
  }
  for(const item of cases){
    if(productByCase.has(item.id))continue;
    const room=caseRoomMap.get(item.room_id);
    items.push({
      key:`productize-case:${item.id}`,role:'maker',kind:'productize_case',priority:'action',
      title:'解決メモをProductにする',
      detail:`${item.title} — 解決メモはできていますが、まだVoiceが受け取れるProductになっていません。`,
      action_label:'Productを作る',action_url:`./product-create.html?case=${encodeURIComponent(item.id)}`,
      occurred_at:item.updated_at||item.created_at,meta:{case_id:item.id,room_id:item.room_id,post_id:room?.post_id||null}
    });
  }

  // Maker: published Product not yet returned to its source Problem.
  if(myProducts.length){
    const ids=myProducts.map((x:any)=>x.id);
    const pubOut=await db.from(T('boyaki_product_thread_publications'))
      .select('id,product_id,status,published_at').in('product_id',ids).eq('status','active');
    if(pubOut.error)throw Error(pubOut.error.message);
    const published=new Set((pubOut.data||[]).map((x:any)=>x.product_id));
    for(const product of myProducts){
      if(published.has(product.id))continue;
      items.push({
        key:`publish-product:${product.id}`,role:'maker',kind:'publish_product',priority:'action',
        title:'Productを元の困りごとに掲載',
        detail:`${product.title} — Productは作成済みですが、元の困りごとにはまだ掲載されていません。`,
        action_label:'掲載する',action_url:`./product.html?id=${encodeURIComponent(product.id)}`,
        occurred_at:product.updated_at||product.published_at||product.created_at,meta:{product_id:product.id}
      });
    }
  }

  // Maker + Voice: latest message from someone else in an active Room the account participates in.
  const acceptedRoomIds=invitations.filter((x:any)=>x.status==='accepted').map((x:any)=>x.room_id);
  const makerRoomIds=cases.map((x:any)=>x.room_id);
  let createdRoomIds:string[]=[];
  if(makerPostIds.length){
    const out=await db.from(T('boyaki_solution_rooms')).select('id,post_id,created_by_pubkey,status').in('post_id',makerPostIds).eq('status','active');
    if(out.error)throw Error(out.error.message);
    createdRoomIds=(out.data||[]).filter((x:any)=>x.created_by_pubkey===account||makerPostIds.includes(x.post_id)).map((x:any)=>x.id);
  }
  const roomIds=[...new Set([...acceptedRoomIds,...makerRoomIds,...createdRoomIds].filter(Boolean))];
  if(roomIds.length){
    const msgOut=await db.from(T('boyaki_solution_room_messages'))
      .select('id,room_id,owner_account_pubkey,display_name,content,status,created_at,updated_at')
      .in('room_id',roomIds).eq('status','active').order('created_at',{ascending:false}).limit(500);
    if(msgOut.error)throw Error(msgOut.error.message);
    const latestByRoom=new Map<string,any>();
    for(const msg of msgOut.data||[])if(msg.owner_account_pubkey!==account&&!latestByRoom.has(msg.room_id))latestByRoom.set(msg.room_id,msg);
    for(const [roomId,msg] of latestByRoom){
      items.push({
        key:`room-message:${roomId}:${msg.id}`,role:acceptedRoomIds.includes(roomId)?'voice':'maker',kind:'room_activity',priority:'update',
        title:'「一緒に解決」に新しい発言があります',
        detail:`${msg.display_name||'参加者'}: ${excerpt(msg.content,100)}`,
        action_label:'続きを見る',action_url:`./solution-room.html?room=${encodeURIComponent(roomId)}`,
        occurred_at:msg.created_at,meta:{room_id:roomId,message_id:msg.id}
      });
    }
  }

  // Maker: current market opportunities. This is derived from live demand, not stored as a notification.
  const makerEligible=makerEvents.length>0||cases.length>0||myProducts.length>0;
  if(makerEligible){
    const problemOut=await db.from(T('boyaki_problem_statements'))
      .select('id,post_id,statement,status,created_at,updated_at').eq('status','active').order('updated_at',{ascending:false}).limit(150);
    if(problemOut.error)throw Error(problemOut.error.message);
    const problems=problemOut.data||[],problemPostIds=problems.map((x:any)=>x.post_id);
    if(problemPostIds.length){
      const [demandMarketOut,pubMarketOut]=await Promise.all([
        db.from(T('boyaki_demand_signals')).select('post_id,signal,amount_yen').in('post_id',problemPostIds),
        db.from(T('boyaki_product_thread_publications')).select('post_id,status').in('post_id',problemPostIds).eq('status','active')
      ]);
      if(demandMarketOut.error)throw Error(demandMarketOut.error.message);
      if(pubMarketOut.error)throw Error(pubMarketOut.error.message);
      const solved=new Set((pubMarketOut.data||[]).map((x:any)=>x.post_id)),scores=new Map<string,any>();
      for(const row of demandMarketOut.data||[]){
        let s=scores.get(row.post_id);if(!s){s={same:0,try:0,pay:0};scores.set(row.post_id,s)}
        if(row.signal==='same_problem')s.same++;
        else if(row.signal==='would_try')s.try++;
        else if(row.signal==='would_pay')s.pay++;
      }
      const opportunities=problems
        .map((problem:any)=>({problem,signal:scores.get(problem.post_id)||{same:0,try:0,pay:0}}))
        .map((x:any)=>({...x,score:x.signal.same+x.signal.try*2+x.signal.pay*3}))
        .filter((x:any)=>x.score>0&&!solved.has(x.problem.post_id)&&!makerPostIds.includes(x.problem.post_id))
        .sort((a:any,b:any)=>b.score-a.score||String(b.problem.updated_at).localeCompare(String(a.problem.updated_at)))
        .slice(0,5);
      for(const row of opportunities){
        items.push({
          key:`market-opportunity:${row.problem.id}`,role:'maker',kind:'market_opportunity',priority:'ready',
          title:'需要の反応がある未解決の困りごと',
          detail:`${excerpt(row.problem.statement,120)} — 同じ悩み ${row.signal.same} / 試したい ${row.signal.try} / 払ってもいい ${row.signal.pay}`,
          action_label:'困りごとを見る',action_url:`./?problem=${encodeURIComponent(row.problem.post_id)}`,
          occurred_at:row.problem.updated_at||row.problem.created_at,meta:{problem_id:row.problem.id,post_id:row.problem.post_id,demand_score:row.score}
        });
      }
    }
  }

  // Maker: recent paid sales are useful updates, but never outrank required work.
  if(sales.length){
    const ids=[...new Set(sales.map((x:any)=>x.product_id))];
    const out=await db.from(T('boyaki_products')).select('id,title').in('id',ids);
    if(out.error)throw Error(out.error.message);
    const pm=new Map((out.data||[]).map((x:any)=>[x.id,x]));
    for(const sale of sales.slice(0,20)){
      const product=pm.get(sale.product_id);if(!product)continue;
      items.push({
        key:`sale:${sale.id}`,role:'maker',kind:'sale',priority:'update',
        title:'Productが購入されました',
        detail:`${product.title} · ¥${Number(sale.amount_yen||0).toLocaleString('ja-JP')} · テスト購入`,
        action_label:'商品を見る',action_url:`./product.html?id=${encodeURIComponent(product.id)}`,
        occurred_at:sale.paid_at||sale.created_at,meta:{product_id:product.id,order_id:sale.id}
      });
    }
  }

  const keys=items.map(x=>x.key);
  const seen=new Set<string>();
  if(keys.length){
    const out=await db.from(T('boyaki_inbox_seen')).select('item_key').eq('account_pubkey',account).in('item_key',keys);
    if(out.error)throw Error(out.error.message);
    for(const row of out.data||[])seen.add(row.item_key);
  }
  for(const item of items)item.seen=seen.has(item.key);

  items.sort((a,b)=>{
    const p=(priorityRank[a.priority]??9)-(priorityRank[b.priority]??9);if(p)return p;
    const seenDiff=Number(a.seen)-Number(b.seen);if(seenDiff)return seenDiff;
    return String(b.occurred_at||'').localeCompare(String(a.occurred_at||''));
  });

  const summary={
    total:items.length,
    unseen:items.filter(x=>!x.seen).length,
    action_required:items.filter(x=>x.priority==='action').length,
    voice:items.filter(x=>x.role==='voice').length,
    maker:items.filter(x=>x.role==='maker').length
  };
  return {items,summary};
}

async function getInbox(req:Request){
  const event=await auth(req);await requireAccount(event.pubkey);
  const result=await buildInbox(event.pubkey);
  return json(req,200,{...result,account_pubkey:event.pubkey,derived:true,environment:'AI-STAGING'});
}
async function markSeen(req:Request,raw:string){
  const event=await auth(req,raw,true);await consume(event,req);await requireAccount(event.pubkey);
  const body=JSON.parse(raw||'{}'),keys=Array.isArray(body.keys)?[...new Set(body.keys.map((x:any)=>String(x)).filter((x:string)=>x.length>=3&&x.length<=220))].slice(0,100):[];
  if(!keys.length)return json(req,400,{error:'inbox_keys_required'});
  const rows=keys.map((item_key:string)=>({account_pubkey:event.pubkey,item_key,seen_at:new Date().toISOString()}));
  const {error}=await db.from(T('boyaki_inbox_seen')).upsert(rows,{onConflict:'account_pubkey,item_key'});
  if(error)throw Error(error.message);
  return json(req,200,{ok:true,seen:keys,environment:'AI-STAGING'});
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(req)});
  const url=new URL(req.url),marker='/ai-staging-inbox-api',index=url.pathname.indexOf(marker);
  const path=index>=0?(url.pathname.slice(index+marker.length)||'/'):url.pathname;
  try{
    if(req.method==='GET'&&path==='/health')return json(req,200,{
      ok:true,service:'ai-staging-inbox-api',derived_action_inbox:true,seen_markers_only:true,
      environment:'AI-STAGING',version:'ai-staging-action-inbox-v1'
    });
    if(req.method==='GET'&&path==='/me/inbox')return getInbox(req);
    const raw=await req.text();
    if(req.method==='POST'&&path==='/me/inbox/seen')return markSeen(req,raw);
    return json(req,404,{error:'not_found'});
  }catch(error){
    const code=String((error as any)?.message||error);console.error(code);
    return json(req,/authorization|signature|stale|replayed/.test(code)?401:code==='ai_account_required'?403:500,{error:code});
  }
});