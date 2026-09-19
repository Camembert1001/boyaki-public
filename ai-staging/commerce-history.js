import { client } from './canonical-api.js?v=20260919-thread-room-product-v7';

const purchasesBox=document.querySelector('[data-commerce-purchases]');
const purchasesStatus=document.querySelector('#commerce-purchases-status');
const salesBox=document.querySelector('[data-commerce-sales]');
const salesStatus=document.querySelector('#commerce-sales-status');
const productsBox=document.querySelector('[data-commerce-products]');
const productsStatus=document.querySelector('#commerce-products-status');

const yen=v=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(Number(v)||0);
const fmt=v=>v?new Date(v).toLocaleString('ja-JP'):'';

function account(){const id=client.identity();return id?.kind==='account'?id:null}
function empty(box,text){if(box)box.innerHTML=`<p class="hint">${text}</p>`}

async function renderPurchases(){
  if(!purchasesBox)return;
  if(!account()){empty(purchasesBox,'ログインすると購入済みプロダクトが表示されます。');return}
  if(purchasesStatus)purchasesStatus.textContent='購入履歴を読み込んでいます…';
  try{
    const result=await client.listMyPurchases(),rows=result.purchases||[];
    purchasesBox.replaceChildren();
    if(!rows.length)empty(purchasesBox,'まだ購入したプロダクトはありません。');
    for(const row of rows){
      const card=document.createElement('article');card.className='participation-panel';
      const h=document.createElement('h3');h.textContent=row.product?.title||'Product';
      const meta=document.createElement('p');meta.className='hint';meta.textContent=`${yen(row.amount_yen)} · ${fmt(row.paid_at||row.created_at)} · テスト購入`;
      const actions=document.createElement('div');actions.className='actions';
      const open=document.createElement('a');open.className='button-link';open.href=`./product.html?id=${encodeURIComponent(row.product_id)}`;open.textContent='購入内容を開く';
      actions.append(open);card.append(h,meta,actions);purchasesBox.append(card);
    }
    if(purchasesStatus)purchasesStatus.textContent=`${rows.length}件の購入`;
  }catch(err){console.error('purchases history',err);empty(purchasesBox,'購入履歴を読み込めませんでした。');if(purchasesStatus)purchasesStatus.textContent='読み込みに失敗しました。'}
}

async function renderMakerCommerce(){
  if(!salesBox&&!productsBox)return;
  if(!account()){empty(salesBox,'ログインすると売上履歴が表示されます。');empty(productsBox,'ログインすると出品中プロダクトが表示されます。');return}
  if(salesStatus)salesStatus.textContent='売上履歴を読み込んでいます…';
  if(productsStatus)productsStatus.textContent='出品中プロダクトを読み込んでいます…';
  try{
    const [salesResult,productResult]=await Promise.all([client.listMySales(),client.listMyProducts()]);
    const sales=salesResult.sales||[],products=productResult.products||[];
    if(productsBox){
      productsBox.replaceChildren();
      if(!products.length)empty(productsBox,'まだ出品プロダクトはありません。Solution Caseから商品化できます。');
      for(const product of products){
        const card=document.createElement('article');card.className='participation-panel';
        const h=document.createElement('h3');h.textContent=product.title;
        const meta=document.createElement('p');meta.className='hint';meta.textContent=`${yen(product.price_yen)} · ${product.status}`;
        const actions=document.createElement('div');actions.className='actions';
        const open=document.createElement('a');open.className='button-link';open.href=`./product.html?id=${encodeURIComponent(product.id)}`;open.textContent='商品ページ';
        actions.append(open);card.append(h,meta,actions);productsBox.append(card);
      }
      if(productsStatus)productsStatus.textContent=`${products.length}件のプロダクト`;
    }
    if(salesBox){
      salesBox.replaceChildren();
      if(!sales.length)empty(salesBox,'まだ購入は発生していません。');
      for(const sale of sales){
        const card=document.createElement('article');card.className='participation-panel';
        const h=document.createElement('h3');h.textContent=sale.product?.title||'Product';
        const meta=document.createElement('p');meta.className='hint';meta.textContent=`${yen(sale.amount_yen)} · ${fmt(sale.paid_at||sale.created_at)} · buyer ${String(sale.buyer_account_pubkey||'').slice(0,8)}…`;
        card.append(h,meta);salesBox.append(card);
      }
      if(salesStatus)salesStatus.textContent=`${salesResult.summary?.orders||0}件購入 · テスト売上 ${yen(salesResult.summary?.revenue_yen||0)}`;
    }
  }catch(err){console.error('maker commerce history',err);empty(salesBox,'売上履歴を読み込めませんでした。');empty(productsBox,'出品情報を読み込めませんでした。');if(salesStatus)salesStatus.textContent='読み込みに失敗しました。';if(productsStatus)productsStatus.textContent='読み込みに失敗しました。'}
}

await Promise.all([renderPurchases(),renderMakerCommerce()]);