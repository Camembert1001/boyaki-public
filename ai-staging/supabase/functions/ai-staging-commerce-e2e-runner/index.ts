import { finalizeEvent, generateSecretKey, getPublicKey } from 'npm:nostr-tools@2.17.0';

const BASE='https://vbqitqjhobzpdlaraglc.supabase.co/functions/v1';
const API=BASE+'/ai-staging-boyaki-api';
const THREAD=BASE+'/ai-staging-boyaki-thread-api';
const COMMERCE=BASE+'/ai-staging-commerce-api';
type Id={sk:Uint8Array;pk:string;kind:'account'};

Deno.serve(async request=>{
  const cors={'Access-Control-Allow-Origin':'https://camembert1001.github.io','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'content-type'};
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const results:any[]=[],responses:any[]=[];
  const pass=(name:string,detail:any='')=>results.push({name,status:'PASS',detail});
  const fail=(m:string):never=>{throw Error(m)};
  const eq=(a:any,b:any,m:string)=>{if(a!==b)fail(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`)};
  const yes=(v:any,m:string)=>{if(!v)fail(m)};
  const sha=async(s:string)=>{const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return[...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')};
  const make=():Id=>{const sk=generateSecretKey();return{sk,pk:getPublicKey(sk),kind:'account'}};
  async function headers(id:Id,url:string,method:string,raw=''){
    const tags:any[]=[['u',url],['method',method.toUpperCase()],['nonce',crypto.randomUUID()]];
    if(raw)tags.push(['payload',await sha(raw)]);
    const e=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:'',tags},id.sk);
    return{'Content-Type':'application/json','Authorization':`Nostr ${btoa(JSON.stringify(e))}`};
  }
  async function req(base:string,path:string,opt:any={}){
    const method=opt.method||'GET',body=opt.body??null,id=opt.id??null,expected=opt.expected||[200],url=base+path,raw=body===null?'':JSON.stringify(body);
    const h=id?await headers(id,url,method,raw):{'Content-Type':'application/json'};
    const r=await fetch(url,{method,headers:h,body:raw||undefined});
    const text=await r.text();let p:any={};try{p=JSON.parse(text)}catch{p={body:text}}
    responses.push({method,url,status:r.status,body:p});
    if(!expected.includes(r.status))fail(`${method} ${path} -> ${r.status}: ${JSON.stringify(p)}`);
    return p;
  }

  try{
    const health=await req(COMMERCE,'/health');
    eq(health.checkout_mode,'ai_staging_test','checkout mode');eq(health.real_payment_processed,false,'real payment flag');pass('commerce-health');

    const source=make(),maker=make(),buyer=make(),outsider=make();
    for(const [id,name] of [[source,'Commerce E2E Source'],[maker,'Commerce E2E Maker'],[buyer,'Commerce E2E Buyer'],[outsider,'Commerce E2E Outsider']] as any[]){
      await req(API,'/me/account',{method:'POST',id,body:{profile:{displayName:name,interest:'both',about:'AI-STAGING commerce E2E'}}});
    }
    pass('commerce-accounts-ready');

    const post=(await req(API,'/posts',{method:'POST',id:source,expected:[201],body:{content:`AI-STAGING COMMERCE E2E ${Date.now()}`,identity_kind:'account'}})).post;
    yes(post?.id,'post id');pass('commerce-source-post',post.id);

    const room=(await req(THREAD,`/posts/${post.id}/solution-room`,{method:'POST',id:maker,expected:[201]})).room;
    yes(room?.id,'room id');pass('commerce-solution-room',room.id);

    const caseRow=(await req(THREAD,`/solution-rooms/${room.id}/cases`,{method:'POST',id:maker,expected:[201],body:{title:'Commerce E2E Case',contribution:'Turns the BOYAKI into a deliverable product.'}})).case;
    yes(caseRow?.id,'case id');pass('commerce-solution-case',caseRow.id);

    const product=(await req(COMMERCE,'/products',{method:'POST',id:maker,expected:[201],body:{
      solution_case_id:caseRow.id,title:'Commerce E2E Product',description:'A test deliverable generated from a Solution Case.',price_yen:700,delivery_text:'SECRET E2E DELIVERY: https://example.invalid/commerce-e2e'
    }})).product;
    yes(product?.id,'product id');eq(product.price_yen,700,'product price');pass('product-publish',product.id);

    const duplicate=await req(COMMERCE,'/products',{method:'POST',id:maker,expected:[409],body:{
      solution_case_id:caseRow.id,title:'Duplicate',description:'Duplicate should fail',price_yen:700,delivery_text:'duplicate'
    }});
    eq(duplicate.error,'case_already_productized','duplicate productization');pass('one-product-per-case');

    const catalog=await req(COMMERCE,'/products');
    const publicProduct=(catalog.products||[]).find((x:any)=>x.id===product.id);yes(publicProduct,'catalog product missing');yes(!('delivery_text' in publicProduct),'delivery leaked in catalog');pass('public-catalog-hides-delivery');

    const detail=(await req(COMMERCE,`/products/${product.id}`)).product;
    eq(detail.id,product.id,'detail product');yes(!('delivery_text' in detail),'delivery leaked in detail');eq(detail.solution_case.id,caseRow.id,'case context');pass('product-detail-context');

    const before=await req(COMMERCE,`/products/${product.id}/access`,{id:buyer,expected:[403]});
    eq(before.error,'purchase_required','buyer pre-purchase access');pass('delivery-locked-before-purchase');

    const makerBuy=await req(COMMERCE,`/products/${product.id}/purchase`,{method:'POST',id:maker,expected:[409]});
    eq(makerBuy.error,'maker_cannot_buy_own_product','maker self purchase');pass('maker-self-purchase-blocked');

    const purchased=await req(COMMERCE,`/products/${product.id}/purchase`,{method:'POST',id:buyer,expected:[201]});
    eq(purchased.order.payment_status,'paid','order paid');eq(purchased.order.amount_yen,700,'order amount');eq(purchased.order.payment_provider,'ai_staging_test','test payment provider');eq(purchased.real_payment_processed,false,'no real payment');eq(purchased.entitlement.status,'active','entitlement active');pass('voice-test-purchase');

    const repeat=await req(COMMERCE,`/products/${product.id}/purchase`,{method:'POST',id:buyer,expected:[200]});
    eq(repeat.idempotent,true,'repeat purchase idempotent');eq(repeat.order.id,purchased.order.id,'repeat order id');pass('purchase-idempotent');

    const access=await req(COMMERCE,`/products/${product.id}/access`,{id:buyer});
    eq(access.access,'buyer','buyer access type');eq(access.product.delivery_text,'SECRET E2E DELIVERY: https://example.invalid/commerce-e2e','delivery content');pass('buyer-receives-product');

    const outsiderAccess=await req(COMMERCE,`/products/${product.id}/access`,{id:outsider,expected:[403]});
    eq(outsiderAccess.error,'purchase_required','outsider access');pass('nonbuyer-delivery-blocked');

    const purchases=await req(COMMERCE,'/me/purchases',{id:buyer});
    const purchaseRow=(purchases.purchases||[]).find((x:any)=>x.product_id===product.id);yes(purchaseRow,'buyer purchase history missing');eq(purchaseRow.amount_yen,700,'purchase history amount');pass('buyer-purchase-history');

    const sales=await req(COMMERCE,'/me/sales',{id:maker});
    const sale=(sales.sales||[]).find((x:any)=>x.product_id===product.id);yes(sale,'maker sale missing');eq(sales.summary.revenue_yen,700,'maker test revenue');eq(sales.summary.orders,1,'maker order count');pass('maker-sales-history');

    await req(API,`/posts/${post.id}`,{method:'DELETE',id:source});pass('source-withdraw-after-sale');
    const afterSource=await req(COMMERCE,`/products/${product.id}/access`,{id:buyer});
    eq(afterSource.product.delivery_text,'SECRET E2E DELIVERY: https://example.invalid/commerce-e2e','entitlement after source withdrawal');pass('purchase-survives-source-withdrawal');

    return new Response(JSON.stringify({ok:true,environment:'ai-staging',fixture:{post_id:post.id,room_id:room.id,case_id:caseRow.id,product_id:product.id,order_id:purchased.order.id},results,responses}),{headers:{'content-type':'application/json',...cors}});
  }catch(error){
    results.push({name:'execution',status:'FAIL',detail:String((error as any)?.message||error)});
    return new Response(JSON.stringify({ok:false,error:String((error as any)?.message||error),results,responses}),{status:500,headers:{'content-type':'application/json',...cors}});
  }
});