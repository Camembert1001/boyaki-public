import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const read=p=>readFile(new URL(p,root),'utf8');
function storage(seed={}){
 const value={...seed};Object.defineProperties(value,{getItem:{value:k=>value[k]??null},setItem:{value:(k,v)=>value[k]=String(v)},removeItem:{value:k=>delete value[k]}});return value;
}
const local=storage({'boyaki-account-sk':'STAGING sentinel','boyaki-device-sk':'STAGING device','boyaki-profile-display-name':'STAGING profile'}),session=storage({'boyaki-account-sk':'STAGING session'}),calls=[];
class XHR{open(method,url){calls.push({method,url})}addEventListener(){}}
const context={URL,Request,XMLHttpRequest:XHR,location:{origin:'https://camembert1001.github.io',href:'https://camembert1001.github.io/boyaki-public/ai-staging/'},document:{documentElement:{dataset:{}},readyState:'loading',addEventListener(){}},navigator:{sendBeacon:()=>true},window:{localStorage:local,sessionStorage:session,fetch:async(url)=>{calls.push(url);return{status:200}}}};
vm.runInNewContext(await read('ai-environment.js'),context);
const s=context.window.BOYAKI_STORAGE;
s.local.setItem('boyaki-account-sk','AI sentinel');s.session.setItem('boyaki-account-sk','AI session');
assert.equal(local['boyaki-account-sk'],'STAGING sentinel');assert.equal(session['boyaki-account-sk'],'STAGING session');assert.equal(local['ai-staging:boyaki:boyaki-account-sk'],'AI sentinel');
s.local.clear();s.session.clear();assert.equal(local['boyaki-device-sk'],'STAGING device');assert.equal(local['boyaki-account-sk'],'STAGING sentinel');assert.equal(session['boyaki-account-sk'],'STAGING session');
const base='https://vbqitqjhobzpdlaraglc.supabase.co/functions/v1/';
for(const target of [base+'boyaki-api/posts',base+'boyaki-thread-api/posts','https://uvjyponltgoytjzwkfrh.supabase.co/functions/v1/boyaki-api/posts','https://camembert1001.github.io/boyaki-public/staging/index.html','https://camembert1001.github.io/boyaki-public/ai-staging/../staging/index.html',base+'ai-staging-boyaki-api-malicious/posts'])await assert.rejects(()=>context.window.fetch(target),/network_boundary/);
assert.equal(calls.length,0);await context.window.fetch(base+'ai-staging-boyaki-api/health');assert.equal(calls.length,1);
assert.throws(()=>new context.window.WebSocket('wss://example.com'),/relay_disabled/);
const events={},deleted=[],cached=[];let pending;
vm.runInNewContext(await read('sw.js'),{URL,Response,self:{location:{href:context.location.href+'sw.js'},addEventListener:(n,f)=>events[n]=f,clients:{claim:async()=>{}},skipWaiting:async()=>{}},caches:{keys:async()=>['boyaki-shell-v8','production-cache','ai-staging:boyaki:shell:old'],delete:async k=>deleted.push(k),open:async k=>({addAll:async a=>cached.push({k,a})})}});
events.activate({waitUntil:p=>pending=p});await pending;assert.deepEqual(deleted,['ai-staging:boyaki:shell:old']);
events.install({waitUntil:p=>pending=p});await pending;assert(cached.every(x=>x.k.startsWith('ai-staging:boyaki:')&&x.a.every(u=>u.startsWith(context.location.href))));
let intercepted=false;for(const url of [base+'ai-staging-boyaki-api/posts','https://camembert1001.github.io/boyaki-public/staging/index.html'])events.fetch({request:{method:'GET',url},respondWith:()=>intercepted=true});assert.equal(intercepted,false);
async function walk(dir=''){let files=[];for(const x of await readdir(new URL(dir||'.',root),{withFileTypes:true})){if(x.name==='tests'||x.name==='supabase')continue;const p=dir+x.name;if(x.isDirectory())files.push(...await walk(p+'/'));else files.push(p)}return files}
const files=await walk();for(const file of files.filter(f=>/\.(js|html)$/.test(f))){const text=await read(file);assert(!/functions\/v1\/boyaki|\/staging\/|wss:\/\//.test(text),file+' forbidden route');if(!['ai-environment.js','e2e-selftest.js'].includes(file))assert(!/\b(?:localStorage|sessionStorage)\b/.test(text),file+' unscoped storage');if(file.endsWith('.html')&&text.includes('<html')){assert(text.includes('ai-environment.js'),file+' missing environment');assert(text.includes('Content-Security-Policy'),file+' missing CSP');for(const match of text.matchAll(/(?:src|href)="([^"?#]+)(?:\?[^"#]*)?"/g)){const ref=match[1];if(ref.startsWith('./')||ref.startsWith('../')){if(!ref.endsWith('/'))await readFile(new URL(ref,new URL(file,root))).catch(()=>{throw Error(file+' missing asset '+ref)})}}}}
console.log(JSON.stringify({ok:true,checks:['local/session sentinel preserved including clear','normal APIs, Production API and path traversal denied before transport','public WebSockets blocked','worker cleanup limited to AI prefix','worker ignores API and other environments','all live HTML has early boundary and CSP','all application storage scoped','relative assets exist'],files:files.length},null,2));
