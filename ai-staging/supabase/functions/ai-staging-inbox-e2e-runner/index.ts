import { finalizeEvent, generateSecretKey, getPublicKey } from 'npm:nostr-tools@2.17.0';

const BASE='https://vbqitqjhobzpdlaraglc.supabase.co/functions/v1';
const API=BASE+'/ai-staging-boyaki-api';
const THREAD=BASE+'/ai-staging-boyaki-thread-api';
const COMMERCE=BASE+'/ai-staging-commerce-api';
const INBOX=BASE+'/ai-staging-inbox-api';
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
  const find=(inbox:any,kind:string)=> (inbox.items||[]).find((x:any)=>x.kind===kind);

  try{
    const health=await req(INBOX,'/health');eq(health.derived_action_inbox,true,'inbox health');pass('inbox-health');

    const source=make(),maker=make();
    for(const [id,name] of [[source,'Inbox E2E Voice'],[maker,'Inbox E2E Maker']] as any[]){
      await req(API,'/me/account',{method:'POST',id,body:{profile:{displayName:name,interest:'both',about:'AI-STAGING action inbox E2E'}}});
    }
    pass('accounts-ready');

    const post=(await req(API,'/posts',{method:'POST',id:source,expected:[201],body:{content:`AI-STAGING INBOX E2E ${Date.now()} manual transfer pain`,identity_kind:'account'}})).post;
    const makerEvent=(await req(THREAD,`/posts/${post.id}/thread`,{method:'POST',id:maker,expected:[201],body:{event_type:'proposal',content:'Solution Roomで具体化したい',identity_kind:'account',participant_role:'maker',display_name:'Inbox Maker'}})).event;
    yes(makerEvent?.id,'maker thread event');pass('maker-enters-thread');

    const makerBefore=await req(INBOX,'/me/inbox',{id:maker});
    const inviteSource=find(makerBefore,'invite_source_owner');yes(inviteSource,'invite source action missing');eq(inviteSource.priority,'action','invite source priority');pass('maker-inbox-invite-source');

    const sourceInvite=(await req(THREAD,`/posts/${post.id}/solution-room/invitations`,{method:'POST',id:maker,expected:[201],body:{source_owner:true}})).invitation;
    const sourcePending=await req(INBOX,'/me/inbox',{id:source});
    const pending=find(sourcePending,'room_invitation');yes(pending,'source pending invite missing');eq(pending.meta.invitation_id,sourceInvite.id,'source invite id');pass('voice-inbox-pending-invite');

    const accepted=await req(THREAD,`/solution-room-invitations/${sourceInvite.id}/accept`,{method:'POST',id:source,body:{problem_statement:'複数システム間の定型的な手動転記に毎日時間を取られる',confirm_shared_problem:true}});
    eq(accepted.invitation.status,'accepted','source accepted');pass('voice-accepts-transition');

    const caseRow=(await req(THREAD,`/solution-rooms/${sourceInvite.room_id}/cases`,{method:'POST',id:maker,expected:[201],body:{title:'Inbox E2E Case',contribution:'Shared Problemから購入可能な成果物へ'}})).case;
    const makerCaseInbox=await req(INBOX,'/me/inbox',{id:maker});
    const productize=find(makerCaseInbox,'productize_case');yes(productize,'productize action missing');eq(productize.meta.case_id,caseRow.id,'case id in action');pass('maker-inbox-productize-case');

    const product=(await req(COMMERCE,'/products',{method:'POST',id:maker,expected:[201],body:{
      solution_case_id:caseRow.id,title:'Inbox E2E Product',description:'Action Inbox test Product',price_yen:650,delivery_text:'INBOX E2E SECRET DELIVERY'
    }})).product;
    const makerPublishInbox=await req(INBOX,'/me/inbox',{id:maker});
    const publish=find(makerPublishInbox,'publish_product');yes(publish,'publish action missing');eq(publish.meta.product_id,product.id,'publish product id');pass('maker-inbox-publish-product');

    await req(COMMERCE,`/products/${product.id}/publish-back`,{method:'POST',id:maker,expected:[201]});
    const sourceProductInbox=await req(INBOX,'/me/inbox',{id:source});
    const ready=find(sourceProductInbox,'product_ready');yes(ready,'product ready update missing');eq(ready.meta.product_id,product.id,'ready product id');eq(ready.seen,false,'ready initially unseen');pass('voice-inbox-product-ready');

    await req(INBOX,'/me/inbox/seen',{method:'POST',id:source,body:{keys:[ready.key]}});
    const seenInbox=await req(INBOX,'/me/inbox',{id:source});
    const seenReady=find(seenInbox,'product_ready');yes(seenReady,'seen product ready missing');eq(seenReady.seen,true,'seen marker');pass('inbox-seen-marker');

    const purchase=await req(COMMERCE,`/products/${product.id}/purchase`,{method:'POST',id:source,expected:[201]});
    eq(purchase.order.payment_status,'paid','purchase paid');pass('voice-purchases-product');

    const purchasedInbox=await req(INBOX,'/me/inbox',{id:source});
    yes(!find(purchasedInbox,'product_ready'),'product ready should disappear after purchase');
    const receive=find(purchasedInbox,'purchase_ready');yes(receive,'purchase receive action missing');eq(receive.meta.order_id,purchase.order.id,'purchase order id');pass('voice-inbox-purchase-ready');

    const roomMessage=(await req(THREAD,`/solution-rooms/${sourceInvite.room_id}/messages`,{method:'POST',id:source,expected:[201],body:{content:'この仕様なら使えそうです'}})).message;
    yes(roomMessage?.id,'room message');pass('voice-posts-room-message');

    const makerAfter=await req(INBOX,'/me/inbox',{id:maker});
    const activity=find(makerAfter,'room_activity');yes(activity,'room activity missing');eq(activity.meta.message_id,roomMessage.id,'room message id');
    const sale=find(makerAfter,'sale');yes(sale,'sale update missing');eq(sale.meta.order_id,purchase.order.id,'sale order id');
    yes(!find(makerAfter,'publish_product'),'publish action should resolve after publish-back');
    yes(!find(makerAfter,'productize_case'),'productize action should resolve after Product creation');
    pass('maker-inbox-resolves-and-updates');

    return new Response(JSON.stringify({ok:true,environment:'ai-staging',fixture:{
      post_id:post.id,room_id:sourceInvite.room_id,case_id:caseRow.id,product_id:product.id,order_id:purchase.order.id,
      source_pubkey:source.pk,maker_pubkey:maker.pk
    },results,responses}),{headers:{'content-type':'application/json',...cors}});
  }catch(error){
    results.push({name:'execution',status:'FAIL',detail:String((error as any)?.message||error)});
    return new Response(JSON.stringify({ok:false,error:String((error as any)?.message||error),results,responses}),{status:500,headers:{'content-type':'application/json',...cors}});
  }
});