import { client } from './canonical-api.js?v=20260920-consolidated-v1';

client.identity();

document.querySelector('#brand-home')?.addEventListener('click',e=>{
  e.preventDefault();
  location.assign('./');
});

if('serviceWorker' in navigator){
  navigator.serviceWorker
    .register('./sw.js',{scope:'./',updateViaCache:'none'})
    .then(r=>r.update())
    .catch(e=>console.warn('offline cache unavailable',e));
}
