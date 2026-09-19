import { client } from './canonical-api.js?v=20260919-commerce-v6';

const $=s=>document.querySelector(s);
const room=String(new URLSearchParams(location.search).get('room')||'').trim();
const validRoom=/^[0-9a-f-]{36}$/i.test(room);
const form=$('#case-form'),status=$('#case-status'),button=$('#case-submit'),source=$('#case-source');

function accountLoggedIn(){
  const id=client.identity();
  return id?.kind==='account';
}

if(validRoom)$('#back-room').href=`./solution-room.html?room=${encodeURIComponent(room)}`;
else{
  form.hidden=true;
  status.textContent='Solution Room IDが不正です。';
}

async function loadSource(){
  if(!validRoom)return;
  try{
    const result=await client.getSolutionRoom(room);
    const post=result.room?.post;
    const sourceActive=post?.status==='active'&&Boolean(post?.content);
    const text=sourceActive?String(post.content).trim():'元のBOYAKIは取り下げ済みです。Solution CaseはこのRoomの履歴として保存できます。';
    source.replaceChildren();
    const eyebrow=document.createElement('p');eyebrow.className='eyebrow';eyebrow.textContent='Source BOYAKI';
    const raw=document.createElement('p');raw.className='raw';raw.textContent=text;
    source.append(eyebrow,raw);
    if(sourceActive&&post?.id){
      const open=document.createElement('a');open.className='button-link';open.href=`./?problem=${encodeURIComponent(post.id)}`;open.textContent='元のBOYAKIを見る';source.append(open);
    }
  }catch(err){
    console.error('solution case source load failed',err);
    source.innerHTML='<p class="hint">元のBOYAKIを読み込めませんでした。</p>';
  }
}

form.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!validRoom)return;
  if(!accountLoggedIn()){
    status.textContent='Solution Caseを作るにはBOYAKI Accountでログインしてください。';
    return;
  }
  const title=$('#case-title').value.trim();
  const contribution=$('#case-contribution').value.trim();
  if(!title){status.textContent='ケースタイトルを入力してください。';return}
  if(!contribution){status.textContent='貢献内容を入力してください。';return}
  button.disabled=true;
  button.textContent='作成中…';
  status.textContent='AI-STAGINGのContribution Historyへ保存しています…';
  try{
    await client.createSolutionCase(room,title,contribution);
    form.reset();
    status.textContent='Solution Caseを保存しました。Maker Contribution Historyへ移動します…';
    setTimeout(()=>location.href='./mypage.html#maker',600);
  }catch(err){
    console.error('solution case create failed',err);
    status.textContent='Solution Caseを保存できませんでした。通信状態を確認して再試行してください。';
    button.disabled=false;
    button.textContent='作成';
  }
});

await loadSource();
