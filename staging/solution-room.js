import { SimplePool, getPublicKey, finalizeEvent } from 'https://esm.sh/nostr-tools@2.17.0';
import { RELAYS } from './relays.js';

const $=s=>document.querySelector(s);
const pool=new SimplePool();
const params=new URLSearchParams(location.search);
const room=String(params.get('room')||'').trim();
const validRoom=/^[1-9]$/.test(room);
const fromHex=hex=>new Uint8Array((hex.match(/.{1,2}/g)||[]).map(b=>parseInt(b,16)));
const escapeHtml=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=ts=>new Date(ts*1000).toLocaleString('ja-JP',{month:'numeric',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const accountHex=localStorage.getItem('boyaki-account-sk')||sessionStorage.getItem('boyaki-account-sk');
let identity=null,sub=null;
const seen=new Set();
if(accountHex){try{const sk=fromHex(accountHex);identity={sk,pk:getPublicKey(sk)}}catch{}}

if(!validRoom){$('#room-title').textContent='Room not found';$('#room-id').textContent='invalid';$('#room-log').innerHTML='<p class="hint">Room 1〜9から選び直してください。</p>';$('#room-form').hidden=true}else{$('#room-title').textContent=`Room ${room}`;$('#room-id').textContent=`room:${room}`;document.title=`Room ${room} — BOYAKI`}
$('#room-identity').textContent=identity?`${identity.pk.slice(0,8)}…${identity.pk.slice(-6)}`:'not logged in';
const submit=$('#room-form button[type="submit"]');
const actions=$('.room-actions');
if(actions){if(!$('#room-report')){const b=document.createElement('button');b.type='button';b.id='room-report';b.textContent='ルーム/メッセージを通報する';actions.append(b)}if(!$('#solution-case-create')){const b=document.createElement('button');b.type='button';b.id='solution-case-create';b.textContent='ソリューションケース作成';actions.append(b)}}
if(!identity){submit.disabled=true;$('#room-status').textContent='送信するにはBOYAKI Accountでログインしてください。'}

function parse(ev){try{return JSON.parse(ev.content||'{}')}catch{return {message:ev.content||''}}}
function renderMessage(ev,{pending=false}={}){
  if(seen.has(ev.id))return;const data=parse(ev),message=String(data.message||data.note||'').trim();if(!message)return;
  seen.add(ev.id);const log=$('#room-log');log.querySelector('.room-empty')?.remove();
  const mine=identity?.pk===ev.pubkey;const item=document.createElement('div');item.className=`room-message${mine?' mine':''}`;item.dataset.eventId=ev.id;
  item.innerHTML=`<div class="room-meta">${escapeHtml(data.displayName||`${ev.pubkey.slice(0,8)}…${ev.pubkey.slice(-6)}`)} · ${escapeHtml(fmt(ev.created_at))}${mine?' · you':''}${pending?' · 送信中':''}</div><p>${escapeHtml(message)}</p>`;
  log.append(item);item.scrollIntoView({block:'nearest'});
}
async function load(){
  if(!validRoom)return;const log=$('#room-log');log.innerHTML='<p class="hint">復元しています…</p>';seen.clear();
  try{const since=Math.floor(Date.now()/1000)-60*60*24*365;const [messages,deletions]=await Promise.all([pool.querySync(RELAYS,{kinds:[1],'#t':['boyaki-solution-room-message'],'#room_id':[room],since,limit:500}),pool.querySync(RELAYS,{kinds:[5],since,limit:1000})]);const deleted=new Map();for(const d of deletions){let set=deleted.get(d.pubkey);if(!set){set=new Set();deleted.set(d.pubkey,set)}for(const t of d.tags||[])if(t[0]==='e'&&t[1])set.add(t[1])}const visible=messages.filter(ev=>!deleted.get(ev.pubkey)?.has(ev.id)).sort((a,b)=>a.created_at-b.created_at||String(a.id).localeCompare(String(b.id)));log.innerHTML='';if(!visible.length)log.innerHTML='<p class="hint room-empty">まだSolution Logはありません。最初のメッセージを送れます。</p>';for(const ev of visible)renderMessage(ev)}catch(err){log.innerHTML=`<p class="hint">Solution Logを復元できませんでした。${escapeHtml(err?.message||'')}</p>`}
}
function startRealtime(){
  if(!validRoom)return;try{sub?.close?.()}catch{}
  try{sub=pool.subscribeMany(RELAYS,[{kinds:[1],'#t':['boyaki-solution-room-message'],'#room_id':[room],since:Math.floor(Date.now()/1000)}],{onevent(ev){renderMessage(ev)},oneose(){}})}catch(err){console.warn('realtime subscribe failed',err)}
}
async function publishMessage(message){if(!identity||!validRoom)throw new Error('not logged in');const profileName=localStorage.getItem('boyaki-display-name')||localStorage.getItem('boyaki-maker-display-name')||'';const ev=finalizeEvent({kind:1,created_at:Math.floor(Date.now()/1000),content:JSON.stringify({message,displayName:profileName}),tags:[['t','boyaki-solution-room-message'],['room_id',room],['app','boyaki-web'],['schema','solution-room-message-v1']]},identity.sk);renderMessage(ev,{pending:true});const out=await Promise.allSettled(pool.publish(RELAYS,ev));if(!out.some(x=>x.status==='fulfilled')){seen.delete(ev.id);document.querySelector(`[data-event-id="${ev.id}"]`)?.remove();throw new Error('relay publish failed')}const meta=document.querySelector(`[data-event-id="${ev.id}"] .room-meta`);if(meta)meta.textContent=meta.textContent.replace(' · 送信中','');return ev}

$('#room-form').addEventListener('submit',async e=>{e.preventDefault();if(!identity)return;const text=$('#room-message').value.trim();if(!text)return;$('#room-message').value='';submit.disabled=true;$('#room-status').textContent='';try{await publishMessage(text)}catch{$('#room-message').value=text;$('#room-status').textContent='送信できませんでした。再試行してください。'}finally{submit.disabled=false;$('#room-message').focus()}});
$('#room-refresh').addEventListener('click',()=>load());
$('#room-report')?.addEventListener('click',()=>{$('#room-status').textContent='通報対象の選択フローは次の実装で接続します。'});
$('#solution-case-create')?.addEventListener('click',()=>{$('#room-status').textContent='ソリューションケース作成フローは次の実装で接続します。'});
await load();startRealtime();
window.addEventListener('pagehide',()=>{try{sub?.close?.()}catch{}});
