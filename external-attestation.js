import {SimplePool,finalizeEvent,getPublicKey} from 'https://esm.sh/nostr-tools@2.17.0';

const RELAYS=['wss://nos.lol','wss://relay.primal.net'];
const pool=new SimplePool();
const status=document.querySelector('#status');
const HEX64=/^[0-9a-f]{64}$/i;
const enc=new TextEncoder();
const toHex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
const fromHex=hex=>new Uint8Array((hex.match(/.{1,2}/g)||[]).map(x=>parseInt(x,16)));
const sha256=async s=>toHex(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))));

function deviceIdentity(){
  const hex=localStorage.getItem('boyaki-device-sk');
  if(!hex||!HEX64.test(hex))return null;
  const sk=fromHex(hex);return {sk,pk:getPublicKey(sk)};
}
async function publish(ev){
  const rs=await Promise.allSettled(pool.publish(RELAYS,ev));
  if(!rs.some(x=>x.status==='fulfilled'))throw new Error('relay publish failed');
  return ev;
}
async function ensureChallenge(rawId){
  const device=deviceIdentity();if(!device)return null;
  const secretKey=`boyaki-attestation-secret:${rawId}`;
  const challengeKey=`boyaki-attestation-challenge:${rawId}`;
  const existingSecret=localStorage.getItem(secretKey),existingChallenge=localStorage.getItem(challengeKey);
  if(existingSecret&&existingChallenge){try{return {secret:existingSecret,challenge:JSON.parse(existingChallenge),device}}catch{}}
  const secret=toHex(crypto.getRandomValues(new Uint8Array(16)));
  const digest=await sha256(secret);
  const challenge=finalizeEvent({
    kind:1,created_at:Math.floor(Date.now()/1000),content:'',
    tags:[['t','boyaki-auth-challenge'],['e',rawId,RELAYS[0],'root'],['challenge_sha256',digest],['schema','external-attestation-challenge-v1'],['app','boyaki-web']]
  },device.sk);
  await publish(challenge);
  localStorage.setItem(secretKey,secret);localStorage.setItem(challengeKey,JSON.stringify(challenge));
  return {secret,challenge,device};
}
async function attest(rawId,button){
  if(!window.nostr?.getPublicKey||!window.nostr?.signEvent)throw new Error('nostr signer unavailable');
  const x=await ensureChallenge(rawId);if(!x)throw new Error('device identity unavailable');
  const externalPk=await window.nostr.getPublicKey();
  if(!HEX64.test(externalPk)||externalPk===x.device.pk)throw new Error('independent signer required');
  const template={
    kind:1,created_at:Math.floor(Date.now()/1000),content:'',
    tags:[['t','boyaki-external-attestation'],['e',rawId,RELAYS[0],'root'],['e',x.challenge.id,RELAYS[0],'reply'],['p',x.device.pk],['challenge_secret',x.secret],['schema','external-attestation-proof-v1'],['app','boyaki-web']]
  };
  const proof=await window.nostr.signEvent(template);
  if(proof.pubkey!==externalPk)throw new Error('signer mismatch');
  await publish(proof);
  localStorage.setItem(`boyaki-attested:${rawId}`,proof.id);
  button.textContent='外部アカウントで証明済み';button.disabled=true;
}
function rawIdFromHref(href=''){
  try{return new URL(href,location.href).searchParams.get('problem')}catch{return null}
}
function control(rawId){
  const p=document.createElement('p');p.className='hint';p.dataset.externalAttestation=rawId;
  p.append('既存のNostrアカウントがある場合だけ、この投稿が外部ユーザーのものだと任意で証明できます。投稿自体にログインは不要です。証明すると、そのNostrアカウントとこのBOYAKIの関係が公開されます。 ');
  const b=document.createElement('button');b.type='button';b.textContent='公開で証明する（任意）';
  b.addEventListener('click',async()=>{b.disabled=true;try{await attest(rawId,b)}catch{b.disabled=false;b.textContent='証明できませんでした'}});
  p.append(b);return p;
}
async function isOwnRaw(rawId){
  const d=deviceIdentity();if(!d)return false;
  const xs=await pool.querySync(RELAYS,{ids:[rawId],kinds:[1],limit:4});
  return xs.some(e=>e.id===rawId&&e.pubkey===d.pk&&e.tags.some(t=>t[0]==='t'&&t[1]==='boyaki-raw'));
}
async function renderStatus(){
  if(!status||!window.nostr?.getPublicKey||!window.nostr?.signEvent)return;
  const rawId=rawIdFromHref(status.querySelector('a[href*="problem="]')?.getAttribute('href')||'');
  if(!HEX64.test(rawId||'')||localStorage.getItem(`boyaki-attested:${rawId}`)||status.querySelector(`[data-external-attestation="${rawId}"]`))return;
  status.append(control(rawId));
}
async function renderOwnedCards(){
  if(!window.nostr?.getPublicKey||!window.nostr?.signEvent||!deviceIdentity())return;
  for(const card of document.querySelectorAll('.problem-card')){
    const rawId=rawIdFromHref(card.querySelector('.permalink')?.getAttribute('href')||'');
    if(!HEX64.test(rawId||'')||localStorage.getItem(`boyaki-attested:${rawId}`)||card.querySelector(`[data-external-attestation="${rawId}"]`))continue;
    if(await isOwnRaw(rawId))card.append(control(rawId));
  }
}
let scheduled=false;
function scheduleRender(){
  if(scheduled)return;scheduled=true;
  setTimeout(async()=>{scheduled=false;await renderStatus().catch(()=>{});await renderOwnedCards().catch(()=>{})},50);
}
new MutationObserver(scheduleRender).observe(document.documentElement,{childList:true,subtree:true});
scheduleRender();
