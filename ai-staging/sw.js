const PREFIX='ai-staging:boyaki:shell:';
const CACHE=PREFIX+'20260920-consolidated-v2';
const ROOT=new URL('./',self.location.href);
const ASSETS=['index.html','styles.css','ai-environment.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS.map(p=>new URL(p,ROOT).href))).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  // Never cache API responses, credentials, external resources or other environments.
  if(e.request.method!=='GET'||u.origin!==ROOT.origin||!u.pathname.startsWith(ROOT.pathname))return;
  e.respondWith(fetch(e.request,{cache:'no-store'}).then(async r=>{if(r.ok&&r.type==='basic')await(await caches.open(CACHE)).put(e.request,r.clone());return r}).catch(async()=>await(await caches.open(CACHE)).match(e.request)||new Response('BOYAKIに接続できません。オンラインで再読込してください。',{status:503,headers:{'content-type':'text/plain;charset=utf-8'}})));
});
