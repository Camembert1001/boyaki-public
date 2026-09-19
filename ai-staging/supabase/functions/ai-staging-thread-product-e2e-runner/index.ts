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
    const source=make(),voice=make(),maker=make();
    const post=(await req(API,'/posts',{method:'POST',id:source,expected:[201],body:{content:`AI-STAGING INVITE PUBLISHBACK E2E ${Date.now()}`,identity_kind:'account'}})).post;
    yes(post?.id,'post id');pass('source-boyaki');

    const voiceEvent=(await req(THREAD,`/posts/${post.id}/thread`,{method:'POST',id:voice,expected:[201],body:{event_type:'clarify',content:'自分も困ってる。ここが解決したら使いたい',identity_kind:'account',participant_role:'voice',display_name:'E2E Voice'}})).event;
    eq(voiceEvent.participant_role,'voice','voice role');pass('voice-thread-participation');

    const makerEvent=(await req(THREAD,`/posts/${post.id}/thread`,{method:'POST',id:maker,expected:[201],body:{event_type:'proposal',content:'一緒にSolution Roomで仕様を詰めたい',identity_kind:'account',participant_role:'maker',display_name:'E2E Maker'}})).event;
    eq(makerEvent.participant_role,'maker','maker role');pass('maker-thread-participation');

    const inviteResult=await req(THREAD,`/posts/${post.id}/solution-room/invitations`,{method:'POST',id:maker,expected:[201],body:{thread_event_id:voiceEvent.id}});
    const room=inviteResult.room,invitation=inviteResult.invitation;
    yes(room?.id,'room id');eq(invitation.invitee_account_pubkey,voice.pk,'invite recipient');eq(invitation.status,'pending','invite status');pass('maker-invites-voice');

    const voiceThreadAccess=await req(THREAD,`/posts/${post.id}/thread/access`,{id:voice});
    eq(voiceThreadAccess.my_invitation?.id,invitation.id,'voice invitation visible in thread');eq(voiceThreadAccess.my_invitation?.status,'pending','voice invitation pending');pass('voice-sees-thread-invite');

    const denied=await req(THREAD,`/solution-rooms/${room.id}/messages`,{method:'POST',id:voice,expected:[403],body:{content:'accept前には書けないはず'}});
    eq(denied.error,'room_invitation_required','pre-accept room write');pass('voice-write-blocked-before-accept');

    const accepted=await req(THREAD,`/solution-room-invitations/${invitation.id}/accept`,{method:'POST',id:voice});
    eq(accepted.invitation.status,'accepted','accepted status');pass('voice-accepts-invite');

    const access=await req(THREAD,`/solution-rooms/${room.id}/access`,{id:voice});
    eq(access.can_write,true,'voice room write access');eq(access.role,'voice','voice room role');pass('voice-room-membership');

    const roomMessage=(await req(THREAD,`/solution-rooms/${room.id}/messages`,{method:'POST',id:voice,expected:[201],body:{content:'この条件なら実際に使えそう'}})).message;
    yes(roomMessage?.id,'room message id');pass('voice-maker-room-discussion');

    const caseRow=(await req(THREAD,`/solution-rooms/${room.id}/cases`,{method:'POST',id:maker,expected:[201],body:{title:'Invite flow Case',contribution:'VoiceとRoomで話した内容からProduct化'}})).case;
    yes(caseRow?.id,'case id');pass('maker-creates-solution-case');

    const product=(await req(COMMERCE,'/products',{method:'POST',id:maker,expected:[201],body:{solution_case_id:caseRow.id,title:'Thread-born Product',description:'BOYAKIスレッドと招待Roomの会話から作ったテストProduct',price_yen:900,delivery_text:'SECRET THREAD PRODUCT DELIVERY'}})).product;
    yes(product?.id,'product id');pass('maker-creates-product');

    const before=await req(COMMERCE,`/posts/${post.id}/products`);
    eq((before.products||[]).length,0,'product should not auto-publish to thread');pass('product-not-auto-published');

    const publication=(await req(COMMERCE,`/products/${product.id}/publish-back`,{method:'POST',id:maker,expected:[201]})).publication;
    eq(publication.post_id,post.id,'publish-back post');eq(publication.room_id,room.id,'publish-back room');pass('maker-publishes-product-back');

    const after=await req(COMMERCE,`/posts/${post.id}/products`);
    const threadProduct=(after.products||[]).find((x:any)=>x.id===product.id);yes(threadProduct,'published product missing from source thread');eq(threadProduct.price_yen,900,'thread product price');pass('voice-discovers-product-in-thread');

    const makerProducts=await req(COMMERCE,'/me/products',{id:maker});
    const makerProduct=(makerProducts.products||[]).find((x:any)=>x.id===product.id);yes(makerProduct,'maker product missing');eq(makerProduct.thread_publication?.status,'active','Maker Space publication status');pass('product-remains-in-maker-space');

    const purchase=await req(COMMERCE,`/products/${product.id}/purchase`,{method:'POST',id:voice,expected:[201]});
    eq(purchase.order.payment_status,'paid','test purchase paid');eq(purchase.order.amount_yen,900,'purchase amount');eq(purchase.real_payment_processed,false,'no real payment');pass('voice-buys-thread-product');

    const delivery=await req(COMMERCE,`/products/${product.id}/access`,{id:voice});
    eq(delivery.product.delivery_text,'SECRET THREAD PRODUCT DELIVERY','delivery');pass('voice-receives-product');

    return new Response(JSON.stringify({ok:true,environment:'ai-staging',fixture:{post_id:post.id,room_id:room.id,invitation_id:invitation.id,room_message_id:roomMessage.id,case_id:caseRow.id,product_id:product.id,order_id:purchase.order.id},results,responses}),{headers:{'content-type':'application/json',...cors}});
  }catch(error){
    results.push({name:'execution',status:'FAIL',detail:String((error as any)?.message||error)});
    return new Response(JSON.stringify({ok:false,error:String((error as any)?.message||error),results,responses}),{status:500,headers:{'content-type':'application/json',...cors}});
  }
});