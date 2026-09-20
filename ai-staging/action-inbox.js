import { client } from './canonical-api.js?v=20260920-consolidated-v1';

const list=document.querySelector('[data-action-inbox]');
const status=document.querySelector('#action-inbox-status');
const summary=document.querySelector('#action-inbox-summary');
const markButton=document.querySelector('#inbox-mark-visible');
const hideSeen=document.querySelector('#inbox-hide-seen');
const tabBadge=document.querySelector('[data-inbox-tab-badge]');
const filterButtons=[...document.querySelectorAll('[data-inbox-filter]')];
let state={items:[],summary:{},filter:'all',loading:false};

const fmt=value=>value?new Date(value).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
const priorityLabel=value=>value==='action'?'要対応':value==='update'?'更新':'できること';
const kindLabel=value=>({
  room_invitation:'招待',
  product_ready:'Product',
  purchase_ready:'購入済み',
  invite_source_owner:'次の段階',
  productize_case:'Product作成',
  publish_product:'掲載',
  room_activity:'話し合い',
  sale:'売上',
  market_opportunity:'新しい困りごと'
}[value]||'Inbox');

function account(){
  const id=client.identity();
  return id?.kind==='account'?id:null;
}
function visibleItems(){
  return state.items.filter(item=>{
    if(state.filter!=='all'&&item.role!==state.filter)return false;
    if(hideSeen?.checked&&item.seen&&item.priority!=='action')return false;
    return true;
  });
}
function badge(text,className=''){
  const span=document.createElement('span');span.className=`inbox-badge ${className}`.trim();span.textContent=text;return span;
}
function card(item){
  const article=document.createElement('article');
  article.className=`inbox-item priority-${item.priority}${item.seen?' seen':''}`;
  article.dataset.inboxKey=item.key;

  const top=document.createElement('div');top.className='inbox-item-top';
  const badges=document.createElement('div');badges.className='inbox-badges';
  badges.append(
    badge(priorityLabel(item.priority),`priority-${item.priority}`),
    badge(item.role==='voice'?'Voice':'Maker'),
    badge(kindLabel(item.kind))
  );
  if(!item.seen)badges.append(badge('未確認','unseen'));
  const time=document.createElement('time');time.className='hint';time.textContent=fmt(item.occurred_at);
  top.append(badges,time);

  const h=document.createElement('h3');h.textContent=item.title;
  const detail=document.createElement('p');detail.textContent=item.detail||'';

  const actions=document.createElement('div');actions.className='actions';
  const open=document.createElement('a');open.className='button-link inbox-action';open.href=item.action_url;open.textContent=item.action_label||'開く';
  open.addEventListener('click',async e=>{
    if(item.seen)return;
    e.preventDefault();
    open.setAttribute('aria-busy','true');
    try{
      await client.markInboxSeen([item.key]);
      item.seen=true;
    }catch(err){
      console.warn('inbox seen marker failed',err);
    }
    location.href=open.href;
  });
  actions.append(open);

  if(!item.seen){
    const seen=document.createElement('button');seen.type='button';seen.textContent='確認済みにする';
    seen.addEventListener('click',async()=>{
      seen.disabled=true;
      try{
        await client.markInboxSeen([item.key]);item.seen=true;render();
      }catch(err){
        console.error('inbox mark seen failed',err);seen.disabled=false;
        if(status)status.textContent='確認済みにできませんでした。';
      }
    });
    actions.append(seen);
  }

  article.append(top,h,detail,actions);
  return article;
}
function render(){
  if(!list)return;
  const rows=visibleItems();
  list.replaceChildren();

  if(!rows.length){
    const empty=document.createElement('div');empty.className='inbox-empty';
    const h=document.createElement('h3');h.textContent='今ここで動くものはありません';
    const p=document.createElement('p');p.className='hint';
    p.textContent=state.items.length?'表示条件に合う項目がありません。':'招待、話し合いの続き、Product作成、元の困りごとへの掲載、購入などが動くとここに集まります。';
    empty.append(h,p);list.append(empty);
  }else for(const item of rows)list.append(card(item));

  const unseen=state.items.filter(x=>!x.seen).length;
  const actions=state.items.filter(x=>x.priority==='action').length;
  const voice=state.items.filter(x=>x.role==='voice').length;
  const maker=state.items.filter(x=>x.role==='maker').length;
  if(summary)summary.textContent=`未確認 ${unseen} · 要対応 ${actions} · Voice ${voice} · Maker ${maker}`;
  if(tabBadge){tabBadge.textContent=unseen?String(unseen):'';tabBadge.hidden=!unseen}
  if(markButton)markButton.disabled=!rows.some(x=>!x.seen);
}
async function load(){
  if(!list)return;
  if(!account()){
    list.innerHTML='<div class="inbox-empty"><h3>ログインすると「やること」を使えます</h3><p class="hint">自分に届いた招待と、次にやることをAccount ID単位で集約します。</p></div>';
    if(status)status.textContent='';return;
  }
  if(state.loading)return;
  state.loading=true;if(status)status.textContent='やることを整理しています…';
  try{
    const result=await client.listMyInbox();
    state.items=result.items||[];state.summary=result.summary||{};
    render();
    if(status)status.textContent='今の状態から、次にできることを更新しました。';
  }catch(err){
    console.error('action inbox load failed',err);
    list.innerHTML='<div class="inbox-empty"><h3>やることを読み込めませんでした</h3><p class="hint">再読込しても直らない場合はバグ報告から知らせてください。</p></div>';
    if(status)status.textContent='読み込みに失敗しました。';
  }finally{state.loading=false}
}
for(const button of filterButtons){
  button.addEventListener('click',()=>{
    state.filter=button.dataset.inboxFilter||'all';
    filterButtons.forEach(x=>x.setAttribute('aria-pressed',x===button?'true':'false'));
    render();
  });
}
hideSeen?.addEventListener('change',render);
markButton?.addEventListener('click',async()=>{
  const keys=visibleItems().filter(x=>!x.seen).map(x=>x.key);
  if(!keys.length)return;
  markButton.disabled=true;markButton.textContent='確認済みにしています…';
  try{
    await client.markInboxSeen(keys);
    for(const item of state.items)if(keys.includes(item.key))item.seen=true;
    render();
    if(status)status.textContent=`${keys.length}件を確認済みにしました。要対応の項目は、実際に完了するまで表示に残ります。`;
  }catch(err){
    console.error('mark visible inbox seen failed',err);
    if(status)status.textContent='確認済みにできませんでした。';
  }finally{markButton.textContent='表示中を確認済みにする';render()}
});

await load();
