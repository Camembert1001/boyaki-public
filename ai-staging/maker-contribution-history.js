import { client } from './canonical-api.js?v=20260919-thread-room-product-v7';

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

function yen(value){const n=Number(value);return Number.isFinite(n)&&n>0?new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(n):''}
function evidenceBlock(snapshot){
  const evidence=snapshot||{},wrap=document.createElement('div');wrap.className='candidate-block';
  const title=document.createElement('strong');title.textContent='Case作成時の需要証拠';wrap.append(title);
  const ladder=document.createElement('div');ladder.className='demand-ladder';
  for(const [label,count] of [
    ['同じ悩み',evidence.same_problem?.count||0],
    ['試したい',evidence.would_try?.count||0],
    ['払ってもいい',evidence.would_pay?.count||0]
  ]){const chip=document.createElement('span');chip.className=`step${count?' on':''}`;chip.textContent=`${label} ${count}`;ladder.append(chip)}
  if(evidence.would_pay?.median_yen){const chip=document.createElement('span');chip.className='step on';chip.textContent=`支払中央値 ${yen(evidence.would_pay.median_yen)}`;ladder.append(chip)}
  wrap.append(ladder);
  const conditions=evidence.pay_conditions||[];
  if(conditions.length){
    for(const row of conditions.slice(0,5)){const p=document.createElement('p');p.className='hint';p.textContent=`${yen(row.amount_yen)} — ${row.condition_text}`;wrap.append(p)}
  }
  return wrap;
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
    const [result,productResult]=await Promise.all([client.listMySolutionCases(),client.listMyProducts()]);
    const cases=result.cases||[],products=productResult.products||[];
    const productByCase=new Map(products.map(x=>[x.solution_case_id,x]));
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

        card.append(evidenceBlock(item.evidence_snapshot));
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
        const product=productByCase.get(item.id);
        const productLink=document.createElement('a');
        productLink.className='button-link';
        productLink.href=product?`./product.html?id=${encodeURIComponent(product.id)}`:`./product-create.html?case=${encodeURIComponent(item.id)}`;
        productLink.textContent=product?'商品を見る':'プロダクトとして出す';
        actions.append(productLink);
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
