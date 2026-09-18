import { generateSecretKey, getPublicKey } from 'https://esm.sh/nostr-tools@2.17.0';
import * as nip49 from 'https://esm.sh/nostr-tools@2.17.0/nip49';
import { client } from './canonical-api.js?v=20260918-ai-v1';
const $=s=>document.querySelector(s);
const unix=()=>Math.floor(Date.now()/1000);
const toHex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
const fromHex=hex=>new Uint8Array((hex.match(/.{1,2}/g)||[]).map(b=>parseInt(b,16)));
const short=pk=>`${pk.slice(0,8)}…${pk.slice(-6)}`;

function getLegacyIdentity(){
  let hex=window.BOYAKI_STORAGE.local.getItem('boyaki-device-sk');
  if(!hex){hex=toHex(generateSecretKey());window.BOYAKI_STORAGE.local.setItem('boyaki-device-sk',hex)}
  const sk=fromHex(hex);return {sk,pk:getPublicKey(sk)}
}
const legacy=getLegacyIdentity();
$('#device-id').textContent=short(legacy.pk);

async function publishProfile(profile,sk){return client.saveAccount(profile,{sk,pk:getPublicKey(sk),kind:'account'})}

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
    window.BOYAKI_STORAGE.local.setItem('boyaki-account-sk',toHex(sk));
    window.BOYAKI_STORAGE.local.setItem('boyaki-account-login-key',loginKey);
    window.BOYAKI_STORAGE.local.setItem('boyaki-account-pk',pk);
    window.BOYAKI_STORAGE.local.setItem('boyaki-profile-display-name',displayName);
    window.BOYAKI_STORAGE.local.setItem('boyaki-profile-interest',interest);
    window.BOYAKI_STORAGE.local.setItem('boyaki-profile-about',about);
    $('#account-login-key').value=loginKey;$('#account-result').hidden=false;$('#register-form').reset();$('#register-form').hidden=true;
    $('#register-status').textContent='アカウントを作成しました。この端末ではログイン済みです。ログインキーを必ず保存してください。';
  }catch(err){
    $('#register-status').textContent='アカウントを作成できませんでした。通信状態を確認して再試行してください。';
  }finally{button.disabled=false}
});
$('#copy-login-key').addEventListener('click',async()=>{const v=$('#account-login-key').value;if(!v)return;try{await navigator.clipboard.writeText(v);$('#copy-login-key').textContent='コピーしました'}catch{$('#account-login-key').select()}});
