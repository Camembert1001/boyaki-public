import { client } from './canonical-api.js?v=20260919-solution-flow-v3';

const $=s=>document.querySelector(s);
const list=$('#solution-room-list');
const status=$('#room-status');
const device=$('#device-id');

function short(value){return value?`${value.slice(0,8)}…${value.slice(-6)}`:'not logged in'}
function fmt(value){return value?new Date(value).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):''}
function accountIdentity(){
  const id=client.identity();
  return id?.kind==='account'?id:null;
}
function roomCard(room){
  const card=document.createElement('article');
  card.className='participation-panel solution-room-card';
  card.dataset.solutionRoomId=room.id;

  const post=room.post;
  const sourceActive=post?.status==='active'&&Boolean(post?.content);
  const meta=document.createElement('p');
  meta.className='eyebrow';
  meta.textContent=`Solution Room · ${fmt(room.updated_at||room.created_at)}`;

  const title=document.createElement('h3');
  const raw=sourceActive?String(post.content).trim():'元のBOYAKIは取り下げ済み';
  title.textContent=raw.length>72?`${raw.slice(0,72)}…`:raw;

  const hint=document.createElement('p');
  hint.className='hint';
  hint.textContent=sourceActive
    ?'このRoomのSolution LogとSolution CaseはAI-STAGINGだけに保存され、通常STAGINGの活動履歴とは分離されています。'
    :'元のBOYAKIは取り下げ済みですが、Maker側のSolution Log / Caseは履歴として保持されています。';

  const actions=document.createElement('div');
  actions.className='actions';

  const open=document.createElement('a');
  open.className='button-link';
  open.href=`./solution-room.html?room=${encodeURIComponent(room.id)}`;
  open.textContent='Solution Roomを開く';
  actions.append(open);

  if(sourceActive&&post?.id){
    const source=document.createElement('a');
    source.className='button-link';
    source.href=`./?problem=${encodeURIComponent(post.id)}`;
    source.textContent='元のBOYAKIを見る';
    actions.append(source);
  }

  card.append(meta,title,hint,actions);
  return card;
}

async function load(){
  status.textContent='Solution Roomsを読み込んでいます…';
  try{
    const result=await client.listSolutionRooms();
    const rooms=result.rooms||[];
    list.replaceChildren();
    if(!rooms.length){
      const empty=document.createElement('div');
      empty.className='participation-panel';
      empty.innerHTML='<h3>まだSolution Roomはありません</h3><p class="hint">BOYAKIのスレッドで「解決を具体化する」→「Solution Roomを作る」から始められます。</p>';
      const a=document.createElement('a');a.className='button-link';a.href='./';a.textContent='BOYAKIを探す';empty.append(a);list.append(empty);
    }else{
      for(const room of rooms)list.append(roomCard(room));
    }
    status.textContent=`${rooms.length}件のSolution Room`;
  }catch(err){
    console.error('solution room list failed',err);
    status.textContent='Solution Roomsを読み込めませんでした。再読み込みしてください。';
    list.innerHTML='<div class="participation-panel"><p class="hint">読み込みに失敗しました。</p></div>';
  }
}

const id=accountIdentity();
device.textContent=id?`Account · ${short(id.pk)}`:'not logged in';
await load();
