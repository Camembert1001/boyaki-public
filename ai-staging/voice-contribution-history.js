import { client } from './canonical-api.js?v=20260920-action-inbox-v10';

const box=document.querySelector('[data-contribution-role="voice"]');
const status=document.querySelector('#voice-contribution-status');

function fmt(value){return value?new Date(value).toLocaleString('ja-JP'):''}
function excerpt(post){
  const text=String(post?.content||'').trim();
  if(!text)return post?.source_withdrawn?'共有Problem':'元のBOYAKIを取得できません';
  return text.length>110?`${text.slice(0,110)}…`:text;
}
function eventLabel(type){
  return type==='clarify'?'追加質問':type==='proposal'?'解決案':type==='message'?'Voiceメッセージ':'Voice参加';
}
function demandLabel(signal){
  return signal==='same_problem'?'同じことで困ってる':signal==='would_try'?'解決したら試したい':'この条件なら払える';
}
function cardBase(title,post,createdAt){
  const card=document.createElement('article');card.className='participation-panel';
  const h=document.createElement('h3');h.textContent=title;card.append(h);
  const source=document.createElement('p');source.className='hint';source.textContent=`${post?.source_withdrawn?'共有Problem':'BOYAKI'}: ${excerpt(post)}`;card.append(source);
  const meta=document.createElement('p');meta.className='hint';meta.textContent=`${fmt(createdAt)} · Voice · AI-STAGING`;card.append(meta);
  if(post?.id&&(post?.status==='active'||post?.source_withdrawn)){
    const actions=document.createElement('div');actions.className='actions';
    const link=document.createElement('a');link.className='button-link';link.href=`./?problem=${encodeURIComponent(post.id)}`;link.textContent=post?.source_withdrawn?'共有Problemを見る':'BOYAKIを見る';actions.append(link);card.append(actions);
  }
  return card;
}

async function render(){
  if(!box)return;
  const id=client.identity();
  if(id?.kind!=='account'){
    box.innerHTML='<p class="hint">ログインすると、このAccount IDで残したVoice活動が表示されます。</p>';
    if(status)status.textContent='';return;
  }
  if(status)status.textContent='Voice Contribution Historyを読み込んでいます…';
  try{
    const result=await client.listMyVoiceHistory();
    const events=result.thread_contributions||[],demand=result.demand_signals||[];
    const items=[
      ...events.map(x=>({kind:'thread',at:x.created_at,row:x})),
      ...demand.map(x=>({kind:'demand',at:x.updated_at||x.created_at,row:x}))
    ].sort((a,b)=>String(b.at).localeCompare(String(a.at)));
    box.replaceChildren();
    if(!items.length){
      box.innerHTML='<p class="hint">まだVoiceとして残った活動はありません。Voiceとしてスレッドに参加したり、需要シグナルを残すとここに積み上がります。</p>';
    }else{
      for(const item of items){
        const row=item.row;
        if(item.kind==='thread'){
          const card=cardBase(eventLabel(row.event_type),row.post,row.created_at);
          const body=document.createElement('p');body.textContent=row.content||'';card.insertBefore(body,card.children[1]||null);
          box.append(card);
        }else{
          const label=demandLabel(row.signal);
          const card=cardBase(label,row.post,row.updated_at||row.created_at);
          if(row.signal==='would_pay'){
            const detail=document.createElement('p');
            detail.textContent=`¥${Number(row.amount_yen||0).toLocaleString('ja-JP')} — ${row.condition_text||''}`;
            card.insertBefore(detail,card.children[1]||null);
          }
          box.append(card);
        }
      }
    }
    if(status)status.textContent=`${items.length}件のVoice活動`;
  }catch(err){
    console.error('voice contribution history failed',err);
    box.innerHTML='<p class="hint">Voice Contribution Historyを読み込めませんでした。</p>';
    if(status)status.textContent='読み込みに失敗しました。';
  }
}

await render();
