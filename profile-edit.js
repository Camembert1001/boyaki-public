import { SimplePool, getPublicKey, finalizeEvent } from 'https://esm.sh/nostr-tools@2.17.0';

const RELAYS=['wss://nos.lol','wss://relay.primal.net'];
const pool=new SimplePool();
const $=s=>document.querySelector(s);
const fromHex=hex=>new Uint8Array((hex.match(/.{1,2}/g)||[]).map(b=>parseInt(b,16)));
const unix=()=>Math.floor(Date.now()/1000);
function currentIdentity(){
  const hex=localStorage.getItem('boyaki-account-sk')||sessionStorage.getItem('boyaki-account-sk');
  if(!hex)return null;
  try{const sk=fromHex(hex);return {sk,pk:getPublicKey(sk)}}catch{return null}
}
function signed(template,id){return finalizeEvent({...template,created_at:template.created_at??unix()},id.sk)}
async function publishProfile(profile,id){
  const ev=signed({kind:0,content:JSON.stringify({
    name:profile.displayName,display_name:profile.displayName,about:profile.about,
    boyaki_interest:profile.interest,boyaki_schema:'account-profile-v1'
  }),tags:[['app','boyaki-web'],['schema','boyaki-account-profile-v1']]},id);
  const out=await Promise.allSettled(pool.publish(RELAYS,ev));
  if(!out.some(x=>x.status==='fulfilled'))throw new Error('relay publish failed');
}
async function main(){
  const id=currentIdentity();
  if(!id){$('#edit-state').textContent='ログインしていません。マイページからログインしてください。';$('#profile-edit-form').hidden=true;return}
  let p={};
  try{
    const rows=await pool.querySync(RELAYS,{kinds:[0],authors:[id.pk],limit:20});
    const latest=rows.sort((a,b)=>b.created_at-a.created_at)[0];
    if(latest)p=JSON.parse(latest.content||'{}');
  }catch{}
  $('#edit-name').value=p.display_name||p.name||localStorage.getItem('boyaki-profile-display-name')||'';
  const interest=p.boyaki_interest||localStorage.getItem('boyaki-profile-interest')||'both';
  $('#edit-interest').value=['voice','maker','both'].includes(interest)?interest:'both';
  $('#edit-about').value=typeof p.about==='string'?p.about:(localStorage.getItem('boyaki-profile-about')||'');
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
    localStorage.setItem('boyaki-profile-display-name',displayName);
    localStorage.setItem('boyaki-profile-interest',interest);
    localStorage.setItem('boyaki-profile-about',about);
    $('#edit-state').textContent='更新しました。マイページへ戻ります…';
    setTimeout(()=>location.href='./mypage.html',500);
  }catch(err){console.error(err);$('#edit-state').textContent='更新できませんでした。通信状態を確認して再試行してください。';}
  finally{button.disabled=false}
});
main();