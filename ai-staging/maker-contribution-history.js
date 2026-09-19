import { client } from './canonical-api.js?v=20260919-contribution-history-v5';

const box=document.querySelector('[data-contribution-role="maker"]');
const status=document.querySelector('#maker-contribution-status');

function accountIdentity(){
  const id=client.identity();
  return id?.kind==='account'?id:null;
}
function fmt(value){
  return value?new Date(value).toLocaleString('ja-JP'):'';
}
function postExcerpt(item){
  const text=String(item?.room?.post?.content||'').trim();
  return text.length>100?`${text.slice(0,100)}…`:text;
}

async function render(){
  if(!box)return;
  if(!accountIdentity()){
    box.innerHTML='<p class="hint">ログインすると、このAccount IDで作成したSolution Caseが表示されます。</p>';
    if(status)status.textContent='';
    return;
  }
  if(status)status.textContent='Contribution Historyを読み込んでいます…';
  try{
    const result=await client.listMySolutionCases();
    const cases=result.cases||[];
    box.replaceChildren();
    if(!cases.length){
      box.innerHTML='<p class="hint">まだSolution Caseはありません。Solution RoomからCaseを作ると、ここにAccount ID単位で残ります。</p>';
    }else{
      for(const item of cases){
        const card=document.createElement('article');
        card.className='participation-panel';
        card.dataset.solutionCaseId=item.id;

        const title=document.createElement('h3');
        title.textContent=item.title||'Solution Case';

        const contribution=document.createElement('p');
        contribution.textContent=item.contribution||'';

        const source=postExcerpt(item);
        if(source){
          const sourceBox=document.createElement('p');
          sourceBox.className='hint';
          sourceBox.textContent=`元のBOYAKI: ${source}`;
          card.append(title,contribution,sourceBox);
        }else card.append(title,contribution);

        const meta=document.createElement('p');
        meta.className='hint';
        meta.textContent=`${fmt(item.created_at)} · Solution Case · AI-STAGING`;
        card.append(meta);

        const actions=document.createElement('div');
        actions.className='actions';
        if(item.room_id){
          const room=document.createElement('a');
          room.className='button-link';
          room.href=`./solution-room.html?room=${encodeURIComponent(item.room_id)}&mode=view`;
          room.textContent='Solution Logを見る';
          actions.append(room);
        }
        if(item.room?.post?.id){
          const post=document.createElement('a');
          post.className='button-link';
          post.href=`./?problem=${encodeURIComponent(item.room.post.id)}`;
          post.textContent='元のBOYAKIを見る';
          actions.append(post);
        }
        const del=document.createElement('button');
        del.type='button';
        del.textContent='Caseを削除';
        del.addEventListener('click',async()=>{
          if(del.disabled)return;
          del.disabled=true;
          if(status)status.textContent='Solution Caseを削除しています…';
          try{
            await client.deleteSolutionCase(item.id);
            if(status)status.textContent='Solution Caseを削除しました。';
            await render();
          }catch(err){
            console.error('solution case delete failed',err);
            del.disabled=false;
            if(status)status.textContent='Solution Caseを削除できませんでした。再試行してください。';
          }
        });
        actions.append(del);
        card.append(actions);
        box.append(card);
      }
    }
    if(status)status.textContent=`${cases.length}件のSolution Case`;
  }catch(err){
    console.error('maker contribution history failed',err);
    box.innerHTML='<p class="hint">Contribution Historyを読み込めませんでした。</p>';
    if(status)status.textContent='読み込みに失敗しました。';
  }
}

await render();
