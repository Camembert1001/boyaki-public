import { SimplePool, getPublicKey, finalizeEvent, nip49 } from 'https://esm.sh/nostr-tools@2.17.0';

const RELAYS=['wss://nos.lol','wss://relay.primal.net'];
const pool=new SimplePool();
const $=s=>document.querySelector(s);
const fromHex=hex=>new Uint8Array((hex.match(/.{1,2}/g)||[]).map(b=>parseInt(b,16)));
const short=pk=>`${pk.slice(0,8)}…${pk.slice(-6)}`;
const fmt=ts=>new Date(ts*1000).toLocaleString('ja-JP');
const tag=(ev,k)=>ev.tags?.find(t=>t[0]===k)?.[1];
const unix=()=>Math.floor(Date.now()/1000);

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
function setText(id,value){const node=$(id);if(node)node.textContent=String(value)}
function historyRow(label,ev){const p=document.createElement('p');p.className='hint';const text=(ev.content||'').trim();p.textContent=`${label} · ${fmt(ev.created_at)}${text?` · ${text.slice(0,120)}`:''}`;return p}
function canonicalCounterTag(ev,name){return tag(ev,'boyaki_counter')===name||tag(ev,'counter')===name}
function deletionTargets(ev){return (ev.tags||[]).filter(t=>t[0]==='e').map(t=>t[1])}

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

function renderOwnPosts(raw,knownDeletionIds,identity){
  const box=$('#own-posts'); if(!box)return;
  box.innerHTML='';
  if(!raw.length){box.innerHTML='<p class="hint">このブラウザIDに紐づくBOYAKI投稿はありません。</p>';return}
  for(const ev of raw.sort((a,b)=>b.created_at-a.created_at)){
    const withdrawn=knownDeletionIds.has(ev.id)||localStorage.getItem(`boyaki-withdrawn:${ev.id}`)==='1';
    const wrap=document.createElement('div');wrap.className='participation-panel';
    const text=document.createElement('p');text.textContent=(ev.content||'').slice(0,220);wrap.append(text);
    const meta=document.createElement('p');meta.className='hint';meta.textContent=`${fmt(ev.created_at)} · ${withdrawn?'取り下げ済み':'公開中'} · ${ev.id.slice(0,10)}…`;wrap.append(meta);
    const actions=document.createElement('div');actions.className='actions';
    const link=document.createElement('a');link.className='button-link';link.href=`./?problem=${encodeURIComponent(ev.id)}`;link.textContent='投稿を見る';actions.append(link);
    const button=document.createElement('button');button.textContent=withdrawn?'取り下げ済み':'自分の投稿を取り下げ';button.disabled=withdrawn;
    button.addEventListener('click',async()=>{if(!confirm('このBOYAKIを取り下げますか？ 公開一覧から除外されます。'))return;button.disabled=true;button.textContent='取り下げ中…';try{await withdrawOwn(ev,identity,knownDeletionIds);button.textContent='取り下げ済み';meta.textContent=`${fmt(ev.created_at)} · 取り下げ済み · ${ev.id.slice(0,10)}…`}catch{button.disabled=false;button.textContent='再試行';$('#ownership-status').textContent='取り下げをRelayへ反映できませんでした。通信状態を確認して再試行してください。'}});
    actions.append(button);wrap.append(actions);box.append(wrap);
  }
}

async function loadEvidence(identity){
  const since=unix()-60*60*24*365;
  const rows=await pool.querySync(RELAYS,{authors:[identity.pk],kinds:[1,5,7,1984,30023],since,limit:1000});
  const deduped=[...new Map(rows.map(x=>[x.id,x])).values()].sort((a,b)=>b.created_at-a.created_at);
  const deletions=deduped.filter(e=>e.kind===5&&e.pubkey===identity.pk);
  const deletedIds=new Set(deletions.flatMap(deletionTargets));
  const raw=deduped.filter(e=>e.kind===1&&tag(e,'t')==='boyaki-raw');
  const activeRaw=raw.filter(e=>!deletedIds.has(e.id));
  const voiceValidations=deduped.filter(e=>canonicalCounterTag(e,'voice-validation'));
  const voiceResolved=deduped.filter(e=>canonicalCounterTag(e,'voice-resolved')||canonicalCounterTag(e,'voice-improved'));
  const makerSolutions=deduped.filter(e=>canonicalCounterTag(e,'maker-solution'));
  const makerReleases=deduped.filter(e=>canonicalCounterTag(e,'maker-release'));
  const makerValidations=deduped.filter(e=>canonicalCounterTag(e,'maker-validation'));
  const makerOutcomes=deduped.filter(e=>canonicalCounterTag(e,'maker-outcome'));
  setText('#voice-boyaki',activeRaw.length);setText('#voice-validations',voiceValidations.length);setText('#voice-resolved',voiceResolved.length);setText('#maker-solutions',makerSolutions.length);setText('#maker-releases',makerReleases.length);setText('#maker-validations',makerValidations.length);setText('#maker-outcomes',makerOutcomes.length);
  const voiceHistory=$('#voice-history');[...activeRaw,...voiceValidations,...voiceResolved].sort((a,b)=>b.created_at-a.created_at).slice(0,8).forEach(ev=>voiceHistory.append(historyRow('Voice evidence',ev)));if(!voiceHistory.children.length)voiceHistory.innerHTML='<p class="hint">まだVoiceのcanonical evidenceはありません。</p>';
  const makerHistory=$('#maker-history');[...makerSolutions,...makerReleases,...makerValidations,...makerOutcomes].sort((a,b)=>b.created_at-a.created_at).slice(0,8).forEach(ev=>makerHistory.append(historyRow('Maker evidence',ev)));if(!makerHistory.children.length)makerHistory.innerHTML='<p class="hint">まだMakerのcanonical evidenceはありません。</p>';
  const recent=$('#recent-history');deduped.slice(0,12).forEach(ev=>recent.append(historyRow(tag(ev,'role')||tag(ev,'t')||`kind-${ev.kind}`,ev)));if(!recent.children.length)recent.innerHTML='<p class="hint">このブラウザIDに紐づく最近の活動はありません。</p>';
  renderOwnPosts(raw,deletedIds,identity);
}

$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const key=$('#login-key').value.trim(),password=$('#login-password').value,remember=$('#remember-login').checked;const button=e.submitter;button.disabled=true;$('#profile-state').textContent='ログイン中…';try{const sk=nip49.decrypt(key,password);const hex=[...sk].map(b=>b.toString(16).padStart(2,'0')).join('');if(remember)localStorage.setItem('boyaki-account-sk',hex);else sessionStorage.setItem('boyaki-account-sk',hex);localStorage.setItem('boyaki-account-login-key',key);location.reload()}catch(err){console.error(err);$('#profile-state').textContent='ログインできませんでした。ログインキーとパスワードを確認してください。'}finally{button.disabled=false}});

async function main(){
  const identity=currentIdentity();
  if(!identity){$('#profile-state').textContent='BOYAKIアカウントにログインしていません。';$('#profile-name').textContent='未ログイン';$('#device-id').textContent='not logged in';$('#profile-actions').innerHTML='<a class="button-link" href="./register.html">新規登録へ</a>';const legacy=legacyIdentity();if(legacy)$('#legacy-identity-note').textContent=`このブラウザには旧BOYAKI ID ${short(legacy.pk)} があります。過去活動のアカウント引き継ぎは次工程です。`;$('#own-posts').innerHTML='<p class="hint">アカウントへログイン後、そのアカウントに紐づく投稿をここで管理できます。</p>';return}
  $('#device-id').textContent=short(identity.pk);
  const profile=await loadProfile(identity);
  if(profile.displayName){$('#profile-name').textContent=profile.displayName;$('#profile-about').textContent=profile.about||'';$('#profile-state').textContent='BOYAKIアカウントにログイン中です。';$('#login-form').hidden=true;$('#profile-actions').innerHTML='<a class="button-link" href="./register.html">プロフィールを編集</a><button id="logout-button" type="button">ログアウト</button>';setTimeout(()=>{const b=$('#logout-button');if(b)b.addEventListener('click',()=>{localStorage.removeItem('boyaki-account-sk');sessionStorage.removeItem('boyaki-account-sk');location.reload()})},0)}else{$('#profile-name').textContent='プロフィール未登録';$('#profile-state').textContent='アカウント鍵はありますが、プロフィールを取得できませんでした。';$('#profile-actions').innerHTML='<a class="button-link" href="./register.html">プロフィールを作る</a>'}
  try{await loadEvidence(identity)}catch{$('#recent-history').innerHTML='<p class="hint">活動データを取得できませんでした。通信状態を確認して再読み込みしてください。</p>';$('#own-posts').innerHTML='<p class="hint">投稿管理データを取得できませんでした。</p>'}
}
main();
