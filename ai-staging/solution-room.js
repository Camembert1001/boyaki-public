import { getPublicKey } from 'https://esm.sh/nostr-tools@2.17.0';
import { client, fromHex } from './canonical-api.js?v=20260919-solution-room-v2';

const $=s=>document.querySelector(s);
const params=new URLSearchParams(location.search);
const room=String(params.get('room')||'').trim();
const viewOnly=params.get('mode')==='view';
const validRoom=/^[1-9]$/.test(room);
const escapeHtml=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=value=>new Date(value).toLocaleString('ja-JP',{month:'numeric',day:'2-digit',hour:'2-digit',minute:'2-digit'});

function accountIdentity(){
  const hex=window.BOYAKI_STORAGE.local.getItem('boyaki-account-sk')||window.BOYAKI_STORAGE.session.getItem('boyaki-account-sk');
  if(!hex)return null;
  try{
    const sk=fromHex(hex);
    return {sk,pk:getPublicKey(sk),kind:'account'};
  }catch{return null}
}

const identity=accountIdentity();
let refreshTimer=null;
let loading=false;

if(!validRoom){
  $('#room-title').textContent='Room not found';
  $('#room-id').textContent='invalid';
  $('#room-form').hidden=true;
}else{
  $('#room-title').textContent=`Room ${room}`;
  $('#room-id').textContent=viewOnly?'閲覧モード':`room:${room}`;
  document.title=`Room ${room} — BOYAKI AI-STAGING`;
}

$('#room-identity').textContent=identity?`${identity.pk.slice(0,8)}…${identity.pk.slice(-6)}`:'not logged in';
const submit=$('#room-form button[type="submit"]');

if(viewOnly){
  $('#room-form').hidden=true;
  const identityCard=$('.identity-card');
  if(identityCard)identityCard.hidden=true;
  const hero=document.querySelector('.card.hero .hint');
  if(hero)hero.textContent='このSolution LogはAI-STAGING内の履歴からの閲覧モードです。ここから会話への参加・ケース作成はできません。';
}else if(!identity){
  submit.disabled=true;
  $('#room-status').textContent='送信するにはBOYAKI Accountでログインしてください。';
}

function setStatus(text,state=''){
  const node=$('#room-status');
  if(!node)return;
  node.textContent=text;
  if(state)node.dataset.state=state;else delete node.dataset.state;
}

function renderMessage(message){
  const text=String(message.content||'').trim();
  if(!text)return null;
  const mine=identity?.pk===message.author_pubkey;
  const item=document.createElement('div');
  item.className=`room-message${mine?' mine':''}`;
  item.dataset.messageId=message.id;

  const meta=document.createElement('div');
  meta.className='room-meta';
  const name=message.display_name?.trim()||`${message.author_pubkey.slice(0,8)}…${message.author_pubkey.slice(-6)}`;
  meta.textContent=`${name} · ${fmt(message.created_at)}${mine?' · you':''}`;

  const body=document.createElement('p');
  body.textContent=text;
  item.append(meta,body);

  if(mine&&!viewOnly){
    const actions=document.createElement('div');
    actions.className='room-actions';
    const del=document.createElement('button');
    del.type='button';
    del.textContent='取り下げ';
    del.addEventListener('click',async()=>{
      if(del.disabled)return;
      del.disabled=true;
      setStatus('メッセージを取り下げています…','working');
      try{
        await client.deleteSolutionRoomMessage(message.id);
        setStatus('メッセージを取り下げました。','success');
        await load();
      }catch(err){
        console.error('solution room delete failed',err);
        setStatus('取り下げできませんでした。通信状態を確認して再試行してください。','error');
        del.disabled=false;
      }
    });
    actions.append(del);
    item.append(actions);
  }
  return item;
}

async function load({silent=false}={}){
  if(!validRoom||loading)return;
  loading=true;
  const log=$('#room-log');
  if(!silent)log.innerHTML='<p class="hint">Solution Logを復元しています…</p>';
  try{
    const result=await client.listSolutionRoomMessages(room);
    const messages=result.messages||[];
    const stickToBottom=Math.abs(log.scrollHeight-log.scrollTop-log.clientHeight)<80;
    log.replaceChildren();
    if(!messages.length){
      const empty=document.createElement('p');
      empty.className='hint room-empty';
      empty.textContent='Solution Logはまだありません。ここから最初のメッセージを残せます。';
      log.append(empty);
    }else{
      for(const message of messages){
        const node=renderMessage(message);
        if(node)log.append(node);
      }
    }
    if(stickToBottom||!silent)log.scrollTop=log.scrollHeight;
  }catch(err){
    console.error('solution room load failed',err);
    if(!silent){
      log.innerHTML='<p class="hint">Solution Logを復元できませんでした。通信状態を確認して再試行してください。</p>';
      setStatus('読み込みに失敗しました。','error');
    }
  }finally{loading=false}
}

async function publishMessage(message){
  if(viewOnly||!identity||!validRoom)throw new Error('not_allowed');
  return client.createSolutionRoomMessage(room,message);
}

if(!viewOnly){
  $('#room-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const input=$('#room-message');
    const text=input.value.trim();
    if(!text)return;
    submit.disabled=true;
    submit.textContent='送信中…';
    setStatus('AI-STAGINGのSolution Logへ保存しています…','working');
    try{
      await publishMessage(text);
      input.value='';
      setStatus('Solution Logへ保存しました。STAGING側の履歴には反映されません。','success');
      await load();
      input.focus();
    }catch(err){
      console.error('solution room publish failed',err);
      setStatus('送信できませんでした。内容は保存されていません。','error');
    }finally{
      submit.disabled=!identity;
      submit.textContent='送信';
    }
  });

  $('#room-refresh')?.addEventListener('click',()=>{
    setStatus('更新しています…','working');
    load().then(()=>setStatus('最新のSolution Logを表示しています。','success')).catch(()=>{});
  });

  $('#room-report')?.addEventListener('click',()=>{
    setStatus('通報対象の選択フローは未接続です。今回の実装対象はSolution Roomの保存・復元・取り下げです。');
  });

  $('#solution-case-create')?.addEventListener('click',()=>{
    location.href=`./solution-case-create.html?room=${encodeURIComponent(room)}`;
  });
}

await load();
if(validRoom){
  refreshTimer=setInterval(()=>load({silent:true}),8000);
}
window.addEventListener('pagehide',()=>{if(refreshTimer)clearInterval(refreshTimer)},{once:true});
