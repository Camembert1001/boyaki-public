import { client } from './canonical-api.js?v=20260920-action-inbox-v10';
const $=s=>document.querySelector(s);
const caseId=String(new URLSearchParams(location.search).get('case')||'').trim();
const uuid=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
let caseRow=null;

function yen(v){return Number.isFinite(Number(v))?new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(Number(v)):''}
function renderCase(item){
  const box=$('#product-case');box.replaceChildren();
  const e=document.createElement('p');e.className='eyebrow';e.textContent='Source Solution Case';
  const h=document.createElement('h2');h.textContent=item.title||'Solution Case';
  const p=document.createElement('p');p.textContent=item.contribution||'';
  box.append(e,h,p);
  const evidence=item.evidence_snapshot||{},ladder=document.createElement('div');ladder.className='demand-ladder';
  for(const [label,count] of [['同じ悩み',evidence.same_problem?.count||0],['試したい',evidence.would_try?.count||0],['払ってもいい',evidence.would_pay?.count||0]]){
    const chip=document.createElement('span');chip.className=`step${count?' on':''}`;chip.textContent=`${label} ${count}`;ladder.append(chip);
  }
  if(evidence.would_pay?.median_yen){const chip=document.createElement('span');chip.className='step on';chip.textContent=`支払中央値 ${yen(evidence.would_pay.median_yen)}`;ladder.append(chip)}
  box.append(ladder);
  const post=item.room?.post,source=String(post?.content||'').trim();
  if(source){const q=document.createElement('p');q.className='hint';q.textContent=`${post?.source_withdrawn?'共有Problem（元BOYAKI本文は取り下げ済み）':'元のBOYAKI'}: ${source}`;box.append(q)}
}
async function load(){
  const id=client.identity();
  if(id?.kind!=='account'){location.href='./mypage.html#maker';return}
  if(!uuid.test(caseId)){ $('#product-case').innerHTML='<p class="hint">Solution Case IDが不正です。</p>';$('#product-form').hidden=true;return}
  try{
    const [cases,products]=await Promise.all([client.listMySolutionCases(),client.listMyProducts()]);
    caseRow=(cases.cases||[]).find(x=>x.id===caseId)||null;
    if(!caseRow){$('#product-case').innerHTML='<p class="hint">このAccount IDのSolution Caseではありません。</p>';$('#product-form').hidden=true;return}
    const existing=(products.products||[]).find(x=>x.solution_case_id===caseId);
    if(existing){location.href=`./product.html?id=${encodeURIComponent(existing.id)}`;return}
    renderCase(caseRow);
    $('#product-title').value=caseRow.title||'';
    const median=caseRow.evidence_snapshot?.would_pay?.median_yen;
    if(median)$('#product-price').value=median;
  }catch(err){console.error(err);$('#product-case').innerHTML='<p class="hint">Solution Caseを読み込めませんでした。</p>';$('#product-form').hidden=true}
}
$('#product-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!caseRow)return;
  const button=$('#product-submit'),title=$('#product-title').value.trim(),description=$('#product-description').value.trim(),delivery=$('#product-delivery').value.trim(),price=Number($('#product-price').value);
  button.disabled=true;button.textContent='作成中…';$('#product-status').textContent='Maker SpaceにProductを作成しています…';
  try{
    const result=await client.createProduct(caseRow.id,title,description,price,delivery);
    $('#product-status').textContent='ProductをMaker Spaceに作成しました。次の画面で元のProblemに掲載するか選べます。';
    setTimeout(()=>location.href=`./product.html?id=${encodeURIComponent(result.product.id)}`,500);
  }catch(err){
    console.error(err);const code=String(err?.message||err);
    $('#product-status').textContent=code==='case_already_productized'?'このSolution Caseはすでに商品化されています。':'公開できませんでした。入力内容と通信状態を確認してください。';
    button.disabled=false;button.textContent='Maker SpaceにProductを作成';
  }
});
await load();