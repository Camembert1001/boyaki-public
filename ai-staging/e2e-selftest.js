const RUNNER='https://vbqitqjhobzpdlaraglc.supabase.co/functions/v1/ai-staging-e2e-runner';
const button=document.querySelector('#run'),summary=document.querySelector('#summary'),output=document.querySelector('#output');
button.addEventListener('click',async()=>{
  button.disabled=true;summary.textContent='AI-STAGING E2E 実行中…';
  try{const r=await fetch(RUNNER,{method:'POST',cache:'no-store'}),result=await r.json();output.textContent=JSON.stringify({http_status:r.status,...result},null,2);const bad=window.BOYAKI_AI_DIAGNOSTICS.network().filter(x=>x.status==='blocked'||x.status==='network-error');const ok=r.ok&&result.ok===true&&result.environment==='ai-staging'&&!bad.length;summary.className=ok?'pass':'fail';summary.textContent=`${ok?'PASS':'FAIL'} ${result.results?.filter(x=>x.status==='PASS').length||0}/${result.results?.length||0}`}catch(e){summary.className='fail';summary.textContent='FAIL';output.textContent=String(e.message)}finally{button.disabled=false}
});
async function diagnostics(){
  const cacheNames='caches' in window?await caches.keys():[];
  const workers='serviceWorker' in navigator?await navigator.serviceWorker.getRegistrations():[];
  document.querySelector('#diagnostics').textContent=JSON.stringify({environment:window.BOYAKI_ENVIRONMENT,namespace:window.BOYAKI_AI_DIAGNOSTICS.namespace,network:window.BOYAKI_AI_DIAGNOSTICS.network(),storageKeys:{local:Object.keys(window.localStorage),session:Object.keys(window.sessionStorage)},cacheNames,serviceWorkers:workers.map(r=>({scope:r.scope,scriptURL:r.active?.scriptURL}))},null,2);
}
document.querySelector('#inspect').addEventListener('click',()=>diagnostics().catch(e=>document.querySelector('#diagnostics').textContent=String(e.message)));
