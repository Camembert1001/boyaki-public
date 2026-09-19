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
  const source=new URL(req.url),base=new URL(SUPABASE_URL),marker='/ai-staging-commerce-api',index=source.pathname.indexOf(marker);
  base.pathname=`/functions/v1/ai-staging-commerce-api${index>=0?source.pathname.slice(index+marker.length):''}`;
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
function uuid(value:any){return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)}
async function requireAccount(pubkey:string){
  const {data,error}=await db.from(T('boyaki_accounts')).select('account_pubkey,profile').eq('account_pubkey',pubkey).maybeSingle();
  if(error)throw Error(error.message);
  if(!data)throw Error('ai_account_required');
  return data;
}
function profileName(profile:any,pubkey:string){
  const value=profile&&typeof profile==='object'&&typeof profile.displayName==='string'?profile.displayName.trim():'';
  return value||`${pubkey.slice(0,8)}…${pubkey.slice(-6)}`;
}
async function productContext(product:any){
  const {data:caseRow,error:caseError}=await db.from(T('boyaki_solution_cases'))
    .select('id,room_id,maker_account_pubkey,title,contribution,evidence_snapshot,status,created_at')
    .eq('id',product.solution_case_id).maybeSingle();
  if(caseError)throw Error(caseError.message);
  let room:any=null,post:any=null;
  if(caseRow?.room_id){
    const roomResult=await db.from(T('boyaki_solution_rooms')).select('id,post_id,status,created_at').eq('id',caseRow.room_id).maybeSingle();
    if(roomResult.error)throw Error(roomResult.error.message);
    room=roomResult.data;
    if(room?.post_id){
      const postResult=await db.from(T('boyaki_posts')).select('id,content,status,created_at').eq('id',room.post_id).maybeSingle();
      if(postResult.error)throw Error(postResult.error.message);
      post=postResult.data;
    }
  }
  const maker=await requireAccount(product.maker_account_pubkey);
  const {count,error:countError}=await db.from(T('boyaki_orders'))
    .select('*',{count:'exact',head:true}).eq('product_id',product.id).eq('payment_status','paid');
  if(countError)throw Error(countError.message);
  const publication=await db.from(T('boyaki_product_thread_publications'))
    .select('id,product_id,post_id,room_id,published_by_pubkey,status,published_at,updated_at')
    .eq('product_id',product.id).maybeSingle();
  if(publication.error)throw Error(publication.error.message);
  return {
    solution_case:caseRow?{
      id:caseRow.id,title:caseRow.title,contribution:caseRow.contribution,
      evidence_snapshot:caseRow.evidence_snapshot,created_at:caseRow.created_at
    }:null,
    room:room?{id:room.id,status:room.status}:null,
    source_post:post?{id:post.id,content:post.content,status:post.status,created_at:post.created_at}:null,
    maker:{account_pubkey:product.maker_account_pubkey,display_name:profileName(maker.profile,product.maker_account_pubkey)},
    sold_count:count||0,
    thread_publication:publication.data||null
  };
}
function publicProduct(row:any,context:any=null){
  return {
    id:row.id,solution_case_id:row.solution_case_id,maker_account_pubkey:row.maker_account_pubkey,
    title:row.title,description:row.description,price_yen:row.price_yen,status:row.status,
    created_at:row.created_at,updated_at:row.updated_at,published_at:row.published_at,
    ...(context||{})
  };
}
async function listProducts(req:Request){
  const {data,error}=await db.from(T('boyaki_products'))
    .select('id,solution_case_id,maker_account_pubkey,title,description,price_yen,status,created_at,updated_at,published_at')
    .eq('status','published').order('published_at',{ascending:false}).limit(200);
  if(error)throw Error(error.message);
  const products=[];
  for(const row of data||[])products.push(publicProduct(row,await productContext(row)));
  return json(req,200,{products,checkout_mode:'ai_staging_test',environment:'AI-STAGING'});
}
async function getProduct(req:Request,id:string){
  const {data,error}=await db.from(T('boyaki_products'))
    .select('id,solution_case_id,maker_account_pubkey,title,description,price_yen,status,created_at,updated_at,published_at')
    .eq('id',id).maybeSingle();
  if(error)throw Error(error.message);
  if(!data||data.status!=='published')return json(req,404,{error:'product_not_found'});
  return json(req,200,{product:publicProduct(data,await productContext(data)),checkout_mode:'ai_staging_test',environment:'AI-STAGING'});
}
async function listMyProducts(req:Request){
  const event=await auth(req);await requireAccount(event.pubkey);
  const {data,error}=await db.from(T('boyaki_products'))
    .select('id,solution_case_id,maker_account_pubkey,title,description,price_yen,status,created_at,updated_at,published_at')
    .eq('maker_account_pubkey',event.pubkey).order('created_at',{ascending:false});
  if(error)throw Error(error.message);
  const products=[];
  for(const row of data||[])products.push(publicProduct(row,await productContext(row)));
  return json(req,200,{products,environment:'AI-STAGING'});
}
async function createProduct(req:Request,raw:string){
  const event=await auth(req,raw,true);await consume(event,req);await requireAccount(event.pubkey);
  const body=JSON.parse(raw||'{}'),caseId=String(body.solution_case_id||'');
  if(!uuid(caseId))return json(req,400,{error:'invalid_solution_case_id'});
  const title=typeof body.title==='string'?body.title.trim():'';
  const description=typeof body.description==='string'?body.description.trim():'';
  const delivery=typeof body.delivery_text==='string'?body.delivery_text.trim():'';
  const price=Number(body.price_yen);
  if(!title||title.length>120||!description||description.length>1200||!delivery||delivery.length>20000||!Number.isInteger(price)||price<1||price>1000000){
    return json(req,400,{error:'invalid_product'});
  }
  const {data:caseRow,error:caseError}=await db.from(T('boyaki_solution_cases'))
    .select('id,maker_account_pubkey,status').eq('id',caseId).maybeSingle();
  if(caseError)throw Error(caseError.message);
  if(!caseRow||caseRow.status!=='active')return json(req,404,{error:'solution_case_not_found'});
  if(caseRow.maker_account_pubkey!==event.pubkey)return json(req,403,{error:'not_solution_case_owner'});
  const existing=await db.from(T('boyaki_products'))
    .select('id,status').eq('solution_case_id',caseId).maybeSingle();
  if(existing.error)throw Error(existing.error.message);
  if(existing.data)return json(req,409,{error:'case_already_productized',product_id:existing.data.id,status:existing.data.status});
  const now=new Date().toISOString();
  const {data,error}=await db.from(T('boyaki_products')).insert({
    solution_case_id:caseId,maker_account_pubkey:event.pubkey,title,description,price_yen:price,
    delivery_text:delivery,status:'published',published_at:now,updated_at:now
  }).select('id,solution_case_id,maker_account_pubkey,title,description,price_yen,status,created_at,updated_at,published_at').single();
  if(error)throw Error(error.message);
  return json(req,201,{product:publicProduct(data,await productContext(data)),environment:'AI-STAGING'});
}
async function publishBack(req:Request,id:string){
  const event=await auth(req);await consume(event,req);await requireAccount(event.pubkey);
  const {data:product,error:productError}=await db.from(T('boyaki_products'))
    .select('id,solution_case_id,maker_account_pubkey,status').eq('id',id).maybeSingle();
  if(productError)throw Error(productError.message);
  if(!product||product.status!=='published')return json(req,404,{error:'product_not_found'});
  if(product.maker_account_pubkey!==event.pubkey)return json(req,403,{error:'not_product_owner'});
  const {data:caseRow,error:caseError}=await db.from(T('boyaki_solution_cases'))
    .select('id,room_id,status').eq('id',product.solution_case_id).maybeSingle();
  if(caseError)throw Error(caseError.message);
  if(!caseRow||!caseRow.room_id)return json(req,409,{error:'product_source_room_missing'});
  const {data:room,error:roomError}=await db.from(T('boyaki_solution_rooms'))
    .select('id,post_id,status').eq('id',caseRow.room_id).maybeSingle();
  if(roomError)throw Error(roomError.message);
  if(!room?.post_id)return json(req,409,{error:'product_source_post_missing'});
  const {data:post,error:postError}=await db.from(T('boyaki_posts')).select('id,status').eq('id',room.post_id).maybeSingle();
  if(postError)throw Error(postError.message);
  if(!post||post.status!=='active')return json(req,409,{error:'source_post_not_active'});
  const existing=await db.from(T('boyaki_product_thread_publications'))
    .select('id,product_id,post_id,room_id,published_by_pubkey,status,published_at,updated_at').eq('product_id',id).maybeSingle();
  if(existing.error)throw Error(existing.error.message);
  if(existing.data?.status==='active')return json(req,200,{publication:existing.data,idempotent:true,environment:'AI-STAGING'});
  const now=new Date().toISOString(),payload={product_id:id,post_id:room.post_id,room_id:room.id,published_by_pubkey:event.pubkey,status:'active',published_at:existing.data?.published_at||now,updated_at:now};
  const query=existing.data
    ?db.from(T('boyaki_product_thread_publications')).update(payload).eq('id',existing.data.id)
    :db.from(T('boyaki_product_thread_publications')).insert(payload);
  const {data,error}=await query.select('id,product_id,post_id,room_id,published_by_pubkey,status,published_at,updated_at').single();
  if(error)throw Error(error.message);
  return json(req,existing.data?200:201,{publication:data,idempotent:false,environment:'AI-STAGING'});
}
async function listPostProducts(req:Request,postId:string){
  const {data:pubs,error}=await db.from(T('boyaki_product_thread_publications'))
    .select('id,product_id,post_id,room_id,published_by_pubkey,status,published_at,updated_at')
    .eq('post_id',postId).eq('status','active').order('published_at',{ascending:false});
  if(error)throw Error(error.message);
  if(!pubs?.length)return json(req,200,{post_id:postId,products:[],environment:'AI-STAGING'});
  const ids=pubs.map((x:any)=>x.product_id);
  const {data:products,error:productError}=await db.from(T('boyaki_products'))
    .select('id,solution_case_id,maker_account_pubkey,title,description,price_yen,status,created_at,updated_at,published_at')
    .in('id',ids).eq('status','published');
  if(productError)throw Error(productError.message);
  const map=new Map((products||[]).map((x:any)=>[x.id,x])),out=[];
  for(const pub of pubs){
    const product=map.get(pub.product_id);if(!product)continue;
    out.push({...publicProduct(product,await productContext(product)),thread_publication:pub});
  }
  return json(req,200,{post_id:postId,products:out,environment:'AI-STAGING'});
}

async function purchase(req:Request,id:string){
  const event=await auth(req);await consume(event,req);await requireAccount(event.pubkey);
  const {data:product,error:productError}=await db.from(T('boyaki_products'))
    .select('id,maker_account_pubkey,price_yen,status').eq('id',id).maybeSingle();
  if(productError)throw Error(productError.message);
  if(!product||product.status!=='published')return json(req,404,{error:'product_not_found'});
  if(product.maker_account_pubkey===event.pubkey)return json(req,409,{error:'maker_cannot_buy_own_product'});
  const existing=await db.from(T('boyaki_orders'))
    .select('id,product_id,buyer_account_pubkey,seller_account_pubkey,amount_yen,payment_provider,payment_status,created_at,paid_at')
    .eq('product_id',id).eq('buyer_account_pubkey',event.pubkey).maybeSingle();
  if(existing.error)throw Error(existing.error.message);
  if(existing.data){
    const entitlement=await db.from(T('boyaki_entitlements')).select('id,status,granted_at').eq('order_id',existing.data.id).maybeSingle();
    if(entitlement.error)throw Error(entitlement.error.message);
    return json(req,200,{order:existing.data,entitlement:entitlement.data,idempotent:true,checkout_mode:'ai_staging_test',real_payment_processed:false,environment:'AI-STAGING'});
  }
  const now=new Date().toISOString();
  const {data:order,error:orderError}=await db.from(T('boyaki_orders')).insert({
    product_id:id,buyer_account_pubkey:event.pubkey,seller_account_pubkey:product.maker_account_pubkey,
    amount_yen:product.price_yen,payment_provider:'ai_staging_test',payment_status:'paid',paid_at:now
  }).select('id,product_id,buyer_account_pubkey,seller_account_pubkey,amount_yen,payment_provider,payment_status,created_at,paid_at').single();
  if(orderError)throw Error(orderError.message);
  const {data:entitlement,error:entitlementError}=await db.from(T('boyaki_entitlements')).insert({
    order_id:order.id,product_id:id,buyer_account_pubkey:event.pubkey,status:'active',granted_at:now
  }).select('id,order_id,product_id,buyer_account_pubkey,status,granted_at').single();
  if(entitlementError){
    await db.from(T('boyaki_orders')).delete().eq('id',order.id);
    throw Error(entitlementError.message);
  }
  return json(req,201,{order,entitlement,idempotent:false,checkout_mode:'ai_staging_test',real_payment_processed:false,environment:'AI-STAGING'});
}
async function accessProduct(req:Request,id:string){
  const event=await auth(req);await requireAccount(event.pubkey);
  const {data:product,error}=await db.from(T('boyaki_products'))
    .select('id,solution_case_id,maker_account_pubkey,title,description,price_yen,delivery_text,status,created_at,updated_at,published_at')
    .eq('id',id).maybeSingle();
  if(error)throw Error(error.message);
  if(!product)return json(req,404,{error:'product_not_found'});
  let access='maker';
  if(product.maker_account_pubkey!==event.pubkey){
    const entitlement=await db.from(T('boyaki_entitlements'))
      .select('id,order_id,status,granted_at').eq('product_id',id).eq('buyer_account_pubkey',event.pubkey).eq('status','active').maybeSingle();
    if(entitlement.error)throw Error(entitlement.error.message);
    if(!entitlement.data)return json(req,403,{error:'purchase_required'});
    access='buyer';
  }
  return json(req,200,{access,product:{...publicProduct(product),delivery_text:product.delivery_text},environment:'AI-STAGING'});
}
async function listMyPurchases(req:Request){
  const event=await auth(req);await requireAccount(event.pubkey);
  const {data:orders,error}=await db.from(T('boyaki_orders'))
    .select('id,product_id,buyer_account_pubkey,seller_account_pubkey,amount_yen,payment_provider,payment_status,created_at,paid_at')
    .eq('buyer_account_pubkey',event.pubkey).eq('payment_status','paid').order('created_at',{ascending:false}).limit(200);
  if(error)throw Error(error.message);
  const ids=[...new Set((orders||[]).map((x:any)=>x.product_id))],products:any[]=[];
  if(ids.length){
    const out=await db.from(T('boyaki_products')).select('id,title,description,price_yen,status,maker_account_pubkey').in('id',ids);
    if(out.error)throw Error(out.error.message);products.push(...(out.data||[]));
  }
  const map=new Map(products.map((x:any)=>[x.id,x]));
  return json(req,200,{purchases:(orders||[]).map((x:any)=>({...x,product:map.get(x.product_id)||null,access_path:`/products/${x.product_id}/access`})),environment:'AI-STAGING'});
}
async function listMySales(req:Request){
  const event=await auth(req);await requireAccount(event.pubkey);
  const {data:orders,error}=await db.from(T('boyaki_orders'))
    .select('id,product_id,buyer_account_pubkey,seller_account_pubkey,amount_yen,payment_provider,payment_status,created_at,paid_at')
    .eq('seller_account_pubkey',event.pubkey).eq('payment_status','paid').order('created_at',{ascending:false}).limit(300);
  if(error)throw Error(error.message);
  const ids=[...new Set((orders||[]).map((x:any)=>x.product_id))],products:any[]=[];
  if(ids.length){
    const out=await db.from(T('boyaki_products')).select('id,title,price_yen,status').in('id',ids);
    if(out.error)throw Error(out.error.message);products.push(...(out.data||[]));
  }
  const map=new Map(products.map((x:any)=>[x.id,x])),revenue=(orders||[]).reduce((sum:number,x:any)=>sum+Number(x.amount_yen||0),0);
  return json(req,200,{sales:(orders||[]).map((x:any)=>({...x,product:map.get(x.product_id)||null})),summary:{orders:(orders||[]).length,revenue_yen:revenue},environment:'AI-STAGING'});
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(req)});
  const url=new URL(req.url),marker='/ai-staging-commerce-api',index=url.pathname.indexOf(marker);
  const path=index>=0?(url.pathname.slice(index+marker.length)||'/'):url.pathname;
  try{
    if(req.method==='GET'&&path==='/health')return json(req,200,{
      ok:true,service:'ai-staging-commerce-api',products:true,orders:true,entitlements:true,
      checkout_mode:'ai_staging_test',real_payment_processed:false,publish_back:true,environment:'AI-STAGING',version:'ai-staging-commerce-v2'
    });
    const productMatch=/^\/products\/([0-9a-f-]+)$/i.exec(path);
    const purchaseMatch=/^\/products\/([0-9a-f-]+)\/purchase$/i.exec(path);
    const accessMatch=/^\/products\/([0-9a-f-]+)\/access$/i.exec(path);
    const publishBackMatch=/^\/products\/([0-9a-f-]+)\/publish-back$/i.exec(path);
    const postProductsMatch=/^\/posts\/([0-9a-f-]+)\/products$/i.exec(path);

    if(req.method==='GET'&&path==='/products')return listProducts(req);
    if(req.method==='GET'&&path==='/me/products')return listMyProducts(req);
    if(req.method==='GET'&&path==='/me/purchases')return listMyPurchases(req);
    if(req.method==='GET'&&path==='/me/sales')return listMySales(req);
    if(req.method==='GET'&&productMatch&&uuid(productMatch[1]))return getProduct(req,productMatch[1]);
    if(req.method==='GET'&&accessMatch&&uuid(accessMatch[1]))return accessProduct(req,accessMatch[1]);
    if(req.method==='GET'&&postProductsMatch&&uuid(postProductsMatch[1]))return listPostProducts(req,postProductsMatch[1]);

    const raw=await req.text();
    if(req.method==='POST'&&path==='/products')return createProduct(req,raw);
    if(req.method==='POST'&&purchaseMatch&&uuid(purchaseMatch[1]))return purchase(req,purchaseMatch[1]);
    if(req.method==='POST'&&publishBackMatch&&uuid(publishBackMatch[1]))return publishBack(req,publishBackMatch[1]);

    return json(req,404,{error:'not_found'});
  }catch(error){
    const code=String((error as any)?.message||error);
    console.error(code);
    return json(req,/authorization|signature|stale|replayed/.test(code)?401:code==='ai_account_required'?403:500,{error:code});
  }
});