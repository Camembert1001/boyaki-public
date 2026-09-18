
const VERSION='20260909-room-v1';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const short=value=>value?`${value.slice(0,8)}…${value.slice(-6)}`:'guest';

window.BOYAKI_AI_STAGING_THREAD_ROOM_VERSION=VERSION;

async function client(){
  for(let i=0;i<60;i++){
    if(window.BOYAKI_CANONICAL)return window.BOYAKI_CANONICAL;
    await sleep(100);
  }
  throw new Error('canonical_client_missing');
}

async function createRoomMessage(api,postId,content,role,displayName){return api.createThread(postId,'message',content,null,{participant_role:role,display_name:displayName})}

function localDisplayName(){
  return (window.BOYAKI_STORAGE.local.getItem('boyaki-profile-display-name')||window.BOYAKI_STORAGE.local.getItem('boyaki-maker-display-name')||'').trim();
}
function roleLabel(role){return role==='maker'?'Maker':'Voice'}
function identityKey(ev){return ev.owner_account_pubkey||ev.author_pubkey}

function participantSummary(events,post){
  const map=new Map();
  for(const ev of events){
    if(ev.event_type!=='message'||!['voice','maker'].includes(ev.participant_role))continue;
    const key=identityKey(ev);
    map.set(key,{key,name:ev.display_name||short(ev.author_pubkey),role:ev.participant_role,created_at:ev.created_at});
  }
  const posterKey=post?.owner_account_pubkey||post?.author_pubkey||'';
  return [...map.values()].map(x=>({...x,isPoster:x.key===posterKey}));
}

function badge(text){
  const span=document.createElement('span');span.className='chip';span.textContent=text;return span;
}
function addParticipants(room,events,post){
  const participants=participantSummary(events,post);
  const section=document.createElement('div');section.dataset.boyakiRoomParticipants='1';section.className='participation-panel';
  const title=document.createElement('p');title.className='hint';title.innerHTML='<strong>このルームで発言している人</strong>';
  section.append(title);
  const row=document.createElement('div');row.className='chips';
  if(!participants.length){const empty=document.createElement('span');empty.className='hint';empty.textContent='まだ発言者はいません。';row.append(empty)}
  for(const p of participants){
    const chip=document.createElement('span');chip.className='chip';chip.textContent=`${p.name} · ${roleLabel(p.role)}${p.isPoster?' · 投稿者':''}`;row.append(chip);
  }
  section.append(row);room.append(section);
}

function addMessages(room,events,post,deletable,api,rerender){
  const list=document.createElement('div');list.className='thread';list.dataset.boyakiRoomMessages='1';
  const messages=events.filter(e=>e.event_type==='message');
  const posterKey=post?.owner_account_pubkey||post?.author_pubkey||'';
  for(const ev of messages){
    const item=document.createElement('div');item.className='thread-item';item.dataset.eventId=ev.id;item.dataset.eventType='boyaki-message';
    const head=document.createElement('div');head.className='chips';
    const name=document.createElement('strong');name.textContent=ev.display_name||short(ev.author_pubkey);head.append(name);
    head.append(badge(roleLabel(ev.participant_role)));
    if(identityKey(ev)===posterKey)head.append(badge('投稿者'));
    item.append(head);
    const body=document.createElement('p');body.textContent=ev.content||'';item.append(body);
    if(deletable.has(ev.id)){
      const actions=document.createElement('div');actions.className='actions';
      const del=document.createElement('button');del.type='button';del.textContent='削除';
      del.addEventListener('click',async()=>{del.disabled=true;try{await api.deleteThread(ev.id);await rerender()}catch(err){del.disabled=false;console.error(err)}});
      actions.append(del);item.append(actions);
    }
    list.append(item);
  }
  if(!messages.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='まだ会話は始まっていません。';list.append(empty)}
  const legacyCount=events.length-messages.length;
  if(legacyCount>0){const note=document.createElement('p');note.className='hint';note.textContent=`AI-STAGINGの旧形式テスト会話 ${legacyCount}件は新しいルーム表示から外しています。`;list.append(note)}
  room.append(list);
}

async function renderMount(mount){
  if(!mount?.isConnected)return;
  const article=mount.closest('[data-canonical-post-card]');
  const postId=article?.dataset?.canonicalPostId;if(!postId)return;
  const api=await client();
  if(window.BOYAKI_CANONICAL_THREAD_WRITE_CUTOVER_ACTIVE!==true){setTimeout(()=>renderMount(mount).catch(()=>{}),300);return}
  const thread=await api.listThread(postId);
  const id=api.identity();
  let access={current_role:null,current_display_name:null,deletable_event_ids:[]};
  if(id){try{access=await api.threadAccess(postId)}catch(err){console.warn('room access unavailable',err)}}
  const events=thread.events||[];
  const deletable=new Set(access.deletable_event_ids||[]);

  const room=document.createElement('section');room.dataset.boyakiRoomUi='1';room.dataset.version=VERSION;room.className='stack';
  const intro=document.createElement('div');intro.className='participation-panel';
  const h=document.createElement('h3');h.textContent='BOYAKIルーム';
  const hint=document.createElement('p');hint.className='hint';hint.textContent='見るだけなら参加操作は不要です。発言するときだけ Voice / Maker のどちらかを選びます。';
  intro.append(h,hint);room.append(intro);
  addParticipants(room,events,thread.post);

  const rerender=async()=>{mount.dataset.boyakiRoomRendering='1';await renderMount(mount);delete mount.dataset.boyakiRoomRendering};
  addMessages(room,events,thread.post,deletable,api,rerender);

  const speak=document.createElement('div');speak.className='participation-panel';speak.dataset.boyakiRoomSpeak='1';
  if(!id){
    const p=document.createElement('p');p.className='hint';p.textContent='閲覧は自由です。発言する場合はBOYAKIのidentityで参加してください。';speak.append(p);
  }else{
    const roleKey=`boyaki-room-role:${postId}`;
    let selected=window.BOYAKI_STORAGE.local.getItem(roleKey)||access.current_role||'';
    if(!['voice','maker'].includes(selected))selected='';
    const title=document.createElement('p');title.className='hint';title.innerHTML='<strong>発言するときの役割</strong>';
    const actions=document.createElement('div');actions.className='actions';
    const voice=document.createElement('button');voice.type='button';voice.textContent='Voiceとして参加';
    const maker=document.createElement('button');maker.type='button';maker.textContent='Makerとして参加';
    const state=document.createElement('p');state.className='hint';
    const form=document.createElement('form');form.dataset.canonicalThreadForm='1';form.dataset.form='room-message';form.hidden=true;
    const input=document.createElement('input');input.maxLength=240;input.placeholder='メッセージを入力';input.required=true;
    const send=document.createElement('button');send.type='submit';send.textContent='送信';form.append(input,send);
    const applyRole=role=>{
      selected=role;window.BOYAKI_STORAGE.local.setItem(roleKey,role);
      voice.setAttribute('aria-pressed',role==='voice'?'true':'false');maker.setAttribute('aria-pressed',role==='maker'?'true':'false');
      state.textContent=`${roleLabel(role)}として発言します。役割はこのBOYAKIルーム内だけのものです。`;
      form.hidden=false;
    };
    voice.addEventListener('click',()=>applyRole('voice'));maker.addEventListener('click',()=>applyRole('maker'));
    actions.append(voice,maker);speak.append(title,actions,state,form);
    if(selected)applyRole(selected);else state.textContent='見るだけなら選択しなくてOKです。';
    form.addEventListener('submit',async e=>{
      e.preventDefault();e.stopPropagation();
      const text=input.value.trim();if(!text||!selected)return;
      send.disabled=true;
      const name=(localDisplayName()||access.current_display_name||short(id.pk)).slice(0,80);
      try{await createRoomMessage(api,postId,text,selected,name);input.value='';await rerender()}catch(err){console.error('room message failed',err);state.textContent=`送信できませんでした: ${String(err?.message||err)}（Nostr Relayへは送信していません）`;send.disabled=false}
    });
  }
  room.append(speak);
  mount.replaceChildren(room);
  mount.dataset.boyakiRoomV1='1';
}

const pending=new WeakSet();
function schedule(mount){
  if(!mount||pending.has(mount))return;
  pending.add(mount);
  setTimeout(async()=>{pending.delete(mount);try{await renderMount(mount)}catch(err){console.warn('thread room render failed',err)}},180);
}
function scan(root=document){
  const mounts=[];
  if(root.matches?.('[data-canonical-thread-mount]'))mounts.push(root);
  root.querySelectorAll?.('[data-canonical-thread-mount]').forEach(x=>mounts.push(x));
  for(const mount of mounts){
    if(!mount.querySelector('[data-boyaki-room-ui]')&&!mount.dataset.boyakiRoomRendering)schedule(mount);
  }
}
new MutationObserver(records=>{for(const record of records){for(const node of record.addedNodes)if(node.nodeType===1)scan(node);const mount=record.target?.closest?.('[data-canonical-thread-mount]');if(mount&&!mount.querySelector('[data-boyaki-room-ui]'))schedule(mount)}}).observe(document.documentElement,{childList:true,subtree:true});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>scan());else scan();
