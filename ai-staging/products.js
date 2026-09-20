import { client } from './canonical-api.js?v=20260919-problem-transition-v8';
const $=s=>document.querySelector(s);
const yen=v=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(Number(v)||0);
function card(product){
  const article=document.createElement('article');article.className='card product-card';
  const meta=document.createElement('p');meta.className='eyebrow';meta.textContent=`${product.maker?.display_name||'Maker'} · ${product.sold_count||0}件購入`;
  const h=document.createElement('h2');h.textContent=product.title;
  const desc=document.createElement('p');desc.textContent=product.description;
  const price=document.createElement('p');price.className='product-price';price.textContent=yen(product.price_yen);
  article.append(meta,h,desc,price);
  const evidence=product.solution_case?.evidence_snapshot||{},ladder=document.createElement('div');ladder.className='demand-ladder';
  for(const [label,count] of [['同じ悩み',evidence.same_problem?.count||0],['試したい',evidence.would_try?.count||0],['払ってもいい',evidence.would_pay?.count||0]]){const chip=document.createElement('span');chip.className=`step${count?' on':''}`;chip.textContent=`${label} ${count}`;ladder.append(chip)}
  if(evidence.would_pay?.median_yen){const chip=document.createElement('span');chip.className='step on';chip.textContent=`支払中央値 ${yen(evidence.would_pay.median_yen)}`;ladder.append(chip)}
  article.append(ladder);
  const sourcePost=product.source_post,source=String(sourcePost?.content||'').trim();
  if(source){const p=document.createElement('p');p.className='hint';const label=sourcePost?.shared_problem?'残った困りごと':'元のBOYAKI';p.textContent=`${label}: ${source.length>120?source.slice(0,120)+'…':source}`;article.append(p)}
  const actions=document.createElement('div');actions.className='actions';const open=document.createElement('a');open.className='button-link';open.href=`./product.html?id=${encodeURIComponent(product.id)}`;open.textContent='Productを見る';actions.append(open);article.append(actions);
  return article;
}
async function load(){
  const list=$('#products-list');$('#products-status').textContent='読み込んでいます…';
  try{
    const result=await client.listProducts();list.replaceChildren();
    const products=result.products||[];
    if(!products.length){list.innerHTML='<div class="card"><p class="hint">まだProductはありません。Makerが解決メモから最初のProductを作れます。</p></div>'}
    else for(const p of products)list.append(card(p));
    $('#products-status').textContent=`${products.length}件のProduct · テスト購入`;
  }catch(err){console.error(err);list.innerHTML='<div class="card"><p class="hint">Productを読み込めませんでした。</p></div>';$('#products-status').textContent='読み込みに失敗しました。'}
}
$('#products-refresh').addEventListener('click',load);await load();