import { getPublicKey, finalizeEvent } from 'https://esm.sh/nostr-tools@2.17.0';
import * as nip49 from 'https://esm.sh/nostr-tools@2.17.0/nip49';
import { client,fromHex,toHex } from './canonical-api.js?v=20260918-ai-v1';
import { loadOwnedPosts } from './canonical-mypage.js?v=20260918-ai-v1';
const $=s=>document.querySelector(s),short=pk=>`${pk.slice(0,8)}…${pk.slice(-6)}`;
const store=window.BOYAKI_STORAGE;
function currentIdentity(){const i=client.identity();return i.kind==='account'?i:null}
function cacheProfile(profile){for(const [key,value] of Object.entries({'display-name':profile.displayName,interest:profile.interest,about:profile.about}))store.local.setItem('boyaki-profile-'+key,value||'')}
function clearLogin(){for(const s of [store.local,store.session])for(const key of ['boyaki-account-sk','boyaki-account-login-key','boyaki-account-pk','boyaki-profile-display-name','boyaki-profile-interest','boyaki-profile-about'])s.removeItem(key)}
$('#login-form').addEventListener('submit',async e=>{
  e.preventDefault();const button=e.submitter;button.disabled=true;$('#profile-state').textContent='ログイン中…';
  try{
    const key=$('#login-key').value.trim(),sk=nip49.decrypt(key,$('#login-password').value),id={sk,pk:getPublicKey(sk),kind:'account'};
    const result=await client.getAccount(id); // AI account must exist; never import another environment's profile.
    clearLogin();const target=$('#remember-login').checked?store.local:store.session;
    target.setItem('boyaki-account-sk',toHex(sk));target.setItem('boyaki-account-login-key',key);target.setItem('boyaki-account-pk',id.pk);cacheProfile(result.account.profile);$('#login-form').reset();location.reload();
  }catch{ $('#profile-state').textContent='ログインできませんでした。AI-STAGINGのログインキー・パスワードと通信状態を確認してください。' }
  finally{button.disabled=false}
});
async function linkDevice(account,links){
  const hex=store.local.getItem('boyaki-device-sk');if(!hex)return;
  const sk=fromHex(hex),pk=getPublicKey(sk);if(pk===account.pk||links.some(x=>x.legacy_pubkey===pk&&x.status==='verified'))return;
  const common=[['app','boyaki-web'],['environment','ai-staging'],['schema','boyaki-account-link-v1'],['account',account.pk],['legacy',pk]];
  const event=(signer,direction)=>finalizeEvent({kind:30078,created_at:Math.floor(Date.now()/1000),content:'',tags:[...common,['direction',direction]]},signer);
  await client.verifyIdentityLink(event(sk,'legacy-claims-account'),event(account.sk,'account-accepts-legacy'));
}
function savedLoginKey(){
  return store.local.getItem('boyaki-account-login-key')||store.session.getItem('boyaki-account-login-key')||'';
}
function activeAccountStore(){
  if(store.local.getItem('boyaki-account-sk'))return store.local;
  if(store.session.getItem('boyaki-account-sk'))return store.session;
  return null;
}
function setupLoginKeyRecoveryUI(){
  const card=$('#login-key-card'),show=$('#show-login-key'),copy=$('#copy-login-key'),hide=$('#hide-login-key'),area=$('#saved-login-key'),status=$('#login-key-status');
  if(!card||!show||!copy||!hide||!area||!status)return;
  if(!savedLoginKey())return;
  card.hidden=false;
  status.textContent='この端末に保存されているログインキーがあります。';
  show.addEventListener('click',()=>{const key=savedLoginKey();if(!key){status.textContent='保存済みログインキーが見つかりません。';return}area.value=key;area.hidden=false;copy.hidden=false;hide.hidden=false;show.hidden=true;status.textContent='ログインキーを表示しています。安全な場所へ保存したら「隠す」を押してください。';});
  copy.addEventListener('click',async()=>{const key=savedLoginKey();if(!key){status.textContent='保存済みログインキーが見つかりません。';return}try{await navigator.clipboard.writeText(key);status.textContent='ログインキーをコピーしました。';}catch{area.value=key;area.hidden=false;area.focus();area.select();status.textContent='自動コピーできませんでした。表示欄を選択してコピーしてください。';}});
  hide.addEventListener('click',()=>{area.value='';area.hidden=true;copy.hidden=true;hide.hidden=true;show.hidden=false;status.textContent='ログインキーを隠しました。';});
}
function setupLoginKeyReissueUI(account){
  const card=$('#account-key-backup'),form=$('#account-key-reissue-form'),password=$('#account-key-new-password'),confirm=$('#account-key-new-password-confirm'),area=$('#account-key-backup-value'),copy=$('#account-key-copy'),hide=$('#account-key-hide'),status=$('#account-key-backup-status');
  if(!card||!form||!password||!confirm||!area||!copy||!hide||!status)return;
  const target=activeAccountStore();if(!target)return;
  card.hidden=false;form.hidden=false;
  status.textContent='パスワードを忘れても、この端末でログイン中なら同じアカウント用の新しいログインキーを発行できます。';
  form.addEventListener('submit',async e=>{
    e.preventDefault();const button=e.submitter;
    const nextPassword=password.value,confirmation=confirm.value;
    if(nextPassword.length<10){status.textContent='新しいパスワードは10文字以上にしてください。';return}
    if(nextPassword!==confirmation){status.textContent='新しいパスワードが一致しません。';return}
    button.disabled=true;status.textContent='新しいログインキーを作成しています…';
    try{
      const loginKey=nip49.encrypt(account.sk,nextPassword);
      const verifiedSk=nip49.decrypt(loginKey,nextPassword);
      if(getPublicKey(verifiedSk)!==account.pk)throw new Error('reissue_verification_failed');
      target.setItem('boyaki-account-login-key',loginKey);
      area.value=loginKey;area.hidden=false;copy.hidden=false;hide.hidden=false;
      form.reset();
      status.textContent='新しいログインキーを発行しました。必ずコピーして保存してください。Account ID・投稿・活動履歴は変わりません。古いログインキーは無効化されません。';
    }catch(err){
      console.error('login key reissue failed',err);
      status.textContent='ログインキーを再発行できませんでした。再試行してください。';
    }finally{button.disabled=false}
  });
  copy.addEventListener('click',async()=>{const key=area.value;if(!key)return;try{await navigator.clipboard.writeText(key);status.textContent='新しいログインキーをコピーしました。安全な場所に保存してください。';}catch{area.focus();area.select();status.textContent='自動コピーできませんでした。表示欄を選択してコピーしてください。';}});
  hide.addEventListener('click',()=>{area.value='';area.hidden=true;copy.hidden=true;hide.hidden=true;status.textContent='新しいログインキーを隠しました。端末内には現在のログインキーとして保存されています。';});
}

async function main(){
  const id=currentIdentity();
  if(!id){$('#profile-state').textContent='AI-STAGINGアカウントにログインしていません。';$('#profile-name').textContent='未ログイン';$('#device-id').textContent='not logged in';return}
  $('#login-form').hidden=true;document.querySelectorAll('[data-authenticated-only]').forEach(x=>x.hidden=false);$('#device-id').textContent=short(id.pk);
  $('#profile-actions').innerHTML='<a class="button-link" href="./profile-edit.html">プロフィールを編集</a><button id="logout-button" type="button">ログアウト</button>';
  $('#logout-button').addEventListener('click',()=>{clearLogin();location.reload()});
  setupLoginKeyRecoveryUI();
  setupLoginKeyReissueUI(id);
  try{
    const {account,links}=await client.getAccount();cacheProfile(account.profile);
    $('#profile-name').textContent=account.profile.displayName||'プロフィール未登録';$('#profile-about').textContent=account.profile.about||'';$('#profile-state').textContent='AI-STAGINGアカウントにログイン中です。';
    await linkDevice(id,links||[]);$('#legacy-identity-note').textContent='このAI-STAGINGブラウザ内の投稿だけを、このアカウントで管理します。';
    await loadOwnedPosts();
  }catch(e){$('#profile-state').textContent='AI-STAGINGのアカウント情報を取得できませんでした。再読込してください。'}
}
main();
