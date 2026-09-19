import { finalizeEvent, generateSecretKey, getPublicKey } from 'npm:nostr-tools@2.17.0';
const BASE='https://vbqitqjhobzpdlaraglc.supabase.co/functions/v1';
const API=BASE+'/ai-staging-boyaki-api';
type Id={sk:Uint8Array;pk:string;kind:'account'|'legacy_browser'};

Deno.serve(async request=>{
 const cors={'Access-Control-Allow-Origin':'https://camembert1001.github.io','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'content-type'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(request.method!=='POST')return new Response(JSON.stringify({ok:true,service:'ai-staging-demand-e2e-runner',environment:'ai-staging'}),{headers:{'content-type':'application/json',...cors}});
 const results:any[]=[],responses:any[]=[];
 const pass=(name:string,detail:any='')=>results.push({name,status:'PASS',detail});
 const fail=(message:string):never=>{throw new Error(message)};
 const yes=(value:any,message:string)=>{if(!value)fail(message)};
 const eq=(a:any,b:any,message:string)=>{if(a!==b)fail(`${message}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`)};
 const sha=async(text:string)=>{const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return[...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')};
 const identity=(kind:'account'|'legacy_browser'='account'):Id=>{const sk=generateSecretKey();return{sk,pk:getPublicKey(sk),kind}};
 async function headers(id:Id,url:string,method:string,raw=''){
  const tags:any[]=[['u',url],['method',method.toUpperCase()],['nonce',crypto.randomUUID()]];
  if(raw)tags.push(['payload',await sha(raw)]);
  const event=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:'',tags},id.sk);
  return{'Content-Type':'application/json','Authorization':`Nostr ${btoa(JSON.stringify(event))}`};
 }
 async function req(path:string,opt:any={}){
  const method=opt.method||'GET',body=opt.body??null,id=opt.id??null,expected=opt.expected||[200];
  const url=API+path,raw=body===null?'':JSON.stringify(body),h=id?await headers(id,url,method,raw):{'Content-Type':'application/json'};
  const response=await fetch(url,{method,headers:h,body:raw||undefined});
  const text=await response.text();let payload:any={};try{payload=JSON.parse(text)}catch{payload={body:text}}
  responses.push({method,url,status:response.status,body:payload,request_id:response.headers.get('sb-request-id')});
  if(!expected.includes(response.status))fail(`${method} ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
 }
 let owner:Id|null=null,postId='';
 try{
  const health=await req('/health');eq(health.demand_evidence,true,'demand health flag');pass('demand-health');
  owner=identity('account');const buyer=identity('account');const anon=identity('legacy_browser');
  for(const [id,name] of [[owner,'Demand E2E Owner'],[buyer,'Demand E2E Buyer']] as any[]){
   const saved=await req('/me/account',{method:'POST',id,body:{profile:{displayName:name,interest:'both',about:'AI-STAGING demand E2E'}}});
   eq(saved.account.account_pubkey,id.pk,'account save');pass(name==='Demand E2E Owner'?'owner-account':'buyer-account');
  }
  const created=await req('/posts',{method:'POST',id:owner,expected:[201],body:{content:`AI-STAGING DEMAND E2E ${Date.now()}`,identity_kind:'account'}});
  postId=created.post.id;yes(postId,'post id');pass('demand-post-create',postId);

  let agg=await req(`/posts/${postId}/demand`);
  eq(agg.signals.same_problem.count,0,'empty same_problem');eq(agg.signals.would_pay.count,0,'empty would_pay');pass('demand-empty');

  const self=await req(`/posts/${postId}/demand`,{method:'POST',id:owner,expected:[409],body:{signal:'same_problem',identity_kind:'account'}});
  eq(self.error,'source_author_cannot_signal_demand','source author rejection');pass('source-author-excluded');

  await req(`/posts/${postId}/demand`,{method:'POST',id:buyer,body:{signal:'same_problem',identity_kind:'account'}});pass('same-problem-save');
  await req(`/posts/${postId}/demand`,{method:'POST',id:buyer,body:{signal:'would_try',identity_kind:'account'}});pass('would-try-save');
  await req(`/posts/${postId}/demand`,{method:'POST',id:buyer,body:{signal:'would_pay',identity_kind:'account',amount_yen:500,condition_text:'二重入力がなくなるなら'}});pass('would-pay-save');

  agg=await req(`/posts/${postId}/demand`);
  eq(agg.signals.same_problem.count,1,'same problem aggregate');eq(agg.signals.would_try.count,1,'would try aggregate');eq(agg.signals.would_pay.count,1,'would pay aggregate');eq(agg.signals.would_pay.median_yen,500,'pay median one');eq(agg.signals.would_pay.account_count,1,'account pay count');yes(agg.pay_conditions.some((x:any)=>x.amount_yen===500&&x.condition_text==='二重入力がなくなるなら'),'pay condition missing');pass('demand-aggregate-one');

  const mine=await req(`/posts/${postId}/demand/mine`,{id:buyer});
  eq(mine.signals.length,3,'mine signal count');eq(mine.is_source_author,false,'buyer source flag');pass('demand-mine');

  await req(`/posts/${postId}/demand`,{method:'POST',id:buyer,body:{signal:'would_pay',identity_kind:'account',amount_yen:700,condition_text:'毎朝の転記が自動になるなら'}});pass('would-pay-update');
  await req(`/posts/${postId}/demand`,{method:'POST',id:anon,body:{signal:'would_pay',identity_kind:'legacy_browser',amount_yen:1300,condition_text:'設定が5分以内なら'}});pass('anonymous-would-pay');

  agg=await req(`/posts/${postId}/demand`);
  eq(agg.signals.would_pay.count,2,'pay count two');eq(agg.signals.would_pay.account_count,1,'pay account count one');eq(agg.signals.would_pay.min_yen,700,'pay min');eq(agg.signals.would_pay.median_yen,1000,'pay median');eq(agg.signals.would_pay.max_yen,1300,'pay max');pass('demand-aggregate-mixed');

  const feed=await req('/posts?limit=100');
  const feedPost=(feed.posts||[]).find((x:any)=>x.id===postId);yes(feedPost,'feed post missing');eq(feedPost.demand_summary.would_pay,2,'feed pay count');eq(feedPost.demand_summary.median_yen,1000,'feed median');pass('feed-demand-summary');

  await req(`/posts/${postId}/demand/same_problem`,{method:'DELETE',id:buyer});pass('demand-withdraw');
  const mineAfter=await req(`/posts/${postId}/demand/mine`,{id:buyer});yes(!mineAfter.signals.some((x:any)=>x.signal==='same_problem'),'same problem still mine');pass('demand-withdraw-hidden');

  await req(`/posts/${postId}`,{method:'DELETE',id:owner});pass('source-post-delete');
  const gone=await req(`/posts/${postId}/demand`,{expected:[404]});eq(gone.error,'post_not_found','demand should hide after source delete');pass('demand-hidden-after-source-delete');
  const reject=await req(`/posts/${postId}/demand`,{method:'POST',id:buyer,expected:[404],body:{signal:'would_try',identity_kind:'account'}});eq(reject.error,'post_not_found','demand write after source delete');pass('demand-write-rejected-after-source-delete');

  return new Response(JSON.stringify({ok:true,environment:'ai-staging',results,responses}),{headers:{'content-type':'application/json',...cors}});
 }catch(error){
  if(postId&&owner)try{await req(`/posts/${postId}`,{method:'DELETE',id:owner,expected:[200,404]})}catch{}
  results.push({name:'execution',status:'FAIL',detail:String((error as any)?.message||error)});
  return new Response(JSON.stringify({ok:false,error:String((error as any)?.message||error),results,responses}),{status:500,headers:{'content-type':'application/json',...cors}});
 }
});