import { SimplePool, getPublicKey, finalizeEvent } from 'https://esm.sh/nostr-tools@2.17.0';
import * as nip49 from 'https://esm.sh/nostr-tools@2.17.0/nip49';
import { RELAYS } from './relays.js';
const pool=new SimplePool();
const $=s=>document.querySelector(s);
const fromHex=hex=>new Uint8Array((hex.match(/.{1,2}/g)||[]).map(b=>parseInt(b,16)));
const short=pk=>`${pk.slice(0,8)}…${pk.slice(-6)}`;
const fmt=ts=>new Date(ts*1000).toLocaleString('ja-JP');
const tag=(ev,k)=>ev.tags?.find(t=>t[0]===k)?.[1];
const unix=()=>Math.floor(Date.now()/1000);
const LINK_KIND=30078;
const LINK_SCHEMA='boyaki-account-link-v1';

function currentIdentity(){
  const accountHex=localStorage.getItem('boyaki-account-sk')||sessionStorage.getItem('boyaki-account-sk');
  if(accountHex){try{const sk=fromHex(accountHex);return {sk,pk:getPublicKey(sk),type:'account'}}catch{}}
  return null;
}
function legacyIdentity(){
  const hex=localStorage.getItem('boyaki-device-sk');if(!hex)return null;
  try{const sk=fromHex(hex);return {sk,pk:getPublicKey(sk),type:'legacy-browser'}}catch{return null}
}
function signed(template,id){return finalizeEvent({...template,created_at:template.created_at??unix()},id.sk)}
async function publishExact(ev){const out=await Promise.allSettled(pool.publish(RELAYS,ev));if(!out.some(x=>x.status==='fulfilled'))throw new Error('relay publish failed');return ev}
function deletionTargets(ev){return (ev.tags||[]).filter(t=>t[0]==='e').map(t=>t[1])}
function isLinkEvent(ev){return ev?.kind===LINK_KIND&&tag(ev,'schema')===LINK_SCHEMA&&tag(ev,'account')&&tag(ev,'legacy')}
async function publishLinkPair(account,legacy){
  const common=[['app','boyaki-web'],['schema',LINK_SCHEMA],['account',account.pk],['legacy',legacy.pk]];
  const legacyClaim=signed({kind:LINK_KIND,content:'',tags:[['d',`legacy-to-account:${legacy.pk}:${account.pk}`],...common,['direction','legacy-claims-account']]},legacy);
  const accountAccept=signed({kind:LINK_KIND,content:'',tags:[['d',`account-accepts-legacy:${account.pk}:${legacy.pk}`],...common,['direction','account-accepts-legacy']]},account);
  await publishExact(legacyClaim); await publishExact(accountAccept);
  return {legacyClaim,accountAccept};
}
async function linkedLegacyPubkeys(accountPk){
  const accepts=await pool.querySync(RELAYS,{kinds:[LINK_KIND],authors:[accountPk],'#schema':[LINK_SCHEMA],limit:200}).catch(()=>[]);
  const candidates=new Set(accepts.filter(e=>isLinkEvent(e)&&tag(e,'direction')==='account-accepts-legacy'&&tag(e,'account')===accountPk).map(e=>tag(e,'legacy')));
  const out=[];
  for(const legacyPk of candidates){
    const claims=await pool.querySync(RELAYS,{kinds:[LINK_KIND],authors:[legacyPk],'#schema':[LINK_SCHEMA],limit:50}).catch(()=>[]);
    const ok=claims.some(e=>isLinkEvent(e)&&tag(e,'direction')==='legacy-claims-account'&&tag(e,'account')===accountPk&&tag(e,'legacy')===legacyPk);
    if(ok)out.push(legacyPk);
  }
  return out;
}

async function loadProfile(identity){
  const local={displayName:localStorage.getItem('boyaki-profile-display-name')||localStorage.getItem('boyaki-maker-display-name')||'',about:localStorage.getItem('boyaki-profile-about')||''};
  let remote=null;
  try{const rows=await pool.querySync(RELAYS,{kinds:[0],authors:[identity.pk],limit:20});const latest=rows.sort((a,b)=>b.created_at-a.created_at)[0];if(latest){const p=JSON.parse(latest.content||'{}');if(p.boyaki_schema==='account-profile-v1'||p.boyaki_schema==='profile-v1')remote=p}}catch{}
  return {displayName:remote?.display_name||remote?.name||local.displayName,about:remote?.about||local.about};
}

async function withdrawOwn(root,identity,knownDeletionIds){
  if(root.pubkey!==identity.pk)return false;
  if(knownDeletionIds.has(root.id)||localStorage.getItem(`boyaki-withdrawn:${root.id}`)==='1')return true;
  let ev=null;
  const stored=localStorage.getItem(`boyaki-withdrawal:${root.id}`);
  if(stored){try{const parsed=JSON.parse(stored);if(parsed?.kind===5&&parsed?.pubkey===identity.pk&&deletionTargets(parsed).includes(root.id))ev=parsed}catch{}}
  if(!ev)ev=signed({kind:5,content:'withdrawn by original browser identity',tags:[['e',root.id],['k','1'],['app','boyaki-web'],['schema','mypage-owner-withdrawal-v1']]},identity);
  await publishExact(ev);
  localStorage.setItem(`boyaki-withdrawn:${root.id}`,'1');
  knownDeletionIds.add(root.id);
  return true;
}

function renderOwnPosts(raw,knownDeletionIds,accountIdentity,legacyLocal){
  const box=$('#own-posts'); if(!box)return;
  box.innerHTML='';
  if(!raw.length){box.innerHTML='<p class="hint">このアカウントに紐づくBOYAKI投稿はありません。</p>';return}
  for(const ev of raw.sort((a,b)=>b.created_at-a.created_at)){
    const withdrawn=knownDeletionIds.has(ev.id)||localStorage.getItem(`boyaki-withdrawn:${ev.id}`)==='1';
    const wrap=document.createElement('div');wrap.className='participation-panel';
    const text=document.createElement('p');text.textContent=(ev.content||'').slice(0,220);wrap.append(text);
    const meta=document.createElement('p');meta.className='hint';meta.textContent=`${fmt(ev.created_at)} · ${withdrawn?'取り下げ済み':'公開中'} · ${ev.id.slice(0,10)}…`;wrap.append(meta);
    const actions=document.createElement('div');actions.className='actions';
    const link=document.createElement('a');link.className='button-link';link.href=`./?problem=${encodeURIComponent(ev.id)}`;link.textContent='投稿を見る';actions.append(link);
    const signer=ev.pubkey===accountIdentity.pk?accountIdentity:(legacyLocal&&ev.pubkey===legacyLocal.pk?legacyLocal:null);
    const button=document.createElement('button');
    button.textContent=withdrawn?'取り下げ済み':signer?'自分の投稿を取り下げ':'旧端末でのみ取り下げ可能';
    button.disabled=withdrawn||!signer;
    if(signer)button.addEventListener('click',async()=>{if(!confirm('このBOYAKIを取り下げますか？ 公開一覧から除外されます。'))return;button.disabled=true;button.textContent='取り下げ中…';try{await withdrawOwn(ev,signer,knownDeletionIds);button.textContent='取り下げ済み';meta.textContent=`${fmt(ev.created_at)} · 取り下げ済み · ${ev.id.slice(0,10)}…`}catch{button.disabled=false;button.textContent='再試行';$('#ownership-status').textContent='取り下げをRelayへ反映できませんでした。通信状態を確認して再試行してください。'}});
    actions.append(button);wrap.append(actions);box.append(wrap);
  }
}

async function loadOwnedPosts(identity){
  const since=unix()-60*60*24*365;
  const linked=await linkedLegacyPubkeys(identity.pk);
  const authors=[identity.pk,...linked];
  const rows=await pool.querySync(RELAYS,{authors,kinds:[1,5],since,limit:1000});
  const deduped=[...new Map(rows.map(x=>[x.id,x])).values()].sort((a,b)=>b.created_at-a.created_at);
  const deletions=deduped.filter(e=>e.kind===5&&authors.includes(e.pubkey));
  const deletedIds=new Set(deletions.flatMap(deletionTargets));
  const raw=deduped.filter(e=>e.kind===1&&tag(e,'t')==='boyaki-raw');
  renderOwnPosts(raw,deletedIds,identity,legacyIdentity());
}

async function sha256Hex(text){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function canonical(){const c=window.BOYAKI_CANONICAL;if(!c)throw new Error('canonical_client_missing');return c}
async function resolveLoginEnvelope(loginKey){
  const hash=await sha256Hex(loginKey);
  try{
    const result=await canonical().resolveAccountCredential(hash);
    return {hash,encryptedSecret:result.encrypted_secret,accountPubkey:result.account_pubkey,managed:true};
  }catch(err){
    if(String(err?.message||err)==='credential_not_found')return {hash,encryptedSecret:loginKey,accountPubkey:null,managed:false};
    throw err;
  }
}
function storeAuthenticatedSession(sk,loginKey,remember){
  const hex=[...sk].map(b=>b.toString(16).padStart(2,'0')).join('');
  for(const s of [localStorage,sessionStorage]){s.removeItem('boyaki-account-sk');s.removeItem('boyaki-account-login-key')}
  const target=remember?localStorage:sessionStorage;
  target.setItem('boyaki-account-sk',hex);
  target.setItem('boyaki-account-login-key',loginKey);
}
$('#login-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const key=$('#login-key').value.trim(),password=$('#login-password').value,remember=$('#remember-login').checked;
  const button=e.submitter;button.disabled=true;$('#profile-state').textContent='ログイン中…';
  try{
    const resolved=await resolveLoginEnvelope(key);
    const sk=nip49.decrypt(resolved.encryptedSecret,password);
    const pk=getPublicKey(sk);
    if(resolved.accountPubkey&&pk!==resolved.accountPubkey)throw new Error('credential_account_mismatch');
    storeAuthenticatedSession(sk,key,remember);
    if(!resolved.managed){
      try{await canonical().saveAccountCredential(resolved.hash,key)}
      catch(err){console.warn('legacy credential registration deferred',err)}
    }
    location.reload();
  }catch(err){
    console.error(err);
    const code=String(err?.message||err);
    $('#profile-state').textContent=code==='credential_not_found'
      ?'ログイン情報が見つかりませんでした。'
      :'ログインできませんでした。ログインキー・パスワードと通信状態を確認してください。';
  }finally{button.disabled=false}
});

function savedLoginKey(){
  return localStorage.getItem('boyaki-account-login-key')||sessionStorage.getItem('boyaki-account-login-key')||'';
}
function activeAccountStore(){
  if(localStorage.getItem('boyaki-account-sk'))return localStorage;
  if(sessionStorage.getItem('boyaki-account-sk'))return sessionStorage;
  return null;
}
function setupLoginKeyRecoveryUI(){
  const card=$('#login-key-card'),show=$('#show-login-key'),copy=$('#copy-login-key'),hide=$('#hide-login-key'),area=$('#saved-login-key'),status=$('#login-key-status');
  if(!card||!show||!copy||!hide||!area||!status)return;
  if(!savedLoginKey())return;
  card.hidden=false;
  status.textContent='この端末に保存されているログインキーがあります。';
  show.addEventListener('click',()=>{
    const key=savedLoginKey();
    if(!key){status.textContent='保存済みログインキーが見つかりません。';return}
    area.value=key;area.hidden=false;copy.hidden=false;hide.hidden=false;show.hidden=true;
    status.textContent='ログインキーを表示しています。安全な場所へ保存したら「隠す」を押してください。';
  });
  copy.addEventListener('click',async()=>{
    const key=savedLoginKey();
    if(!key){status.textContent='保存済みログインキーが見つかりません。';return}
    try{await navigator.clipboard.writeText(key);status.textContent='ログインキーをコピーしました。';}
    catch{area.value=key;area.hidden=false;area.focus();area.select();status.textContent='自動コピーできませんでした。表示欄を選択してコピーしてください。';}
  });
  hide.addEventListener('click',()=>{area.value='';area.hidden=true;copy.hidden=true;hide.hidden=true;show.hidden=false;status.textContent='ログインキーを隠しました。';});
}
function setupPasswordReset(identity){
  const card=$('#account-password-reset'),status=$('#account-password-reset-status'),complete=$('#account-password-reset-complete'),form=$('#account-password-reset-form');
  const password=$('#account-password-new'),confirm=$('#account-password-new-confirm');
  const manualWrap=$('#account-password-reset-login-key-wrap'),manualKey=$('#account-password-reset-login-key');
  if(!card||!status||!complete||!form||!password||!confirm||!manualWrap||!manualKey||!identity)return;
  const setStatus=(state,message,{focus=false}={})=>{
    status.hidden=false;
    status.dataset.state=state;
    status.textContent=message;
    if(focus){
      status.focus({preventScroll:true});
      status.scrollIntoView({behavior:'smooth',block:'center'});
    }
  };
  card.hidden=false;
  complete.hidden=true;
  const existing=savedLoginKey();
  manualWrap.hidden=Boolean(existing);
  setStatus('info',existing
    ?'現在のログインキーは変更せず、パスワードだけを再設定できます。'
    :'この端末にログインキーが保存されていません。現在のログインキーを入力すると、パスワードだけを再設定できます。');
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    complete.hidden=true;
    const button=e.submitter,p=password.value,check=confirm.value;
    const stableLoginKey=savedLoginKey()||manualKey.value.trim();
    if(!stableLoginKey){setStatus('error','再設定できませんでした。現在のログインキーを入力してください。',{focus:true});return}
    if(p.length<10){setStatus('error','再設定できませんでした。新しいパスワードは10文字以上にしてください。',{focus:true});return}
    if(p!==check){setStatus('error','再設定できませんでした。新しいパスワードが一致しません。',{focus:true});return}
    button.disabled=true;
    button.textContent='再設定中…';
    setStatus('working','パスワードを再設定しています。この画面を閉じずにお待ちください。',{focus:true});
    try{
      const encryptedSecret=nip49.encrypt(identity.sk,p);
      const verified=nip49.decrypt(encryptedSecret,p);
      if(getPublicKey(verified)!==identity.pk)throw new Error('password_reset_verification_failed');
      const hash=await sha256Hex(stableLoginKey);
      await canonical().saveAccountCredential(hash,encryptedSecret);
      const target=activeAccountStore()||localStorage;
      localStorage.removeItem('boyaki-account-login-key');sessionStorage.removeItem('boyaki-account-login-key');
      target.setItem('boyaki-account-login-key',stableLoginKey);
      form.reset();manualWrap.hidden=true;
      setStatus('success','再設定が完了しました。',{focus:true});
      complete.hidden=false;
      complete.scrollIntoView({behavior:'smooth',block:'center'});
    }catch(err){
      console.error('password reset failed',err);
      setStatus('error','再設定に失敗しました。通信状態を確認して、もう一度お試しください。',{focus:true});
    }finally{
      button.disabled=false;
      button.textContent='パスワードを再設定';
    }
  });
}

async function main(){
  const identity=currentIdentity();
  if(!identity){
    $('#profile-state').textContent='BOYAKIアカウントにログインしていません。';
    $('#profile-name').textContent='未ログイン';
    $('#device-id').textContent='not logged in';
    $('#profile-actions').innerHTML='<a class="button-link" href="./register.html">新規登録へ</a>';
    const legacy=legacyIdentity();
    if(legacy)$('#legacy-identity-note').textContent=`このブラウザには旧BOYAKI ID ${short(legacy.pk)} があります。過去活動のアカウント引き継ぎは次工程です。`;
    $('#own-posts').innerHTML='<p class="hint">アカウントへログイン後、そのアカウントに紐づく投稿をここで管理できます。</p>';
    return;
  }
  document.querySelectorAll('[data-authenticated-only]').forEach(x=>x.hidden=false);
  $('#device-id').textContent=short(identity.pk);
  setupLoginKeyRecoveryUI();
  setupPasswordReset(identity);
  const loginForm=$('#login-form'); if(loginForm) loginForm.hidden=true;
  const legacy=legacyIdentity();
  let linked=await linkedLegacyPubkeys(identity.pk);
  const linkCard=$('#legacy-link-card'),linkButton=$('#legacy-link-button'),linkStatus=$('#legacy-link-status');
  if(legacy&&legacy.pk!==identity.pk){
    linkCard.hidden=false;
    if(!linked.includes(legacy.pk)){
      linkStatus.textContent=`このブラウザで作成された旧BOYAKI ID ${short(legacy.pk)} の過去活動を確認しています…`;
      linkButton.hidden=true;
      try{
        await publishLinkPair(identity,legacy);
        linked=[...new Set([...linked,legacy.pk])];
        linkStatus.textContent=`このブラウザの旧BOYAKI ID ${short(legacy.pk)} の過去活動を自動でこのアカウントへ紐づけました。`;
      }catch(err){
        console.error('automatic legacy link failed',err);
        linkStatus.textContent=`旧BOYAKI ID ${short(legacy.pk)} の自動引き継ぎに失敗しました。通信状態を確認して再試行してください。`;
        linkButton.hidden=false;
        linkButton.addEventListener('click',async()=>{linkButton.disabled=true;linkStatus.textContent='両方のidentityで相互署名しています…';try{await publishLinkPair(identity,legacy);linkStatus.textContent='引き継ぎました。My Pageを更新します…';setTimeout(()=>location.reload(),500)}catch(err){console.error(err);linkStatus.textContent='引き継ぎに失敗しました。通信状態を確認して再試行してください。';linkButton.disabled=false}});
      }
    }else{
      linkStatus.textContent=`このブラウザの旧BOYAKI ID ${short(legacy.pk)} は、このアカウントに引き継ぎ済みです。`;
      linkButton.hidden=true;
    }
  }
  const profile=await loadProfile(identity);
  if(profile.displayName){
    $('#profile-name').textContent=profile.displayName;
    $('#profile-about').textContent=profile.about||'';
    $('#profile-state').textContent='BOYAKIアカウントにログイン中です。';
    $('#profile-actions').innerHTML='<a id="profile-edit-link" class="button-link" href="./profile-edit.html?v=20260904-v2">プロフィールを編集</a><button id="logout-button" type="button">ログアウト</button>';
    setTimeout(()=>{const b=$('#logout-button');if(b)b.addEventListener('click',()=>{localStorage.removeItem('boyaki-account-sk');sessionStorage.removeItem('boyaki-account-sk');location.reload()})},0);
  }else{
    $('#profile-name').textContent='プロフィール未登録';
    $('#profile-state').textContent='アカウント鍵はありますが、プロフィールを取得できませんでした。';
    $('#profile-actions').innerHTML='<a class="button-link" href="./register.html">プロフィールを作る</a>';
  }
  try{await loadOwnedPosts(identity)}catch(err){console.error('owned posts load failed',err);$('#own-posts').innerHTML='<p class="hint">投稿管理データを取得できませんでした。</p>'}
}
main();
