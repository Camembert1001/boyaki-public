import { finalizeEvent, generateSecretKey, getPublicKey } from 'npm:nostr-tools@2.17.0';

const BASE='https://vbqitqjhobzpdlaraglc.supabase.co/functions/v1';
const API=BASE+'/ai-staging-boyaki-api';
const THREAD=BASE+'/ai-staging-boyaki-thread-api';
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
    const casual=make(),casualMaker=make();
    const casualPost=(await req(API,'/posts',{method:'POST',id:casual,expected:[201],body:{content:`AI-STAGING CASUAL DELETE E2E ${Date.now()}`,identity_kind:'account'}})).post;
    pass('casual-boyaki-create',casualPost.id);
    await req(THREAD,`/posts/${casualPost.id}/thread`,{method:'POST',id:casualMaker,expected:[201],body:{event_type:'proposal',content:'まだ共同解決には入っていない提案',identity_kind:'account',participant_role:'maker'}});
    const casualRoom=(await req(THREAD,`/posts/${casualPost.id}/solution-room`,{method:'POST',id:casualMaker,expected:[201]})).room;
    pass('casual-room-can-be-prepared');
    const earlyCase=await req(THREAD,`/solution-rooms/${casualRoom.id}/cases`,{method:'POST',id:casualMaker,expected:[409],body:{title:'Too early',contribution:'Should not persist before consent'}});
    eq(earlyCase.error,'shared_problem_required','case before consent');pass('case-blocked-before-consent');
    const deleted=await req(API,`/posts/${casualPost.id}`,{method:'DELETE',id:casual});
    eq(deleted.thread_preserved,false,'casual thread preservation');eq(deleted.status,'deleted','casual delete status');pass('casual-boyaki-fully-deletable');
    const feed=await req(API,'/posts?limit=100');
    yes(!(feed.posts||[]).some((x:any)=>x.id===casualPost.id),'casual deleted post still in feed');pass('casual-delete-removes-discovery');
    const missingThread=await req(THREAD,`/posts/${casualPost.id}/thread`,{expected:[404]});eq(missingThread.error,'post_not_found','casual thread should be gone');pass('casual-delete-removes-thread');
    const missingRoom=await req(THREAD,`/solution-rooms/${casualRoom.id}`,{expected:[404]});eq(missingRoom.error,'solution_room_not_found','casual room should be gone');pass('casual-delete-removes-room');

    const source=make(),maker=make();
    const post=(await req(API,'/posts',{method:'POST',id:source,expected:[201],body:{content:`AI-STAGING CONSENT BOUNDARY E2E ${Date.now()}`,identity_kind:'account'}})).post;
    await req(THREAD,`/posts/${post.id}/thread`,{method:'POST',id:maker,expected:[201],body:{event_type:'proposal',content:'共同解決へ進みたい',identity_kind:'account',participant_role:'maker'}});
    const invite=(await req(THREAD,`/posts/${post.id}/solution-room/invitations`,{method:'POST',id:maker,expected:[201],body:{source_owner:true}})).invitation;
    eq(invite.invitee_context,'source_owner','source invite context');eq(invite.invitee_account_pubkey,source.pk,'source invite recipient');pass('maker-invites-original-voice');
    const noConsent=await req(THREAD,`/solution-room-invitations/${invite.id}/accept`,{method:'POST',id:source,expected:[400],body:{problem_statement:'定型作業に時間を取られる',confirm_shared_problem:false}});
    eq(noConsent.error,'shared_problem_consent_required','explicit consent required');pass('explicit-consent-required');
    const accepted=await req(THREAD,`/solution-room-invitations/${invite.id}/accept`,{method:'POST',id:source,body:{problem_statement:'複数システム間の定型的な手動転記に毎日時間を取られる',confirm_shared_problem:true}});
    eq(accepted.shared_problem_created,true,'problem created');eq(accepted.problem_statement.statement,'複数システム間の定型的な手動転記に毎日時間を取られる','problem text');pass('source-owner-creates-shared-problem');
    const access=await req(THREAD,`/posts/${post.id}/thread/access`,{id:source});
    eq(access.problem_statement.statement,'複数システム間の定型的な手動転記に毎日時間を取られる','problem visible in thread');pass('shared-problem-visible');
    const caseRow=(await req(THREAD,`/solution-rooms/${invite.room_id}/cases`,{method:'POST',id:maker,expected:[201],body:{title:'Boundary Case',contribution:'Created only after original Voice consent'}})).case;
    yes(caseRow?.id,'case id after consent');pass('case-unlocked-after-consent',caseRow.id);

    return new Response(JSON.stringify({ok:true,environment:'ai-staging',fixtures:{casual_post_id:casualPost.id,consent_post_id:post.id,consent_room_id:invite.room_id,consent_case_id:caseRow.id},results,responses}),{headers:{'content-type':'application/json',...cors}});
  }catch(error){
    results.push({name:'execution',status:'FAIL',detail:String((error as any)?.message||error)});
    return new Response(JSON.stringify({ok:false,error:String((error as any)?.message||error),results,responses}),{status:500,headers:{'content-type':'application/json',...cors}});
  }
});