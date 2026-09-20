import { client } from './canonical-api.js?v=20260920-consolidated-v2';

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
  const sourceWithdrawn=post?.source_withdrawn===true;
  const hasSource=Boolean(post?.content);
  const meta=document.createElement('p');
  meta.className='eyebrow';
  meta.textContent=`一緒に解決 · ${fmt(room.updated_at||room.created_at)}`;

  const title=document.createElement('h3');
  const raw=hasSource?String(post.content).trim():'困りごとを取得できませんでした';
  title.textContent=raw.length>72?`${raw.slice(0,72)}…`:raw;

  const hint=document.createElement('p');
  hint.className='hint';
  hint.textContent=sourceWithdrawn
    ?'元の個人的なBOYAKI本文は取り下げ済みです。残した困りごと・話し合い・解決メモは続いています。'
    :'ここでの話し合いと解決メモは、このAccount IDのMaker履歴に残ります。';

  const actions=document.createElement('div');
  actions.className='actions';

  const open=document.createElement('a');
  open.className='button-link';
  open.href=`./solution-room.html?room=${encodeURIComponent(room.id)}`;
  open.textContent='一緒に解決を開く';
  actions.append(open);

  if(post?.id){
    const source=document.createElement('a');
    source.className='button-link';
    source.href=`./?problem=${encodeURIComponent(post.id)}`;
    source.textContent=sourceWithdrawn?'残った困りごとを見る':'元のBOYAKIを見る';
    actions.append(source);
  }

  card.append(meta,title,hint,actions);
  return card;
}

async function load(){
  status.textContent='進行中の解決を読み込んでいます…';
  try{
    const result=await client.listSolutionRooms();
    const rooms=result.rooms||[];
    list.replaceChildren();
    if(!rooms.length){
      const empty=document.createElement('div');
      empty.className='participation-panel';
      empty.innerHTML='<h3>まだ「一緒に解決」はありません</h3><p class="hint">BOYAKIの話し合いでMakerとして参加し、必要なVoiceを「一緒に解決」へ招待すると始まります。</p>';
      const a=document.createElement('a');a.className='button-link';a.href='./';a.textContent='BOYAKIを探す';empty.append(a);list.append(empty);
    }else{
      for(const room of rooms)list.append(roomCard(room));
    }
    status.textContent=`${rooms.length}件の進行中の解決`;
  }catch(err){
    console.error('solution room list failed',err);
    status.textContent='進行中の解決を読み込めませんでした。再読み込みしてください。';
    list.innerHTML='<div class="participation-panel"><p class="hint">読み込みに失敗しました。</p></div>';
  }
}

const id=accountIdentity();
device.textContent=id?`Account · ${short(id.pk)}`:'not logged in';
await Promise.all([load(),loadProducts()]);
async function loadProducts(){
  const box=$('#maker-products-list'),state=$('#maker-products-status');
  if(!box)return;
  const id=accountIdentity();
  if(!id){box.innerHTML='<p class="hint">ログインすると、このAccount IDで作ったProductが表示されます。</p>';if(state)state.textContent='';return}
  if(state)state.textContent='Productを読み込んでいます…';
  try{
    const result=await client.listMyProducts(),products=result.products||[];
    box.replaceChildren();
    if(!products.length)box.innerHTML='<p class="hint">まだProductはありません。解決メモからProductを作れます。</p>';
    for(const product of products){
      const card=document.createElement('article');card.className='participation-panel';
      const h=document.createElement('h3');h.textContent=product.title;
      const meta=document.createElement('p');meta.className='hint';
      meta.textContent=`${new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(product.price_yen)} · ${product.thread_publication?.status==='active'?'元の困りごとに掲載済み':'まだ元の困りごとに未掲載'}`;
      const actions=document.createElement('div');actions.className='actions';
      const open=document.createElement('a');open.className='button-link';open.href=`./product.html?id=${encodeURIComponent(product.id)}`;open.textContent=product.thread_publication?.status==='active'?'Productを見る / 掲載先確認':'Productを見る / 元の困りごとへ掲載';
      actions.append(open);
      if(product.thread_publication?.status==='active'){
        const thread=document.createElement('a');thread.className='button-link';thread.href=`./?problem=${encodeURIComponent(product.thread_publication.post_id)}`;thread.textContent='掲載先を見る';
        actions.append(thread);
      }
      card.append(h,meta,actions);box.append(card);
    }
    if(state)state.textContent=`${products.length}件のProduct`;
  }catch(err){
    console.error('maker products failed',err);box.innerHTML='<p class="hint">Productを読み込めませんでした。</p>';if(state)state.textContent='読み込みに失敗しました。';
  }
}

