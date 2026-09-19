import { client } from '../canonical-api.js?v=20260919-problem-market-v9';

const $=s=>document.querySelector(s);
const yen=v=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(Number(v)||0);
const fmt=v=>v?new Date(v).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
let state={problems:[],products:[],query:'',filter:'all',sort:'demand'};

function productMap(products){
  const map=new Map();
  for(const product of products){
    const postId=product?.source_post?.id;
    if(!postId)continue;
    if(!map.has(postId))map.set(postId,[]);
    map.get(postId).push(product);
  }
  return map;
}
function demandScore(problem){
  const d=problem.demand_summary||{};
  return (Number(d.same_problem)||0)+(Number(d.would_try)||0)*2+(Number(d.would_pay)||0)*3;
}
function matches(problem,products){
  if(state.filter==='products'&&!products.length)return false;
  if(state.filter==='open'&&products.length)return false;
  if(state.filter==='pay'&&!(problem.demand_summary?.would_pay>0))return false;
  const q=state.query.trim().toLocaleLowerCase();
  return !q||String(problem.statement||'').toLocaleLowerCase().includes(q)||products.some(p=>String(p.title||'').toLocaleLowerCase().includes(q));
}
function demandChips(problem){
  const d=problem.demand_summary||{},wrap=document.createElement('div');wrap.className='demand-ladder';
  for(const [label,count] of [['同じ悩み',d.same_problem||0],['試したい',d.would_try||0],['払ってもいい',d.would_pay||0]]){
    const chip=document.createElement('span');chip.className=`step${count?' on':''}`;chip.textContent=`${label} ${count}`;wrap.append(chip);
  }
  if(d.median_yen){const chip=document.createElement('span');chip.className='step on';chip.textContent=`支払中央値 ${yen(d.median_yen)}`;wrap.append(chip)}
  return wrap;
}
function problemCard(problem,products){
  const card=document.createElement('article');card.className='card market-card';card.dataset.problemId=problem.id;
  const top=document.createElement('div');top.className='market-top';
  const meta=document.createElement('p');meta.className='eyebrow';meta.textContent=problem.source_withdrawn?'Shared Problem · 元BOYAKI本文取り下げ済み':'Shared Problem · 元BOYAKI本文あり';
  const badge=document.createElement('span');badge.className='market-product-badge';badge.textContent=products.length?`Product ${products.length}`:'Product なし';
  top.append(meta,badge);

  const h=document.createElement('h2');h.textContent=problem.statement;
  const sub=document.createElement('p');sub.className='hint';
  sub.textContent=`Problem化 ${fmt(problem.created_at)} · 需要反応 ${problem.demand_total||0}件${problem.source_withdrawn?' · 元の個人的な本文は残っていません':''}`;
  card.append(top,h,sub,demandChips(problem));

  if(products.length){
    const shelf=document.createElement('div');shelf.className='market-products';
    const title=document.createElement('strong');title.textContent='このProblemから生まれたProduct';shelf.append(title);
    for(const p of products.slice(0,3)){
      const row=document.createElement('a');row.className='market-product';row.href=`../product.html?id=${encodeURIComponent(p.id)}`;
      const name=document.createElement('span');name.textContent=p.title;
      const price=document.createElement('b');price.textContent=yen(p.price_yen);
      row.append(name,price);shelf.append(row);
    }
    if(products.length>3){const more=document.createElement('p');more.className='hint';more.textContent=`ほか ${products.length-3}件`;shelf.append(more)}
    card.append(shelf);
  }else{
    const gap=document.createElement('div');gap.className='market-gap';
    gap.innerHTML='<strong>まだProductがありません</strong><span>需要を見てMakerがSolutionを作れる余地があります。</span>';
    card.append(gap);
  }

  const actions=document.createElement('div');actions.className='actions';
  const open=document.createElement('a');open.className='button-link';open.href=`../?problem=${encodeURIComponent(problem.post_id)}`;open.textContent='Problemを開く';actions.append(open);
  if(!products.length){const maker=document.createElement('a');maker.className='button-link';maker.href=`../?problem=${encodeURIComponent(problem.post_id)}`;maker.textContent='Makerとして見る';actions.append(maker)}
  card.append(actions);
  return card;
}
function render(){
  const map=productMap(state.products),list=$('#problem-market-list');
  let rows=state.problems.map(p=>({problem:p,products:map.get(p.post_id)||[]})).filter(x=>matches(x.problem,x.products));
  if(state.sort==='demand')rows.sort((a,b)=>demandScore(b.problem)-demandScore(a.problem)||String(b.problem.updated_at).localeCompare(String(a.problem.updated_at)));
  else if(state.sort==='products')rows.sort((a,b)=>b.products.length-a.products.length||demandScore(b.problem)-demandScore(a.problem));
  else rows.sort((a,b)=>String(b.problem.updated_at).localeCompare(String(a.problem.updated_at)));

  list.replaceChildren();
  if(!rows.length){
    const empty=document.createElement('div');empty.className='card';
    empty.innerHTML='<h2>該当するProblemはまだありません</h2><p class="hint">BOYAKIが共同解決フェーズへ進み、元Voiceが一般化Problemを承認するとここに並びます。</p>';
    list.append(empty);
  }else for(const row of rows)list.append(problemCard(row.problem,row.products));

  const totalDemand=state.problems.reduce((n,p)=>n+(p.demand_total||0),0);
  const productProblems=new Set(state.products.map(p=>p?.source_post?.id).filter(Boolean)).size;
  $('#market-summary').textContent=`${state.problems.length} Problems · 需要反応 ${totalDemand}件 · Productあり ${productProblems} Problems`;
  $('#market-visible').textContent=`${rows.length}件表示`;
}
async function load(){
  const status=$('#market-status');status.textContent='Problem Marketを読み込んでいます…';
  try{
    const [problemResult,productResult]=await Promise.all([client.listProblems(200),client.listProducts()]);
    state.problems=problemResult.problems||[];state.products=productResult.products||[];
    render();status.textContent='Shared ProblemとProductを最新状態に更新しました。';
  }catch(err){
    console.error('problem market load failed',err);
    $('#problem-market-list').innerHTML='<div class="card"><p class="hint">Problem Marketを読み込めませんでした。</p></div>';
    status.textContent='読み込みに失敗しました。';
  }
}
$('#market-search')?.addEventListener('input',e=>{state.query=e.target.value;render()});
$('#market-filter')?.addEventListener('change',e=>{state.filter=e.target.value;render()});
$('#market-sort')?.addEventListener('change',e=>{state.sort=e.target.value;render()});
$('#market-refresh')?.addEventListener('click',load);
await load();
