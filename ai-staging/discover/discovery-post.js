import { client } from '../canonical-api.js?v=20260918-ai-v1';
const $=s=>document.querySelector(s);
function safeToken(value,max=80){
  return String(value||'').trim().slice(0,max).replace(/[^a-zA-Z0-9._:-]/g,'-');
}

function safeSourceUrl(value){
  try{
    const u=new URL(String(value||'').trim());
    if(!['http:','https:'].includes(u.protocol)) return '';
    u.username='';u.password='';u.hash='';
    return u.toString().slice(0,500);
  }catch{return ''}
}

function pageMeta(){
  const d=document.documentElement.dataset;
  const q=new URLSearchParams(location.search);
  return {
    contentId:d.boyakiContentId||'unknown',
    campaignId:d.boyakiCampaignId||'unknown',
    vertical:d.boyakiVertical||'unknown',
    theme:d.boyakiTheme||'unknown',
    source:safeToken(q.get('source')||''),
    ref:safeToken(q.get('ref')||''),
    sourceUrl:safeSourceUrl($('#external-source')?.value||q.get('source_url')||'')
  };
}

async function createTrackedRaw(text){const result=await client.createPost(text);window.BOYAKI_STORAGE.local.setItem(`boyaki-acq:${result.post.id}`,JSON.stringify({...pageMeta(),landedAt:Date.now(),marketCredit:0}));return result.post}

const sourceField=$('#external-source');
if(sourceField){
  const q=new URLSearchParams(location.search);
  const initial=safeSourceUrl(q.get('source_url')||'');
  if(initial) sourceField.value=initial;
}

const form=$('#discovery-raw-form'), status=$('#discovery-status');
form?.addEventListener('submit',async e=>{
  e.preventDefault(); const input=$('#discovery-raw'); const text=input.value.trim(); if(!text)return;
  const button=form.querySelector('button'); button.disabled=true;
  const isEnglish=document.documentElement.lang==='en';
  status.textContent=isEnglish?'Publishing…':'公開しています…';
  try{
    const ev=await createTrackedRaw(text); input.value='';
    status.innerHTML=isEnglish?`Published. <a href="../?problem=${ev.id}">View this problem</a>`:`公開しました。<a href="../?problem=${ev.id}">この問題を見る</a>`;
  }catch(err){status.textContent=isEnglish?'Could not publish. Please try again shortly.':'公開できませんでした。少し後で再試行してください。'}
  finally{button.disabled=false}
});
