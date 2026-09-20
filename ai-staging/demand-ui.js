// Human-facing demand controls for a BOYAKI detail card.
// Domain/API names stay internal; the UI speaks in plain Japanese.
function yen(value){const n=Number(value);return Number.isFinite(n)&&n>0?new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(n):''}
export function demandFeedChips(chips,summary){
 if(!chips)return;
 chips.querySelectorAll('[data-demand-feed-chip]').forEach(x=>x.remove());
 const s=summary?.signals?{
  same_problem:summary.signals.same_problem?.count||0,
  would_try:summary.signals.would_try?.count||0,
  would_pay:summary.signals.would_pay?.count||0,
  median_yen:summary.signals.would_pay?.median_yen||null
 }:(summary||{});
 for(const [label,value] of [['同じ悩み',s.same_problem],['試したい',s.would_try],['払ってもいい',s.would_pay]]){
  if(Number(value)>0){const node=document.createElement('span');node.className='chip';node.dataset.demandFeedChip='1';node.textContent=`${label} ${value}`;chips.append(node)}
 }
 if(Number(s.median_yen)>0){const node=document.createElement('span');node.className='chip';node.dataset.demandFeedChip='1';node.textContent=`支払中央値 ${yen(s.median_yen)}`;chips.append(node)}
}
export async function hydrateDemandEvidence(article,post,getClient){
 const client=await getClient();
 const host=document.createElement('section');host.className='participation-panel demand-evidence';host.dataset.demandEvidence='1';
 const title=document.createElement('h3');title.textContent='需要の反応';
 const intro=document.createElement('p');intro.className='hint';intro.textContent='「同じ悩み」「試したい」「この条件なら払える」を集めます。購入予約や決済ではなく、Makerが解く価値を判断するための反応です。';
 const stats=document.createElement('div');stats.className='demand-ladder';
 const statusNode=document.createElement('p');statusNode.className='hint';statusNode.setAttribute('role','status');statusNode.setAttribute('aria-live','polite');
 host.append(title,intro,stats,statusNode);
 const threadMount=article.querySelector('[data-canonical-thread-mount]');
 if(threadMount)article.insertBefore(host,threadMount);else article.append(host);

 let aggregate=null,mine=null;
 const renderStats=()=>{
  stats.replaceChildren();
  const signals=aggregate?.signals||{};
  const items=[
   ['同じことで困ってる',signals.same_problem?.count||0],
   ['解決したら試したい',signals.would_try?.count||0],
   ['この条件なら払える',signals.would_pay?.count||0]
  ];
  for(const [label,count] of items){const chip=document.createElement('span');chip.className=`step${count?' on':''}`;chip.textContent=`${label} ${count}`;stats.append(chip)}
  const pay=signals.would_pay||{};
  if(pay.count>0&&pay.median_yen){const chip=document.createElement('span');chip.className='step on';chip.textContent=`支払中央値 ${yen(pay.median_yen)}`;stats.append(chip)}
 };
 const reload=async()=>{
  const jobs=[client.getDemand(post.id)];
  const id=client.identity();
  if(id)jobs.push(client.getMyDemand(post.id));
  const out=await Promise.all(jobs);
  aggregate=out[0];mine=out[1]||{signals:[],is_source_author:false};
  renderStats();
 };
 try{await reload()}catch(err){console.error('demand evidence load failed',err);statusNode.textContent='反応を読み込めませんでした。';return}

 if(mine?.is_source_author){
  statusNode.textContent='投稿者本人の反応は数に含めません。ほかの人からの反応だけを表示します。';
 }else{
  const mineMap=new Map((mine?.signals||[]).map(x=>[x.signal,x]));
  const actionBox=document.createElement('div');actionBox.className='actions';
  const toggle=async(signal,label,button)=>{
    button.disabled=true;statusNode.textContent='反応を更新しています…';
    try{
      if(mineMap.has(signal))await client.deleteDemand(post.id,signal);
      else await client.saveDemand(post.id,signal);
      await reload();mineMap.clear();for(const x of mine.signals||[])mineMap.set(x.signal,x);
      button.textContent=mineMap.has(signal)?`${label} ✓ 取り消す`:label;
      statusNode.textContent='反応を更新しました。';
      demandFeedChips(article.querySelector('.chips'),aggregate);
    }catch(err){console.error('demand signal update failed',err);statusNode.textContent='更新できませんでした。再試行してください。'}
    finally{button.disabled=false}
  };
  for(const [signal,label] of [['same_problem','同じことで困ってる'],['would_try','解決したら試したい']]){
    const button=document.createElement('button');button.type='button';button.textContent=mineMap.has(signal)?`${label} ✓ 取り消す`:label;
    button.addEventListener('click',()=>toggle(signal,label,button));actionBox.append(button);
  }
  host.append(actionBox);

  const payTitle=document.createElement('p');payTitle.className='hint';payTitle.innerHTML='<strong>支払意思を条件つきで残す</strong><br>「何が実現したら」「1回いくらまで」をセットで残します。条件と金額は匿名の反応として表示されます。';
  const payForm=document.createElement('form');payForm.className='maker-form';payForm.dataset.demandPayForm='1';
  const amountLabel=document.createElement('label');amountLabel.textContent='上限金額（円）';
  const amount=document.createElement('input');amount.type='number';amount.min='1';amount.max='1000000';amount.step='1';amount.inputMode='numeric';amount.required=true;amount.placeholder='例: 500';
  const conditionLabel=document.createElement('label');conditionLabel.textContent='成立条件';
  const condition=document.createElement('input');condition.maxLength=160;condition.required=true;condition.placeholder='例: 二重入力が完全になくなるなら';
  const payActions=document.createElement('div');payActions.className='actions';
  const save=document.createElement('button');save.type='submit';
  const remove=document.createElement('button');remove.type='button';remove.textContent='支払意思を取り消す';
  const refreshPayState=()=>{
    const row=(mine?.signals||[]).find(x=>x.signal==='would_pay');
    if(row){amount.value=row.amount_yen||'';condition.value=row.condition_text||'';save.textContent='支払条件を更新';remove.hidden=false}
    else{amount.value='';condition.value='';save.textContent='この条件なら払える';remove.hidden=true}
  };
  refreshPayState();
  payActions.append(save,remove);amountLabel.append(amount);conditionLabel.append(condition);payForm.append(amountLabel,conditionLabel,payActions);
  payForm.addEventListener('submit',async e=>{
    e.preventDefault();const value=Number(amount.value),text=condition.value.trim();
    if(!Number.isInteger(value)||value<1||value>1000000){statusNode.textContent='金額は1〜1,000,000円の整数で入力してください。';return}
    if(!text){statusNode.textContent='「何が実現したら払えるか」を入力してください。';return}
    save.disabled=true;statusNode.textContent='支払意思を保存しています…';
    try{await client.saveDemand(post.id,'would_pay',{amount_yen:value,condition_text:text});await reload();demandFeedChips(article.querySelector('.chips'),aggregate);statusNode.textContent='支払意思を保存しました。購入予約ではありません。';refreshPayState();renderConditions()}
    catch(err){console.error('payment demand save failed',err);statusNode.textContent='支払意思を保存できませんでした。'}
    finally{save.disabled=false}
  });
  remove.addEventListener('click',async()=>{
    remove.disabled=true;statusNode.textContent='支払意思を取り消しています…';
    try{await client.deleteDemand(post.id,'would_pay');await reload();demandFeedChips(article.querySelector('.chips'),aggregate);statusNode.textContent='支払意思を取り消しました。';refreshPayState();renderConditions()}
    catch(err){console.error('payment demand delete failed',err);statusNode.textContent='取り消せませんでした。'}
    finally{remove.disabled=false}
  });
  host.append(payTitle,payForm);
 }

 const conditions=document.createElement('div');conditions.className='stack';conditions.dataset.demandConditions='1';host.append(conditions);
 function renderConditions(){
  conditions.replaceChildren();
  const rows=aggregate?.pay_conditions||[];
  if(!rows.length)return;
  const head=document.createElement('p');head.className='hint';head.innerHTML='<strong>匿名の成立条件</strong>';conditions.append(head);
  for(const row of rows){
    const item=document.createElement('div');item.className='thread-item';
    const strong=document.createElement('strong');strong.textContent=yen(row.amount_yen);
    item.append(strong,document.createTextNode(` — ${row.condition_text}`));conditions.append(item);
  }
 }
 renderConditions();
}
