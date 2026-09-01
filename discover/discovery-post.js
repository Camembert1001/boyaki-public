import { SimplePool, generateSecretKey, getPublicKey, finalizeEvent, nip44 } from 'https://esm.sh/nostr-tools@2.17.0';

const RELAYS=['wss://nos.lol','wss://relay.primal.net'];
const RECOVERY_PUBKEY='1ba668198fc73341765d7dc8d51e7f669d04b613e56e43bba0fc0d7b5e313250';
const pool=new SimplePool();
const $=s=>document.querySelector(s);
const toHex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
const fromHex=hex=>new Uint8Array((hex.match(/.{1,2}/g)||[]).map(b=>parseInt(b,16)));
const unix=()=>Math.floor(Date.now()/1000);

function identity(){
  let hex=localStorage.getItem('boyaki-device-sk');
  if(!hex){hex=toHex(generateSecretKey());localStorage.setItem('boyaki-device-sk',hex)}
  const sk=fromHex(hex); return {sk,pk:getPublicKey(sk)};
}

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

async function publishExact(ev){
  const result=await Promise.allSettled(pool.publish(RELAYS,ev));
  if(!result.some(x=>x.status==='fulfilled')) throw new Error('relay publish failed');
  return ev;
}

async function createTrackedRaw(text){
  const {sk,pk}=identity(); const meta=pageMeta();
  const tags=[
    ['t','boyaki-raw'],['app','boyaki-web'],['schema','raw-v1'],['source','deliberate-web-submission'],
    ['acq_content_id',meta.contentId],['acq_campaign_id',meta.campaignId],['acq_vertical',meta.vertical],['acq_theme',meta.theme],
    ['acq_schema','holdings-frontier-v12'],['acq_authenticity','unqualified']
  ];
  if(meta.source) tags.push(['acq_source',meta.source]);
  if(meta.ref) tags.push(['acq_ref',meta.ref]);
  if(meta.sourceUrl) tags.push(['acq_source_url',meta.sourceUrl]);
  const raw=finalizeEvent({kind:1,created_at:unix(),content:text,tags},sk);
  const deletion=finalizeEvent({kind:5,created_at:unix(),content:'withdraw raw source',tags:[['e',raw.id],['k','1'],['app','boyaki-web'],['schema','presigned-withdrawal-v1']]},sk);
  const conversationKey=nip44.v2.utils.getConversationKey(sk,RECOVERY_PUBKEY);
  const encrypted=nip44.v2.encrypt(JSON.stringify(deletion),conversationKey);
  const capsule=finalizeEvent({kind:1,created_at:unix(),content:encrypted,tags:[['t','boyaki-recovery-capsule'],['e',raw.id,RELAYS[0],'root'],['p',RECOVERY_PUBKEY],['app','boyaki-web'],['schema','encrypted-revocation-capsule-v1']]},sk);
  await publishExact(capsule); await publishExact(raw);
  localStorage.setItem(`boyaki-withdrawal:${raw.id}`,JSON.stringify(deletion));
  localStorage.setItem(`boyaki-acq:${raw.id}`,JSON.stringify({...meta,landedAt:Date.now(),pubkey:pk,marketCredit:0}));
  return raw;
}

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
