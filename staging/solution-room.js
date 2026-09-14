import { SimplePool, getPublicKey, finalizeEvent } from 'https://esm.sh/nostr-tools@2.17.0';
import { RELAYS } from './relays.js';

const $=s=>document.querySelector(s);
const pool=new SimplePool();
const params=new URLSearchParams(location.search);
const room=String(params.get('room')||'').trim();
const validRoom=/^[1-9]$/.test(room);
const fromHex=hex=>new Uint8Array((hex.match(/.{1,2}/g)||[]).map(b=>parseInt(b,16)));
const escapeHtml=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=ts=>new Date(ts*1000).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
const accountHex=localStorage.getItem('boyaki-account-sk')||sessionStorage.getItem('boyaki-account-sk');
let identity=null;
if(accountHex){try{const sk=fromHex(accountHex);identity={sk,pk:getPublicKey(sk)}}catch{}}

if(!validRoom){
  $('#room-title').textContent='Room not found';
  $('#room-id').textContent='invalid';
  $('#room-log').innerHTML='<p class="hint">Room 1〜9から選び直してください。</p>';
  $('#room-form').hidden=true;
}else{
  $('#room-title').textContent=`Room ${room}`;
  $('#room-id').textContent=`room:${room}`;
  document.title=`Room ${room} — BOYAKI`;
}

$('#room-identity').textContent=identity?`${identity.pk.slice(0,8)}…${identity.pk.slice(-6)}`:'not logged in';
const submit=$('#room-form button[type="submit"]');
if(!identity){submit.disabled=true;$('#room-status').textContent='送信するにはBOYAKI Accountでログインしてください。'}

function tag(ev,key){return (ev.tags||[]).find(t=>t[0]===key)?.[1]||''}
function parse(ev){try{return JSON.parse(ev.content||'{}')}catch{return {message:ev.content||''}}}
async function load(){
  if(!validRoom)return;
  const log=$('#room-log');
  log.innerHTML='<p class="hint">復元しています…</p>';
  try{
    const since=Math.floor(Date.now()/1000)-60*60*24*365;
    const [messages,deletions]=await Promise.all([
      pool.querySync(RELAYS,{kinds:[1],'#t':['boyaki-solution-room-message'],'#room_id':[room],since,limit:500}),
      pool.querySync(RELAYS,{kinds:[5],since,limit:1000})
    ]);
    const deleted=new Map();
    for(const d of deletions){let set=deleted.get(d.pubkey);if(!set){set=new Set();deleted.set(d.pubkey,set)}for(const t of d.tags||[])if(t[0]==='e'&&t[1])set.add(t[1])}
    const visible=messages.filter(ev=>!deleted.get(ev.pubkey)?.has(ev.id)).sort((a,b)=>a.created_at-b.created_at||String(a.id).localeCompare(String(b.id)));
    log.innerHTML='';
    if(!visible.length){log.innerHTML='<p class="hint room-empty">まだSolution Logはありません。最初のメッセージを送れます。</p>';return}
    for(const ev of visible){
      const data=parse(ev),message=String(data.message||data.note||'').trim();if(!message)continue;
      const mine=identity?.pk===ev.pubkey;
      const item=document.createElement('div');item.className=`room-message${mine?' mine':''}`;
      item.innerHTML=`<div class="room-meta">${escapeHtml(data.displayName||`${ev.pubkey.slice(0,8)}…${ev.pubkey.slice(-6)}`)} · ${escapeHtml(fmt(ev.created_at))}${mine?' · you':''}</div><p>${escapeHtml(message)}</p>`;
      if(mine){const b=document.createElement('button');b.type='button';b.textContent='取り下げ';b.addEventListener('click',()=>withdraw(ev));item.append(b)}
      log.append(item);
    }
  }catch(err){log.innerHTML=`<p class="hint">Solution Logを復元できませんでした。${escapeHtml(err?.message||'')}</p>`}
}

async function publishMessage(message){
  if(!identity||!validRoom)throw new Error('not logged in');
  const profileName=localStorage.getItem('boyaki-display-name')||localStorage.getItem('boyaki-maker-display-name')||'';
  const ev=finalizeEvent({kind:1,created_at:Math.floor(Date.now()/1000),content:JSON.stringify({message,displayName:profileName}),tags:[['t','boyaki-solution-room-message'],['room_id',room],['app','boyaki-web'],['schema','solution-room-message-v1']]},identity.sk);
  const out=await Promise.allSettled(pool.publish(RELAYS,ev));
  if(!out.some(x=>x.status==='fulfilled'))throw new Error('relay publish failed');
}
async function withdraw(ev){
  if(!identity||ev.pubkey!==identity.pk)return;
  const del=finalizeEvent({kind:5,created_at:Math.floor(Date.now()/1000),content:'withdraw BOYAKI Solution Room message',tags:[['e',ev.id],['k',String(ev.kind)],['room_id',room],['app','boyaki-web'],['schema','solution-room-withdraw-v1']]},identity.sk);
  const out=await Promise.allSettled(pool.publish(RELAYS,del));
  if(out.some(x=>x.status==='fulfilled'))await load();
}

$('#room-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!identity)return;
  const text=$('#room-message').value.trim();if(!text)return;
  submit.disabled=true;$('#room-status').textContent='送信しています…';
  try{await publishMessage(text);$('#room-message').value='';$('#room-status').textContent='送信しました。';await load()}
  catch{$('#room-status').textContent='送信できませんでした。少し後で再試行してください。'}
  finally{submit.disabled=false}
});
$('#room-refresh').addEventListener('click',()=>load());
load();
