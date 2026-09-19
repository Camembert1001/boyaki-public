import { client } from './canonical-api.js?v=20260919-problem-transition-v8';
const $=s=>document.querySelector(s),id=String(new URLSearchParams(location.search).get('id')||'').trim();
const uuid=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const yen=v=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(Number(v)||0);
let product=null;
function render(p){
  const box=$('#product-detail');box.replaceChildren();
  const meta=document.createElement('p');meta.className='eyebrow';meta.textContent=`${p.maker?.display_name||'Maker'} · ${p.sold_count||0}件購入`;
  const h=document.createElement('h1');h.textContent=p.title;
  const desc=document.createElement('p');desc.className='lead';desc.textContent=p.description;
  const price=document.createElement('p');price.className='product-price';price.textContent=yen(p.price_yen);
  box.append(meta,h,desc,price);
  const source=p.source_post,sourceText=String(source?.content||'').trim();
  const sourceBox=document.createElement('div');sourceBox.className='candidate-block';
  const st=document.createElement('strong');
  st.textContent=source?.source_withdrawn?'共有Problem（元BOYAKI本文は取り下げ済み）':'元のBOYAKI';
  sourceBox.append(st);
  const sp=document.createElement('p');sp.textContent=sourceText||'元のBOYAKIは取り下げ済み';sourceBox.append(sp);box.append(sourceBox);
  if(p.solution_case){const caseBox=document.createElement('div');caseBox.className='candidate-block';caseBox.innerHTML='<strong>Solution Case</strong>';const t=document.createElement('p');t.textContent=p.solution_case.title;const c=document.createElement('p');c.className='hint';c.textContent=p.solution_case.contribution;caseBox.append(t,c);box.append(caseBox)}
  const actions=document.createElement('div');actions.className='actions';
  if(p.room?.id){const room=document.createElement('a');room.className='button-link';room.href=`./solution-room.html?room=${encodeURIComponent(p.room.id)}&mode=view`;room.textContent='Solution Logを見る';actions.append(room)}
  box.append(actions);
}
async function showAccess(){
  try{
    const result=await client.accessProduct(id);
    $('#delivery-card').hidden=false;$('#checkout-card').hidden=true;
    const out=$('#delivery-content');out.replaceChildren();const pre=document.createElement('pre');pre.textContent=result.product.delivery_text;out.append(pre);
    return true;
  }catch(err){if(String(err?.message||err)!=='purchase_required')console.warn('product access',err);return false}
}
async function load(){
  if(!uuid.test(id)){ $('#product-detail').innerHTML='<p class="hint">商品IDが不正です。</p>';return}
  try{
    const result=await client.getProduct(id);product=result.product;render(product);document.title=`${product.title} — BOYAKI AI-STAGING`;
    const identity=client.identity();
    if(identity?.kind==='account'&&identity.pk===product.maker_account_pubkey){
      const card=$('#publish-back-card'),button=$('#publish-back'),link=$('#published-thread-link'),state=$('#publish-back-status');
      card.hidden=false;
      if(product.thread_publication?.status==='active'){
        button.hidden=true;link.hidden=false;link.href=`./?problem=${encodeURIComponent(product.thread_publication.post_id)}`;state.textContent='元のBOYAKIスレッドに掲載済みです。';
      }else{
        button.hidden=false;link.hidden=true;state.textContent='まだ元スレッドには掲載していません。';
      }
    }
    if(identity?.kind==='account'){
      const has=await showAccess();
      if(!has){
        $('#checkout-card').hidden=false;
        if(identity.pk===product.maker_account_pubkey){$('#checkout-card').innerHTML='<p class="hint">これはあなたが出品したプロダクトです。購入せず受け取り内容を確認できます。</p>';await showAccess()}
        else $('#buy-product').textContent=`${yen(product.price_yen)}でテスト購入する`;
      }
    }else{
      $('#checkout-card').hidden=false;$('#checkout-card').innerHTML='<p class="hint">購入するにはBOYAKI Accountでログインしてください。</p><div class="actions"><a class="button-link" href="./mypage.html">ログイン</a></div>';
    }
  }catch(err){console.error(err);$('#product-detail').innerHTML='<p class="hint">商品を読み込めませんでした。</p>'}
}
$('#publish-back')?.addEventListener('click',async()=>{
  if(!product)return;
  const button=$('#publish-back'),state=$('#publish-back-status'),link=$('#published-thread-link');
  button.disabled=true;button.textContent='掲載中…';state.textContent='元のBOYAKIスレッドへProductを掲載しています…';
  try{
    const result=await client.publishProductBack(id),publication=result.publication;
    product.thread_publication=publication;
    button.hidden=true;link.hidden=false;link.href=`./?problem=${encodeURIComponent(publication.post_id)}`;
    state.textContent=result.idempotent?'すでに掲載済みでした。':'元のBOYAKIスレッドにProductを掲載しました。';
  }catch(err){
    console.error('publish back failed',err);const code=String(err?.message||err);
    state.textContent=code==='source_thread_not_available'?'元のスレッドが共同Problemとして残っていないため掲載できません。':'元スレッドへ掲載できませんでした。';
    button.disabled=false;button.textContent='元スレッドに掲載する';
  }
});
$('#buy-product')?.addEventListener('click',async()=>{
  const button=$('#buy-product');button.disabled=true;button.textContent='購入処理中…';$('#checkout-status').textContent='AI-STAGINGの注文と購入権を作成しています…';
  try{
    const result=await client.purchaseProduct(id);
    $('#checkout-status').textContent=result.idempotent?'すでに購入済みです。受け取りを開きます。':'テスト購入が完了しました。実際の決済は発生していません。';
    await showAccess();
  }catch(err){console.error(err);const code=String(err?.message||err);$('#checkout-status').textContent=code==='maker_cannot_buy_own_product'?'自分の商品は購入できません。':'購入処理に失敗しました。';button.disabled=false;button.textContent=`${yen(product?.price_yen)}でテスト購入する`;}
});
await load();