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
  async function headers(id:Id,url:string,method:string,raw=''){const tags:any[]=[['u',url],['method',method.toUpperCase()],['nonce',crypto.randomUUID()]];if(raw)tags.push(['payload',await sha(raw)]);const e=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:'',tags},id.sk);return{'Content-Type':'application/json','Authorization':`Nostr ${btoa(JSON.stringify(e))}`}}
  async function req(base:string,path:string,opt:any={}){const method=opt.method||'GET',body=opt.body??null,id=opt.id??null,expected=opt.expected||[200],url=base+path,raw=body===null?'':JSON.stringify(body),h=id?await headers(id,url,method,raw):{'Content-Type':'application/json'};const r=await fetch(url,{method,headers:h,body:raw||undefined}),text=await r.text();let p:any={};try{p=JSON.parse(text)}catch{p={body:text}}responses.push({method,url,status:r.status,body:p});if(!expected.includes(r.status))fail(`${method} ${path} -> ${r.status}: ${JSON.stringify(p)}`);return p}
  try{
    const source=make(),maker=make(),voice=make();
    const statement='複数システム間の定型的な手動転記に毎日時間を取られる';

    const post=(await req(API,'/posts',{method:'POST',id:source,expected:[201],body:{content:`AI-STAGING SHARED PROBLEM E2E ${Date.now()} 個人的な原文`,identity_kind:'account'}})).post;
    yes(post?.id,'post id');pass('source-boyaki');

    await req(THREAD,`/posts/${post.id}/thread`,{method:'POST',id:maker,expected:[201],body:{event_type:'proposal',content:'この問題を一緒に解きたい',identity_kind:'account',participant_role:'maker'}});
    const voiceEvent=(await req(THREAD,`/posts/${post.id}/thread`,{method:'POST',id:voice,expected:[201],body:{event_type:'clarify',content:'自分も同じ痛みがある',identity_kind:'account',participant_role:'voice'}})).event;
    pass('thread-participants');

    const sourceInvite=(await req(THREAD,`/posts/${post.id}/solution-room/invitations`,{method:'POST',id:maker,expected:[201],body:{source_owner:true}})).invitation;
    const acceptedSource=await req(THREAD,`/solution-room-invitations/${sourceInvite.id}/accept`,{method:'POST',id:source,body:{problem_statement:statement,confirm_shared_problem:true}});
    eq(acceptedSource.problem_statement.statement,statement,'shared problem statement');pass('shared-problem-created');

    const voiceInvite=(await req(THREAD,`/posts/${post.id}/solution-room/invitations`,{method:'POST',id:maker,expected:[201],body:{thread_event_id:voiceEvent.id}})).invitation;
    const acceptedVoice=await req(THREAD,`/solution-room-invitations/${voiceInvite.id}/accept`,{method:'POST',id:voice,body:{problem_statement:null,confirm_shared_problem:false}});
    eq(acceptedVoice.invitation.status,'accepted','voice accepted');pass('additional-voice-joins');

    await req(API,`/posts/${post.id}/demand`,{method:'POST',id:voice,body:{signal:'same_problem',identity_kind:'account'}});
    const roomMessage=(await req(THREAD,`/solution-rooms/${sourceInvite.room_id}/messages`,{method:'POST',id:voice,expected:[201],body:{content:'一般化されたProblemならこのまま議論を続けられる'}})).message;
    yes(roomMessage?.id,'room message');pass('room-collaboration');

    const caseRow=(await req(THREAD,`/solution-rooms/${sourceInvite.room_id}/cases`,{method:'POST',id:maker,expected:[201],body:{title:'Shared Problem Case',contribution:'原文ではなく共有Problemを解く'}})).case;
    const product=(await req(COMMERCE,'/products',{method:'POST',id:maker,expected:[201],body:{solution_case_id:caseRow.id,title:'Shared Problem Product',description:'一般化Problemから作られたProduct',price_yen:800,delivery_text:'SECRET SHARED PROBLEM DELIVERY'}})).product;
    pass('product-created');

    const withdrawn=await req(API,`/posts/${post.id}`,{method:'DELETE',id:source});
    eq(withdrawn.status,'source_withdrawn','withdraw status');eq(withdrawn.thread_preserved,true,'thread preserved');eq(withdrawn.demand_signals_purged,false,'demand preserved');pass('original-text-withdrawn-only');

    const feed=await req(API,'/posts?limit=100');
    const visible=(feed.posts||[]).find((x:any)=>x.id===post.id);yes(visible,'shared problem missing from feed');eq(visible.source_withdrawn,true,'source withdrawn flag');eq(visible.content,statement,'feed problem text');eq(visible.author_pubkey,null,'withdrawn author should be hidden');pass('shared-problem-stays-discoverable');

    const mine=await req(API,'/me/posts',{id:source});
    const minePost=(mine.posts||[]).find((x:any)=>x.id===post.id);eq(minePost.content,null,'original content should be purged');eq(minePost.status,'withdrawn','source row status');eq(minePost.problem_statement,statement,'owner problem fallback');pass('original-content-purged');

    const thread=await req(THREAD,`/posts/${post.id}/thread`);
    eq(thread.problem_statement.statement,statement,'thread problem statement');yes((thread.events||[]).some((x:any)=>x.id===voiceEvent.id),'voice event lost');pass('thread-survives-source-withdrawal');

    const demand=await req(API,`/posts/${post.id}/demand`);
    eq(demand.signals.same_problem.count,1,'demand should survive');pass('demand-survives-source-withdrawal');

    const publication=(await req(COMMERCE,`/products/${product.id}/publish-back`,{method:'POST',id:maker,expected:[201]})).publication;
    eq(publication.post_id,post.id,'publish-back post');pass('product-publishes-to-shared-problem');

    const published=await req(COMMERCE,`/posts/${post.id}/products`);
    const threadProduct=(published.products||[]).find((x:any)=>x.id===product.id);yes(threadProduct,'product missing from shared problem');eq(threadProduct.source_post.content,statement,'product source should be problem statement');eq(threadProduct.source_post.source_withdrawn,true,'product source withdrawn flag');pass('shared-problem-is-product-shelf');

    const purchase=await req(COMMERCE,`/products/${product.id}/purchase`,{method:'POST',id:voice,expected:[201]});
    eq(purchase.order.amount_yen,800,'purchase amount');eq(purchase.real_payment_processed,false,'no real payment');pass('voice-buys-after-source-withdrawal');

    const delivery=await req(COMMERCE,`/products/${product.id}/access`,{id:voice});
    eq(delivery.product.delivery_text,'SECRET SHARED PROBLEM DELIVERY','delivery');pass('voice-receives-product');

    return new Response(JSON.stringify({ok:true,environment:'ai-staging',fixture:{post_id:post.id,room_id:sourceInvite.room_id,case_id:caseRow.id,product_id:product.id,order_id:purchase.order.id,source_invitation_id:sourceInvite.id,voice_invitation_id:voiceInvite.id},results,responses}),{headers:{'content-type':'application/json',...cors}});
  }catch(error){
    results.push({name:'execution',status:'FAIL',detail:String((error as any)?.message||error)});
    return new Response(JSON.stringify({ok:false,error:String((error as any)?.message||error),results,responses}),{status:500,headers:{'content-type':'application/json',...cors}});
  }
});