import { SimplePool } from 'https://esm.sh/nostr-tools@2.17.0';
import { RELAYS } from './relays.js';

const pool=new SimplePool();
const LINK_KIND=30078;
const LINK_SCHEMA='boyaki-account-link-v1';
const NOSTR_ID_RE=/^[0-9a-f]{64}$/i;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fmt=value=>new Date(value).toLocaleString('ja-JP');
const tag=(ev,k)=>ev?.tags?.find(t=>t[0]===k)?.[1];
let syncing=false;

async function api(){
  for(let i=0;i<30;i++){
    if(window.BOYAKI_CANONICAL)return window.BOYAKI_CANONICAL;
    await sleep(100);
  }
  throw new Error('canonical_client_missing');
}

function ownershipStatus(text){
  const node=document.querySelector('#ownership-status');
  if(node)node.textContent=text;
}

async function verifiedLinkPairs(accountPk){
  const accepts=await pool.querySync(RELAYS,{kinds:[LINK_KIND],authors:[accountPk],'#schema':[LINK_SCHEMA],limit:200}).catch(()=>[]);
  const out=[];
  for(const accept of accepts){
    const legacy=tag(accept,'legacy');
    if(!NOSTR_ID_RE.test(legacy||'')||tag(accept,'direction')!=='account-accepts-legacy'||tag(accept,'account')!==accountPk)continue;
    const claims=await pool.querySync(RELAYS,{kinds:[LINK_KIND],authors:[legacy],'#schema':[LINK_SCHEMA],limit:50}).catch(()=>[]);
    const claim=claims.find(ev=>tag(ev,'direction')==='legacy-claims-account'&&tag(ev,'account')===accountPk&&tag(ev,'legacy')===legacy);
    if(claim)out.push({legacy,claim,accept});
  }
  return out;
}

async function promoteLegacy(client,accountPk){
  const pairs=await verifiedLinkPairs(accountPk);
  for(const pair of pairs){
    try{await client.verifyIdentityLink(pair.claim,pair.accept)}catch(err){console.warn('canonical identity-link verification failed',pair.legacy,err)}
  }
  const authors=[accountPk,...pairs.map(x=>x.legacy)];
  const raw=await pool.querySync(RELAYS,{kinds:[1],authors,'#t':['boyaki-raw'],limit:1000}).catch(()=>[]);
  let registered=0;
  for(const ev of raw){
    try{await client.registerLegacyControl(ev);registered++}catch(err){console.warn('legacy control registration failed',ev.id,err)}
  }
  return {pairs,raw,registered};
}

function ensureCanonicalBox(){
  const parent=document.querySelector('#own-posts');
  if(!parent)return null;
  let box=parent.querySelector('[data-canonical-own-posts]');
  if(box)return box;
  box=document.createElement('div');
  box.dataset.canonicalOwnPosts='1';
  box.className='stack';
  const head=document.createElement('p');
  head.className='hint';
  head.innerHTML='<strong>Accountで管理する投稿</strong> — 同じAccountでログインしたどの端末からでも削除できます。';
  box.append(head);
  parent.prepend(box);
  return box;
}

async function renderCanonicalMine(client){
  const box=ensureCanonicalBox();
  if(!box)return;
  box.querySelectorAll('[data-canonical-owned-post]').forEach(x=>x.remove());
  const result=await client.listMine();
  const posts=(result.posts||[]).filter(x=>x.status!=='deleted');
  if(!posts.length){
    const empty=document.createElement('p');empty.className='hint';empty.dataset.canonicalOwnedPost='1';empty.textContent='Account管理DBに保存された投稿はまだありません。';box.append(empty);return;
  }
  for(const post of posts){
    const wrap=document.createElement('div');
    wrap.className='participation-panel';wrap.dataset.canonicalOwnedPost='1';
    const text=document.createElement('p');text.textContent=post.content||'(本文削除済み)';wrap.append(text);
    const meta=document.createElement('p');meta.className='hint';meta.textContent=`${fmt(post.created_at)} · ${post.status==='active'?'公開中':post.status} · ${post.id.slice(0,10)}…`;wrap.append(meta);
    const actions=document.createElement('div');actions.className='actions';
    if(post.status==='active'){
      const link=document.createElement('a');link.className='button-link';link.href=`./?problem=${encodeURIComponent(post.id)}`;link.textContent='投稿を見る';actions.append(link);
      const del=document.createElement('button');del.type='button';del.textContent='自分の投稿を削除';
      del.addEventListener('click',async()=>{
        if(!confirm('このBOYAKIを削除しますか？ BOYAKIの管理DBから本文を削除します。'))return;
        del.disabled=true;del.textContent='削除中…';
        try{await client.deletePost(post.id);wrap.remove();ownershipStatus('このAccountの投稿を削除しました。別端末にも同じ状態が反映されます。')}
        catch(err){console.error(err);del.disabled=false;del.textContent='再試行';ownershipStatus('削除できませんでした。通信状態を確認して再試行してください。')}
      });
      actions.append(del);
    }
    wrap.append(actions);box.append(wrap);
  }
}

async function patchLegacyButtons(client){
  const candidates=[...document.querySelectorAll('#own-posts .participation-panel')].filter(x=>!x.dataset.canonicalOwnedPost);
  const ids=[];
  const rows=[];
  for(const wrap of candidates){
    const link=wrap.querySelector('a[href*="problem="]');
    if(!link)continue;
    let id='';try{id=new URL(link.href,location.href).searchParams.get('problem')||''}catch{}
    if(!NOSTR_ID_RE.test(id))continue;
    ids.push(id);rows.push({id,wrap});
  }
  if(!ids.length)return;
  const result=await client.legacyControls(ids).catch(()=>({controls:[]}));
  const controls=new Map((result.controls||[]).map(x=>[x.nostr_event_id,x]));
  for(const row of rows){
    const control=controls.get(row.id);
    if(!control)continue;
    const button=[...row.wrap.querySelectorAll('button')].find(b=>/旧端末でのみ取り下げ可能|自分の投稿を取り下げ|取り下げ済み|再試行/.test(b.textContent||''));
    if(!button)continue;
    if(control.status!=='active'){
      button.disabled=true;button.textContent='取り下げ済み';
      const meta=row.wrap.querySelector('.hint');if(meta)meta.textContent=meta.textContent.replace('公開中','取り下げ済み');
      continue;
    }
    button.disabled=false;button.textContent='自分の投稿を取り下げ';
    if(button.dataset.canonicalLegacyBound==='1')continue;
    button.dataset.canonicalLegacyBound='1';
    button.addEventListener('click',async e=>{
      e.preventDefault();e.stopImmediatePropagation();
      if(!confirm('このBOYAKIを取り下げますか？ 同じAccountのどの端末からも管理できる状態として反映します。'))return;
      button.disabled=true;button.textContent='取り下げ中…';
      try{
        await client.deleteLegacy(row.id);
        button.textContent='取り下げ済み';
        ownershipStatus('旧ブラウザIDの投稿をAccount権限で取り下げました。別端末にも反映されます。');
      }catch(err){console.error(err);button.disabled=false;button.textContent='再試行';ownershipStatus('取り下げを反映できませんでした。再試行してください。')}
    },true);
  }
}

async function syncAccountOwnership(client,id,{quiet=false}={}){
  if(syncing)return;
  syncing=true;
  if(!quiet)ownershipStatus('Account単位の投稿管理を同期しています…');
  try{
    const migrated=await promoteLegacy(client,id.pk);
    await renderCanonicalMine(client);
    for(let i=0;i<12;i++){
      await patchLegacyButtons(client);
      await sleep(500);
    }
    ownershipStatus(migrated.pairs.length
      ?`Account管理を同期しました。引き継ぎ済み旧ID ${migrated.pairs.length}件の投稿も、この端末から管理できます。`
      :'Account管理を同期しました。同じAccountでログインした端末間で投稿を管理できます。');
  }catch(err){
    console.error('canonical mypage sync failed',err);
    ownershipStatus('Account管理DBとの同期の一部に失敗しました。既存の履歴表示は維持されています。');
  }finally{syncing=false}
}

async function activate(){
  const client=await api();
  const ready=await client.initialize();
  const id=client.identity();
  if(!ready||id?.kind!=='account')return;

  const linkButton=document.querySelector('#legacy-link-button');
  if(linkButton){
    linkButton.addEventListener('click',()=>{
      setTimeout(()=>syncAccountOwnership(client,id,{quiet:true}),1800);
      setTimeout(()=>syncAccountOwnership(client,id,{quiet:true}),5000);
    });
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncAccountOwnership(client,id,{quiet:true})});
  await syncAccountOwnership(client,id);
}

activate();
