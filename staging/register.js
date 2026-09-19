import { SimplePool, generateSecretKey, getPublicKey, finalizeEvent } from 'https://esm.sh/nostr-tools@2.17.0';
import * as nip49 from 'https://esm.sh/nostr-tools@2.17.0/nip49';
import { RELAYS } from './relays.js';
import './canonical-api.js?v=20260919-shared-identity-v1';
const pool=new SimplePool();
const $=s=>document.querySelector(s);
const unix=()=>Math.floor(Date.now()/1000);
const toHex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
const fromHex=hex=>new Uint8Array((hex.match(/.{1,2}/g)||[]).map(b=>parseInt(b,16)));
const short=pk=>`${pk.slice(0,8)}…${pk.slice(-6)}`;
async function sha256Hex(text){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')}

function getLegacyIdentity(){
  let hex=localStorage.getItem('boyaki-device-sk');
  if(!hex){hex=toHex(generateSecretKey());localStorage.setItem('boyaki-device-sk',hex)}
  const sk=fromHex(hex);return {sk,pk:getPublicKey(sk)}
}
const legacy=getLegacyIdentity();
$('#device-id').textContent=short(legacy.pk);

function signed(template,sk){return finalizeEvent({...template,created_at:template.created_at??unix()},sk)}
async function publishProfile(profile,sk){
  const ev=signed({kind:0,content:JSON.stringify({
    name:profile.displayName,display_name:profile.displayName,about:profile.about,
    boyaki_interest:profile.interest,boyaki_schema:'account-profile-v1'
  }),tags:[['app','boyaki-web'],['schema','boyaki-account-profile-v1']]},sk);
  const out=await Promise.allSettled(pool.publish(RELAYS,ev));
  if(!out.some(x=>x.status==='fulfilled'))throw new Error('relay publish failed');
  return ev;
}

$('#register-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const button=e.submitter,displayName=$('#register-name').value.trim(),interest=$('#register-interest').value,about=$('#register-about').value.trim();
  const password=$('#register-password').value,confirm=$('#register-password-confirm').value;
  if(!displayName){$('#register-status').textContent='表示名を入力してください。';return}
  if(password.length<10){$('#register-status').textContent='パスワードは10文字以上にしてください。';return}
  if(password!==confirm){$('#register-status').textContent='パスワードが一致しません。';return}
  button.disabled=true;$('#register-status').textContent='アカウント鍵を作成しています…';
  try{
    const sk=generateSecretKey(),pk=getPublicKey(sk);
    const loginKey=nip49.encrypt(sk,password);
    await publishProfile({displayName,interest,about},sk);
    localStorage.setItem('boyaki-account-sk',toHex(sk));
    localStorage.setItem('boyaki-account-login-key',loginKey);
    localStorage.setItem('boyaki-account-pk',pk);
    localStorage.setItem('boyaki-profile-display-name',displayName);
    localStorage.setItem('boyaki-profile-interest',interest);
    localStorage.setItem('boyaki-profile-about',about);
    let sharedIdentityReady=false;
    try{
      const hash=await sha256Hex(loginKey);
      await window.BOYAKI_CANONICAL.saveAccountCredential(hash,loginKey);
      sharedIdentityReady=true;
    }catch(err){console.warn('shared identity registration deferred',err)}
    $('#account-login-key').value=loginKey;$('#account-result').hidden=false;
    $('#register-status').textContent=sharedIdentityReady
      ?'アカウントを作成しました。STAGINGとAI-STAGINGで同じアカウントを使えます。ログインキーを必ず保存してください。'
      :'アカウントを作成しました。共有アカウント登録は保留中です。STAGINGで一度ログインすると再登録されます。ログインキーを必ず保存してください。';
  }catch(err){
    console.error(err);$('#register-status').textContent='アカウントを作成できませんでした。通信状態を確認して再試行してください。';
  }finally{button.disabled=false}
});
$('#copy-login-key').addEventListener('click',async()=>{const v=$('#account-login-key').value;if(!v)return;try{await navigator.clipboard.writeText(v);$('#copy-login-key').textContent='コピーしました'}catch{$('#account-login-key').select()}});
