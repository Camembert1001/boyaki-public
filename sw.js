const CACHE='boyaki-shell-v7-canonical-thread';
const ASSETS=['./index.html','./styles.css','./app.js','./canonical-api.js','./canonical-cutover.js','./quality-index-gate.js','./makers.html','./maker-space.js','./solution-candidates.json','./manifest.webmanifest'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  const isNavigation=e.request.mode==='navigate'||e.request.destination==='document';
  const alwaysFresh=isNavigation||/\/(mypage|profile-edit|register|index|app|canonical-api|canonical-cutover|canonical-mypage|quality-index-gate)(\.html|\.js)$/.test(u.pathname);
  if(alwaysFresh){
    e.respondWith(fetch(e.request,{cache:'no-store'}).catch(()=>caches.match('./index.html')));
    return;
  }
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request)));
});
