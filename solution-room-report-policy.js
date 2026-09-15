import { SimplePool, generateSecretKey, getPublicKey, finalizeEvent } from 'https://esm.sh/nostr-tools@2.17.0';
import { RELAYS } from './relays.js';
const pool=new SimplePool();
const toHex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
const fromHex=hex=>new Uint8Array((hex.match(/.{1,2}/g)||[]).map(b=>parseInt(b,16)));
function identity(){let hex=localStorage.getItem('boyaki-device-sk');if(!hex){hex=toHex(generateSecretKey());localStorage.setItem('boyaki-device-sk',hex)}const sk=fromHex(hex);return{sk,pk:getPublicKey(sk)}}
async function report(candidateId,message){
  const id=identity();
  const ev=finalizeEvent({kind:1984,created_at:Math.floor(Date.now()/1000),content:JSON.stringify({reason:'user_report',candidateId,message:message.slice(0,500)}),tags:[['t','boyaki-solution-room-report'],['candidate_id',candidateId],['app','boyaki-web'],['schema','solution-room-report-v1']]},id.sk);
  const results=await Promise.allSettled(pool.publish(RELAYS,ev));
  if(!results.some(x=>x.status==='fulfilled'))throw new Error('report publish failed');
}
function apply(root=document){
  const chats=[];if(root.matches?.('.solution-room-chat'))chats.push(root);root.querySelectorAll?.('.solution-room-chat').forEach(x=>chats.push(x));
  for(const chat of chats)for(const item of chat.querySelectorAll('.activity-item')){
    const old=[...item.querySelectorAll('button')].find(b=>b.textContent.trim()==='取り下げ');if(!old)continue;
    const button=old.cloneNode(true);button.textContent='問題を報告';button.dataset.reportPolicy='1';old.replaceWith(button);
    button.addEventListener('click',async()=>{
      const candidateId=document.body.dataset.solutionRoom||item.closest('.candidate-card')?.querySelector('.candidate-id')?.textContent?.trim()||'';
      const message=item.querySelector('p')?.textContent?.trim()||'';
      button.disabled=true;button.textContent='報告中…';
      try{await report(candidateId,message);button.textContent='報告しました'}catch(err){console.error(err);button.disabled=false;button.textContent='問題を報告'}
    });
  }
}
new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1)apply(n)}).observe(document.documentElement,{childList:true,subtree:true});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>apply());else apply();
