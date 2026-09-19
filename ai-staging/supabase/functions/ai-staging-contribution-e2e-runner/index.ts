import { finalizeEvent, generateSecretKey, getPublicKey } from 'npm:nostr-tools@2.17.0';
const BASE='https://vbqitqjhobzpdlaraglc.supabase.co/functions/v1';
const API=BASE+'/ai-staging-boyaki-api',THREAD=BASE+'/ai-staging-boyaki-thread-api';
type Id={sk:Uint8Array;pk:string;kind:'account'|'legacy_browser'};

Deno.serve(async request=>{
 const cors={'Access-Control-Allow-Origin':'https://camembert1001.github.io','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'content-type'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const results:any[]=[],responses:any[]=[];
 const pass=(name:string)=>results.push({name,status:'PASS'});
 const fail=(m:string):never=>{throw Error(m)},eq=(a:any,b:any,m:string)=>{if(a!==b)fail(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`)},yes=(v:any,m:string)=>{if(!v)fail(m)};
 const sha=async(s:string)=>{const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return[...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')};
 const make=():Id=>{const sk=generateSecretKey();return{sk,pk:getPublicKey(sk),kind:'account'}};
 async function headers(id:Id,url:string,method:string,raw=''){const tags:any[]=[['u',url],['method',method.toUpperCase()],['nonce',crypto.randomUUID()]];if(raw)tags.push(['payload',await sha(raw)]);const e=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:'',tags},id.sk);return{'Content-Type':'application/json','Authorization':`Nostr ${btoa(JSON.stringify(e))}`}}
 async function req(base:string,path:string,opt:any={}){const method=opt.method||'GET',body=opt.body??null,id=opt.id??null,expected=opt.expected||[200],url=base+path,raw=body===null?'':JSON.stringify(body),h=id?await headers(id,url,method,raw):{'Content-Type':'application/json'};const r=await fetch(url,{method,headers:h,body:raw||undefined}),text=await r.text();let p:any={};try{p=JSON.parse(text)}catch{p={body:text}}responses.push({method,url,status:r.status,body:p});if(!expected.includes(r.status))fail(`${method} ${path} -> ${r.status}: ${JSON.stringify(p)}`);return p}
 let source:Id|null=null,postId='';
 try{
  const health=await req(THREAD,'/health');eq(health.voice_history,true,'voice history flag');pass('voice-history-health');
  source=make();const voice=make();
  for(const [id,name] of [[source,'Voice E2E Source'],[voice,'Voice E2E Participant']] as any[]){await req(API,'/me/account',{method:'POST',id,body:{profile:{displayName:name,interest:'both',about:'Voice contribution E2E'}}})}
  pass('accounts-ready');
  const post=(await req(API,'/posts',{method:'POST',id:source,expected:[201],body:{content:`AI-STAGING VOICE HISTORY E2E ${Date.now()}`,identity_kind:'account'}})).post;postId=post.id;pass('voice-source-post');

  const clarify=(await req(THREAD,`/posts/${postId}/thread`,{method:'POST',id:voice,expected:[201],body:{event_type:'clarify',content:'どの作業が一番時間かかる？',identity_kind:'account',participant_role:'voice'}})).event;yes(clarify.id,'clarify id');eq(clarify.participant_role,'voice','clarify role');pass('voice-role-persisted');
  const voiceMsg=(await req(THREAD,`/posts/${postId}/thread`,{method:'POST',id:voice,expected:[201],body:{event_type:'message',content:'自分も毎朝同じ作業で困る',identity_kind:'account',participant_role:'voice'}})).event;pass('voice-message-persisted');
  await req(THREAD,`/posts/${postId}/thread`,{method:'POST',id:voice,expected:[201],body:{event_type:'proposal',content:'自動化スクリプト案',identity_kind:'account',participant_role:'maker'}});pass('maker-role-persisted-separately');
  await req(API,`/posts/${postId}/demand`,{method:'POST',id:voice,body:{signal:'same_problem',identity_kind:'account'}});pass('voice-demand-signal');

  let history=await req(THREAD,'/me/voice-history',{id:voice});
  eq(history.thread_contributions.length,2,'voice thread count');eq(history.demand_signals.length,1,'voice demand count');
  yes(history.thread_contributions.every((x:any)=>x.participant_role==='voice'),'maker contribution leaked into voice history');
  yes(history.thread_contributions.every((x:any)=>x.post?.id===postId),'voice source post missing');pass('voice-history-cross-device');

  await req(THREAD,`/thread/${clarify.id}`,{method:'DELETE',id:voice});pass('voice-contribution-delete');
  history=await req(THREAD,'/me/voice-history',{id:voice});eq(history.thread_contributions.length,1,'deleted voice event still visible');eq(history.thread_contributions[0].id,voiceMsg.id,'wrong surviving voice event');pass('voice-history-delete-reflected');

  await req(API,`/posts/${postId}`,{method:'DELETE',id:source});pass('source-withdraw');
  history=await req(THREAD,'/me/voice-history',{id:voice});eq(history.thread_contributions.length,0,'thread contribution remained after source withdrawal');eq(history.demand_signals.length,0,'demand remained after source withdrawal');pass('voice-history-source-withdrawal-clean');
  return new Response(JSON.stringify({ok:true,environment:'ai-staging',results,responses}),{headers:{'content-type':'application/json',...cors}});
 }catch(error){
  if(postId&&source)try{await req(API,`/posts/${postId}`,{method:'DELETE',id:source,expected:[200,404]})}catch{}
  results.push({name:'execution',status:'FAIL',detail:String((error as any)?.message||error)});
  return new Response(JSON.stringify({ok:false,error:String((error as any)?.message||error),results,responses}),{status:500,headers:{'content-type':'application/json',...cors}});
 }
});