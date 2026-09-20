import { getPublicKey } from 'https://esm.sh/nostr-tools@2.17.0';
import { client, fromHex } from './canonical-api.js?v=20260920-consolidated-v1';

const $=s=>document.querySelector(s);
const params=new URLSearchParams(location.search);
const room=String(params.get('room')||'').trim();
const viewOnly=params.get('mode')==='view';
const validRoom=/^[0-9a-f-]{36}$/i.test(room);
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
let accessState={can_write:false,role:null,invitation:null};

if(!validRoom){
  $('#room-title').textContent='見つかりません';
  $('#room-id').textContent='invalid';
  $('#room-problem').textContent='この解決ページのIDが不正です。';
  $('#room-form').hidden=true;
}else{
  $('#room-id').textContent=viewOnly?'閲覧モード':`room:${room.slice(0,8)}…`;
}

$('#room-identity').textContent=identity?`${identity.pk.slice(0,8)}…${identity.pk.slice(-6)}`:'not logged in';
const submit=$('#room-form button[type="submit"]');
const caseButton=$('#solution-case-create');

function setStatus(text,state=''){
  const node=$('#room-status');
  if(!node)return;
  node.textContent=text;
  if(state)node.dataset.state=state;else delete node.dataset.state;
}

function applyAccess(){
  if(viewOnly){
    $('#room-form').hidden=true;
    const identityCard=$('.identity-card');if(identityCard)identityCard.hidden=true;
    return;
  }
  if(!identity){
    submit.disabled=true;
    caseButton.hidden=true;
    setStatus('ここで話すには、元の困りごとでMakerから招待を受けてログインしてください。');
    return;
  }
  if(!accessState.can_write){
    submit.disabled=true;
    caseButton.hidden=true;
    $('#room-message').disabled=true;
    setStatus(accessState.invitation?.status==='pending'
      ?'招待はまだ未承認です。元の困りごとから招待を確認してください。'
      :'内容は閲覧できますが、話し合いへの参加には元の困りごとからの招待が必要です。');
    return;
  }
  $('#room-message').disabled=false;
  submit.disabled=false;
  caseButton.hidden=accessState.role!=='maker'||!accessState.problem_statement;
  setStatus(accessState.role==='maker'
    ?(accessState.problem_statement?'Makerとして「一緒に解決」に参加しています。まとまったら解決メモを作れます。':'Makerとして準備中です。元のBOYAKI投稿者が「一緒に解決」へ進むことに同意すると、解決メモを作れます。')
    :'招待されたVoiceとして「一緒に解決」に参加しています。');
}

function yen(value){const n=Number(value);return Number.isFinite(n)&&n>0?new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(n):''}
function renderDemandEvidence(evidence){
  const box=$('#room-demand-evidence');if(!box)return;
  box.replaceChildren();
  const title=document.createElement('p');title.className='eyebrow';title.textContent='Demand Evidence';
  const heading=document.createElement('h3');heading.textContent='この困りごとに集まっている反応';
  const summary=document.createElement('div');summary.className='demand-ladder';
  const rows=[
    ['同じことで困ってる',evidence?.same_problem?.count||0],
    ['解決したら試したい',evidence?.would_try?.count||0],
    ['この条件なら払える',evidence?.would_pay?.count||0]
  ];
  for(const [label,count] of rows){const chip=document.createElement('span');chip.className=`step${count?' on':''}`;chip.textContent=`${label} ${count}`;summary.append(chip)}
  if(evidence?.would_pay?.median_yen){const chip=document.createElement('span');chip.className='step on';chip.textContent=`支払中央値 ${yen(evidence.would_pay.median_yen)}`;summary.append(chip)}
  box.append(title,heading,summary);
  const conditions=evidence?.pay_conditions||[];
  if(conditions.length){
    const note=document.createElement('p');note.className='hint';note.textContent='匿名の成立条件';box.append(note);
    for(const row of conditions){const item=document.createElement('div');item.className='thread-item';const strong=document.createElement('strong');strong.textContent=yen(row.amount_yen);item.append(strong,document.createTextNode(` — ${row.condition_text}`));box.append(item)}
  }else{
    const empty=document.createElement('p');empty.className='hint';empty.textContent='まだ「この条件なら払える」という反応はありません。';box.append(empty);
  }
}

async function loadRoomMeta(){
  if(!validRoom)return false;
  try{
    const result=await client.getSolutionRoom(room);
    const data=result.room,post=data?.post;
    renderDemandEvidence(data?.demand_evidence||{});
    const sourceWithdrawn=post?.source_withdrawn===true;
    const sharedProblem=String(data?.problem_statement?.statement||post?.problem_statement||'').trim();
    const raw=String(post?.content||sharedProblem||'元のBOYAKIを取得できませんでした').trim();
    $('#room-title').textContent=raw.length>54?`${raw.slice(0,54)}…`:raw;
    $('#room-problem').textContent=sourceWithdrawn
      ?`残った困りごと: ${sharedProblem||raw}\n\n元の個人的なBOYAKI本文は投稿者によって取り下げ済みです。`
      :raw;
    const sourceLink=$('#room-source-link');
    if(post?.id){sourceLink.hidden=false;sourceLink.href=`./?problem=${encodeURIComponent(post.id)}`;sourceLink.textContent=sourceWithdrawn?'残った困りごとを見る':'元のBOYAKIを見る'}
    else sourceLink.hidden=true;
    document.title=`${raw.slice(0,32)||'一緒に解決'} — BOYAKI`;
    return true;
  }catch(err){
    console.error('solution room metadata failed',err);
    $('#room-title').textContent='一緒に解決を読み込めませんでした';
    $('#room-problem').textContent='この解決ページが削除されたか、読み込みに失敗しました。';
    $('#room-form').hidden=true;
    setStatus('情報を取得できませんでした。','error');
    return false;
  }
}

async function loadAccess(){
  if(viewOnly||!identity||!validRoom){applyAccess();return}
  try{
    accessState=await client.getSolutionRoomAccess(room);
  }catch(err){
    console.error('solution room access failed',err);
    accessState={can_write:false,role:null,invitation:null};
  }
  applyAccess();
}

function renderMessage(message){
  const text=String(message.content||'').trim();if(!text)return null;
  const mine=identity?.pk===message.author_pubkey;
  const item=document.createElement('div');item.className=`room-message${mine?' mine':''}`;item.dataset.messageId=message.id;
  const meta=document.createElement('div');meta.className='room-meta';
  const name=message.display_name?.trim()||`${message.author_pubkey.slice(0,8)}…${message.author_pubkey.slice(-6)}`;
  meta.textContent=`${name} · ${fmt(message.created_at)}${mine?' · you':''}`;
  const body=document.createElement('p');body.textContent=text;item.append(meta,body);
  if(mine&&!viewOnly&&accessState.can_write){
    const actions=document.createElement('div');actions.className='room-actions';
    const del=document.createElement('button');del.type='button';del.textContent='取り下げ';
    del.addEventListener('click',async()=>{
      del.disabled=true;setStatus('メッセージを取り下げています…','working');
      try{await client.deleteSolutionRoomMessage(message.id);setStatus('メッセージを取り下げました。','success');await loadMessages()}
      catch(err){console.error('solution room delete failed',err);setStatus('取り下げできませんでした。','error');del.disabled=false}
    });
    actions.append(del);item.append(actions);
  }
  return item;
}

async function loadMessages({silent=false}={}){
  if(!validRoom||loading)return false;
  loading=true;const log=$('#room-log');
  if(!silent)log.innerHTML='<p class="hint">話し合いの記録を読み込んでいます…</p>';
  try{
    const result=await client.listSolutionRoomMessages(room),messages=result.messages||[];
    const stickToBottom=Math.abs(log.scrollHeight-log.scrollTop-log.clientHeight)<80;
    log.replaceChildren();
    if(!messages.length){const empty=document.createElement('p');empty.className='hint room-empty';empty.textContent='まだ話し合いはありません。';log.append(empty)}
    else for(const message of messages){const node=renderMessage(message);if(node)log.append(node)}
    if(stickToBottom||!silent)log.scrollTop=log.scrollHeight;
    return true;
  }catch(err){
    console.error('solution room load failed',err);
    if(!silent){log.innerHTML='<p class="hint">話し合いの記録を読み込めませんでした。</p>';setStatus('読み込みに失敗しました。','error')}
    return false;
  }finally{loading=false}
}

if(!viewOnly){
  $('#room-form').addEventListener('submit',async e=>{
    e.preventDefault();if(!accessState.can_write)return;
    const input=$('#room-message'),text=input.value.trim();if(!text)return;
    submit.disabled=true;submit.textContent='送信中…';setStatus('発言を保存しています…','working');
    try{
      await client.createSolutionRoomMessage(room,text);input.value='';
      setStatus('発言を保存しました。','success');await loadMessages();input.focus();
    }catch(err){
      console.error('solution room publish failed',err);
      setStatus(String(err?.message||err)==='room_invitation_required'?'ここへの参加権がありません。元の困りごとの招待を確認してください。':'送信できませんでした。','error');
    }finally{submit.disabled=!accessState.can_write;submit.textContent='送信'}
  });

  $('#room-refresh')?.addEventListener('click',async()=>{setStatus('更新しています…','working');await loadAccess();const ok=await loadMessages();if(ok&&accessState.can_write)setStatus('最新の話し合いを表示しています。','success')});
  $('#room-report')?.addEventListener('click',()=>setStatus('通報対象の選択フローはまだ未接続です。'));
  caseButton?.addEventListener('click',()=>{
    if(accessState.role!=='maker'){setStatus('解決メモはMakerだけが作成できます。','error');return}
    if(!accessState.problem_statement){setStatus('元のBOYAKI投稿者が「一緒に解決」へ進むことに同意するまで、解決メモは作成できません。','error');return}
    location.href=`./solution-case-create.html?room=${encodeURIComponent(room)}`;
  });
}

const roomReady=await loadRoomMeta();
if(roomReady){await loadAccess();await loadMessages()}
if(roomReady&&validRoom)refreshTimer=setInterval(()=>loadMessages({silent:true}),8000);
window.addEventListener('pagehide',()=>{if(refreshTimer)clearInterval(refreshTimer)},{once:true});
