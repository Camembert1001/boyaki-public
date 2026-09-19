// Loaded first on every page. Never migrate or delete other environments' keys.
(()=>{
  'use strict';
  const prefix='ai-staging:boyaki:';
  function scoped(storage){
    const keys=()=>Object.keys(storage).filter(k=>k.startsWith(prefix));
    return Object.freeze({getItem:key=>storage.getItem(prefix+key),setItem:(key,value)=>storage.setItem(prefix+key,String(value)),removeItem:key=>storage.removeItem(prefix+key),clear:()=>keys().forEach(k=>storage.removeItem(k)),key:index=>keys()[index]?.slice(prefix.length)??null,get length(){return keys().length}});
  }
  window.BOYAKI_STORAGE=Object.freeze({local:scoped(window.localStorage),session:scoped(window.sessionStorage)});
  window.BOYAKI_AI_STAGING=true;window.BOYAKI_ENVIRONMENT='ai-staging';window.BOYAKI_PLAINTEXT_NOSTR_PUBLICATION_DISABLED=true;
  document.documentElement.dataset.boyakiEnvironment='ai-staging';
  const base='https://vbqitqjhobzpdlaraglc.supabase.co/functions/v1/';
  const functions=['ai-staging-boyaki-api','ai-staging-boyaki-thread-api','ai-staging-commerce-api','ai-staging-e2e-runner'];
  const sharedIdentityResolve=base+'boyaki-api/account-credentials/resolve';
  const root=new URL('/boyaki-public/ai-staging/',location.origin);
  const allowed=value=>{const u=new URL(value,location.href);return (u.origin===root.origin&&u.pathname.startsWith(root.pathname))||functions.some(f=>u.href===base+f||u.href.startsWith(base+f+'/')||u.href.startsWith(base+f+'?'))||u.href===sharedIdentityResolve||u.href.startsWith(sharedIdentityResolve+'?')};
  // Only method, URL and status. Never record credentials, bodies or headers.
  let audit;try{audit=JSON.parse(window.BOYAKI_STORAGE.session.getItem('network-audit')||'[]')}catch{audit=[]}
  const record=(url,method,status)=>{const u=new URL(url,location.href);audit.push({url:u.origin+u.pathname,method,status});audit=audit.slice(-1000);window.BOYAKI_STORAGE.session.setItem('network-audit',JSON.stringify(audit))};
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async(input,init)=>{const url=input instanceof Request?input.url:String(input),method=init?.method||(input instanceof Request?input.method:'GET');if(!allowed(url)){record(url,method,'blocked');throw new Error('ai_staging_network_boundary')}try{const r=await nativeFetch(input,init);record(url,method,r.status);return r}catch(e){record(url,method,'network-error');throw e}};
  const open=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url,...args){if(!allowed(url)){record(url,method,'blocked');throw new Error('ai_staging_network_boundary')}this.addEventListener('loadend',()=>record(url,method,this.status),{once:true});return open.call(this,method,url,...args)};
  window.WebSocket=class{constructor(url){record(url,'WebSocket','blocked');throw new Error('ai_staging_public_relay_disabled')}};
  window.EventSource=class{constructor(url){record(url,'EventSource','blocked');throw new Error('ai_staging_stream_disabled')}};
  const beacon=navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon=(url,data)=>{if(!allowed(url)){record(url,'beacon','blocked');return false}record(url,'beacon','sent');return beacon(url,data)};
  window.BOYAKI_AI_DIAGNOSTICS=Object.freeze({network:()=>audit.map(x=>({...x})),namespace:prefix,allows:allowed});
  function banner(){
    document.querySelector('meta[name="robots"]')?.setAttribute('content','noindex,nofollow');
    if(!document.title.includes('AI-STAGING'))document.title+=' — AI-STAGING';
    if(document.querySelector('[data-boyaki-ai-staging-banner]'))return;
    const b=document.createElement('div');b.dataset.boyakiAiStagingBanner='1';b.textContent='AI-STAGING — AI実装・破壊テスト環境 / 本番・STAGINGではありません';b.style.cssText='position:sticky;top:0;z-index:2147483646;padding:8px 12px;text-align:center;font:700 13px/1.3 system-ui;background:#f3e8ff;color:#581c87;border-bottom:1px solid #c084fc';document.body.prepend(b);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',banner,{once:true});else banner();
})();
