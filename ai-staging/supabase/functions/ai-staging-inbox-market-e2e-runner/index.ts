import { finalizeEvent, generateSecretKey, getPublicKey } from 'npm:nostr-tools@2.17.0';

const BASE='https://vbqitqjhobzpdlaraglc.supabase.co/functions/v1';
const API=BASE+'/ai-staging-boyaki-api';
const THREAD=BASE+'/ai-staging-boyaki-thread-api';
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
  try{
    const source=make(),maker=make();
    for(const [id,name] of [[source,'Inbox Market E2E Source'],[maker,'Inbox Market E2E Maker']] as any[]){
      await req(API,'/me/account',{method:'POST',id,body:{profile:{displayName:name,interest:'both',about:'Inbox market opportunity E2E'}}});
    }
    const opportunityPost=(await req(API,'/posts',{method:'POST',id:source,expected:[201],body:{content:`AI-STAGING INBOX MARKET E2E ${Date.now()} recurring paperwork`,identity_kind:'account'}})).post;
    await req(THREAD,`/posts/${opportunityPost.id}/thread`,{method:'POST',id:source,expected:[201],body:{event_type:'proposal',content:'自分で共同解決フェーズへ進める',identity_kind:'account',participant_role:'maker'}});
    const selfInvite=(await req(THREAD,`/posts/${opportunityPost.id}/solution-room/invitations`,{method:'POST',id:source,expected:[201],body:{source_owner:true}})).invitation;
    const accepted=await req(THREAD,`/solution-room-invitations/${selfInvite.id}/accept`,{method:'POST',id:source,body:{problem_statement:'毎日発生する定型的な事務作業に時間を取られる',confirm_shared_problem:true}});
    const problemId=accepted.problem_statement.id;pass('shared-problem-ready',problemId);

    await req(API,`/posts/${opportunityPost.id}/demand`,{method:'POST',id:maker,body:{signal:'would_pay',identity_kind:'account',amount_yen:1200,condition_text:'毎日の手作業がなくなるなら払いたい'}});pass('maker-demand-signal');

    const eligibilityPost=(await req(API,'/posts',{method:'POST',id:maker,expected:[201],body:{content:`AI-STAGING INBOX MARKET ELIGIBILITY ${Date.now()}`,identity_kind:'account'}})).post;
    await req(THREAD,`/posts/${eligibilityPost.id}/thread`,{method:'POST',id:maker,expected:[201],body:{event_type:'proposal',content:'Makerとして活動中',identity_kind:'account',participant_role:'maker'}});
    pass('maker-eligible');

    const inbox=await req(INBOX,'/me/inbox',{id:maker});
    const item=(inbox.items||[]).find((x:any)=>x.kind==='market_opportunity'&&x.meta?.post_id===opportunityPost.id);
    yes(item,'market opportunity missing');eq(item.priority,'ready','market opportunity priority');eq(item.meta.demand_score,3,'weighted pay demand score');pass('maker-market-opportunity');

    return new Response(JSON.stringify({ok:true,environment:'ai-staging',fixture:{
      opportunity_post_id:opportunityPost.id,opportunity_room_id:selfInvite.room_id,problem_id:problemId,
      eligibility_post_id:eligibilityPost.id,source_pubkey:source.pk,maker_pubkey:maker.pk
    },results,responses}),{headers:{'content-type':'application/json',...cors}});
  }catch(error){
    results.push({name:'execution',status:'FAIL',detail:String((error as any)?.message||error)});
    return new Response(JSON.stringify({ok:false,error:String((error as any)?.message||error),results,responses}),{status:500,headers:{'content-type':'application/json',...cors}});
  }
});