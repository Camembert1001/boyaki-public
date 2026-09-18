import { getPublicKey } from 'https://esm.sh/nostr-tools@2.17.0';
import { client } from './canonical-api.js?v=20260918-ai-v1';
const $=s=>document.querySelector(s);
const fromHex=hex=>new Uint8Array((hex.match(/.{1,2}/g)||[]).map(b=>parseInt(b,16)));
const unix=()=>Math.floor(Date.now()/1000);
function currentIdentity(){
  const hex=window.BOYAKI_STORAGE.local.getItem('boyaki-account-sk')||window.BOYAKI_STORAGE.session.getItem('boyaki-account-sk');
  if(!hex)return null;
  try{const sk=fromHex(hex);return {sk,pk:getPublicKey(sk)}}catch{return null}
}
async function publishProfile(profile,id){return client.saveAccount(profile,id)}
async function main(){
  const id=currentIdentity();
  if(!id){$('#edit-state').textContent='ログインしていません。マイページからログインしてください。';$('#profile-edit-form').hidden=true;return}
  let p={};
  try{
    const result=await client.getAccount();const p0=result.account.profile; p={display_name:p0.displayName,boyaki_interest:p0.interest,about:p0.about};
  }catch{}
  $('#edit-name').value=p.display_name||p.name||window.BOYAKI_STORAGE.local.getItem('boyaki-profile-display-name')||'';
  const interest=p.boyaki_interest||window.BOYAKI_STORAGE.local.getItem('boyaki-profile-interest')||'both';
  $('#edit-interest').value=['voice','maker','both'].includes(interest)?interest:'both';
  $('#edit-about').value=typeof p.about==='string'?p.about:(window.BOYAKI_STORAGE.local.getItem('boyaki-profile-about')||'');
  $('#edit-state').textContent='ログイン中のアカウントプロフィールを編集しています。';
}
$('#profile-edit-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const id=currentIdentity();if(!id)return;
  const button=e.submitter,displayName=$('#edit-name').value.trim(),interest=$('#edit-interest').value,about=$('#edit-about').value.trim();
  if(!displayName){$('#edit-state').textContent='表示名を入力してください。';return}
  button.disabled=true;$('#edit-state').textContent='更新しています…';
  try{
    await publishProfile({displayName,interest,about},id);
    window.BOYAKI_STORAGE.local.setItem('boyaki-profile-display-name',displayName);
    window.BOYAKI_STORAGE.local.setItem('boyaki-profile-interest',interest);
    window.BOYAKI_STORAGE.local.setItem('boyaki-profile-about',about);
    $('#edit-state').textContent='更新しました。マイページへ戻ります…';
    setTimeout(()=>location.href='./mypage.html',500);
  }catch(err){console.error(err);$('#edit-state').textContent='更新できませんでした。通信状態を確認して再試行してください。';}
  finally{button.disabled=false}
});
main();