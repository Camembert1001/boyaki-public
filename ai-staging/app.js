import { client } from './canonical-api.js?v=20260918-ai-v1';
client.identity();
document.querySelector('#brand-home')?.addEventListener('click',e=>{e.preventDefault();location.assign('./')});
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x===b));
  document.querySelector('#feed-view').hidden=b.dataset.view!=='feed';document.querySelector('#maker-view').hidden=b.dataset.view!=='maker';document.querySelector('#problem-view').hidden=true;document.querySelector('#composer').hidden=false;
  window.dispatchEvent(new Event('boyaki-feed-refresh'));
}));
document.querySelector('#maker-search')?.addEventListener('input',()=>window.dispatchEvent(new Event('boyaki-feed-refresh')));
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(r=>r.update()).catch(e=>console.warn('AI-STAGING offline cache unavailable',e));
