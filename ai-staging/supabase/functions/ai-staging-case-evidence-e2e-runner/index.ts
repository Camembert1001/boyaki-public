import { finalizeEvent, generateSecretKey, getPublicKey } from 'npm:nostr-tools@2.17.0';
const BASE='https://vbqitqjhobzpdlaraglc.supabase.co/functions/v1',API=BASE+'/ai-staging-boyaki-api',THREAD=BASE+'/ai-staging-boyaki-thread-api';
type Id={sk:Uint8Array;pk:string;kind:'account'|'legacy_browser'};
Deno.serve(async request=>{
 const cors={'Access-Control-Allow-Origin':'https://camembert1001.github.io','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'content-type'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const results:any[]=[],responses:any[]=[];const pass=(n:string)=>results.push({name:n,status:'PASS'});
 const fail=(m:string):never=>{throw Error(m)},eq=(a:any,b:any,m:string)=>{if(a!==b)fail(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`)},yes=(v:any,m:string)=>{if(!v)fail(m)};
 const sha=async(s:string)=>{const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return[...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')};
 const make=(kind:'account'|'legacy_browser'='account'):Id=>{const sk=generateSecretKey();return{sk,pk:getPublicKey(sk),kind}};
 async function hdr(id:Id,url:string,method:string,raw=''){const tags:any[]=[['u',url],['method',method.toUpperCase()],['nonce',crypto.randomUUID()]];if(raw)tags.push(['payload',await sha(raw)]);const e=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:'',tags},id.sk);return{'Content-Type':'application/json','Authorization':`Nostr ${btoa(JSON.stringify(e))}`}}
 async function req(base:string,path:string,opt:any={}){const method=opt.method||'GET',body=opt.body??null,id=opt.id??null,expected=opt.expected||[200],url=base+path,raw=body===null?'':JSON.stringify(body),headers=id?await hdr(id,url,method,raw):{'Content-Type':'application/json'};const r=await fetch(url,{method,headers,body:raw||undefined}),t=await r.text();let p:any={};try{p=JSON.parse(t)}catch{p={body:t}}responses.push({method,url,status:r.status,body:p});if(!expected.includes(r.status))fail(`${method} ${path} -> ${r.status}: ${JSON.stringify(p)}`);return p}
 let source:Id|null=null,postId='',caseId='';
 try{
  const health=await req(THREAD,'/health');eq(health.case_evidence_snapshot,true,'case evidence health');pass('case-evidence-health');
  source=make();const maker=make(),buyer=make();
  for(const [id,name] of [[source,'Evidence E2E Source'],[maker,'Evidence E2E Maker'],[buyer,'Evidence E2E Buyer']] as any[]){await req(API,'/me/account',{method:'POST',id,body:{profile:{displayName:name,interest:'both',about:'Case evidence E2E'}}})}
  pass('accounts-ready');
  const post=(await req(API,'/posts',{method:'POST',id:source,expected:[201],body:{content:`AI-STAGING CASE EVIDENCE E2E ${Date.now()}`,identity_kind:'account'}})).post;postId=post.id;pass('source-post');
  await req(API,`/posts/${postId}/demand`,{method:'POST',id:buyer,body:{signal:'same_problem',identity_kind:'account'}});
  await req(API,`/posts/${postId}/demand`,{method:'POST',id:buyer,body:{signal:'would_try',identity_kind:'account'}});
  await req(API,`/posts/${postId}/demand`,{method:'POST',id:buyer,body:{signal:'would_pay',identity_kind:'account',amount_yen:500,condition_text:'毎朝の転記がゼロになるなら'}});pass('initial-demand');

  const room=(await req(THREAD,`/posts/${postId}/solution-room`,{method:'POST',id:maker,expected:[201]})).room;yes(room.id,'room id');pass('room-create');
  let detail=(await req(THREAD,`/solution-rooms/${room.id}`)).room;
  eq(detail.demand_evidence.same_problem.count,1,'room same problem');eq(detail.demand_evidence.would_try.count,1,'room would try');eq(detail.demand_evidence.would_pay.median_yen,500,'room median');pass('room-live-demand');

  const created=(await req(THREAD,`/solution-rooms/${room.id}/cases`,{method:'POST',id:maker,expected:[201],body:{title:'Evidence-backed Case',contribution:'Demand evidence was visible before implementation.'}})).case;caseId=created.id;
  eq(created.evidence_snapshot.same_problem.count,1,'case same problem snapshot');eq(created.evidence_snapshot.would_pay.median_yen,500,'case median snapshot');pass('case-captures-evidence');

  await req(API,`/posts/${postId}/demand`,{method:'POST',id:buyer,body:{signal:'would_pay',identity_kind:'account',amount_yen:1200,condition_text:'設定不要で自動化されるなら'}});pass('demand-changed-after-case');
  detail=(await req(THREAD,`/solution-rooms/${room.id}`)).room;eq(detail.demand_evidence.would_pay.median_yen,1200,'room should show live demand');pass('room-demand-stays-live');

  let mine=await req(THREAD,'/me/solution-cases',{id:maker});const restored=mine.cases.find((x:any)=>x.id===caseId);yes(restored,'case history missing');eq(restored.evidence_snapshot.would_pay.median_yen,500,'case snapshot mutated');pass('case-evidence-is-frozen');

  await req(API,`/posts/${postId}`,{method:'DELETE',id:source});pass('source-withdraw');
  detail=(await req(THREAD,`/solution-rooms/${room.id}`)).room;eq(detail.demand_evidence.would_pay.count,0,'live demand not purged after source withdraw');eq(detail.post.content,null,'source content not purged');pass('room-after-source-withdraw');
  mine=await req(THREAD,'/me/solution-cases',{id:maker});const after=mine.cases.find((x:any)=>x.id===caseId);eq(after.evidence_snapshot.would_pay.median_yen,500,'historical snapshot lost after source withdraw');pass('case-snapshot-survives-source-withdraw');

  await req(THREAD,`/solution-cases/${caseId}`,{method:'DELETE',id:maker});caseId='';pass('case-cleanup');
  return new Response(JSON.stringify({ok:true,environment:'ai-staging',room_id:room.id,results,responses}),{headers:{'content-type':'application/json',...cors}});
 }catch(error){
  if(caseId){/* cleanup handled outside if owner context unavailable here */}
  if(postId&&source)try{await req(API,`/posts/${postId}`,{method:'DELETE',id:source,expected:[200,404]})}catch{}
  results.push({name:'execution',status:'FAIL',detail:String((error as any)?.message||error)});
  return new Response(JSON.stringify({ok:false,error:String((error as any)?.message||error),results,responses}),{status:500,headers:{'content-type':'application/json',...cors}});
 }
});