const list=document.querySelector('#candidate-list');
const hero=document.querySelector('.maker-hero');
const sectionHead=document.querySelector('.section-head');
const identity=document.querySelector('.identity-card');
const joinPanel=document.querySelector('#join-panel');
const activityPanel=document.querySelector('#activity-panel');

function roomId(card){return card.querySelector('.candidate-id')?.textContent?.trim()||''}
function roomTitle(card){return card.querySelector('.candidate-title')?.textContent?.trim()||'Solution Room'}
function currentRoom(){return new URL(location.href).searchParams.get('room')||''}

function ensureEntryButton(card){
  if(card.querySelector('[data-action="enter-room"]'))return;
  const actions=card.querySelector('.candidate-actions');
  if(!actions)return;
  const button=document.createElement('button');
  button.type='button';
  button.dataset.action='enter-room';
  button.textContent='このSolution Roomに入る';
  button.addEventListener('click',()=>enterRoom(roomId(card)));
  actions.prepend(button);
}

function ensureBackButton(card){
  if(card.querySelector('[data-action="leave-room"]'))return;
  const button=document.createElement('button');
  button.type='button';
  button.dataset.action='leave-room';
  button.textContent='← Maker Spaceへ戻る';
  button.addEventListener('click',leaveRoom);
  const top=card.querySelector('.candidate-topline');
  if(top)top.insertAdjacentElement('beforebegin',button);
  else card.prepend(button);
}

function setRoomMode(id,{scroll=true}={}){
  const cards=[...document.querySelectorAll('.candidate-card')];
  if(!cards.length)return false;
  const target=cards.find(card=>roomId(card)===id);
  if(!target)return false;
  cards.forEach(card=>{card.hidden=card!==target});
  hero && (hero.hidden=true);
  sectionHead && (sectionHead.hidden=true);
  identity && (identity.hidden=true);
  if(joinPanel)joinPanel.hidden=true;
  if(activityPanel)activityPanel.hidden=true;
  ensureBackButton(target);
  target.querySelector('[data-action="enter-room"]')?.setAttribute('hidden','');
  document.title=`${roomTitle(target)} — BOYAKI Solution Room`;
  document.body.dataset.solutionRoom=id;
  if(scroll)window.scrollTo({top:0,behavior:'smooth'});
  return true;
}

function clearRoomMode({scroll=true}={}){
  document.querySelectorAll('.candidate-card').forEach(card=>{
    card.hidden=false;
    card.querySelector('[data-action="enter-room"]')?.removeAttribute('hidden');
    card.querySelector('[data-action="leave-room"]')?.remove();
  });
  hero && (hero.hidden=false);
  sectionHead && (sectionHead.hidden=false);
  identity && (identity.hidden=false);
  delete document.body.dataset.solutionRoom;
  document.title='BOYAKI Maker Space — 活動する場所';
  if(scroll)window.scrollTo({top:0,behavior:'smooth'});
}

function enterRoom(id){
  if(!id)return;
  const url=new URL(location.href);
  url.searchParams.set('room',id);
  history.pushState({room:id},'',url);
  setRoomMode(id);
}

function leaveRoom(){
  const url=new URL(location.href);
  url.searchParams.delete('room');
  history.pushState({},'',url);
  clearRoomMode();
}

function sync(){
  const cards=[...document.querySelectorAll('.candidate-card')];
  if(!cards.length)return;
  cards.forEach(ensureEntryButton);
  const id=currentRoom();
  if(id){
    if(!setRoomMode(id,{scroll:false})){
      const url=new URL(location.href);
      url.searchParams.delete('room');
      history.replaceState({},'',url);
      clearRoomMode({scroll:false});
    }
  }else clearRoomMode({scroll:false});
}

new MutationObserver(sync).observe(list,{childList:true});
window.addEventListener('popstate',sync);
sync();
